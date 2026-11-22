import { safeReturnTo } from './safeReturnTo';

const AUTH_ENDPOINTS = new Set([
  '/auth/login', '/auth/register',
  '/auth/unihub/status', '/auth/unihub/native', '/auth/unihub/pending', '/auth/unihub/finish', '/auth/unihub/logout',
]);

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
