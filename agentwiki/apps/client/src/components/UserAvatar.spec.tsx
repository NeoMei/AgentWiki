import { describe, expect, it } from 'vitest';
import { userInitials } from './UserAvatar';

describe('userInitials', () => {
  it('uses the first and last names for a readable account avatar', () => {
    expect(userInitials('Ada Lovelace', 'ada@example.com')).toBe('AL');
  });

  it('falls back to the email when the account has no display name', () => {
    expect(userInitials('', 'me@example.com')).toBe('ME');
  });
});
