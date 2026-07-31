import { createHash } from 'node:crypto';

/**
 * Deterministic, canonical content hashing.
 *
 * Normalizes input by:
 * - removing UTF-8 BOM
 * - converting CRLF and CR to LF
 * - trimming trailing whitespace per line and at end of content
 */
export function normalizeContent(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeContent(text)).digest('hex');
}
