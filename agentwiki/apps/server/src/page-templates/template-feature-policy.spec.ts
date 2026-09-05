import { ConfigService } from '@nestjs/config';
import { TemplateFeaturePolicy } from './template-feature-policy';

describe('TemplateFeaturePolicy', () => {
  const policy = (value: unknown) => new TemplateFeaturePolicy({
    get: jest.fn().mockReturnValue(value),
  } as unknown as ConfigService);

  it('is default closed when the allowlist is missing or empty', () => {
    expect(policy(undefined).canCreate('space-a')).toBe(false);
    expect(policy('').canCreate('space-a')).toBe(false);
    expect(policy(' ,  , ').canCreate('space-a')).toBe(false);
  });

  it('matches only exact trimmed Space ids', () => {
    const subject = policy(' space-a,space-b,space-a ');

    expect(subject.canCreate('space-a')).toBe(true);
    expect(subject.canCreate('space-b')).toBe(true);
    expect(subject.canCreate('space')).toBe(false);
    expect(subject.canCreate('SPACE-A')).toBe(false);
  });

  it('does not interpret a wildcard as all Spaces', () => {
    expect(policy('*').canCreate('space-a')).toBe(false);
  });
});
