import { ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../integrations/llm/llm.service';
import { GraphExtractionService, type WikiLinkTarget } from './graph-extraction.service';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';

export type GraphLayer = 'wikilink' | 'similar' | 'llm';

export interface RefreshResult {
  wikilink: { created: number; removed: number; dangling: number };
  similar: { created: number; removed: number; skipped: number };
  llm: { changeSetId: string | null; proposed: number; reason?: string };
}

const ORIGIN_WIKILINK = 'auto_wikilink';
const ORIGIN_SIMILAR = 'auto_similar';
const LLM_PAGE_BATCH = 6;
const LLM_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LLM_RELATION_TYPES = new Set(['supports', 'contradicts', 'extends', 'related_to']);

export function graphSnapshotHash(pages: Array<{
  id: string;
  updatedAt?: Date | string;
}>): string {
  const hash = createHash('sha256');
  for (const page of [...pages].sort((left, right) => left.id.localeCompare(right.id))) {
    hash.update(page.id).update('\0');
    hash.update(page.updatedAt instanceof Date ? page.updatedAt.toISOString() : String(page.updatedAt ?? '')).update('\0');
  }
  return hash.digest('hex');
}

@Injectable()
export class GraphRefreshService {
  private readonly logger = new Logger(GraphRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: GraphExtractionService,
    private readonly llm: LlmService,
    @Optional() private readonly authorization?: AuthorizationService,
    @Optional() private readonly revisionWriter?: SpaceRevisionWriterService,
  ) {}

  async refresh(spaceId: string, layers?: GraphLayer[], principal?: Principal): Promise<RefreshResult> {
    const space = await this.prisma.space.findUnique({
      where: { id: spaceId, deletedAt: null },
      select: {
        id: true,
        members: { where: { role: 'owner' }, select: { userId: true }, take: 1 },
      },
    });
    if (!space) throw new ForbiddenException('Space not found');
    const selected = layers ?? (['wikilink', 'similar', 'llm'] as GraphLayer[]);
    const deterministic = await this.prisma.$transaction(async (tx) => {
      await this.lockHumanPrincipal(tx, principal);
      const lockedTx = await this.lockSpace(tx, spaceId);
      await this.assertLiveHumanAccess(lockedTx, principal, spaceId);
      await lockedTx.spaceGraphState.upsert({ where: { spaceId }, create: { spaceId }, update: {} });
      await lockedTx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      const [state, pages] = await Promise.all([
        lockedTx.spaceGraphState.findUnique({ where: { spaceId } }),
        lockedTx.page.findMany({
          where: { spaceId, deletedAt: null },
          select: { id: true, title: true, slug: true, content: true, updatedAt: true },
        }),
      ]);
      const vectorRows = await lockedTx.$queryRaw<Array<{ id: string; vector: string }>>(Prisma.sql`
        SELECT "id", "embeddingVector"::text AS "vector"
        FROM "Page"
        WHERE "spaceId" = ${spaceId}
          AND "deletedAt" IS NULL
          AND "embeddingVector" IS NOT NULL
      `);
      const embeddingByPage = new Map(vectorRows.map((row) => [
        row.id,
        row.vector.slice(1, -1).split(',').map(Number),
      ]));
      if (!state) throw new Error('Space graph state disappeared during refresh');
      const result: RefreshResult = {
        wikilink: { created: 0, removed: 0, dangling: 0 },
        similar: { created: 0, removed: 0, skipped: 0 },
        llm: { changeSetId: null, proposed: 0 },
      };
      if (selected.includes('wikilink') && state.wikilinkEnabled) {
        result.wikilink = await this.refreshWikilinks(lockedTx, spaceId, pages);
      }
      if (selected.includes('similar')) {
        if (!state.similarEnabled) {
          result.similar.skipped = pages.length;
        } else {
          result.similar = await this.refreshSimilar(
            lockedTx,
            spaceId,
            pages.map((page) => ({
              id: page.id,
              embedding: embeddingByPage.get(page.id) ?? null,
            })),
            state.similarThreshold,
          );
        }
      }
      return { state, pages, result };
    }, { maxWait: 5_000, timeout: 60_000 });
    const { state, pages, result } = deterministic;
    if (selected.includes('llm') && state.llmEnabled) {
      result.llm = await this.proposeLlmRelations(
        spaceId,
        pages,
        principal?.userId ?? space.members[0]?.userId,
        state.lastLlmRunAt,
        principal,
      );
    }

    const contentHash = graphSnapshotHash(pages);
    const llmDeferred = state.llmEnabled && [
      'llm_unavailable',
      'rate_limited',
      'proposal_pending',
      'no_author',
    ].includes(result.llm.reason ?? '');
    const recordContentHash = layers === undefined && !llmDeferred;
    await this.prisma.$transaction(async (tx) => {
      await this.lockHumanPrincipal(tx, principal);
      const lockedTx = await this.lockSpace(tx, spaceId);
      await this.assertLiveHumanAccess(lockedTx, principal, spaceId);
      await lockedTx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      let snapshotIsCurrent = recordContentHash;
      if (snapshotIsCurrent) {
        const currentPages = await lockedTx.page.findMany({
          where: { spaceId, deletedAt: null },
          select: { id: true, updatedAt: true },
        });
        snapshotIsCurrent = graphSnapshotHash(currentPages) === contentHash;
      }
      await lockedTx.spaceGraphState.upsert({
        where: { spaceId },
        create: {
          spaceId,
          ...(snapshotIsCurrent ? { lastContentHash: contentHash } : {}),
          lastRunAt: new Date(),
        },
        update: {
          ...(snapshotIsCurrent ? { lastContentHash: contentHash } : {}),
          lastRunAt: new Date(),
          ...(result.llm.changeSetId ? { lastLlmChangeSetId: result.llm.changeSetId } : {}),
        },
      });
    }, { maxWait: 5_000, timeout: 60_000 });
    return result;
  }

  async getOrCreateState(spaceId: string) {
    const existing = await this.prisma.spaceGraphState.findUnique({ where: { spaceId } });
    if (existing) return existing;
    try {
      return await this.prisma.spaceGraphState.upsert({
        where: { spaceId },
        create: { spaceId },
        update: {},
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      const raced = await this.prisma.spaceGraphState.findUnique({ where: { spaceId } });
      if (!raced) throw error;
      return raced;
    }
  }

  async updateSettings(
    spaceId: string,
    input: {
      wikilinkEnabled?: boolean;
      similarEnabled?: boolean;
      similarThreshold?: number;
      llmEnabled?: boolean;
    },
    principal: Principal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockHumanPrincipal(tx, principal);
      const lockedTx = await this.lockSpace(tx, spaceId);
      await this.assertLiveHumanAccess(lockedTx, principal, spaceId);
      return lockedTx.spaceGraphState.upsert({
        where: { spaceId },
        create: { spaceId, ...input },
        update: { ...input, lastContentHash: null },
      });
    });
  }

  private async refreshWikilinks(
    database: Prisma.TransactionClient,
    spaceId: string,
    pages: Array<{ id: string; title: string; slug: string; content: string }>,
  ) {
    const links: WikiLinkTarget[] = [];
    for (const page of pages) {
      for (const target of this.extraction.extractWikiLinks(page.content ?? '')) {
        links.push({ sourcePageId: page.id, target });
      }
    }
    const { resolved, dangling } = this.extraction.resolveWikiLinks(pages, links);
    const wanted = new Map(resolved.map((pair) => [
      `${pair.sourcePageId}|${pair.targetPageId}|references`,
      pair,
    ]));
    const existing = await database.knowledgeRelation.findMany({
        where: {
          sourcePage: { spaceId },
          origin: ORIGIN_WIKILINK,
        },
        select: { id: true, sourcePageId: true, targetPageId: true, relation: true },
    });
    const wantedKeys = new Set(wanted.keys());
    const toDelete = existing
      .filter((relation) => !wantedKeys.has(`${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`))
      .map((relation) => relation.id);
    const existingKeys = new Set(existing.map((relation) => `${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`));
    const toCreate = [...wanted.entries()]
      .filter(([key]) => !existingKeys.has(key))
      .map(([, pair]) => pair);
    const creation = toCreate.length
      ? await database.knowledgeRelation.createMany({
          data: toCreate.map((pair) => ({
            sourcePageId: pair.sourcePageId,
            targetPageId: pair.targetPageId,
            relation: 'references',
            origin: ORIGIN_WIKILINK,
            confidence: 1.0,
            strength: 1.0,
          })),
          skipDuplicates: true,
      })
      : { count: 0 };
    const deletion = toDelete.length
      ? await database.knowledgeRelation.deleteMany({
          where: { id: { in: toDelete }, origin: ORIGIN_WIKILINK },
      })
      : { count: 0 };
    return { created: creation.count, removed: deletion.count, dangling };
  }

  private async refreshSimilar(
    database: Prisma.TransactionClient,
    spaceId: string,
    pages: Array<{ id: string; embedding: number[] | null }>,
    threshold: number,
  ) {
    const skipped = pages.filter((page) => !Array.isArray(page.embedding) || page.embedding.length === 0).length;
    const existing = await database.knowledgeRelation.findMany({
        where: {
          sourcePage: { spaceId },
          origin: ORIGIN_SIMILAR,
        },
        select: {
          id: true,
          sourcePageId: true,
          targetPageId: true,
          relation: true,
          confidence: true,
          strength: true,
        },
    });
    const existingByKey = new Map(existing.map((relation) => [
      `${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`,
      relation,
    ]));
    const retainedKeys = new Set<string>();
    const scoreUpdates: Array<{ id: string; score: number }> = [];
    let created = 0;
    for (const pairs of this.extraction.computeSimilarPairChunks(pages, threshold)) {
      const toCreate = pairs.filter((pair) => {
        const key = `${pair.sourcePageId}|${pair.targetPageId}|similar_to`;
        const relation = existingByKey.get(key);
        if (!relation) return true;
        retainedKeys.add(key);
        if (Math.abs(relation.confidence - pair.score) > 1e-9
          || Math.abs(relation.strength - pair.score) > 1e-9) {
          scoreUpdates.push({ id: relation.id, score: pair.score });
        }
        return false;
      });
      if (!toCreate.length) continue;
      const creation = await database.knowledgeRelation.createMany({
        data: toCreate.map((pair) => ({
          sourcePageId: pair.sourcePageId,
          targetPageId: pair.targetPageId,
          relation: 'similar_to',
          origin: ORIGIN_SIMILAR,
          confidence: pair.score,
          strength: pair.score,
        })),
        skipDuplicates: true,
      });
      created += creation.count;
    }
    for (let offset = 0; offset < scoreUpdates.length; offset += 500) {
      const batch = scoreUpdates.slice(offset, offset + 500);
      await database.$executeRaw(Prisma.sql`
        UPDATE "KnowledgeRelation" AS relation
        SET "confidence" = incoming."score",
            "strength" = incoming."score",
            "lastModifiedAt" = NOW()
        FROM (VALUES ${Prisma.join(batch.map((item) => Prisma.sql`
          (${item.id}::text, ${item.score}::double precision)
        `))}) AS incoming("id", "score")
        WHERE relation."id" = incoming."id"
          AND relation."origin" = ${ORIGIN_SIMILAR}
      `);
    }
    const toDelete = existing
      .filter((relation) => !retainedKeys.has(`${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`))
      .map((relation) => relation.id);
    const deletion = toDelete.length
      ? await database.knowledgeRelation.deleteMany({
          where: { id: { in: toDelete }, origin: ORIGIN_SIMILAR },
      })
      : { count: 0 };
    return { created, removed: deletion.count, skipped };
  }

  private async proposeLlmRelations(
    spaceId: string,
    pages: Array<{ id: string; title: string; content: string }>,
    actorUserId?: string,
    lastLlmRunAt?: Date | null,
    principal?: Principal,
  ): Promise<RefreshResult['llm']> {
    if (pages.length < 2) return { changeSetId: null, proposed: 0, reason: 'not_enough_pages' };
    if (!actorUserId) return { changeSetId: null, proposed: 0, reason: 'no_author' };
    const now = new Date();
    const claimReason = await this.prisma.$transaction(async (tx) => {
      await this.lockHumanPrincipal(tx, principal);
      const lockedTx = await this.lockSpace(tx, spaceId);
      await this.assertLiveHumanAccess(lockedTx, principal, spaceId);
      await lockedTx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      const pending = await lockedTx.changeSet.findFirst({
        where: { spaceId, status: 'pending_review', title: { startsWith: 'Auto graph suggestions' } },
        select: { id: true },
      });
      if (pending) return 'proposal_pending' as const;
      const current = await lockedTx.spaceGraphState.findUnique({ where: { spaceId } });
      const lastRun = current?.lastLlmRunAt ?? lastLlmRunAt;
      if (lastRun && Date.now() - lastRun.getTime() < LLM_MIN_INTERVAL_MS) {
        return 'rate_limited' as const;
      }
      const claim = await lockedTx.spaceGraphState.updateMany({
        where: {
          spaceId,
          OR: [
            { lastLlmRunAt: null },
            { lastLlmRunAt: { lte: new Date(now.getTime() - LLM_MIN_INTERVAL_MS) } },
          ],
        },
        data: { lastLlmRunAt: now },
      });
      return claim.count ? null : 'rate_limited' as const;
    });
    if (claimReason) return { changeSetId: null, proposed: 0, reason: claimReason };
    const proposals: Array<Record<string, unknown>> = [];
    try {
      for (let offset = 0; offset < pages.length; offset += LLM_PAGE_BATCH) {
        const batch = pages.slice(offset, offset + LLM_PAGE_BATCH);
        if (batch.length === 1 && offset > 0) batch.unshift(pages[offset - 1]);
        if (batch.length < 2) continue;
        const prompt = this.buildLlmPrompt(batch);
        const response = await this.llm.generateText(prompt);
        let batchProposals = this.parseLlmProposals(response.text, batch.map((page) => page.id));
        if (batchProposals === null) {
          const retry = await this.llm.generateText(
            `${prompt}\nThe previous response was invalid. Return one strict JSON object and no other text.`,
          );
          batchProposals = this.parseLlmProposals(retry.text, batch.map((page) => page.id));
        }
        if (batchProposals) proposals.push(...batchProposals);
      }
    } catch (error) {
      this.logger.warn(`LLM graph proposal failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.prisma.spaceGraphState.updateMany({
        where: { spaceId, lastLlmRunAt: now },
        data: { lastLlmRunAt: null },
      }).catch((releaseError: unknown) => {
        this.logger.warn(`Failed to release LLM graph run claim: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
      });
      return { changeSetId: null, proposed: 0, reason: 'llm_unavailable' };
    }
    const uniqueProposals = [...new Map(proposals.map((proposal) => [
      `${proposal.sourcePageId}|${proposal.targetPageId}|${proposal.relation}`,
      proposal,
    ])).values()];
    if (!uniqueProposals.length) return { changeSetId: null, proposed: 0, reason: 'no_valid_proposals' };
    const changeSet = await this.prisma.$transaction(async (tx) => {
      await this.lockHumanPrincipal(tx, principal);
      const lockedTx = await this.lockSpace(tx, spaceId);
      await this.assertLiveHumanAccess(lockedTx, principal, spaceId);
      await lockedTx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "SpaceGraphState" WHERE "spaceId" = ${spaceId} FOR UPDATE
      `);
      return lockedTx.changeSet.create({
        data: {
          spaceId,
          createdByUserId: actorUserId,
          title: `Auto graph suggestions ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
          status: 'pending_review',
          items: {
            create: uniqueProposals.map((proposal) => ({
              type: 'create_relation',
              status: 'pending',
              payload: proposal as Prisma.InputJsonValue,
            })),
          },
        },
      });
    });
    return { changeSetId: changeSet.id, proposed: uniqueProposals.length };
  }

  private buildLlmPrompt(pages: Array<{ id: string; title: string; content: string }>): string {
    const documents = pages.map((page) =>
      `<page id="${page.id}"><title>${page.title}</title><content>${(page.content ?? '').slice(0, 1500)}</content></page>`).join('\n');
    return [
      'You propose knowledge-graph relations between the pages below.',
      'Allowed relation values: supports, contradicts, extends, related_to.',
      'Reply with strict JSON only: {"relations":[{"sourcePageId":"...","targetPageId":"...","relation":"...","confidence":0-1,"evidenceQuote":"short quote"}]}',
      'Only use the given page ids. At most 8 relations. No prose outside JSON.',
      documents,
    ].join('\n');
  }

  private parseLlmProposals(text: string, validPageIds: string[]): Array<Record<string, unknown>> | null {
    const jsonSlice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      return null;
    }
    const value = parsed as { relations?: unknown };
    if (!Array.isArray(value.relations)) return null;
    const validIds = new Set(validPageIds);
    const proposals: Array<Record<string, unknown>> = [];
    for (const raw of value.relations.slice(0, 8)) {
      const item = raw as Record<string, unknown>;
      if (typeof item.sourcePageId !== 'string' || !validIds.has(item.sourcePageId)) continue;
      if (typeof item.targetPageId !== 'string' || !validIds.has(item.targetPageId)) continue;
      if (item.sourcePageId === item.targetPageId) continue;
      if (typeof item.relation !== 'string' || !LLM_RELATION_TYPES.has(item.relation)) continue;
      const confidence = typeof item.confidence === 'number' && item.confidence > 0 && item.confidence <= 1
        ? item.confidence : 0.6;
      proposals.push({
        sourcePageId: item.sourcePageId,
        targetPageId: item.targetPageId,
        relation: item.relation,
        origin: 'auto_llm',
        confidence,
        ...(typeof item.evidenceQuote === 'string' && item.evidenceQuote ? { evidenceQuote: item.evidenceQuote.slice(0, 300) } : {}),
      });
    }
    return proposals;
  }

  private async lockSpace(tx: Prisma.TransactionClient, spaceId: string): Promise<Prisma.TransactionClient> {
    return this.revisionWriter ? this.revisionWriter.lockSpace(tx, spaceId) : tx;
  }

  private async lockHumanPrincipal(
    tx: Prisma.TransactionClient,
    principal: Principal | undefined,
  ): Promise<void> {
    if (!principal) return;
    if (!this.authorization) throw new ForbiddenException('Live human authorization is unavailable');
    await this.authorization.lockLiveHumanPrincipal(tx, principal);
  }

  private async assertLiveHumanAccess(
    tx: Prisma.TransactionClient,
    principal: Principal | undefined,
    spaceId: string,
  ): Promise<void> {
    if (!principal) return;
    if (!this.authorization) throw new ForbiddenException('Live human authorization is unavailable');
    await this.authorization.assertLiveHumanSpaceAccess(
      tx, principal, spaceId, ['owner', 'admin'],
    );
  }

}
