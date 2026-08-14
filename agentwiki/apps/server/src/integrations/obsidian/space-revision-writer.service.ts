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

    const created = await tx.spaceKnowledgeRevision.create({
      data: {
        spaceId,
        sequence,
        parentRevisionId,
        schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none',
        contentHash: revisionContentHash,
        revisionContentHash,
        snapshot: Prisma.JsonNull,
        delta: Prisma.JsonNull,
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
}
