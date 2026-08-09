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
    return {
      revisionId: revision.id,
      sequence: revision.sequence,
      contentHash: revision.contentHash,
      schemaVersion: revision.schemaVersion,
      recipeVersion: revision.recipeVersion,
      bundle: revision.snapshot,
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
    return {
      fromRevision: fromRevisionId,
      toRevision: head.revisionId,
      revisions: revisions.map((r) => ({
        revisionId: r.id,
        sequence: r.sequence,
        contentHash: r.contentHash,
        delta: r.delta,
      })),
    };
  }
}
