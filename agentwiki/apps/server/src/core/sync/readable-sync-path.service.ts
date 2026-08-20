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
declare const spaceAdvisoryLock: unique symbol;

/**
 * A Prisma transaction after it acquired the shared transaction-scoped Space
 * advisory lock. Only SpaceRevisionWriterService.lockSpace() may brand one.
 */
export type SpaceLockedTransaction = Prisma.TransactionClient & {
  readonly [spaceAdvisoryLock]: true;
};

export interface ReadableSyncPathInput {
  spaceId: string;
  /** Canonical relative directory; an empty string represents the vault root. */
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

export function syncPathDirectory(syncPath: string): string {
  const separator = syncPath.lastIndexOf('/');
  return separator === -1 ? '' : syncPath.slice(0, separator);
}

@Injectable()
export class ReadableSyncPathService {
  /**
   * Selects the first currently free candidate; it does not reserve or retry
   * the path. The caller must write through the same Space-locked transaction.
   * UNIQUE(spaceId, syncPathKey) remains the final database invariant.
   */
  async allocate(
    tx: SpaceLockedTransaction,
    input: ReadableSyncPathInput,
    occupiedPathKeys?: ReadonlySet<string>,
  ): Promise<{ path: string; pathKey: string }> {
    const keys = occupiedPathKeys ?? new Set((await tx.page.findMany({
      where: {
        spaceId: input.spaceId,
        ...(input.excludePageId ? { id: { not: input.excludePageId } } : {}),
      },
      select: { syncPathKey: true },
    })).map((page) => page.syncPathKey));
    const basename = safeMarkdownBasename(input.title);
    const directory = input.directory.normalize('NFC');
    const pathPrefix = directory ? `${directory}/` : '';
    const directoryBytes = encoder.encode(pathPrefix).byteLength;
    for (let suffix = 1; ; suffix += 1) {
      const ending = suffix === 1 ? '.md' : ` (${suffix}).md`;
      const endingBytes = encoder.encode(ending).byteLength;
      const basenameBytes = Math.min(
        255 - endingBytes,
        1024 - directoryBytes - endingBytes,
      );
      const name = `${truncateUtf8(basename, basenameBytes)}${ending}`;
      const candidate = validatePortablePath(`${pathPrefix}${name}`);
      if (!keys.has(candidate.key)) {
        return { path: candidate.path, pathKey: candidate.key };
      }
    }
  }
}
