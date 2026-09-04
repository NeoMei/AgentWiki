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
import { SyncV3ErrorEnvelopeSchema } from '@neomei/agentwiki-sync-protocol';
import { SyncApiException } from '../../integrations/obsidian/sync-error';

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
  code: string;
  requestId: string;
  details?: unknown;
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
    const isSyncV3 = /(?:^|\/)sync\/v3(?:\/|\?|$)/u.test(String(request.url ?? ''));

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'Internal server error';
    let error: string = 'Internal Server Error';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const responseBody = exception.getResponse();
      if (typeof responseBody === 'object' && responseBody !== null && 'protocolVersion' in responseBody) {
        // Versioned sync errors are returned verbatim only when the strict v3
        // contract accepts them. Older protocols retain their established
        // envelope until their compatibility window closes.
        const body = responseBody as Record<string, any>;
        const strictV3 = SyncV3ErrorEnvelopeSchema.safeParse(body);
        if ((isSyncV3 || body.protocolVersion === '3') && !strictV3.success) {
          const safeException = new SyncApiException(
            'INTERNAL_ERROR', 'Sync v3 request failed', undefined, '3',
          );
          const safeBody = SyncV3ErrorEnvelopeSchema.parse(safeException.getResponse());
          this.logger.error(
            `[${request.method}] ${request.url} - ${safeException.getStatus()}: Sync v3 request failed safely`,
          );
          httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
          httpAdapter.reply(response, safeBody, safeException.getStatus());
          return;
        } else {
          const responseEnvelope = strictV3.success ? strictV3.data : body;
          this.logger.error(
            `[${request.method}] ${request.url} - ${statusCode}: ${body?.error?.message ?? exception.message}`,
          );
          const headers: Record<string, string> = {};
          if (statusCode === HttpStatus.TOO_MANY_REQUESTS) {
            headers['Retry-After'] = '1';
          }
          httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
          if (headers['Retry-After']) httpAdapter.setHeader(response, 'Retry-After', headers['Retry-After']);
          httpAdapter.reply(response, responseEnvelope, statusCode);
          return;
        }
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
        details = body.details;
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

    if (isSyncV3) {
      const safeException = statusCode === HttpStatus.BAD_REQUEST
        ? new SyncApiException('PAYLOAD_INVALID', 'Invalid Sync v3 request', undefined, '3')
        : statusCode === HttpStatus.PAYLOAD_TOO_LARGE
          ? new SyncApiException('BATCH_TOO_LARGE', 'Sync v3 request is too large', undefined, '3')
          : statusCode === HttpStatus.TOO_MANY_REQUESTS
            ? new SyncApiException('RATE_LIMITED', 'Sync v3 request is rate limited', undefined, '3')
            : new SyncApiException('INTERNAL_ERROR', 'Sync v3 request failed', undefined, '3');
      const safeBody = SyncV3ErrorEnvelopeSchema.parse(safeException.getResponse());
      this.logger.error(
        `[${request.method}] ${request.url} - ${safeException.getStatus()}: Sync v3 request failed safely`,
      );
      httpAdapter.setHeader(response, 'Cache-Control', 'no-store');
      if (safeException.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        httpAdapter.setHeader(response, 'Retry-After', '1');
      }
      httpAdapter.reply(response, safeBody, safeException.getStatus());
      return;
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
      ...(details === undefined ? {} : { details }),
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
