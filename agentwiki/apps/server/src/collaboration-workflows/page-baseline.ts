import { createHash } from 'node:crypto';

export function canonicalPageContentHash(value: string): string {
  return createHash('sha256').update(value.replace(/\r\n?/gu, '\n'), 'utf8').digest('hex');
}
