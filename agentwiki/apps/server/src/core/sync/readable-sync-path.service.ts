import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  validatePortablePath,
} from '@neomei/agentwiki-sync-protocol';

const encoder = new TextEncoder();
const fallbackBasename = '未命名文章';
const forbiddenCharacter = /[\p{Cc}<>:"/\\|?*]/u;
const reservedDeviceName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu;
const maxBasenameBytes = 255 - encoder.encode(' (2).md').byteLength;

export interface ReadableSyncPathInput {
  spaceId: string;
  directory: string;
  title: string;
  excludePageId?: string;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maximumBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

export function safeMarkdownBasename(title: string): string {
  let sanitized = '';
  for (const character of title.normalize('NFC')) {
    sanitized += forbiddenCharacter.test(character) ? ' ' : character;
  }
  sanitized = sanitized.replace(/\s+/gu, ' ').trim().replace(/[ .]+$/u, '');
  if (!sanitized || reservedDeviceName.test(sanitized.split('.', 1)[0] ?? '')) {
    sanitized = fallbackBasename;
  }
  return truncateUtf8(sanitized, maxBasenameBytes);
}

@Injectable()
export class ReadableSyncPathService {
  async allocate(
    tx: Prisma.TransactionClient,
    input: ReadableSyncPathInput,
  ): Promise<{ path: string; pathKey: string }> {
    const occupied = await tx.page.findMany({
      where: {
        spaceId: input.spaceId,
        ...(input.excludePageId ? { id: { not: input.excludePageId } } : {}),
      },
      select: { syncPathKey: true },
    });
    const keys = new Set(occupied.map((page) => page.syncPathKey));
    const basename = safeMarkdownBasename(input.title);
    const directory = input.directory.normalize('NFC');
    const directoryBytes = encoder.encode(`${directory}/`).byteLength;
    for (let suffix = 1; ; suffix += 1) {
      const ending = suffix === 1 ? '.md' : ` (${suffix}).md`;
      const endingBytes = encoder.encode(ending).byteLength;
      const basenameBytes = Math.min(
        255 - endingBytes,
        1024 - directoryBytes - endingBytes,
      );
      const name = `${truncateUtf8(basename, basenameBytes)}${ending}`;
      const candidate = validatePortablePath(`${directory}/${name}`);
      if (!keys.has(candidate.key)) {
        return { path: candidate.path, pathKey: candidate.key };
      }
    }
  }
}
