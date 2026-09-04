import { HttpException, HttpStatus } from '@nestjs/common';
import type { SyncErrorCode, SyncV3ErrorCode } from '@neomei/agentwiki-sync-protocol';

type AnySyncErrorCode = SyncErrorCode | SyncV3ErrorCode;

interface SyncErrorDefinition {
  status: HttpStatus;
  retryable: boolean;
}

const SYNC_ERROR_MAP: Record<AnySyncErrorCode, SyncErrorDefinition> = {
  AUTHENTICATION_REQUIRED: { status: HttpStatus.UNAUTHORIZED, retryable: false },
  DEVICE_CREDENTIAL_REVOKED: { status: HttpStatus.UNAUTHORIZED, retryable: false },
  DEVICE_CREDENTIAL_EXPIRED: { status: HttpStatus.UNAUTHORIZED, retryable: false },
  USER_INACTIVE: { status: HttpStatus.FORBIDDEN, retryable: false },
  SPACE_FORBIDDEN: { status: HttpStatus.FORBIDDEN, retryable: false },
  SPACE_READ_ONLY: { status: HttpStatus.FORBIDDEN, retryable: false },
  INSTALLATION_NOT_FOUND: { status: HttpStatus.NOT_FOUND, retryable: false },
  INSTALLATION_REVOKED: { status: HttpStatus.GONE, retryable: false },
  INSTALLATION_ALREADY_EXCHANGED: { status: HttpStatus.CONFLICT, retryable: false },
  INSTALLATION_CODE_INVALID: { status: HttpStatus.UNAUTHORIZED, retryable: false },
  INSTALLATION_CODE_EXPIRED: { status: HttpStatus.UNAUTHORIZED, retryable: false },
  CREDENTIAL_COLLISION: { status: HttpStatus.CONFLICT, retryable: false },
  PROTOCOL_UNSUPPORTED: { status: HttpStatus.CONFLICT, retryable: false },
  SYNC_PROTOCOL_UPGRADE_REQUIRED: { status: HttpStatus.CONFLICT, retryable: false },
  REVISION_GONE: { status: HttpStatus.GONE, retryable: false },
  CURSOR_INVALID: { status: HttpStatus.BAD_REQUEST, retryable: false },
  BASE_STALE: { status: HttpStatus.CONFLICT, retryable: false },
  CONFIRMATION_REQUIRED: { status: HttpStatus.BAD_REQUEST, retryable: false },
  CONFIRMATION_MISMATCH: { status: HttpStatus.CONFLICT, retryable: false },
  PAYLOAD_INVALID: { status: HttpStatus.BAD_REQUEST, retryable: false },
  PATH_COLLISION: { status: HttpStatus.CONFLICT, retryable: false },
  PAGE_ID_CONFLICT: { status: HttpStatus.CONFLICT, retryable: false },
  PAGE_TOO_LARGE: { status: HttpStatus.PAYLOAD_TOO_LARGE, retryable: false },
  BATCH_TOO_LARGE: { status: HttpStatus.PAYLOAD_TOO_LARGE, retryable: false },
  SPACE_TOO_LARGE: { status: HttpStatus.CONFLICT, retryable: false },
  BATCH_MISMATCH: { status: HttpStatus.CONFLICT, retryable: false },
  PUSH_SESSION_EXPIRED: { status: HttpStatus.GONE, retryable: false },
  PUSH_SESSION_NOT_FOUND: { status: HttpStatus.NOT_FOUND, retryable: false },
  PUSH_SESSION_STATE_INVALID: { status: HttpStatus.CONFLICT, retryable: false },
  PUSH_SESSION_INCOMPLETE: { status: HttpStatus.CONFLICT, retryable: false },
  IDEMPOTENCY_MISMATCH: { status: HttpStatus.CONFLICT, retryable: false },
  CAPABILITIES_CHANGED: { status: HttpStatus.CONFLICT, retryable: false },
  QUOTA_EXCEEDED: { status: HttpStatus.PAYLOAD_TOO_LARGE, retryable: false },
  RATE_LIMITED: { status: HttpStatus.TOO_MANY_REQUESTS, retryable: true },
  INTERNAL_ERROR: { status: HttpStatus.INTERNAL_SERVER_ERROR, retryable: true },
  ATTACHMENT_REFERENCE_INVALID: { status: HttpStatus.BAD_REQUEST, retryable: false },
  ATTACHMENT_MISSING: { status: HttpStatus.CONFLICT, retryable: false },
  ATTACHMENT_CONTENT_INVALID: { status: HttpStatus.BAD_REQUEST, retryable: false },
  ATTACHMENT_NAME_CONFLICT: { status: HttpStatus.CONFLICT, retryable: false },
  ATTACHMENT_REFERENCED: { status: HttpStatus.CONFLICT, retryable: false },
  ATTACHMENT_BLOB_MISSING: { status: HttpStatus.CONFLICT, retryable: false },
  ATTACHMENT_QUOTA_EXCEEDED: { status: HttpStatus.PAYLOAD_TOO_LARGE, retryable: false },
};

export class SyncApiException extends HttpException {
  readonly syncCode: AnySyncErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AnySyncErrorCode,
    message: string,
    details?: Record<string, string | number | boolean | null>,
    protocolVersion: '1' | '2' | '3' = '1',
  ) {
    const definition = SYNC_ERROR_MAP[code];
    const body = {
      protocolVersion,
      error: {
        code,
        message,
        retryable: definition.retryable,
        ...(details ? { details } : {}),
      },
    };
    super(body, definition.status);
    this.syncCode = code;
    this.retryable = definition.retryable;
  }
}

export function syncErrorStatus(code: AnySyncErrorCode): number {
  return SYNC_ERROR_MAP[code].status;
}
