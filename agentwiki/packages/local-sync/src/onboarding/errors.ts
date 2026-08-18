/**
 * Stable failure codes and typed onboarding errors.
 *
 * Failure codes are public protocol values asserted by tests and consumed by
 * the NDJSON failed event. They never carry free-form diagnostic text as the
 * protocol contract.
 */

export const ONBOARDING_FAILURE_CODES = [
  'AUTH_DENIED',
  'AUTH_EXPIRED',
  'PROTOCOL_UNSUPPORTED',
  'CLIENT_UNSUPPORTED',
  'CONFIG_NOT_WRITABLE',
  'CONFIG_CONFLICT',
  'PACKAGE_INTEGRITY_FAILED',
  'MCP_HANDSHAKE_FAILED',
  'TOOLSET_MISMATCH',
  'REMOTE_UNAVAILABLE',
  'SCAN_FAILED',
  'CODEGRAPH_NOT_FOUND',
  'CODEGRAPH_CAPABILITY_UNSUPPORTED',
  'CODEGRAPH_SCAN_PLAN_CHANGED',
  'CODEGRAPH_INDEX_INCOMPLETE',
  'CODEGRAPH_SCAN_FAILED',
  'CODE_SNAPSHOT_INVALID',
  'CODE_ANALYSIS_FAILED',
  'CODE_ENRICHMENT_SKIPPED',
  'CONFIRMATION_REQUIRED',
  'PREVIEW_CHANGED',
  'SYNC_CONFLICT',
  'SYNC_FAILED',
] as const;

export type OnboardingFailureCode = (typeof ONBOARDING_FAILURE_CODES)[number];

export interface OnboardingFailure {
  code: OnboardingFailureCode;
  message: string;
  retryable: boolean;
  resumeSessionId?: string;
  nextAction?: string;
}

export class OnboardingError extends Error implements OnboardingFailure {
  readonly code: OnboardingFailureCode;
  readonly retryable: boolean;
  readonly resumeSessionId?: string;
  readonly nextAction?: string;

  constructor(failure: OnboardingFailure) {
    super(failure.message);
    this.name = 'OnboardingError';
    this.code = failure.code;
    this.retryable = failure.retryable;
    this.resumeSessionId = failure.resumeSessionId;
    this.nextAction = failure.nextAction;
  }

  toFailure(): OnboardingFailure {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.resumeSessionId !== undefined ? { resumeSessionId: this.resumeSessionId } : {}),
      ...(this.nextAction !== undefined ? { nextAction: this.nextAction } : {}),
    };
  }
}

/** HTTP statuses where retrying the same idempotent request is semantically safe. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
