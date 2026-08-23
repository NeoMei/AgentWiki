export type Translate = (key: string, params?: Record<string, string | number>) => string;

const CODE_KEYS: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: 'error.authInvalidCredentials',
  AUTH_RATE_LIMITED: 'error.rateLimited',
  AUTH_PASSWORD_POLICY: 'error.passwordPolicy',
  AUTH_PASSWORD_MISMATCH: 'error.passwordMismatch',
  SPACE_ACCESS_DENIED: 'error.spaceAccessDenied',
  AUTH_SCOPE_REQUIRED: 'error.spaceAccessDenied',
  COLLABORATION_HUMAN_PERMISSION_DENIED: 'error.spaceAccessDenied',
  CHANGESET_INVALID_STATE: 'error.changeSetState',
  CHANGESET_CONFLICT: 'error.changeSetConflict',
  APPROVAL_REQUIRED: 'error.approvalRequired',
  SOURCE_INVALID: 'error.sourceInvalid',
  SOURCE_TOO_LARGE: 'error.sourceTooLarge',
  RESOURCE_CONFLICT: 'error.resourceConflict',
  CONFLICT: 'error.resourceConflict',
};

export function apiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const response = (error as { response?: { status?: number; data?: { code?: unknown } } })?.response;
  const code = response?.data?.code;
  if (typeof code === 'string' && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  if (response?.status === 429) return t('error.rateLimited');
  if (!response) return t('error.network');
  return t(fallbackKey);
}
