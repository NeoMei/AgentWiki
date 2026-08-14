import { Injectable } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';

export interface RevisionHead {
  revisionId: string;
  sequence: number;
  contentHash: string;
}

export interface RevisionSnapshot extends RevisionHead {
  schemaVersion: string;
  recipeVersion: string;
  bundle: unknown;
}

export interface RevisionDelta {
  fromRevision: string;
  toRevision: string;
  revisions: Array<{
    revisionId: string;
    sequence: number;
    contentHash: string;
    delta: unknown;
  }>;
}

const EMPTY_REVISION: RevisionHead = {
  revisionId: '0',
  sequence: 0,
  contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
};

@Injectable()
export class KnowledgeRevisionService {
  constructor(private readonly prisma: PrismaService) {}

  async current(spaceId: string): Promise<RevisionHead> {
    const revision = await this.prisma.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true, sequence: true, contentHash: true },
    });
    if (!revision) return EMPTY_REVISION;
    return { revisionId: revision.id, sequence: revision.sequence, contentHash: revision.contentHash };
  }

  async snapshot(spaceId: string, revisionId?: string): Promise<RevisionSnapshot> {
    if (!revisionId || revisionId === '0') {
      const head = await this.current(spaceId);
      if (head.revisionId === '0') {
        return {
          ...EMPTY_REVISION,
          schemaVersion: 'knowledge-bundle@1',
          recipeVersion: 'none',
          bundle: {
            schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none', spaceId, baseRevision: '0',
            pages: [], memories: [], relations: [], provenance: [], deletions: [],
          },
        };
      }
      revisionId = head.revisionId;
    }
    const revision = await this.prisma.spaceKnowledgeRevision.findUnique({
      where: { id: revisionId },
    });
    if (!revision || revision.spaceId !== spaceId) {
      throw new BusinessException('KNOWLEDGE_REVISION_NOT_FOUND');
    }
    const bundle = revision.snapshot
      ? revision.snapshot
      : await this.synthesizeLegacyBundle(spaceId, revision.id);
    return {
      revisionId: revision.id,
      sequence: revision.sequence,
      contentHash: revision.contentHash,
      schemaVersion: revision.schemaVersion,
      recipeVersion: revision.recipeVersion,
      bundle,
    };
  }

  async delta(spaceId: string, fromRevisionId: string, maxCount = 100): Promise<RevisionDelta> {
    const head = await this.current(spaceId);
    if (head.revisionId === '0') {
      return { fromRevision: fromRevisionId, toRevision: '0', revisions: [] };
    }
    if (fromRevisionId === '0') {
      const snapshot = await this.snapshot(spaceId, head.revisionId);
      return {
        fromRevision: '0',
        toRevision: head.revisionId,
        revisions: [{
          revisionId: snapshot.revisionId,
          sequence: snapshot.sequence,
          contentHash: snapshot.contentHash,
          delta: snapshot.bundle,
        }],
      };
    }
    const fromRevision = await this.prisma.spaceKnowledgeRevision.findUnique({ where: { id: fromRevisionId } });
    if (!fromRevision || fromRevision.spaceId !== spaceId) {
      throw new BusinessException('KNOWLEDGE_REVISION_NOT_FOUND');
    }
    const revisions = await this.prisma.spaceKnowledgeRevision.findMany({
      where: { spaceId, sequence: { gt: fromRevision.sequence } },
      orderBy: { sequence: 'asc' },
      take: maxCount,
    });
    const synthesized = await Promise.all(revisions.map(async (r) => ({
      revisionId: r.id,
      sequence: r.sequence,
      contentHash: r.contentHash,
      delta: r.delta ?? await this.synthesizeLegacyBundle(spaceId, r.id),
    })));
    return {
      fromRevision: fromRevisionId,
      toRevision: head.revisionId,
      revisions: synthesized,
    };
  }

  private async synthesizeLegacyBundle(spaceId: string, revisionId: string): Promise<unknown> {
    const [sidecar, extras] = await Promise.all([
      this.prisma.legacyRevisionSidecar.findUnique({ where: { revisionId } }),
      this.prisma.legacyRevisionPageExtra.findMany({
        where: { revisionId },
        orderBy: { ordinal: 'asc' },
      }),
    ]);
    const pages = [];
    for (const extra of extras) {
      const value = extra.extra as Record<string, unknown>;
      const bodyRow = await this.prisma.legacyPageBodyRow.findUnique({
        where: { contentHash: extra.legacyBodyHash },
      });
      pages.push({
        pageId: extra.pageId,
        spaceId,
        path: value.path ?? '',
        title: value.title ?? '',
        body: bodyRow?.body ?? '',
        order: value.order ?? 0,
        ...(value.metadata ? { metadata: value.metadata } : {}),
        artifactIds: value.artifactIds ?? [],
        contentHash: value.contentHash ?? extra.legacyBodyHash,
        updatedAt: value.updatedAt ?? new Date(0).toISOString(),
      });
    }
    const sidecarValue = (sidecar?.sidecar ?? {}) as Record<string, unknown>;
    return {
      schemaVersion: sidecarValue.schemaVersion ?? 'knowledge-bundle@1',
      recipeVersion: sidecarValue.recipeVersion ?? 'none',
      spaceId,
      baseRevision: sidecarValue.baseRevision ?? null,
      pages,
      memories: sidecarValue.memories ?? [],
      relations: sidecarValue.relations ?? [],
      provenance: sidecarValue.provenance ?? [],
      deletions: sidecarValue.deletions ?? [],
    };
  }
}
