import { describe, expect, it } from 'vitest';
import { truncateValidatorLength, validatorLength } from './validatorLength';

describe('validator.js-compatible client length', () => {
  it.each([
    [80, 81],
    [200, 201],
    [240, 241],
  ])('keeps emoji at %i and truncates the %i-th code point', (limit, overLimit) => {
    const value = '😀'.repeat(overLimit);
    expect(validatorLength(value)).toBe(overLimit);
    expect(validatorLength(truncateValidatorLength(value, limit))).toBe(limit);
    expect(truncateValidatorLength(value, limit).endsWith('😀')).toBe(true);
  });

  it('discounts one trailing variation selector but counts consecutive selectors separately', () => {
    expect(validatorLength('✈️')).toBe(1);
    expect(validatorLength(`a${'️'.repeat(2)}`)).toBe(2);
    expect(truncateValidatorLength(`a${'✈️'.repeat(200)}`, 200))
      .toBe(`a${'✈️'.repeat(199)}`);
  });
});
