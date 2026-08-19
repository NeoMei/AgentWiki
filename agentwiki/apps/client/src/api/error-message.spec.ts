import { describe, expect, it } from 'vitest';
import { apiErrorMessage } from './error-message';

const t = (key: string) => ({
  'error.authInvalidCredentials': '邮箱或密码错误',
  'error.rateLimited': '请求过于频繁，请稍后再试',
  'auth.loginFailed': '登录失败',
}[key] || key);

describe('apiErrorMessage', () => {
  it('uses stable business codes instead of an English server message', () => {
    expect(apiErrorMessage({ response: { status: 401, data: {
      code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
    } } }, t, 'auth.loginFailed')).toBe('邮箱或密码错误');
  });

  it('maps 429 without exposing its English payload', () => {
    expect(apiErrorMessage({ response: { status: 429, data: {
      message: 'Too many requests',
    } } }, t, 'auth.loginFailed')).toBe('请求过于频繁，请稍后再试');
  });
});
