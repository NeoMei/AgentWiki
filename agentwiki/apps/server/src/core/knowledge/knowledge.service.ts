import { SourceFreshnessService, EVIDENCE_READ_FIELDS } from '../source-freshness/source-freshness.service';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { SpaceRevisionWriterService } from '../sync/space-revision-writer.service';

export interface CreateRelationInput {
  relation: string;
  sourcePageId: string;
  targetPageId: string;
  strength?: number;
  confidence?: number;
  evidenceId?: string;
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly freshness: SourceFreshnessService,
    private prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly revisionWriter: SpaceRevisionWriterService,
  ) {}

  async createRelation(data: CreateRelationInput, principal: Principal) {
    this.logger.log('Creating relation: ' + data.relation + ' from ' + data.sourcePageId + ' to ' + data.targetPageId);
    if (data.sourcePageId === data.targetPageId) {
      throw new BadRequestException('A page cannot relate to itself');
    }
    const pages = await this.prisma.page.findMany({
      where: { id: { in: [data.sourcePageId, data.targetPageId] }, deletedAt: null },
      select: { id: true, spaceId: true },
    });
    if (pages.length !== 2) throw new NotFoundException('Source or target page not found');
    if (pages[0].spaceId !== pages[1].spaceId) {
      throw new BadRequestException('Knowledge relations cannot cross space boundaries');
    }
    return this.prisma.$transaction(async (tx) => {
      const spaceId = pages[0].spaceId;
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, spaceId, ['owner', 'editor'],
      );
      const livePages = await tx.page.findMany({
        where: { id: { in: [data.sourcePageId, data.targetPageId] }, spaceId, deletedAt: null },
        select: { id: true, spaceId: true },
      });
      if (livePages.length !== 2) throw new NotFoundException('Source or target page not found');
      if (data.evidenceId) {
        const evidence = await tx.evidence.findUnique({
          where: { id: data.evidenceId },
          select: { run: { select: { spaceId: true } } },
        });
        if (!evidence || evidence.run.spaceId !== spaceId) {
          throw new BadRequestException('Relation evidence must belong to the relation space');
        }
      }
      await tx.spaceGraphState.upsert({ where: { spaceId }, create: { spaceId }, update: {} });
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      const existing = await tx.knowledgeRelation.findUnique({
        where: {
          sourcePageId_targetPageId_relation: {
            sourcePageId: data.sourcePageId,
            targetPageId: data.targetPageId,
            relation: data.relation,
          },
        },
      });
      const relation = existing?.origin.startsWith('auto_')
        ? await tx.knowledgeRelation.update({
          where: { id: existing.id },
          data: {
            origin: 'manual',
            strength: data.strength ?? 1.0,
            confidence: data.confidence ?? 1.0,
            evidenceId: data.evidenceId,
            sourceChangeSetId: null,
            createdByAgentId: null,
            lastModifiedByUserId: principal.userId,
            lastModifiedAt: new Date(),
          },
        })
        : await tx.knowledgeRelation.create({
          data: {
            relation: data.relation,
            sourcePageId: data.sourcePageId,
            targetPageId: data.targetPageId,
            strength: data.strength ?? 1.0,
            confidence: data.confidence ?? 1.0,
            evidenceId: data.evidenceId,
            lastModifiedByUserId: principal.userId,
            lastModifiedAt: new Date(),
          },
        });
      if (data.evidenceId) {
        await tx.evidence.update({ where: { id: data.evidenceId }, data: { targetRelationId: relation.id } });
      }
      return relation;
    });
  }

  private async projectRelations(relations: any[], spaceId: string, principal: Principal) {
    const ids = [...new Set(relations.map(row => row.evidenceId).filter(Boolean))];
    const evidence = ids.length ? await this.prisma.evidence.findMany({ where: { id: { in: ids } }, select: EVIDENCE_READ_FIELDS }) : [];
    const allowed = await this.freshness.projectEvidence(evidence, spaceId, principal);
    const changeSetIds = [...new Set(relations.map(row => row.sourceChangeSetId).filter(Boolean))];
    const changeSets = changeSetIds.length ? await this.prisma.changeSet.findMany({ where: { id: { in: changeSetIds }, spaceId }, select: { id: true } }) : [];
    const visibleChanges = new Set(changeSets.map(row => row.id));
    return relations.map(row => ({ ...row, evidenceId: allowed.has(row.evidenceId) ? row.evidenceId : null,
      sourceChangeSetId: allowed.has(row.evidenceId) && visibleChanges.has(row.sourceChangeSetId) ? row.sourceChangeSetId : null }));
  }

  async getRelations(pageId: string, principal: Principal) {
    const page = await this.authorization.assertPageAccess(principal, pageId, ['owner', 'admin', 'editor', 'viewer'], 'graph:read');
    const rows = await this.prisma.knowledgeRelation.findMany({ where: {
      OR: [{ sourcePageId: pageId }, { targetPageId: pageId }],
      sourcePage: { spaceId: page.spaceId, deletedAt: null }, targetPage: { spaceId: page.spaceId, deletedAt: null },
    } });
    const projected = await this.projectRelations(rows, page.spaceId, principal);
    return { outgoing: projected.filter(row => row.sourcePageId === pageId), incoming: projected.filter(row => row.targetPageId === pageId) };
  }

  async getRelatedPages(pageId: string, principal: Principal) {
    const { outgoing, incoming } = await this.getRelations(pageId, principal);
    const relations = [...outgoing, ...incoming];
    const ids = [...new Set(relations.map(row => row.sourcePageId === pageId ? row.targetPageId : row.sourcePageId))];
    const pages = ids.length ? await this.prisma.page.findMany({ where: { id: { in: ids }, deletedAt: null }, select: {
      id: true, title: true, slug: true, spaceId: true, folderId: true, syncPath: true, deletedAt: true,
    } }) : [];
    const byId = new Map(pages.map(page => [page.id, page]));
    return relations.flatMap(row => {
      const page = byId.get(row.sourcePageId === pageId ? row.targetPageId : row.sourcePageId);
      return page ? [{ relation: row.relation, strength: row.strength, confidence: row.confidence, origin: row.origin,
        evidenceId: row.evidenceId, createdByAgentId: row.createdByAgentId,
        page: { ...page, path: page.syncPath ?? null }, direction: row.sourcePageId === pageId ? 'outgoing' : 'incoming' }] : [];
    });
  }

  async deleteRelation(id: string, principal: Principal) {
    this.logger.log('Deleting relation: ' + id);
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id },
      include: { sourcePage: { select: { spaceId: true } } },
    });
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const spaceId = relation.sourcePage.spaceId;
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, spaceId, ['owner', 'editor'],
      );
      await tx.spaceGraphState.upsert({ where: { spaceId }, create: { spaceId }, update: {} });
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      const current = await tx.knowledgeRelation.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Relation not found');
      const deleted = await tx.knowledgeRelation.delete({ where: { id } });
      if (deleted.evidenceId) {
        await tx.evidence.updateMany({ where: { id: deleted.evidenceId, targetRelationId: id }, data: { targetRelationId: null } });
      }
      return deleted;
    });
  }

  async updateRelationStrength(id: string, strength: number, principal: Principal) {
    this.logger.log('Updating relation strength: ' + id + ' = ' + strength);
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id },
      include: { sourcePage: { select: { spaceId: true } } },
    });
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const spaceId = relation.sourcePage.spaceId;
      await this.authorization.lockLiveHumanPrincipal(tx, principal);
      const lockedTx = await this.revisionWriter.lockSpace(tx, spaceId);
      await this.authorization.assertLiveHumanSpaceAccess(
        lockedTx, principal, spaceId, ['owner', 'editor'],
      );
      await tx.spaceGraphState.upsert({ where: { spaceId }, create: { spaceId }, update: {} });
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      const current = await tx.knowledgeRelation.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Relation not found');
      return tx.knowledgeRelation.update({
        where: { id },
        data: { strength, lastModifiedByUserId: principal.userId, lastModifiedAt: new Date() },
      });
    });
  }

  async getGraph(spaceId: string, principal: Principal) {
    this.logger.log('Getting graph for space: ' + spaceId);
    const pages = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
    });

    // Handle empty pages gracefully
    if (pages.length === 0) {
      return { nodes: [], edges: [] };
    }

    const pageIds = pages.map((p) => p.id);
    const relations = await this.prisma.knowledgeRelation.findMany({
      where: {
        OR: [
          { sourcePageId: { in: pageIds } },
          { targetPageId: { in: pageIds } },
        ],
      },
    });

    const validRelations = relations.filter(
      (r) => pages.some((p) => p.id === r.sourcePageId) && pages.some((p) => p.id === r.targetPageId),
    );
    const changeSetIds = validRelations.map((relation) => relation.sourceChangeSetId).filter((id): id is string => Boolean(id));
    const evidenceIds = validRelations.map((relation) => relation.evidenceId).filter((id): id is string => Boolean(id));
    const agentIds = validRelations.map((relation) => relation.createdByAgentId).filter((id): id is string => Boolean(id));
    const userIds = validRelations.map((relation) => relation.lastModifiedByUserId).filter((id): id is string => Boolean(id));
    const [changeSets, evidences, agents, users] = await Promise.all([
      changeSetIds.length ? this.prisma.changeSet.findMany({
        where: { id: { in: changeSetIds }, spaceId },
        select: {
          id: true,
          status: true,
          reviewedAt: true,
          publishedAt: true,
          approvals: { orderBy: { createdAt: 'desc' }, take: 1, select: { decision: true, createdAt: true, reviewer: { select: { id: true, name: true, email: true } } } },
        },
      }) : Promise.resolve([]),
      evidenceIds.length ? this.prisma.evidence.findMany({
        where: { id: { in: evidenceIds } },
        select: {
          ...EVIDENCE_READ_FIELDS,
        },
      }) : Promise.resolve([]),
      agentIds.length ? this.prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    ]);
    const changeSetById = new Map(changeSets.map((changeSet) => [changeSet.id, changeSet]));
    const { evidence: evidenceById, statuses: sourceStatuses } = await this.freshness.projectGraph(pages, evidences, principal);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const userById = new Map(users.map((user) => [user.id, user]));

    const nodeMap = new Map(pages.map((p, i) => {
      const angle = (i / Math.max(pages.length, 1)) * Math.PI * 2;
      const radius = Math.min(200, 50 + pages.length * 15);
      return [p.id, {
        id: p.id,
        title: p.title,
        sourceStatus: sourceStatuses.get(p.id),
        folderId: p.folderId ?? null,
        path: p.syncPath ?? null,
        x: 400 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius,
        radius: 20,
      }];
    }));

    const nodes = Array.from(nodeMap.values());
    const edges = validRelations.map((r) => {
      const changeSet = r.sourceChangeSetId ? changeSetById.get(r.sourceChangeSetId) : undefined;
      const evidence = r.evidenceId ? evidenceById.get(r.evidenceId) : undefined;
      return ({
      id: r.id,
      source: r.sourcePageId,
      target: r.targetPageId,
      relation: r.relation,
      strength: r.strength,
      confidence: r.confidence,
      origin: r.origin,
      evidenceId: evidence ? r.evidenceId : null,
      sourceChangeSetId: evidence && changeSet ? r.sourceChangeSetId : null,
      createdByAgentId: r.createdByAgentId,
      createdByAgent: r.createdByAgentId ? agentById.get(r.createdByAgentId) : null,
      evidence,
      sourceInfo: evidence?.sourceVersion.source ?? null,
      sourceVersion: evidence?.sourceVersion.version ?? null,
      sourceMetadata: evidence?.sourceVersion.metadata ?? null,
      approvalStatus: changeSet?.status || (r.origin === 'manual' ? 'manual' : 'unknown'),
      approval: changeSet?.approvals[0] ?? null,
      reviewedAt: changeSet?.reviewedAt ?? null,
      publishedAt: changeSet?.publishedAt ?? null,
      lastModifiedAt: r.lastModifiedAt,
      lastModifiedByUser: r.lastModifiedByUserId ? userById.get(r.lastModifiedByUserId) : null,
    });
    });

    return { nodes, edges };
  }
}
