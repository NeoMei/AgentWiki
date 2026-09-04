import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  normalizeMarkdown,
  pathKey,
  revisionContentHash as computeRevisionContentHash,
  treeRevisionDeltaV2,
  treeRevisionContentHashV2,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
  type RevisionContentManifest,
  type SyncFolderV2,
  type SyncPageV2,
  type TreeDeltaItemV2,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { LegacyBundleHashStream } from './legacy-serializer';
import type { SpaceLockedTransaction } from './readable-sync-path.service';
import { ContentTreeConflict, ContentTreeError } from '../../content-tree/content-tree.types';
import {
  assertCompleteRevisionV2,
  assertRevisionV2Metadata,
  assertStoredTreeDeltaV2,
  hasCompleteRevisionChain,
  hasTrustedV2GenesisBoundary,
  hasTrustedV2GenesisInputMarker,
  hasTrustedV2GenesisMarker,
  loadRevisionV2Evidence,
  REVISION_V2_SCALAR_SELECT,
  revisionShouldBeV2,
  validateRevisionChainTrust,
} from './revision-v2-integrity';
import { lockContentStore } from './content-store-lock';
import { SyncV3RevisionWriterService } from './sync-v3-revision-writer.service';

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

export type StructuralPageChange =
  | {
    operation: 'upsert';
    pageId: string;
    folderId: string | null;
    path: string;
    title: string;
    body: string;
  }
  | {
    operation: 'archive';
    pageId: string;
    previousPath?: string;
  };

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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly v3Writer?: SyncV3RevisionWriterService,
  ) {}

  /**
   * This advisory lock is the first Space-scoped lock for every structural
   * writer. Callers must not lock/update the Space row before this method.
   * Live Agent callers use the authorization boundary helper so their
   * non-Space authorization rows are locked first and Space is revalidated
   * only after this advisory lock has been acquired.
   */
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

  /**
   * Sync cutover takes the Space row only after the shared advisory lock.
   * NO KEY UPDATE serializes mutable Space policy/tree state while remaining
   * compatible with foreign-key KEY SHARE checks.
   */
  async lockSyncSpace(
    tx: Prisma.TransactionClient,
    spaceId: string,
  ): Promise<SpaceTreeLockedTransaction | null> {
    const lockedTx = await this.lockSpace(tx, spaceId);
    const rows = await tx.$queryRaw<Array<{ contentTreeRevision: bigint }>>(Prisma.sql`
      SELECT "contentTreeRevision"
      FROM "Space"
      WHERE "id" = ${spaceId} AND "deletedAt" IS NULL
      FOR NO KEY UPDATE
    `);
    const space = rows[0];
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
    // The transaction must already hold lockSpace(spaceId); this Space CAS is
    // intentionally later in the global advisory -> Space-row order.
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
    const lockedTx = await this.lockSpace(tx, spaceId);
    return this.advanceLocked(lockedTx, spaceId, changes, origin);
  }

  async advanceLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    changes: PageChange[],
    origin: RevisionOrigin,
  ): Promise<RevisionWriteResult> {
    const v3Result = await this.v3Writer?.advanceCurrentIfRequiredLocked(tx, spaceId, origin);
    if (v3Result) return v3Result;
    await lockContentStore(tx);
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
        INSERT INTO "SyncRevisionPageRow" ("revisionId", "pageId", "folderId", "path", "pathKey", "title", "contentHash", "updatedAt")
        SELECT ${created.id}, "pageId", "folderId", "path", "pathKey", "title", "contentHash", "updatedAt"
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

    return this.finalizeTreeV2IfRequired(tx, spaceId, created.id, parentRevisionId, {
      revisionId: created.id,
      sequence,
      revisionContentHash,
      pageCount: BigInt(pageCount),
      revisionManifestByteLength: BigInt(revisionManifestBytes.byteLength),
      revisionBodyBytes,
    });
  }

  async advanceStructuralPages(
    tx: Prisma.TransactionClient,
    spaceId: string,
    changes: StructuralPageChange[],
    origin: RevisionOrigin,
  ): Promise<RevisionWriteResult> {
    const lockedTx = await this.lockSpace(tx, spaceId);
    return this.advanceStructuralPagesLocked(lockedTx, spaceId, changes, origin);
  }

  async advanceStructuralPagesLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    changes: StructuralPageChange[],
    origin: RevisionOrigin,
  ): Promise<RevisionWriteResult> {
    return this.advanceStructuralPagesLockedInternal(tx, spaceId, changes, origin, false);
  }

  /**
   * Task 6 owns the first content-tree@2 snapshot written during cutover. This
   * dedicated entrypoint is intentionally separate from RevisionOrigin so no
   * HTTP payload, ChangeSet metadata, or ordinary writer caller can suppress
   * ongoing v2 finalization.
   */
  async advanceMigrationStructuralPagesLocked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    changes: StructuralPageChange[],
    origin: RevisionOrigin & { origin: 'migration' },
  ): Promise<RevisionWriteResult> {
    return this.advanceStructuralPagesLockedInternal(tx, spaceId, changes, origin, true);
  }

  async finalizeExistingTreeV2Locked(
    tx: SpaceLockedTransaction,
    spaceId: string,
    revisionId: string,
  ): Promise<RevisionWriteResult> {
    const revision = await tx.spaceKnowledgeRevision.findFirst({
      where: { id: revisionId, spaceId },
      select: {
        id: true,
        sequence: true,
        parentRevisionId: true,
        revisionContentHash: true,
        pageCount: true,
        revisionManifestByteLength: true,
        revisionBodyBytes: true,
      },
    });
    if (!revision) {
      throw new ContentTreeError('CONTENT_TREE_REVISION_GONE', 'Revision is not available');
    }
    return this.finalizeTreeV2IfRequired(
      tx,
      spaceId,
      revision.id,
      revision.parentRevisionId,
      {
        revisionId: revision.id,
        sequence: revision.sequence,
        revisionContentHash: revision.revisionContentHash ?? EMPTY_REVISION_HASH,
        pageCount: revision.pageCount ?? 0n,
        revisionManifestByteLength: revision.revisionManifestByteLength ?? 0n,
        revisionBodyBytes: revision.revisionBodyBytes ?? 0n,
      },
    );
  }

  private async advanceStructuralPagesLockedInternal(
    tx: SpaceLockedTransaction,
    spaceId: string,
    changes: StructuralPageChange[],
    origin: RevisionOrigin,
    deferTreeV2Finalization: boolean,
  ): Promise<RevisionWriteResult> {
    const v3Result = await this.v3Writer?.advanceCurrentIfRequiredLocked(tx, spaceId, origin);
    if (v3Result) return v3Result;
    await lockContentStore(tx);
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
      await tx.$executeRaw`
        INSERT INTO "SyncRevisionPageRow" (
          "revisionId", "pageId", "folderId", "path", "pathKey", "title", "contentHash", "updatedAt"
        )
        SELECT
          ${created.id}, "pageId", "folderId", "path", "pathKey", "title", "contentHash", "updatedAt"
        FROM "SyncRevisionPageRow"
        WHERE "revisionId" = ${parentRevisionId}
      `;
      await tx.$executeRaw`
        INSERT INTO "LegacyRevisionPageExtra" (
          "revisionId", "pageId", "ordinal", "extra", "legacyBodyHash"
        )
        SELECT ${created.id}, "pageId", "ordinal", "extra", "legacyBodyHash"
        FROM "LegacyRevisionPageExtra"
        WHERE "revisionId" = ${parentRevisionId}
      `;
      await tx.$executeRaw`
        INSERT INTO "LegacyRevisionSidecar" ("revisionId", "sidecar")
        SELECT ${created.id}, "sidecar"
        FROM "LegacyRevisionSidecar"
        WHERE "revisionId" = ${parentRevisionId}
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

    const changedAt = new Date();
    const prepared = await Promise.all(changes.map(async (change, ordinal) => {
      if (change.operation === 'archive') {
        return {
          ordinal,
          operation: change.operation,
          pageId: change.pageId,
          folderId: null,
          path: null,
          pathKey: null,
          title: null,
          body: null,
          contentHash: null,
          byteLength: null,
          previousPath: change.previousPath ?? null,
          updatedAt: changedAt.toISOString(),
        };
      }
      const body = normalizeMarkdown(change.body);
      return {
        ordinal,
        operation: change.operation,
        pageId: change.pageId,
        folderId: change.folderId,
        path: change.path,
        pathKey: pathKey(change.path),
        title: change.title,
        body,
        contentHash: await contentHash(body),
        byteLength: new TextEncoder().encode(body).byteLength,
        previousPath: null,
        updatedAt: changedAt.toISOString(),
      };
    }));

    if (prepared.length > 0) {
      const payload = JSON.stringify(prepared);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "SyncPageContentRow" ("contentHash", "body", "byteLength")
        SELECT DISTINCT ON (change."contentHash")
          change."contentHash", change."body", change."byteLength"
        FROM jsonb_to_recordset(${payload}::jsonb) AS change(
          "operation" text, "contentHash" text, "body" text, "byteLength" integer
        )
        WHERE change."operation" = 'upsert'
        ORDER BY change."contentHash"
        ON CONFLICT ("contentHash") DO NOTHING
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "LegacyPageBodyRow" ("contentHash", "body")
        SELECT DISTINCT ON (change."contentHash")
          change."contentHash", to_jsonb(change."body")
        FROM jsonb_to_recordset(${payload}::jsonb) AS change(
          "operation" text, "contentHash" text, "body" text
        )
        WHERE change."operation" = 'upsert'
        ORDER BY change."contentHash"
        ON CONFLICT ("contentHash") DO NOTHING
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "SyncRevisionDeltaRow" (
          "revisionId", "ordinal", "operation", "pageId", "previousPath", "contentHash"
        )
        SELECT
          ${created.id}, change."ordinal", change."operation", change."pageId",
          CASE
            WHEN change."operation" = 'archive'
              THEN COALESCE(change."previousPath", prior."path")
            ELSE NULL
          END,
          change."contentHash"
        FROM jsonb_to_recordset(${payload}::jsonb) AS change(
          "ordinal" integer,
          "operation" text,
          "pageId" text,
          "previousPath" text,
          "contentHash" text
        )
        LEFT JOIN "SyncRevisionPageRow" prior
          ON prior."revisionId" = ${created.id}
          AND prior."pageId" = change."pageId"
        ORDER BY change."ordinal"
      `);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "SyncRevisionPageRow" row
        USING jsonb_to_recordset(${payload}::jsonb) AS change("pageId" text)
        WHERE row."revisionId" = ${created.id}
          AND row."pageId" = change."pageId"
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "SyncRevisionPageRow" (
          "revisionId", "pageId", "folderId", "path", "pathKey", "title", "contentHash", "updatedAt"
        )
        SELECT
          ${created.id}, change."pageId", change."folderId", change."path", change."pathKey",
          change."title", change."contentHash", change."updatedAt"
        FROM jsonb_to_recordset(${payload}::jsonb) AS change(
          "operation" text,
          "pageId" text,
          "folderId" text,
          "path" text,
          "pathKey" text,
          "title" text,
          "contentHash" text,
          "updatedAt" timestamptz
        )
        WHERE change."operation" = 'upsert'
      `);
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "LegacyRevisionPageExtra" extra
        USING jsonb_to_recordset(${payload}::jsonb) AS change("operation" text, "pageId" text)
        WHERE extra."revisionId" = ${created.id}
          AND extra."pageId" = change."pageId"
          AND change."operation" = 'archive'
      `);
      await tx.$executeRaw(Prisma.sql`
        WITH input AS (
          SELECT *
          FROM jsonb_to_recordset(${payload}::jsonb) AS change(
            "ordinal" integer,
            "operation" text,
            "pageId" text,
            "path" text,
            "title" text,
            "contentHash" text,
            "updatedAt" text
          )
          WHERE change."operation" = 'upsert'
        ), maximum AS (
          SELECT COALESCE(MAX("ordinal"), -1)::integer AS value
          FROM "LegacyRevisionPageExtra"
          WHERE "revisionId" = ${created.id}
        ), planned AS (
          SELECT
            input.*,
            existing."extra" AS "existingExtra",
            CASE
              WHEN jsonb_typeof(existing."extra"->'order') = 'number'
                THEN ((existing."extra"->>'order')::numeric)::integer
              WHEN existing."pageId" IS NOT NULL THEN existing."ordinal"
              ELSE maximum.value + ROW_NUMBER() OVER (
                PARTITION BY (existing."pageId" IS NULL)
                ORDER BY input."ordinal"
              )::integer
            END AS "legacyOrdinal"
          FROM input
          CROSS JOIN maximum
          LEFT JOIN "LegacyRevisionPageExtra" existing
            ON existing."revisionId" = ${created.id}
            AND existing."pageId" = input."pageId"
        )
        INSERT INTO "LegacyRevisionPageExtra" (
          "revisionId", "pageId", "ordinal", "extra", "legacyBodyHash"
        )
        SELECT
          ${created.id}, planned."pageId", planned."legacyOrdinal",
          COALESCE(planned."existingExtra", '{}'::jsonb) || jsonb_build_object(
            'spaceId', ${spaceId},
            'title', planned."title",
            'order', planned."legacyOrdinal",
            'metadata', COALESCE(planned."existingExtra"->'metadata', 'null'::jsonb),
            'artifactIds', COALESCE(planned."existingExtra"->'artifactIds', '[]'::jsonb),
            'legacyBodyHash', planned."contentHash",
            'contentHash', planned."contentHash",
            'path', planned."path",
            'updatedAt', planned."updatedAt"
          ),
          planned."contentHash"
        FROM planned
        ORDER BY planned."ordinal"
        ON CONFLICT ("revisionId", "pageId") DO UPDATE SET
          "ordinal" = EXCLUDED."ordinal",
          "extra" = EXCLUDED."extra",
          "legacyBodyHash" = EXCLUDED."legacyBodyHash"
      `);
    }

    const settled = await tx.syncRevisionPageRow.findMany({
      where: { revisionId: created.id },
      select: { pageId: true, path: true, title: true, contentHash: true },
      orderBy: { pageId: 'asc' },
    });
    const pageCount = settled.length;
    const manifest: RevisionContentManifest = {
      protocolVersion: '1',
      spaceId,
      pages: settled.map((page) => ({
        pageId: page.pageId,
        path: page.path,
        title: page.title,
        contentHash: page.contentHash,
      })),
    };
    const revisionManifestBytes = pageCount === 0 ? new Uint8Array() : canonicalBytes(manifest);
    const revisionContentHash = pageCount === 0
      ? EMPTY_REVISION_HASH
      : await computeRevisionContentHash(manifest);
    const bodyAggregate = await tx.$queryRaw<Array<{ bytes: bigint }>>`
      SELECT COALESCE(SUM(content."byteLength"), 0) AS bytes
      FROM "SyncRevisionPageRow" row
      JOIN "SyncPageContentRow" content ON content."contentHash" = row."contentHash"
      WHERE row."revisionId" = ${created.id}
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
    const fallback = {
      revisionId: created.id,
      sequence,
      revisionContentHash,
      pageCount: BigInt(pageCount),
      revisionManifestByteLength: BigInt(revisionManifestBytes.byteLength),
      revisionBodyBytes,
    };
    return deferTreeV2Finalization
      ? fallback
      : this.finalizeTreeV2IfRequired(tx, spaceId, created.id, parentRevisionId, fallback);
  }

  private async finalizeTreeV2IfRequired(
    tx: Prisma.TransactionClient,
    spaceId: string,
    revisionId: string,
    parentRevisionId: string | null,
    fallback: RevisionWriteResult,
  ): Promise<RevisionWriteResult> {
    const [folders, pages, revision, currentFolderRows, currentSidecarRow, currentDeltaRows] = await Promise.all([
      tx.folder.findMany({ where: { spaceId, deletedAt: null } }),
      tx.syncRevisionPageRow.findMany({ where: { revisionId }, include: { content: true } }),
      tx.spaceKnowledgeRevision.findUnique({
        where: { id: revisionId }, select: REVISION_V2_SCALAR_SELECT,
      }),
      tx.syncRevisionFolderRow.findMany({ where: { revisionId } }),
      tx.legacyRevisionSidecar.findUnique({ where: { revisionId } }),
      tx.syncRevisionTreeDeltaRow.findMany({ where: { revisionId }, select: { ordinal: true } }),
    ]);
    if (!revision || revision.spaceId !== spaceId || revision.parentRevisionId !== parentRevisionId) {
      throw this.invalidRevisionChain();
    }
    const ancestors = await tx.spaceKnowledgeRevision.findMany({
      where: { spaceId, sequence: { lt: revision.sequence } },
      orderBy: { sequence: 'desc' },
      select: REVISION_V2_SCALAR_SELECT,
    });
    let pendingTrustedGenesis = false;
    let chainTrust: Awaited<ReturnType<typeof validateRevisionChainTrust>>;
    try {
      chainTrust = await validateRevisionChainTrust(tx, spaceId, revision, ancestors);
    } catch {
      let canBootstrapTrustedGenesis: boolean;
      try {
        const existingCheckpoint = await tx.spaceRevisionChainCheckpoint.findUnique({
          where: { spaceId },
        });
        canBootstrapTrustedGenesis = !existingCheckpoint
          && await hasTrustedV2GenesisBoundary(tx, spaceId, revision, ancestors);
      } catch {
        canBootstrapTrustedGenesis = false;
      }
      if (
        canBootstrapTrustedGenesis
        && hasTrustedV2GenesisInputMarker(spaceId, revision, currentSidecarRow?.sidecar)
        && hasCompleteRevisionChain(revision, ancestors, { trustedGenesis: revision })
      ) {
        pendingTrustedGenesis = true;
        chainTrust = { checkpoint: null, trustedGenesis: revision };
      } else {
        throw this.invalidRevisionChain();
      }
    }
    const ancestorById = new Map(ancestors.map((ancestor) => [ancestor.id, ancestor]));
    const parent = parentRevisionId ? ancestorById.get(parentRevisionId) ?? null : null;
    const grandparent = parent?.parentRevisionId
      ? ancestorById.get(parent.parentRevisionId) ?? null
      : null;
    const [parentFolders, parentPages, parentSidecarRow, parentDeltaRows] = parent ? await Promise.all([
      tx.syncRevisionFolderRow.findMany({ where: { revisionId: parent.id } }),
      tx.syncRevisionPageRow.findMany({ where: { revisionId: parent.id }, include: { content: true } }),
      tx.legacyRevisionSidecar.findUnique({ where: { revisionId: parent.id } }),
      tx.syncRevisionTreeDeltaRow.findMany({ where: { revisionId: parent.id }, orderBy: { ordinal: 'asc' } }),
    ]) : [[], [], null, []];
    const [grandparentFolders, grandparentPages, grandparentSidecarRow, grandparentDeltaRows] = grandparent
      ? await Promise.all([
        tx.syncRevisionFolderRow.findMany({ where: { revisionId: grandparent.id } }),
        tx.syncRevisionPageRow.findMany({ where: { revisionId: grandparent.id }, include: { content: true } }),
        tx.legacyRevisionSidecar.findUnique({ where: { revisionId: grandparent.id } }),
        tx.syncRevisionTreeDeltaRow.findMany({
          where: { revisionId: grandparent.id }, orderBy: { ordinal: 'asc' },
        }),
      ])
      : [[], [], null, []];
    const grandparentShouldBeV2 = !!grandparent && revisionShouldBeV2({
      schemaVersion: grandparent.schemaVersion,
      recipeVersion: grandparent.recipeVersion,
      sidecar: grandparentSidecarRow?.sidecar,
      folderRowCount: grandparentFolders.length,
      hasPlacedPage: grandparentPages.some((page) => page.folderId !== null),
      treeDeltaRowCount: grandparentDeltaRows.length,
      migrationBatchId: grandparent.migrationBatchId,
    });
    const parentShouldBeV2 = !!parent && revisionShouldBeV2({
      schemaVersion: parent.schemaVersion,
      recipeVersion: parent.recipeVersion,
      sidecar: parentSidecarRow?.sidecar,
      folderRowCount: parentFolders.length,
      hasPlacedPage: parentPages.some((page) => page.folderId !== null),
      treeDeltaRowCount: parentDeltaRows.length,
      migrationBatchId: parent.migrationBatchId,
      parentShouldBeV2: grandparentShouldBeV2,
    });
    const useV2 = revisionShouldBeV2({
      schemaVersion: revision.schemaVersion,
      recipeVersion: revision.recipeVersion,
      sidecar: currentSidecarRow?.sidecar,
      folderRowCount: Math.max(folders.length, currentFolderRows.length),
      hasPlacedPage: pages.some((page) => page.folderId !== null),
      treeDeltaRowCount: currentDeltaRows.length,
      migrationBatchId: revision.migrationBatchId,
      parentShouldBeV2,
    });
    if (!useV2) return fallback;

    const grandparentManifest = grandparent && grandparentShouldBeV2
      ? await this.assertCompleteV2Parent(
        spaceId,
        grandparent,
        grandparentFolders,
        grandparentPages,
        grandparentSidecarRow,
        grandparentDeltaRows,
      )
      : null;
    const parentManifest = parent && parentShouldBeV2
      ? await this.assertCompleteV2Parent(
        spaceId,
        parent,
        parentFolders,
        parentPages,
        parentSidecarRow,
        parentDeltaRows,
      )
      : null;
    if (parentManifest && chainTrust.checkpoint?.anchorRevisionId !== parent?.id) {
      this.assertStoredTreeDelta(parentDeltaRows, treeRevisionDeltaV2(grandparentManifest, parentManifest));
    }

    const manifest = canonicalTreeRevisionManifestV2({
      protocolVersion: '2',
      spaceId,
      folders: folders.map((folder): SyncFolderV2 => ({
        folderId: folder.id,
        parentFolderId: folder.parentId,
        name: folder.name,
        path: folder.path,
        sortOrder: folder.sortOrder,
        updatedAt: folder.updatedAt.toISOString(),
      })),
      pages: pages.map((page): SyncPageV2 => ({
        pageId: page.pageId,
        folderId: page.folderId,
        path: page.path,
        title: page.title,
        body: page.content.body,
        contentHash: page.contentHash,
        updatedAt: page.updatedAt.toISOString(),
      })),
    });
    await tx.syncRevisionFolderRow.deleteMany({ where: { revisionId } });
    if (manifest.folders.length > 0) {
      await tx.syncRevisionFolderRow.createMany({
        data: manifest.folders.map((folder) => ({
          revisionId,
          folderId: folder.folderId,
          parentFolderId: folder.parentFolderId,
          name: folder.name,
          path: folder.path,
          pathKey: pathKey(folder.path),
          sortOrder: folder.sortOrder,
          updatedAt: new Date(folder.updatedAt),
        })),
      });
    }

    const deltaRows = treeRevisionDeltaV2(parentManifest, manifest).map((item) => {
      if (item.operation === 'archive_page') {
        return { operation: item.operation, folderId: null, pageId: item.pageId, previousPath: item.previousPath, contentHash: null };
      }
      if (item.operation === 'archive_folder') {
        return { operation: item.operation, folderId: item.folderId, pageId: null, previousPath: item.previousPath, contentHash: null };
      }
      if (item.operation === 'upsert_folder') {
        return { operation: item.operation, folderId: item.folder.folderId, pageId: null, previousPath: null, contentHash: null };
      }
      return { operation: item.operation, folderId: null, pageId: item.page.pageId, previousPath: null, contentHash: item.page.contentHash };
    });
    await tx.syncRevisionTreeDeltaRow.deleteMany({ where: { revisionId } });
    if (deltaRows.length > 0) {
      await tx.syncRevisionTreeDeltaRow.createMany({
        data: deltaRows.map((row, ordinal) => ({ revisionId, ordinal, ...row })),
      });
    }
    const empty = manifest.folders.length === 0 && manifest.pages.length === 0;
    const revisionContentHash = empty ? EMPTY_REVISION_HASH : await treeRevisionContentHashV2(manifest);
    const revisionManifestByteLength = BigInt(empty ? 0 : canonicalBytes(manifest).byteLength);
    const revisionBodyBytes = BigInt(manifest.pages.reduce(
      (total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0,
    ));
    await tx.spaceKnowledgeRevision.update({
      where: { id: revisionId },
      data: {
        schemaVersion: 'content-tree@2',
        recipeVersion: 'space-folders-v1',
        revisionContentHash,
        pageCount: BigInt(manifest.pages.length),
        revisionManifestByteLength,
        revisionBodyBytes,
      },
    });
    const sidecar = currentSidecarRow?.sidecar && typeof currentSidecarRow.sidecar === 'object' && !Array.isArray(currentSidecarRow.sidecar)
      ? currentSidecarRow.sidecar as Prisma.InputJsonObject : {};
    const migrationValue = sidecar.spaceFolderMigration;
    const migration = migrationValue && typeof migrationValue === 'object' && !Array.isArray(migrationValue)
      ? migrationValue as Prisma.InputJsonObject : {};
    await tx.legacyRevisionSidecar.upsert({
      where: { revisionId },
      create: { revisionId, sidecar: {
        ...sidecar,
        spaceFolderMigration: {
          ...migration,
          v2Revision: {
            protocolVersion: '2', manifestSchema: 'TreeRevisionContentManifestV2',
            folderCount: String(manifest.folders.length), pageCount: String(manifest.pages.length),
            revisionContentHash, revisionManifestByteLength: String(revisionManifestByteLength),
            revisionBodyBytes: String(revisionBodyBytes), treeDeltaCount: String(deltaRows.length),
          },
        },
      } },
      update: { sidecar: {
        ...sidecar,
        spaceFolderMigration: {
          ...migration,
          v2Revision: {
            protocolVersion: '2', manifestSchema: 'TreeRevisionContentManifestV2',
            folderCount: String(manifest.folders.length), pageCount: String(manifest.pages.length),
            revisionContentHash, revisionManifestByteLength: String(revisionManifestByteLength),
            revisionBodyBytes: String(revisionBodyBytes), treeDeltaCount: String(deltaRows.length),
          },
        },
      } },
    });
    if (pendingTrustedGenesis) {
      try {
        const finalized = await tx.spaceKnowledgeRevision.findUnique({
          where: { id: revisionId },
          select: REVISION_V2_SCALAR_SELECT,
        });
        if (!finalized) throw this.invalidRevisionChain();
        const evidence = await loadRevisionV2Evidence(tx, spaceId, revisionId);
        if (!hasTrustedV2GenesisMarker(spaceId, finalized, evidence.sidecar)) {
          throw this.invalidRevisionChain();
        }
        assertCompleteRevisionV2(finalized, evidence, null);
      } catch {
        throw this.invalidRevisionChain();
      }
    }
    return {
      revisionId,
      sequence: fallback.sequence,
      revisionContentHash,
      pageCount: BigInt(manifest.pages.length),
      revisionManifestByteLength,
      revisionBodyBytes,
    };
  }

  private invalidRevisionChain(): ContentTreeError {
    return new ContentTreeError(
      'CONTENT_TREE_REVISION_GONE',
      'Revision is not available',
    );
  }

  private assertStoredTreeDelta(
    rows: Array<{
      ordinal: number;
      operation: string;
      folderId: string | null;
      pageId: string | null;
      previousPath: string | null;
      contentHash: string | null;
    }>,
    expectedItems: TreeDeltaItemV2[],
  ): void {
    try {
      assertStoredTreeDeltaV2(rows, expectedItems);
    } catch {
      throw this.invalidRevisionChain();
    }
  }

  private async assertCompleteV2Parent(
    spaceId: string,
    revision: {
      schemaVersion: string;
      recipeVersion: string;
      revisionContentHash: string;
      pageCount: bigint;
      revisionManifestByteLength: bigint;
      revisionBodyBytes: bigint;
    },
    folderRows: Array<{
      folderId: string;
      parentFolderId: string | null;
      name: string;
      path: string;
      pathKey: string;
      sortOrder: number;
      updatedAt: Date;
    }>,
    pageRows: Array<{
      pageId: string;
      folderId: string | null;
      path: string;
      pathKey: string;
      title: string;
      contentHash: string;
      updatedAt: Date;
      content: { body: string; byteLength: number };
    }>,
    sidecarRow: { sidecar: unknown } | null,
    deltaRows: Array<{
      ordinal: number;
      operation: string;
      folderId: string | null;
      pageId: string | null;
      previousPath: string | null;
      contentHash: string | null;
    }>,
  ): Promise<TreeRevisionContentManifestV2> {
    try {
      for (const folder of folderRows) {
        const portable = validatePortableDirectoryPath(folder.path);
        if (portable.path !== folder.path || portable.key !== folder.pathKey) throw this.invalidRevisionChain();
      }
      for (const page of pageRows) {
        const portable = validatePortableMarkdownPath(page.path);
        const body = normalizeMarkdown(page.content.body);
        if (
          portable.path !== page.path
          || portable.key !== page.pathKey
          || body !== page.content.body
          || await contentHash(body) !== page.contentHash
          || Buffer.byteLength(body, 'utf8') !== page.content.byteLength
        ) throw this.invalidRevisionChain();
      }
      const manifest = canonicalTreeRevisionManifestV2({
        protocolVersion: '2',
        spaceId,
        folders: folderRows.map((folder): SyncFolderV2 => ({
          folderId: folder.folderId,
          parentFolderId: folder.parentFolderId,
          name: folder.name,
          path: folder.path,
          sortOrder: folder.sortOrder,
          updatedAt: folder.updatedAt.toISOString(),
        })),
        pages: pageRows.map((page): SyncPageV2 => ({
          pageId: page.pageId,
          folderId: page.folderId,
          path: page.path,
          title: page.title,
          body: page.content.body,
          contentHash: page.contentHash,
          updatedAt: page.updatedAt.toISOString(),
        })),
      });
      const folderById = new Map(manifest.folders.map((folder) => [folder.folderId, folder]));
      for (const folder of manifest.folders) {
        let current = folder;
        const seen = new Set<string>();
        while (current.parentFolderId !== null) {
          if (seen.has(current.folderId)) throw this.invalidRevisionChain();
          seen.add(current.folderId);
          const parent = folderById.get(current.parentFolderId);
          if (!parent) throw this.invalidRevisionChain();
          current = parent;
        }
      }
      if (manifest.pages.some((page) => page.folderId !== null && !folderById.has(page.folderId))) {
        throw this.invalidRevisionChain();
      }
      const empty = manifest.folders.length === 0 && manifest.pages.length === 0;
      const revisionContentHash = empty ? EMPTY_REVISION_HASH : await treeRevisionContentHashV2(manifest);
      const revisionManifestByteLength = BigInt(empty ? 0 : canonicalBytes(manifest).byteLength);
      const revisionBodyBytes = BigInt(manifest.pages.reduce(
        (total, page) => total + Buffer.byteLength(page.body, 'utf8'), 0,
      ));
      assertRevisionV2Metadata(revision, {
        manifest,
        calculatedHash: revisionContentHash,
        manifestBytes: Number(revisionManifestByteLength),
        bodyBytes: Number(revisionBodyBytes),
        folderRowCount: folderRows.length,
        hasPlacedPage: pageRows.some((page) => page.folderId !== null),
        sidecar: sidecarRow?.sidecar,
        deltaRows,
      });
      return manifest;
    } catch {
      throw this.invalidRevisionChain();
    }
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
    const bodyHashes = [...new Set(extras.map((extra) => extra.legacyBodyHash))];
    const bodyRows = bodyHashes.length === 0 ? [] : await tx.legacyPageBodyRow.findMany({
      where: { contentHash: { in: bodyHashes } },
    });
    const bodies = new Map(bodyRows.map((row) => [row.contentHash, row.body]));
    for (const extra of extras) {
      const value = extra.extra as Record<string, unknown>;
      stream.appendPage({
        pageId: extra.pageId,
        spaceId,
        path: (value.path as string) ?? '',
        title: (value.title as string) ?? '',
        body: (bodies.get(extra.legacyBodyHash) as string) ?? '',
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
