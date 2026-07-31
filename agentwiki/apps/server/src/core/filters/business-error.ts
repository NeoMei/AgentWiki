import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  error: string;
}

/**
 * Maps domain-specific error codes to HTTP status and message.
 * This allows API consumers (especially Agents) to programmatically
 * distinguish error scenarios beyond generic HTTP status codes.
 */
const ERROR_CODE_MAP: Record<string, { status: HttpStatus; message: string }> = {
  AUTH_INVALID_CREDENTIALS: { status: HttpStatus.UNAUTHORIZED, message: 'Invalid credentials' },
  AUTH_RATE_LIMITED: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests' },
  AUTH_SCOPE_REQUIRED: { status: HttpStatus.FORBIDDEN, message: 'Required scope is missing' },
  LOCAL_SYNC_CODE_INVALID: { status: HttpStatus.UNAUTHORIZED, message: 'Local sync installation code is invalid or expired' },
  LOCAL_SYNC_VERSION_UNSUPPORTED: { status: HttpStatus.CONFLICT, message: 'Local sync plugin version is unsupported' },
  SPACE_ACCESS_DENIED: { status: HttpStatus.FORBIDDEN, message: 'Space access denied' },
  SPACE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Space not found' },
  RESOURCE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Resource not found' },
  RESOURCE_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Resource conflict' },
  SOURCE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Source is invalid' },
  SOURCE_TOO_LARGE: { status: HttpStatus.BAD_REQUEST, message: 'Source exceeds size limit' },
  KNOWLEDGE_BUNDLE_INVALID: { status: HttpStatus.BAD_REQUEST, message: "Knowledge bundle is invalid or violates schema constraints" },
  KNOWLEDGE_BASE_STALE: { status: HttpStatus.CONFLICT, message: "The provided base revision is not the current space revision" },
  KNOWLEDGE_REVISION_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: "Knowledge revision not found" },
  SYNC_CONFIRMATION_REQUIRED: { status: HttpStatus.BAD_REQUEST, message: 'Explicit confirmation is required before synchronization' },
  RUN_NOT_RETRYABLE: { status: HttpStatus.CONFLICT, message: 'Run cannot be retried' },
  CHANGESET_INVALID_STATE: { status: HttpStatus.CONFLICT, message: 'Change set state does not allow this operation' },
  CHANGESET_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Change set conflicts with newer resource state' },
  APPROVAL_REQUIRED: { status: HttpStatus.FORBIDDEN, message: 'Approval is required before publishing' },
  MEMORY_QUOTA_EXCEEDED: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Memory quota exceeded' },
};

export class BusinessException extends HttpException {
  readonly businessCode: string;
  readonly statusCode: number;

  constructor(code: keyof typeof ERROR_CODE_MAP, messageOverride?: string) {
    const def = ERROR_CODE_MAP[code];
    const errorName = def.status === HttpStatus.UNAUTHORIZED ? 'Unauthorized'
      : def.status === HttpStatus.FORBIDDEN ? 'Forbidden'
      : def.status === HttpStatus.NOT_FOUND ? 'Not Found'
      : def.status === HttpStatus.CONFLICT ? 'Conflict'
      : def.status === HttpStatus.TOO_MANY_REQUESTS ? 'Too Many Requests'
      : 'Bad Request';
    const payload: BusinessErrorPayload = {
      statusCode: def.status,
      code,
      message: messageOverride || def.message,
      error: errorName,
    };
    super(payload, def.status);
    this.businessCode = code;
    this.statusCode = def.status;
  }
}

export function getBusinessCode(exception: unknown): string | undefined {
  if (exception instanceof BusinessException) {
    return exception.businessCode;
  }
  if (exception instanceof HttpException) {
    const body = exception.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      const code = (body as Record<string, unknown>).code;
      if (typeof code === 'string' && code in ERROR_CODE_MAP) return code;
    }
  }
  return undefined;
}
