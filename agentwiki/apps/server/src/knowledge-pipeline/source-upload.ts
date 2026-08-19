import { BadRequestException } from '@nestjs/common';

const replacementCount = (value: string) => (value.match(/�/g) || []).length;
const mojibakeCount = (value: string) => (value.match(/[ÃÂåæçäö]/g) || []).length;

export function normalizeUploadFilename(value: string): string {
  const repaired = Buffer.from(value, 'latin1').toString('utf8');
  if (replacementCount(repaired) > 0) return value.normalize('NFC');
  return mojibakeCount(repaired) < mojibakeCount(value) || /[\u3400-\u9fff]/u.test(repaired)
    ? repaired.normalize('NFC')
    : value.normalize('NFC');
}

export function decodeUtf8Source(buffer: Buffer): string {
  let content: string;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException('Source file must be valid UTF-8');
  }
  if (!content.trim()) throw new BadRequestException('Source file is empty');
  return content;
}
