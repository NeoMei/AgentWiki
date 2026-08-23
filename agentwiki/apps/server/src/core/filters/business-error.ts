import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessErrorPayload {
  statusCode: number;
  code: string;
  message: string;
  error: string;
  details?: unknown;
}

/**
 * Maps domain-specific error codes to HTTP status and message.
 * This allows API consumers (especially Agents) to programmatically
 * distinguish error scenarios beyond generic HTTP status codes.
 */
const ERROR_CODE_MAP: Record<string, { status: HttpStatus; message: string }> = {
  AUTH_INVALID_CREDENTIALS: { status: HttpStatus.UNAUTHORIZED, message: 'Invalid credentials' },
  AUTH_DENIED: { status: HttpStatus.FORBIDDEN, message: 'Authorization was denied' },
  AUTH_EXPIRED: { status: HttpStatus.UNAUTHORIZED, message: 'Authorization has expired' },
  AUTH_RATE_LIMITED: { status: HttpStatus.TOO_MANY_REQUESTS, message: 'Too many requests' },
  AUTH_PASSWORD_POLICY: { status: HttpStatus.BAD_REQUEST, message: 'Password does not meet policy requirements' },
  AUTH_PASSWORD_MISMATCH: { status: HttpStatus.BAD_REQUEST, message: 'Passwords do not match' },
  AUTH_INVALID_STATE: { status: HttpStatus.CONFLICT, message: 'Authentication state does not allow this operation' },
  AUTH_SCOPE_REQUIRED: { status: HttpStatus.FORBIDDEN, message: 'Required scope is missing' },
  HUMAN_AUTH_REQUIRED: { status: HttpStatus.FORBIDDEN, message: 'This operation requires a human account' },
  LOCAL_SYNC_CODE_INVALID: { status: HttpStatus.UNAUTHORIZED, message: 'Local sync installation code is invalid or expired' },
  LOCAL_SYNC_CODE_EXPIRED: { status: HttpStatus.UNAUTHORIZED, message: 'Local sync installation code has expired' },
  LOCAL_SYNC_VERSION_UNSUPPORTED: { status: HttpStatus.CONFLICT, message: 'Local sync plugin version is unsupported' },
  ONBOARDING_IDEMPOTENCY_KEY_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Idempotency-Key is missing or invalid' },
  ONBOARDING_PLAN_HASH_MISMATCH: { status: HttpStatus.BAD_REQUEST, message: 'Onboarding server plan does not match the authorized session' },
  ONBOARDING_REPLAY_MISMATCH: { status: HttpStatus.CONFLICT, message: 'Onboarding replay does not match the original request' },
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
  COLLABORATION_TEMPLATE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Collaboration template is invalid' },
  COLLABORATION_TEMPLATE_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Collaboration template not found' },
  COLLABORATION_SYSTEM_TEMPLATE_IMMUTABLE: { status: HttpStatus.CONFLICT, message: 'System collaboration templates are immutable' },
  COLLABORATION_TEMPLATE_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Collaboration template changed; reload before saving' },
  COLLABORATION_HUMAN_PERMISSION_DENIED: { status: HttpStatus.FORBIDDEN, message: 'This human member cannot perform the collaboration action' },
  COLLABORATION_RUN_VERSION_CONFLICT: { status: HttpStatus.CONFLICT, message: 'Collaboration run draft changed; reload before continuing' },
  COLLABORATION_HISTORY_QUERY_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Collaboration history query is invalid' },
  COLLABORATION_HISTORY_PAGE_TOO_LARGE: { status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'Collaboration history page exceeds the response budget' },
  COLLABORATION_RUN_LIST_QUERY_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'Collaboration run list query is invalid' },
  COLLABORATION_RUN_TERMINAL: { status: HttpStatus.CONFLICT, message: 'The collaboration run is terminal' },
  COLLABORATION_PROGRESS_INVARIANT: { status: HttpStatus.CONFLICT, message: 'Collaboration progression state requires human recovery' },
  COLLABORATION_AGENT_INACTIVE: { status: HttpStatus.CONFLICT, message: 'A bound Agent is inactive' },
  COLLABORATION_AGENT_CANNOT_EXECUTE: { status: HttpStatus.FORBIDDEN, message: 'A bound Agent cannot execute collaboration tasks' },
  COLLABORATION_AGENT_NOT_BOUND: { status: HttpStatus.FORBIDDEN, message: 'The Agent is not a bound or assigned participant in this run' },
  COLLABORATION_LEASE_EXPIRED: { status: HttpStatus.CONFLICT, message: 'The collaboration task lease expired' },
  COLLABORATION_TODO_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'Collaboration Todo not found' },
  COLLABORATION_TODO_OUT_OF_ORDER: { status: HttpStatus.CONFLICT, message: 'Required earlier Todo items must finish first' },
  COLLABORATION_TODO_TRANSITION_INVALID: { status: HttpStatus.CONFLICT, message: 'Collaboration Todo transition is invalid' },
  COLLABORATION_EXTERNAL_REFERENCE_INVALID: { status: HttpStatus.BAD_REQUEST, message: 'External Artifact reference is invalid' },
  COLLABORATION_REVIEWER_DENIED: { status: HttpStatus.FORBIDDEN, message: 'The human member is not an allowed reviewer' },
  COLLABORATION_REVIEW_TERMINATE_DENIED: { status: HttpStatus.FORBIDDEN, message: 'This review gate cannot terminate the run' },
  COLLABORATION_IDEMPOTENCY_MISMATCH: { status: HttpStatus.CONFLICT, message: 'Idempotency key was reused for another collaboration action' },
};

function errorNameFor(status: HttpStatus): string {
  return status === HttpStatus.UNAUTHORIZED ? 'Unauthorized'
    : status === HttpStatus.FORBIDDEN ? 'Forbidden'
    : status === HttpStatus.NOT_FOUND ? 'Not Found'
    : status === HttpStatus.CONFLICT ? 'Conflict'
    : status === HttpStatus.TOO_MANY_REQUESTS ? 'Too Many Requests'
    : status === HttpStatus.PAYLOAD_TOO_LARGE ? 'Payload Too Large'
    : 'Bad Request';
}

export class BusinessException extends HttpException {
  readonly businessCode: string;
  readonly statusCode: number;

  constructor(code: keyof typeof ERROR_CODE_MAP, messageOverride?: string, details?: unknown) {
    const def = ERROR_CODE_MAP[code];
    const payload: BusinessErrorPayload = {
      statusCode: def.status,
      code,
      message: messageOverride || def.message,
      error: errorNameFor(def.status),
      ...(details === undefined ? {} : { details }),
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
