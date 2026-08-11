import { safeReturnTo } from './safeReturnTo';

const AUTH_ENDPOINTS = new Set(['/auth/login', '/auth/register']);

export const unauthorizedRedirect = (
  requestUrl: unknown,
  pathname: string,
  search: string,
): string | null => {
  if (typeof requestUrl === 'string' && AUTH_ENDPOINTS.has(requestUrl.split('?')[0])) {
    return null;
  }

  const returnTo = safeReturnTo(`${pathname}${search}`);
  if (returnTo) {
    return `/?intent=onboard&returnTo=${encodeURIComponent(returnTo)}#login`;
  }

  return '/';
};
