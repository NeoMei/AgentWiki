import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  contentHash,
  normalizeMarkdown,
  pathKey,
  revisionContentHash as computeRevisionContentHash,
  type RevisionContentManifest,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { LegacyBundleHashStream } from './legacy-serializer';
import type { SpaceLockedTransaction } from './readable-sync-path.service';
import { ContentTreeConflict } from '../../content-tree/content-tree.types';

const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export interface RevisionWriteResult {
  revisionId: string;
  sequence: number;
  revisionContentHash: string;
  pageCount: bigint;
  revisionManifestByteLength: bigint;
  revisionBodyBytes: bigint;
}

export interface PageChange {
  operation: 'upsert' | 'archive';
  pageId: string;
  path?: string;
  title?: string;
  body?: string;
  previousPath?: string;
}

export interface RevisionOrigin {
  origin: 'web_editor' | 'change_set' | 'obsidian_sync' | 'migration';
  createdByUserId?: string | null;
  humanDeviceCredentialId?: string | null;
  sourceChangeSetId?: string | null;
  migrationBatchId?: string | null;
  legacySidecarOverride?: Prisma.InputJsonObject;
}

export type SpaceTreeLockedTransaction = SpaceLockedTransaction & {
  readonly contentTreeRevision: bigint;
};


@Injectable()
export class SpaceRevisionWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async lockSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
  ): Promise<SpaceLockedTransaction> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
    return tx as SpaceLockedTransaction;
  }

  async lockContentTreeSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
  ): Promise<SpaceTreeLockedTransaction | null> {
    const lockedTx = await this.lockSpace(tx, spaceId);
    const space = await tx.space.findUnique({
      where: { id: spaceId, deletedAt: null },
      select: { contentTreeRevision: true },
    });
    if (!space) return null;
    Object.defineProperty(lockedTx, 'contentTreeRevision', {
      configurable: true,
      enumerable: false,
      value: space.contentTreeRevision,
    });
    return lockedTx as SpaceTreeLockedTransaction;
  }

  async advanceContentTreeRevision(
    tx: SpaceLockedTransaction,
    spaceId: string,
    expected: bigint,
  ): Promise<bigint> {
    const result = await tx.space.updateMany({
      where: { id: spaceId, deletedAt: null, contentTreeRevision: expected },
      data: { contentTreeRevision: { increment: 1n } },
    });
    if (result.count !== 1) {
      const current = await tx.space.findUnique({
        where: { id: spaceId },
        select: { contentTreeRevision: true },
      });
      throw new ContentTreeConflict(expected, current?.contentTreeRevision ?? expected);
    }
    return expected + 1n;
  }

  async advance(
    tx: Prisma.TransactionClient,
    spaceId: string,
    changes: PageChange[],
    origin: RevisionOrigin,
  ): Promise<RevisionWriteResult> {
    // All revision creation paths share one transaction-scoped advisory lock.
    // Some callers also lock explicitly; re-entering the same advisory lock in
    // the same transaction is safe and keeps page/review callers serialized.
    await this.lockSpace(tx, spaceId);

    const latest = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true },
    });
    const parentRevisionId = latest?.id ?? null;
    const sequence = (latest?.sequence ?? 0) + 1;

    const created = await tx.spaceKnowledgeRevision.create({
      data: {
        spaceId,
        sequence,
        parentRevisionId,
        schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none',
        // contentHash/revisionContentHash/pageCount/byte metrics are computed
        // and written in a second update once the normalized rows are settled.
        contentHash: EMPTY_REVISION_HASH,
        revisionContentHash: EMPTY_REVISION_HASH,
        snapshot: Prisma.JsonNull,
        delta: Prisma.JsonNull,
        pageCount: 0n,
        revisionBodyBytes: 0n,
        revisionManifestByteLength: 0n,
        origin: origin.origin,
        createdByUserId: origin.createdByUserId ?? null,
        humanDeviceCredentialId: origin.humanDeviceCredentialId ?? null,
        sourceChangeSetId: origin.sourceChangeSetId ?? null,
        migrationBatchId: origin.migrationBatchId ?? null,
      },
    });

    if (parentRevisionId) {
      // Copy the parent's normalized page rows in the database without ever
      // reading full bodies into Node memory.
      await tx.$executeRaw`
        INSERT INTO "SyncRevisionPageRow" ("revisionId", "pageId", "path", "pathKey", "title", "contentHash", "updatedAt")
        SELECT ${created.id}, "pageId", "path", "pathKey", "title", "contentHash", "updatedAt"
        FROM "SyncRevisionPageRow" WHERE "revisionId" = ${parentRevisionId}
      `;
      await tx.$executeRaw`
        INSERT INTO "LegacyRevisionPageExtra" ("revisionId", "pageId", "ordinal", "extra", "legacyBodyHash")
        SELECT ${created.id}, "pageId", "ordinal", "extra", "legacyBodyHash"
        FROM "LegacyRevisionPageExtra" WHERE "revisionId" = ${parentRevisionId}
      `;
      await tx.$executeRaw`
        INSERT INTO "LegacyRevisionSidecar" ("revisionId", "sidecar")
        SELECT ${created.id}, "sidecar"
        FROM "LegacyRevisionSidecar" WHERE "revisionId" = ${parentRevisionId}
      `;
      await tx.spaceKnowledgeRevision.update({
        where: { id: parentRevisionId },
        data: { supersededAt: new Date() },
      });
    }

    if (origin.legacySidecarOverride) {
      await tx.legacyRevisionSidecar.upsert({
        where: { revisionId: created.id },
        create: { revisionId: created.id, sidecar: origin.legacySidecarOverride },
        update: { sidecar: origin.legacySidecarOverride },
      });
    }

    const deltaRows: Array<{
      ordinal: number;
      operation: string;
      pageId: string;
      previousPath: string | null;
      contentHash: string | null;
    }> = [];

    let ordinal = 0;
    for (const change of changes) {
      if (change.operation === 'archive') {
        const prior = await tx.syncRevisionPageRow.findUnique({
          where: { revisionId_pageId: { revisionId: created.id, pageId: change.pageId } },
          select: { path: true },
        });
        await tx.syncRevisionPageRow.deleteMany({
          where: { revisionId: created.id, pageId: change.pageId },
        });
        await tx.legacyRevisionPageExtra.deleteMany({
          where: { revisionId: created.id, pageId: change.pageId },
        });
        deltaRows.push({
          ordinal: ordinal++,
          operation: 'archive',
          pageId: change.pageId,
          previousPath: change.previousPath ?? prior?.path ?? null,
          contentHash: null,
        });
        continue;
      }
      const body = normalizeMarkdown(change.body ?? '');
      const hash = await contentHash(body);
      await tx.syncPageContentRow.upsert({
        where: { contentHash: hash },
        create: {
          contentHash: hash,
          body,
          byteLength: new TextEncoder().encode(body).byteLength,
        },
        update: {},
      });
      await tx.legacyPageBodyRow.upsert({
        where: { contentHash: hash },
        create: { contentHash: hash, body },
        update: {},
      });
      const prior = await tx.syncRevisionPageRow.findUnique({
        where: { revisionId_pageId: { revisionId: created.id, pageId: change.pageId } },
        select: { path: true, pathKey: true },
      });
      const existingExtra = await tx.legacyRevisionPageExtra.findUnique({
        where: { revisionId_pageId: { revisionId: created.id, pageId: change.pageId } },
      });
      const existingExtraValue = (existingExtra?.extra ?? {}) as Prisma.InputJsonObject;
      await tx.syncRevisionPageRow.upsert({
        where: { revisionId_pageId: { revisionId: created.id, pageId: change.pageId } },
        create: {
          revisionId: created.id,
          pageId: change.pageId,
          path: change.path ?? prior?.path ?? '',
          pathKey: change.path ? pathKey(change.path) : prior?.pathKey ?? '',
          title: change.title ?? '',
          contentHash: hash,
          updatedAt: new Date(),
        },
        update: {
          path: change.path ?? prior?.path ?? undefined,
          pathKey: change.path ? pathKey(change.path) : undefined,
          title: change.title,
          contentHash: hash,
          updatedAt: new Date(),
        },
      });
      let legacyOrdinal: number;
      if (existingExtraValue && typeof existingExtraValue.order === 'number') {
        legacyOrdinal = existingExtraValue.order;
      } else if (existingExtra) {
        legacyOrdinal = existingExtra.ordinal;
      } else {
        const nextOrdinalAgg = await tx.legacyRevisionPageExtra.aggregate({
          where: { revisionId: created.id },
          _max: { ordinal: true },
        });
        legacyOrdinal = (nextOrdinalAgg._max.ordinal ?? -1) + 1;
      }
      await tx.legacyRevisionPageExtra.upsert({
        where: { revisionId_pageId: { revisionId: created.id, pageId: change.pageId } },
        create: {
          revisionId: created.id,
          pageId: change.pageId,
          ordinal: legacyOrdinal,
          legacyBodyHash: hash,
          extra: {
            spaceId,
            title: change.title ?? '',
            order: legacyOrdinal,
            metadata: null,
            artifactIds: [],
            legacyBodyHash: hash,
            contentHash: hash,
            path: change.path ?? '',
            updatedAt: new Date().toISOString(),
          },
        },
        update: {
          legacyBodyHash: hash,
          extra: {
            ...existingExtraValue,
            spaceId,
            title: change.title ?? existingExtraValue?.title,
            order: legacyOrdinal,
            metadata: existingExtraValue?.metadata ?? null,
            artifactIds: existingExtraValue?.artifactIds ?? [],
            legacyBodyHash: hash,
            contentHash: hash,
            path: change.path ?? existingExtraValue?.path,
            updatedAt: new Date().toISOString(),
          },
        },
      });
      deltaRows.push({
        ordinal: ordinal++,
        operation: 'upsert',
        pageId: change.pageId,
        previousPath: null,
        contentHash: hash,
      });
    }

    if (deltaRows.length > 0) {
      await tx.syncRevisionDeltaRow.createMany({
        data: deltaRows.map((d) => ({
          revisionId: created.id,
          ...d,
        })),
      });
    }

    // Compute the settled page set, manifest hash, and bigint metrics from
    // normalized rows without loading page bodies into Node memory.
    const settled = await tx.syncRevisionPageRow.findMany({
      where: { revisionId: created.id },
      select: { pageId: true, path: true, title: true, contentHash: true },
      orderBy: { pageId: 'asc' },
    });
    const pageCount = settled.length;
    const manifest: RevisionContentManifest = {
      protocolVersion: '1',
      spaceId,
      pages: settled.map((p) => ({
        pageId: p.pageId,
        path: p.path,
        title: p.title,
        contentHash: p.contentHash,
      })),
    };
    const revisionManifestBytes = pageCount === 0
      ? new Uint8Array()
      : canonicalBytes(manifest);
    const revisionContentHash = pageCount === 0
      ? EMPTY_REVISION_HASH
      : await computeRevisionContentHash(manifest);
    const bodyAggregate = await tx.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT COALESCE(SUM(c."byteLength"), 0) AS bytes
      FROM "SyncRevisionPageRow" r
      JOIN "SyncPageContentRow" c ON c."contentHash" = r."contentHash"
      WHERE r."revisionId" = ${created.id}
    `;
    const revisionBodyBytes = bodyAggregate[0]?.bytes ?? 0n;

    const legacyContentHash = await this.legacyContentHash(tx, spaceId, created.id);

    await tx.spaceKnowledgeRevision.update({
      where: { id: created.id },
      data: {
        contentHash: legacyContentHash,
        revisionContentHash,
        snapshot: Prisma.JsonNull,
        delta: Prisma.JsonNull,
        pageCount: BigInt(pageCount),
        revisionBodyBytes,
        revisionManifestByteLength: BigInt(revisionManifestBytes.byteLength),
      },
    });

    return {
      revisionId: created.id,
      sequence,
      revisionContentHash,
      pageCount: BigInt(pageCount),
      revisionManifestByteLength: BigInt(revisionManifestBytes.byteLength),
      revisionBodyBytes,
    };
  }

  private async legacyContentHash(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revisionId: string,
  ): Promise<string> {
    const sidecar = await tx.legacyRevisionSidecar.findUnique({
      where: { revisionId },
    });
    const sidecarValue = (sidecar?.sidecar ?? {}) as Record<string, unknown>;
    const stream = new LegacyBundleHashStream(
      (sidecarValue.schemaVersion as string) ?? 'knowledge-bundle@1',
      (sidecarValue.recipeVersion as string) ?? 'none',
      spaceId,
      (sidecarValue.baseRevision as string) ?? null,
    );
    const extras = await tx.legacyRevisionPageExtra.findMany({
      where: { revisionId },
      orderBy: { ordinal: 'asc' },
    });
    for (const extra of extras) {
      const value = extra.extra as Record<string, unknown>;
      const bodyRow = await tx.legacyPageBodyRow.findUnique({
        where: { contentHash: extra.legacyBodyHash },
      });
      stream.appendPage({
        pageId: extra.pageId,
        spaceId,
        path: (value.path as string) ?? '',
        title: (value.title as string) ?? '',
        body: (bodyRow?.body as string) ?? '',
        order: (value.order as number) ?? 0,
        metadata: (value.metadata as { parentId: string } | null) ?? null,
        artifactIds: (value.artifactIds as string[]) ?? [],
        contentHash: (value.contentHash as string) ?? extra.legacyBodyHash,
        updatedAt: (value.updatedAt as string) ?? new Date(0).toISOString(),
      });
    }
    return stream.digest(
      (sidecarValue.memories as unknown[]) ?? [],
      (sidecarValue.relations as unknown[]) ?? [],
      (sidecarValue.provenance as unknown[]) ?? [],
      (sidecarValue.deletions as unknown[]) ?? [],
    );
  }

}
