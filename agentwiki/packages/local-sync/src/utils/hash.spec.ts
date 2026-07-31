import { describe, expect, it } from 'vitest';
import { contentHash, normalizeContent } from './hash.js';

describe('content hash', () => {
  it('is stable for identical normalized content', () => {
    const a = contentHash('Hello\nWorld');
    const b = contentHash('Hello\nWorld');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('normalizes CRLF to LF', () => {
    const a = contentHash('Hello\r\nWorld');
    const b = contentHash('Hello\nWorld');
    expect(a).toBe(b);
  });

  it('normalizes CR to LF', () => {
    const a = contentHash('Hello\rWorld');
    const b = contentHash('Hello\nWorld');
    expect(a).toBe(b);
  });

  it('removes BOM', () => {
    const a = contentHash('\uFEFFHello\nWorld');
    const b = contentHash('Hello\nWorld');
    expect(a).toBe(b);
  });

  it('trims trailing whitespace per line and at end', () => {
    const a = contentHash('Hello   \nWorld\t\n');
    const b = contentHash('Hello\nWorld');
    expect(a).toBe(b);
  });

  it('differs for different content', () => {
    const a = contentHash('Hello');
    const b = contentHash('World');
    expect(a).not.toBe(b);
  });

  it('normalizeContent returns string with normalized line endings', () => {
    expect(normalizeContent('a\r\nb\r')).toBe('a\nb');
  });
});
