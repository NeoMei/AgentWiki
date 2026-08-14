import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { getBusinessCode } from './business-error';
import { HttpAdapterHost } from '@nestjs/core';
import { Prisma } from '@prisma/client';

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  code: string;
  requestId: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'Internal server error';
    let error: string = 'Internal Server Error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'object' && responseBody !== null && 'protocolVersion' in responseBody) {
        // Sync v1 error envelope must be returned verbatim with Retry-After on 429.
        const body = responseBody as Record<string, any>;
        this.logger.error(
          `[${request.method}] ${request.url} - ${statusCode}: ${body?.error?.message ?? exception.message}`,
        );
        const headers: Record<string, string> = {};
        if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
          headers['Retry-After'] = '1';
        }
        httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
        if (headers['Retry-After']) httpAdapter.setHeader(response, 'Retry-After', headers['Retry-After']);
        httpAdapter.reply(response, body, statusCode);
        return;
      }
      if (typeof responseBody === 'string') {
        message = responseBody;
      } else if (typeof responseBody === 'object' && responseBody !== null) {
        const body = responseBody as Record<string, unknown>;
        message =
          typeof body.message === 'string'
            ? body.message
            : Array.isArray(body.message)
              ? body.message.join(', ')
              : JSON.stringify(body.message);
        error = typeof body.error === 'string' ? body.error : exception.name;
      } else {
        message = exception.message;
        error = exception.name;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = this.mapPrismaError(exception);
      statusCode = prismaError.statusCode;
      message = prismaError.message;
      error = prismaError.error;
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST;
      message = 'Validation error';
      error = 'Bad Request';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database initialization failed';
      error = 'Service Unavailable';
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Database engine panic';
      error = 'Service Unavailable';
    } else if ((exception as any).status === 413 || (exception as any).statusCode === 413) {
      statusCode = HttpStatus.PAYLOAD_TOO_LARGE;
      message = 'Request body too large';
      error = 'Payload Too Large';
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const stack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error(
      `[${request.method}] ${request.url} - ${statusCode}: ${message}${stack && !isProduction ? '\n' + stack : ''}`,
    );

    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
      code: getBusinessCode(exception) || this.errorCode(statusCode),
      requestId: request.requestId || 'unknown',
    };

    httpAdapter.reply(response, errorResponse, statusCode);
  }

  private errorCode(statusCode: number): string {
    return ({
      400: 'BAD_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN',
      404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED',
      413: 'REQUEST_TOO_LARGE',
      503: 'SERVICE_UNAVAILABLE',
    } as Record<number, string>)[statusCode] || 'INTERNAL_ERROR';
  }

  private mapPrismaError(
    exception: Prisma.PrismaClientKnownRequestError,
  ): { statusCode: number; message: string; error: string } {
    switch (exception.code) {
      case 'P2000':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Input data is too long',
          error: 'Bad Request',
        };
      case 'P2001':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record does not exist',
          error: 'Not Found',
        };
      case 'P2002': {
        const fields = (exception.meta?.target as string[]) ?? [];
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `Unique constraint failed on ${fields.join(', ')}`,
          error: 'Conflict',
        };
      }
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'Not Found',
        };
      case 'P2014':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid relation reference',
          error: 'Bad Request',
        };
      case 'P2015':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Related record not found',
          error: 'Bad Request',
        };
      case 'P2016':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Query interpretation error',
          error: 'Bad Request',
        };
      case 'P2021':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Table does not exist',
          error: 'Bad Request',
        };
      case 'P2022':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Column does not exist',
          error: 'Bad Request',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          error: 'Internal Server Error',
        };
    }
  }
}
