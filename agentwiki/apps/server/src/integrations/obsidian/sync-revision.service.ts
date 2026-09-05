import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  revisionContentHash as computeRevisionContentHash,
  type RevisionContentManifest,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import {
  isSyncV1RevisionFormat,
  isSyncV2RevisionFormat,
  isSyncV3RevisionFormat,
} from '../../core/sync/sync-revision-format';
import { SyncApiException } from './sync-error';
import {
  SyncV3AuthorityError,
  SyncV3ImmutableRevisionService,
} from './sync-v3-immutable-revision.service';

const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface SyncHead {
  revision: string;
  sequence: number;
  revisionContentHash: string;
  pageCount: bigint;
  revisionManifestByteLength: bigint;
  revisionBodyBytes: bigint;
  publishedAt: string | null;
}

@Injectable()
export class SyncRevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly immutableV3: SyncV3ImmutableRevisionService,
  ) {}

  async head(spaceId: string): Promise<SyncHead> {
    return this.consistentRead(async (tx) => {
      const revision = await tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId },
        orderBy: { sequence: 'desc' },
      });
      if (!revision) return this.emptyHead();
      return this.v1HeadForRevision(tx, spaceId, revision);
    });
  }

  private emptyHead(): SyncHead {
    return {
      revision: '0', sequence: 0, revisionContentHash: EMPTY_REVISION_HASH,
      pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n,
      publishedAt: null,
    };
  }

  private async v1HeadForRevision(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revision: any,
  ): Promise<SyncHead> {
    this.assertV1Compatible(revision);
    const isV2 = isSyncV2RevisionFormat(revision);
    const isV3 = isSyncV3RevisionFormat(revision);
    if (isV3) await this.verifyNativeV3(tx, spaceId, revision);
    if (isV2 || isV3) {
      const rows = await tx.syncRevisionPageRow.findMany({
        where: { revisionId: revision.id },
        select: { pageId: true, path: true, title: true, contentHash: true },
        orderBy: { pageId: 'asc' },
      });
      const manifest: RevisionContentManifest = {
        protocolVersion: '1', spaceId,
        pages: rows.map((row) => ({
          pageId: row.pageId, path: row.path, title: row.title, contentHash: row.contentHash,
        })),
      };
      const empty = rows.length === 0;
      return {
        revision: revision.id,
        sequence: revision.sequence,
        revisionContentHash: empty ? EMPTY_REVISION_HASH : await computeRevisionContentHash(manifest),
        pageCount: BigInt(rows.length),
        revisionManifestByteLength: BigInt(empty ? 0 : canonicalBytes(manifest).byteLength),
        revisionBodyBytes: revision.revisionBodyBytes ?? 0n,
        publishedAt: revision.createdAt.toISOString(),
      };
    }
    return {
      revision: revision.id,
      sequence: revision.sequence,
      revisionContentHash: revision.revisionContentHash ?? EMPTY_REVISION_HASH,
      pageCount: revision.pageCount ?? 0n,
      revisionManifestByteLength: revision.revisionManifestByteLength ?? 0n,
      revisionBodyBytes: revision.revisionBodyBytes ?? 0n,
      publishedAt: revision.createdAt.toISOString(),
    };
  }

  async resolveRevision(spaceId: string, revision: string): Promise<string> {
    if (revision === 'current' || revision === '0') return (await this.head(spaceId)).revision;
    return this.consistentRead(async (tx) => {
      const found = await tx.spaceKnowledgeRevision.findUnique({ where: { id: revision } });
      if (!found || found.spaceId !== spaceId) {
        throw new SyncApiException('REVISION_GONE', 'Revision is not available');
      }
      this.assertV1Compatible(found);
      if (isSyncV3RevisionFormat(found)) await this.verifyNativeV3(tx, spaceId, found);
      return found.id;
    });
  }

  async snapshotPage(
    spaceId: string,
    revisionId: string,
    limit: number,
    afterPageId?: string,
  ) {
    if (revisionId === '0') {
      return { items: [], nextPageId: undefined, head: await this.head(spaceId) };
    }
    return this.consistentRead(async (tx) => {
      const revision = await tx.spaceKnowledgeRevision.findUnique({ where: { id: revisionId } });
      if (!revision || revision.spaceId !== spaceId) {
        throw new SyncApiException('REVISION_GONE', 'Revision is not available');
      }
      const head = await this.v1HeadForRevision(tx, spaceId, revision);
      const rows = await tx.syncRevisionPageRow.findMany({
        where: {
          revisionId,
          ...(afterPageId ? { pageId: { gt: afterPageId } } : {}),
        },
        orderBy: { pageId: 'asc' },
        take: limit + 1,
        include: { content: true },
      });
      const { items, next } = this.trimByResponseBytes(rows, limit);
      return {
        items,
        nextPageId: next ? items[items.length - 1]?.pageId : undefined,
        head,
      };
    });
  }

  async deltaPage(
    spaceId: string,
    fromRevision: string,
    limit: number,
    afterPageId?: string,
  ) {
    return this.consistentRead(async (tx) => {
      const to = await tx.spaceKnowledgeRevision.findFirst({
        where: { spaceId }, orderBy: { sequence: 'desc' },
      });
      const head = to ? await this.v1HeadForRevision(tx, spaceId, to) : this.emptyHead();
      if (fromRevision === head.revision) {
        return { items: [], nextPageId: undefined, toRevision: head.revision, head };
      }
      if (fromRevision === '0') return this.deltaFromEmpty(tx, spaceId, limit, afterPageId, head);
      const from = await tx.spaceKnowledgeRevision.findUnique({ where: { id: fromRevision } });
      if (!from || from.spaceId !== spaceId) {
        throw new SyncApiException('REVISION_GONE', 'from revision is not available');
      }
      this.assertV1Compatible(from);
      if (isSyncV3RevisionFormat(from)) await this.verifyNativeV3(tx, spaceId, from);
      if (from.sequence >= head.sequence) {
        return { items: [], nextPageId: undefined, toRevision: head.revision, head };
      }
      const [fromRows, toRows] = await Promise.all([
        tx.syncRevisionPageRow.findMany({
          where: { revisionId: from.id },
          select: { pageId: true, path: true, title: true, contentHash: true },
          orderBy: { pageId: 'asc' },
        }),
        tx.syncRevisionPageRow.findMany({
          where: { revisionId: head.revision },
          select: { pageId: true, path: true, title: true, contentHash: true },
          orderBy: { pageId: 'asc' },
        }),
      ]);
      const fromById = new Map(fromRows.map((row) => [row.pageId, row]));
      const toById = new Map(toRows.map((row) => [row.pageId, row]));
      const changes: Array<{ operation: 'upsert' | 'archive'; pageId: string; previousPath: string }> = [];
      for (const [pageId, fromRow] of fromById) {
        if (!toById.has(pageId)) changes.push({ operation: 'archive', pageId, previousPath: fromRow.path });
      }
      for (const [pageId, toRow] of toById) {
        const fromRow = fromById.get(pageId);
        if (!fromRow || fromRow.path !== toRow.path || fromRow.title !== toRow.title
          || fromRow.contentHash !== toRow.contentHash) {
          changes.push({ operation: 'upsert', pageId, previousPath: '' });
        }
      }
      changes.sort((a, b) => (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0));
      const filtered = changes.filter((change) => !afterPageId || change.pageId > afterPageId);
      const slice = filtered.slice(0, limit + 1);
      const hasMore = slice.length > limit;
      return {
        items: slice.slice(0, limit),
        nextPageId: hasMore ? slice[limit - 1]?.pageId : undefined,
        toRevision: head.revision,
        head,
      };
    });
  }

  private async deltaFromEmpty(
    tx: Prisma.TransactionClient,
    spaceId: string,
    limit: number,
    afterPageId: string | undefined,
    head: SyncHead,
  ) {
    const rows = await tx.syncRevisionPageRow.findMany({
      where: {
        revisionId: head.revision,
        ...(afterPageId ? { pageId: { gt: afterPageId } } : {}),
      },
      select: { pageId: true, path: true, title: true, contentHash: true },
      orderBy: { pageId: 'asc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      operation: 'upsert' as const, pageId: row.pageId, previousPath: '',
    }));
    return {
      items,
      nextPageId: hasMore ? items[items.length - 1]?.pageId : undefined,
      toRevision: head.revision,
      head,
    };
  }

  private assertV1Compatible(revision: any): void {
    if (revision.attachmentCount > 0n) {
      throw new SyncApiException('SYNC_PROTOCOL_UPGRADE_REQUIRED', 'This revision requires Sync v3');
    }
    if (!isSyncV1RevisionFormat(revision)
      && !isSyncV2RevisionFormat(revision)
      && !isSyncV3RevisionFormat(revision)) {
      throw new SyncApiException(
        'SYNC_PROTOCOL_UPGRADE_REQUIRED',
        'Revision uses a newer or unsupported Sync protocol',
      );
    }
  }

  private async verifyNativeV3(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revision: any,
  ): Promise<void> {
    try {
      await this.immutableV3.verify(tx, spaceId, revision);
    } catch (error) {
      if (error instanceof SyncV3AuthorityError) {
        throw new SyncApiException('REVISION_GONE', 'Revision is not available');
      }
      throw error;
    }
  }

  private async consistentRead<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 10_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (error instanceof SyncApiException) throw error;
      throw new SyncApiException('INTERNAL_ERROR', 'Revision read temporarily unavailable');
    }
  }

  private utf8Length(value: string): number {
    return new TextEncoder().encode(value).byteLength;
  }

  private trimByResponseBytes<T extends { pageId: string; title?: string; contentHash?: string; content?: { body?: string } }>(
    rows: T[],
    limit: number,
  ): { items: T[]; next: boolean } {
    const items: T[] = [];
    let total = 0;
    for (const row of rows) {
      if (items.length >= limit) return { items, next: true };
      const estimate = this.utf8Length(row.title ?? '')
        + this.utf8Length(row.content?.body ?? '')
        + this.utf8Length(row.contentHash ?? '')
        + this.utf8Length(row.pageId)
        + 128;
      if (items.length > 0 && total + estimate > MAX_RESPONSE_BYTES) return { items, next: true };
      items.push(row);
      total += estimate;
    }
    return { items, next: false };
  }
}
