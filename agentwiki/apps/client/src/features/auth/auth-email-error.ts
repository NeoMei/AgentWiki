export type AuthEmailError = 'invalid' | 'inUse';

/** Recognize only known authentication responses; never display raw server text. */
export function authEmailError(error: unknown, registering: boolean): AuthEmailError | null {
  const response = (error as { response?: { status?: number; data?: { code?: unknown; message?: unknown } } })?.response;
  const { code, message } = response?.data ?? {};
  if (registering && response?.status === 409 && (
    code === 'AUTH_EMAIL_IN_USE'
    // Retain compatibility while an older API is still serving requests.
    || (code === 'RESOURCE_CONFLICT' && message === 'Email already in use')
  )) return 'inUse';

  if (response?.status === 400 && (code === 'BAD_REQUEST' || code === undefined)) {
    const messages = typeof message === 'string' ? message.split(', ') : Array.isArray(message) ? message : [];
    if (messages.includes('email must be an email')) return 'invalid';
  }
  return null;
}
