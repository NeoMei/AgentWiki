import { describe, expect, it } from 'vitest';
import { authEmailError } from './auth-email-error';

describe('authEmailError', () => {
  it.each([
    [409, 'AUTH_EMAIL_IN_USE', 'Email already in use', 'inUse'],
    [409, 'RESOURCE_CONFLICT', 'Email already in use', 'inUse'],
    [400, 'BAD_REQUEST', 'email must be an email', 'invalid'],
    [400, undefined, ['email must be an email'], 'invalid'],
    [400, 'BAD_REQUEST', 'email must be an email, name must be a string', 'invalid'],
    [400, 'BAD_REQUEST', 'name must be a string', null],
    [409, 'RESOURCE_CONFLICT', 'Unrelated resource conflict', null],
    [500, 'INTERNAL_ERROR', 'email must be an email', null],
    [429, 'AUTH_RATE_LIMITED', 'Too many requests', null],
  ])('classifies only the known response %s / %s / %s', (status, code, message, expected) => {
    expect(authEmailError({ response: { status, data: { code, message } } }, true)).toBe(expected);
  });

  it('leaves network and malformed responses to the shared error handler', () => {
    expect(authEmailError(new Error('offline'), true)).toBeNull();
    expect(authEmailError({ response: { status: 400, data: null } }, true)).toBeNull();
  });

  it('recognizes email validation for login without treating login conflicts as duplicate registrations', () => {
    expect(authEmailError({ response: { status: 400, data: { code: 'BAD_REQUEST', message: 'email must be an email' } } }, false)).toBe('invalid');
    expect(authEmailError({ response: { status: 409, data: { code: 'AUTH_EMAIL_IN_USE' } } }, false)).toBeNull();
    expect(authEmailError({ response: { status: 409, data: { code: 'RESOURCE_CONFLICT', message: 'Email already in use' } } }, false)).toBeNull();
  });
});
