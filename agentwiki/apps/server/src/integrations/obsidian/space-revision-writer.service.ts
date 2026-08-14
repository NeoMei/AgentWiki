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

    const existingRows = parentRevisionId
      ? await tx.syncRevisionPageRow.findMany({
          where: { revisionId: parentRevisionId },
          include: { content: true },
        })
      : [];
    const pages = new Map<string, WorkingPage>(
      existingRows.map((row) => [
        row.pageId,
        {
          pageId: row.pageId,
          path: row.path,
          pathKey: row.pathKey,
          title: row.title,
          contentHash: row.contentHash,
          body: row.content.body,
          updatedAt: row.updatedAt,
        },
      ]),
    );

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
        const prior = pages.get(change.pageId);
        pages.delete(change.pageId);
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
      const prior = pages.get(change.pageId);
      await tx.syncPageContentRow.upsert({
        where: { contentHash: hash },
        create: {
          contentHash: hash,
          body,
          byteLength: new TextEncoder().encode(body).byteLength,
        },
        update: {},
      });
      pages.set(change.pageId, {
        pageId: change.pageId,
        path: change.path ?? prior?.path ?? '',
        pathKey: change.path ? pathKey(change.path) : prior?.pathKey ?? '',
        title: change.title ?? prior?.title ?? '',
        contentHash: hash,
        body,
        updatedAt: new Date(),
      });
      deltaRows.push({
        ordinal: ordinal++,
        operation: 'upsert',
        pageId: change.pageId,
        previousPath: null,
        contentHash: hash,
      });
    }

    const orderedPages = [...pages.values()].sort((a, b) =>
      a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0,
    );
    const manifest: RevisionContentManifest = {
      protocolVersion: '1',
      spaceId,
      pages: orderedPages.map((p) => ({
        pageId: p.pageId,
        path: p.path,
        title: p.title,
        contentHash: p.contentHash,
      })),
    };
    const revisionManifestBytes = orderedPages.length === 0
      ? new Uint8Array()
      : canonicalBytes(manifest);
    const revisionContentHash = orderedPages.length === 0
      ? EMPTY_REVISION_HASH
      : await computeRevisionContentHash(manifest);
    const revisionBodyBytes = orderedPages.reduce(
      (sum, p) => sum + BigInt(new TextEncoder().encode(p.body).byteLength),
      0n,
    );

    const legacySnapshot = await this.legacySnapshot(tx, spaceId, changes);
    const legacyContentHash = createHash('sha256')
      .update(JSON.stringify(legacySnapshot))
      .digest('hex');

    const created = await tx.spaceKnowledgeRevision.create({
      // Release A dual-write: keep legacy snapshot/delta populated so existing
      // local-sync keeps working. Release B will set these to null.
      data: {
        spaceId,
        sequence,
        parentRevisionId,
        schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none',
        contentHash: legacyContentHash,
        revisionContentHash,
        snapshot: legacySnapshot as unknown as Prisma.InputJsonValue,
        delta: legacySnapshot as unknown as Prisma.InputJsonValue,
        pageCount: BigInt(orderedPages.length),
        revisionBodyBytes,
        revisionManifestByteLength: BigInt(revisionManifestBytes.byteLength),
        origin: origin.origin,
        createdByUserId: origin.createdByUserId ?? null,
        humanDeviceCredentialId: origin.humanDeviceCredentialId ?? null,
        sourceChangeSetId: origin.sourceChangeSetId ?? null,
        migrationBatchId: origin.migrationBatchId ?? null,
      },
    });

    if (orderedPages.length > 0) {
      await tx.syncRevisionPageRow.createMany({
        data: orderedPages.map((p) => ({
          revisionId: created.id,
          pageId: p.pageId,
          path: p.path,
          pathKey: p.pathKey,
          title: p.title,
          contentHash: p.contentHash,
          updatedAt: p.updatedAt,
        })),
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

    return {
      revisionId: created.id,
      sequence,
      revisionContentHash,
      pageCount: BigInt(orderedPages.length),
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
