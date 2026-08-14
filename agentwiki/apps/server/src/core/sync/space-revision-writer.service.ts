import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import {
  canonicalBytes,
  contentHash,
  normalizeMarkdown,
  pathKey,
  revisionContentHash as computeRevisionContentHash,
  type RevisionContentManifest,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';

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
}

interface WorkingPage {
  pageId: string;
  path: string;
  pathKey: string;
  title: string;
  contentHash: string;
  body: string;
  updatedAt: Date;
}

@Injectable()
export class SpaceRevisionWriterService {
  constructor(private readonly prisma: PrismaService) {}

  async lockSpace(tx: Prisma.TransactionClient, spaceId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`;
  }

  async advance(
    tx: Prisma.TransactionClient,
    spaceId: string,
    changes: PageChange[],
    origin: RevisionOrigin,
  ): Promise<RevisionWriteResult> {
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
      const nextOrdinalAgg = await tx.legacyRevisionPageExtra.aggregate({
        where: { revisionId: created.id },
        _max: { ordinal: true },
      });
      const legacyOrdinal = (nextOrdinalAgg._max.ordinal ?? -1) + 1;
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
            spaceId,
            title: change.title ?? undefined,
            order: legacyOrdinal,
            metadata: null,
            artifactIds: [],
            legacyBodyHash: hash,
            contentHash: hash,
            path: change.path ?? undefined,
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

    const legacySnapshot = await this.legacySnapshot(tx, spaceId, changes);
    const legacyContentHash = createHash('sha256')
      .update(JSON.stringify(legacySnapshot))
      .digest('hex');

    await tx.spaceKnowledgeRevision.update({
      where: { id: created.id },
      data: {
        contentHash: legacyContentHash,
        revisionContentHash,
        snapshot: legacySnapshot as unknown as Prisma.InputJsonValue,
        delta: legacySnapshot as unknown as Prisma.InputJsonValue,
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

  private async legacySnapshot(
    tx: Prisma.TransactionClient,
    spaceId: string,
    changes: PageChange[],
  ) {
    const pages = await tx.page.findMany({
      where: { spaceId, deletedAt: null },
      select: {
        knowledgeKey: true,
        title: true,
        content: true,
        parentId: true,
        sortOrder: true,
        updatedAt: true,
        sourcePath: true,
        syncPath: true,
      },
    });
    const changedByPageId = new Map(changes.map((change) => [change.pageId, change]));
    const memories = await tx.agentMemory.findMany({
      where: { spaceId, deletedAt: null, archivedAt: null },
      select: { id: true, type: true, content: true, updatedAt: true },
    });
    const relations = await tx.knowledgeRelation.findMany({
      where: { sourcePage: { spaceId } },
      select: { knowledgeKey: true, sourcePageId: true, targetPageId: true, relation: true, strength: true, confidence: true },
    });
    const pageKnowledgeKeyById = new Map(
      (await tx.page.findMany({ where: { spaceId }, select: { id: true, knowledgeKey: true } }))
        .map((page) => [page.id, page.knowledgeKey]),
    );
    return {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'none',
      spaceId,
      baseRevision: null,
      pages: pages.map((page) => ({
        pageId: page.knowledgeKey,
        spaceId,
        path: page.syncPath || page.sourcePath || this.pagePathFromTitle(page.title),
        title: page.title,
        body: page.content,
        order: page.sortOrder ?? 0,
        ...(page.parentId ? { metadata: { parentId: page.parentId } } : {}),
        artifactIds: [],
        contentHash: createHash('sha256').update(page.content).digest('hex'),
        updatedAt: page.updatedAt.toISOString(),
      })),
      memories: memories.map((memory) => ({
        memoryId: memory.id,
        spaceId,
        key: memory.type,
        value: memory.content,
        scope: 'space' as const,
        pageIds: [] as string[],
        artifactIds: [],
        contentHash: createHash('sha256').update(memory.content).digest('hex'),
        updatedAt: memory.updatedAt.toISOString(),
      })),
      relations: relations.map((relation) => ({
        relationId: relation.knowledgeKey,
        spaceId,
        sourceId: pageKnowledgeKeyById.get(relation.sourcePageId) ?? relation.sourcePageId,
        targetId: pageKnowledgeKeyById.get(relation.targetPageId) ?? relation.targetPageId,
        relationType: relation.relation,
        artifactIds: [],
        metadata: { strength: relation.strength, confidence: relation.confidence },
      })),
      provenance: [],
      deletions: [],
    };
  }

  private pagePathFromTitle(title: string): string {
    const slug = title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    return `pages/${slug}.md`;
  }
}
