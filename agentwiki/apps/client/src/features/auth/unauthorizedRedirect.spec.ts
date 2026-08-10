import { describe, expect, it } from 'vitest';
import { unauthorizedRedirect } from './unauthorizedRedirect';

describe('unauthorizedRedirect', () => {
  it.each(['/auth/login', '/auth/register', '/auth/login?source=onboard'])(
    'lets an authentication form render its own 401 for %s',
    (requestUrl) => {
      expect(unauthorizedRedirect(requestUrl, '/', '')).toBeNull();
    },
  );

  it('preserves a device authorization request when a stale human token is rejected', () => {
    expect(unauthorizedRedirect(
      '/onboard/device/decision',
      '/onboard/device',
      '?user_code=ABCD-EFGH',
    )).toBe(
      '/?intent=onboard&returnTo=%2Fonboard%2Fdevice%3Fuser_code%3DABCD-EFGH#login',
    );
  });

  it.each([
    ['/onboard/device', '?user_code=invalid'],
    ['/dashboard', ''],
    ['//evil.example', ''],
  ])('falls back to the landing page for an unsafe or ordinary path', (pathname, search) => {
    expect(unauthorizedRedirect('/spaces', pathname, search)).toBe('/');
  });
});
