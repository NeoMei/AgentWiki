import { describe, expect, it } from 'vitest';
import { registrationEmailError } from './registration-error';

describe('registrationEmailError', () => {
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
    expect(registrationEmailError({ response: { status, data: { code, message } } })).toBe(expected);
  });

  it('leaves network and malformed responses to the shared error handler', () => {
    expect(registrationEmailError(new Error('offline'))).toBeNull();
    expect(registrationEmailError({ response: { status: 400, data: null } })).toBeNull();
  });
});
