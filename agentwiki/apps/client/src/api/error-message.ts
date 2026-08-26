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
  PAGE_TEMPLATE_INVALID: 'pageTemplate.invalid',
  PAGE_TEMPLATE_NOT_FOUND: 'pageTemplate.notFound',
  PAGE_TEMPLATE_VERSION_NOT_FOUND: 'pageTemplate.versionNotFound',
  PAGE_TEMPLATE_ARCHIVED: 'pageTemplate.archived',
  PAGE_TEMPLATE_SOURCE_INVALID: 'pageTemplate.sourceInvalid',
  PAGE_TEMPLATE_SYSTEM_IMMUTABLE: 'pageTemplate.systemImmutable',
  PAGE_TEMPLATE_AGENT_UNSUPPORTED: 'pageTemplate.agentUnsupported',
  PAGE_TEMPLATE_PERMISSION_DENIED: 'pageTemplate.permissionDenied',
  PAGE_TEMPLATE_NAME_CONFLICT: 'pageTemplate.nameConflict',
  PAGE_TEMPLATE_VERSION_CONFLICT: 'pageTemplate.versionConflict',
  PAGE_TEMPLATE_SOURCE_STALE: 'pageTemplate.sourceStale',
  PAGE_TEMPLATE_QUOTA_EXCEEDED: 'pageTemplate.quotaExceeded',
};

export function apiErrorMessage(error: unknown, t: Translate, fallbackKey: string): string {
  const response = (error as { response?: { status?: number; data?: { code?: unknown } } })?.response;
  const code = response?.data?.code;
  if (typeof code === 'string' && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  if (response?.status === 429) return t('error.rateLimited');
  if (!response) return t('error.network');
  return t(fallbackKey);
}

export function apiErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}
