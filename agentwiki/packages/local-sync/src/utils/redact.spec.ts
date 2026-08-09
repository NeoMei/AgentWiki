import { describe, expect, it } from 'vitest';
import { classifySensitivity, isUploadable, redactSecrets } from './redact.js';

describe('redact', () => {
  it('redacts agentwiki key', () => {
    const result = redactSecrets('key=agk_abcdef1234567890');
    expect(result.hasSecret).toBe(true);
    expect(result.text).toContain('[REDACTED:agentwiki-key]');
    expect(result.text).not.toContain('agk_abcdef');
  });

  it('redacts openai api key', () => {
    const result = redactSecrets('sk-abc12345678901234567890');
    expect(result.hasSecret).toBe(true);
    expect(result.text).toContain('[REDACTED:openai-api-key]');
  });

  it('classifies secret text as local-only', () => {
    const sensitivity = classifySensitivity('password=supersecret123');
    expect(sensitivity).toBe('local-only');
  });

  it('detects quoted JSON secret keys', () => {
    const result = redactSecrets('{"apiKey":"SuperSecret123"}');
    expect(result.hasSecret).toBe(true);
    expect(result.text).not.toContain('SuperSecret123');
  });

  it('classifies clean text as shareable', () => {
    const sensitivity = classifySensitivity('Hello world');
    expect(sensitivity).toBe('shareable');
  });

  it('marks local-only as not uploadable', () => {
    expect(isUploadable('local-only')).toBe(false);
  });

  it('marks shareable and review-required as uploadable', () => {
    expect(isUploadable('shareable')).toBe(true);
    expect(isUploadable('review-required')).toBe(true);
  });
});
