import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

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

  constructor(private prisma: PrismaService) {}

  async createRelation(data: CreateRelationInput, userId?: string) {
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
    if (data.evidenceId) {
      const evidence = await this.prisma.evidence.findUnique({
        where: { id: data.evidenceId },
        select: { run: { select: { spaceId: true } } },
      });
      if (!evidence || evidence.run.spaceId !== pages[0].spaceId) {
        throw new BadRequestException('Relation evidence must belong to the relation space');
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const relation = await tx.knowledgeRelation.create({
        data: {
          relation: data.relation,
          sourcePageId: data.sourcePageId,
          targetPageId: data.targetPageId,
          strength: data.strength ?? 1.0,
          confidence: data.confidence ?? 1.0,
          evidenceId: data.evidenceId,
          lastModifiedByUserId: userId,
          lastModifiedAt: new Date(),
        },
      });
      if (data.evidenceId) {
        await tx.evidence.update({ where: { id: data.evidenceId }, data: { targetRelationId: relation.id } });
      }
      return relation;
    });
  }

  async getRelations(pageId: string) {
    this.logger.log('Getting relations for page: ' + pageId);
    const [outgoing, incoming] = await Promise.all([
      this.prisma.knowledgeRelation.findMany({
        where: {
          sourcePageId: pageId,
          sourcePage: { deletedAt: null },
          targetPage: { deletedAt: null },
        },
      }),
      this.prisma.knowledgeRelation.findMany({
        where: {
          targetPageId: pageId,
          sourcePage: { deletedAt: null },
          targetPage: { deletedAt: null },
        },
      }),
    ]);
    return { outgoing, incoming };
  }

  async getRelatedPages(pageId: string) {
    this.logger.log('Getting related pages for: ' + pageId);
    const relations = await this.prisma.knowledgeRelation.findMany({
      where: { OR: [{ sourcePageId: pageId }, { targetPageId: pageId }] },
    });

    const relatedPageIds = relations.map((r) =>
      r.sourcePageId === pageId ? r.targetPageId : r.sourcePageId,
    );

    const pages = relatedPageIds.length > 0
      ? await this.prisma.page.findMany({
          where: { id: { in: relatedPageIds }, deletedAt: null },
          select: { id: true, title: true, slug: true, spaceId: true, deletedAt: true },
        })
      : [];

    const pageMap = new Map(pages.map((p) => [p.id, p]));

    return relations.map((r) => ({
      relation: r.relation,
      strength: r.strength,
      confidence: r.confidence,
      origin: r.origin,
      evidenceId: r.evidenceId,
      createdByAgentId: r.createdByAgentId,
      page: pageMap.get(r.sourcePageId === pageId ? r.targetPageId : r.sourcePageId),
      direction: r.sourcePageId === pageId ? 'outgoing' : 'incoming',
    }));
  }

  async deleteRelation(id: string) {
    this.logger.log('Deleting relation: ' + id);
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id },
    });
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.knowledgeRelation.delete({ where: { id } });
      if (deleted.evidenceId) {
        await tx.evidence.updateMany({ where: { id: deleted.evidenceId, targetRelationId: id }, data: { targetRelationId: null } });
      }
      return deleted;
    });
  }

  async updateRelationStrength(id: string, strength: number, userId?: string) {
    this.logger.log('Updating relation strength: ' + id + ' = ' + strength);
    const relation = await this.prisma.knowledgeRelation.findUnique({
      where: { id },
    });
    if (!relation) {
      throw new NotFoundException('Relation not found');
    }
    return this.prisma.knowledgeRelation.update({
      where: { id },
      data: { strength, lastModifiedByUserId: userId, lastModifiedAt: new Date() },
    });
  }

  async getGraph(spaceId: string) {
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
        where: { id: { in: changeSetIds } },
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
          id: true,
          quote: true,
          location: true,
          confidence: true,
          sourceVersion: { select: { version: true, metadata: true, source: { select: { id: true, name: true, type: true, uri: true } } } },
        },
      }) : Promise.resolve([]),
      agentIds.length ? this.prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
    ]);
    const changeSetById = new Map(changeSets.map((changeSet) => [changeSet.id, changeSet]));
    const evidenceById = new Map(evidences.map((evidence) => [evidence.id, evidence]));
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const userById = new Map(users.map((user) => [user.id, user]));

    const nodeMap = new Map(pages.map((p, i) => {
      const angle = (i / Math.max(pages.length, 1)) * Math.PI * 2;
      const radius = Math.min(200, 50 + pages.length * 15);
      return [p.id, {
        id: p.id,
        title: p.title,
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
      evidenceId: r.evidenceId,
      sourceChangeSetId: r.sourceChangeSetId,
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
