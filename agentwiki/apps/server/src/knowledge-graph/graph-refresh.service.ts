import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../integrations/llm/llm.service';
import { GraphExtractionService, type WikiLinkTarget } from './graph-extraction.service';

export type GraphLayer = 'wikilink' | 'similar' | 'llm';

export interface RefreshResult {
  wikilink: { created: number; removed: number; dangling: number };
  similar: { created: number; removed: number; skipped: number };
  llm: { changeSetId: string | null; proposed: number; reason?: string };
}

const ORIGIN_WIKILINK = 'auto_wikilink';
const ORIGIN_SIMILAR = 'auto_similar';
const LLM_PAGE_BATCH = 6;
const LLM_RELATION_TYPES = new Set(['supports', 'contradicts', 'extends', 'related_to']);

@Injectable()
export class GraphRefreshService {
  private readonly logger = new Logger(GraphRefreshService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: GraphExtractionService,
    private readonly llm: LlmService,
  ) {}

  async refresh(spaceId: string, layers?: GraphLayer[]): Promise<RefreshResult> {
    const space = await this.prisma.space.findUnique({ where: { id: spaceId } });
    if (!space) throw new ForbiddenException('Space not found');
    const state = await this.getOrCreateState(spaceId);
    const pages = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null },
      select: { id: true, title: true, slug: true, content: true, embedding: true },
    });
    const selected = layers ?? (['wikilink', 'similar', 'llm'] as GraphLayer[]);
    const result: RefreshResult = {
      wikilink: { created: 0, removed: 0, dangling: 0 },
      similar: { created: 0, removed: 0, skipped: 0 },
      llm: { changeSetId: null, proposed: 0 },
    };

    if (selected.includes('wikilink') && state.wikilinkEnabled) {
      const stats = await this.refreshWikilinks(spaceId, pages);
      result.wikilink = stats;
    }
    if (selected.includes('similar')) {
      if (!state.similarEnabled) {
        result.similar.skipped = pages.length;
      } else {
        result.similar = await this.refreshSimilar(
          spaceId,
          pages.map((page) => ({
            id: page.id,
            embedding: Array.isArray(page.embedding) ? (page.embedding as number[]) : null,
          })),
          state.similarThreshold,
        );
      }
    }
    if (selected.includes('llm') && state.llmEnabled) {
      result.llm = await this.proposeLlmRelations(spaceId, pages);
    }

    const contentHash = this.contentHash(pages);
    await this.prisma.spaceGraphState.upsert({
      where: { spaceId },
      create: { spaceId, lastContentHash: contentHash, lastRunAt: new Date() },
      update: { lastContentHash: contentHash, lastRunAt: new Date(),
        ...(result.llm.changeSetId ? { lastLlmChangeSetId: result.llm.changeSetId } : {}) },
    });
    return result;
  }

  async getOrCreateState(spaceId: string) {
    const existing = await this.prisma.spaceGraphState.findUnique({ where: { spaceId } });
    if (existing) return existing;
    return this.prisma.spaceGraphState.upsert({
      where: { spaceId },
      create: { spaceId },
      update: {},
    });
  }

  private async refreshWikilinks(
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
    const pageIds = pages.map((page) => page.id);
    const existing = await this.prisma.knowledgeRelation.findMany({
      where: { sourcePageId: { in: pageIds }, targetPageId: { in: pageIds }, origin: ORIGIN_WIKILINK },
      select: { id: true, sourcePageId: true, targetPageId: true, relation: true },
    });
    const wantedKeys = new Set(resolved.map((pair) => `${pair.sourcePageId}|${pair.targetPageId}|references`));
    const toDelete = existing
      .filter((relation) => !wantedKeys.has(`${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`))
      .map((relation) => relation.id);
    const existingKeys = new Set(existing.map((relation) => `${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`));
    const toCreate = resolved.filter((pair) => !existingKeys.has(`${pair.sourcePageId}|${pair.targetPageId}|references`));
    if (toCreate.length) {
      await this.prisma.knowledgeRelation.createMany({
        data: toCreate.map((pair) => ({
          sourcePageId: pair.sourcePageId,
          targetPageId: pair.targetPageId,
          relation: 'references',
          origin: ORIGIN_WIKILINK,
          confidence: 1.0,
          strength: 1.0,
        })),
        skipDuplicates: true,
      }).catch((error: unknown) => {
        this.logger.warn(`wikilink createMany failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    let removed = 0;
    if (toDelete.length) {
      const deletion = await this.prisma.knowledgeRelation.deleteMany({
        where: { id: { in: toDelete }, origin: ORIGIN_WIKILINK },
      });
      removed = deletion.count;
    }
    return { created: toCreate.length, removed, dangling };
  }

  private async refreshSimilar(
    spaceId: string,
    pages: Array<{ id: string; embedding: number[] | null }>,
    threshold: number,
  ) {
    const pairs = this.extraction.computeSimilarPairs(pages, threshold);
    const skipped = pages.filter((page) => !Array.isArray(page.embedding) || page.embedding.length === 0).length;
    const pageIds = pages.map((page) => page.id);
    const existing = await this.prisma.knowledgeRelation.findMany({
      where: { sourcePageId: { in: pageIds }, targetPageId: { in: pageIds }, origin: ORIGIN_SIMILAR },
      select: { id: true, sourcePageId: true, targetPageId: true, relation: true },
    });
    const wantedKeys = new Set(pairs.map((pair) => `${pair.sourcePageId}|${pair.targetPageId}|similar_to`));
    const toDelete = existing
      .filter((relation) => !wantedKeys.has(`${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`))
      .map((relation) => relation.id);
    const existingKeys = new Set(existing.map((relation) => `${relation.sourcePageId}|${relation.targetPageId}|${relation.relation}`));
    const toCreate = pairs.filter((pair) => !existingKeys.has(`${pair.sourcePageId}|${pair.targetPageId}|similar_to`));
    if (toCreate.length) {
      await this.prisma.knowledgeRelation.createMany({
        data: toCreate.map((pair) => ({
          sourcePageId: pair.sourcePageId,
          targetPageId: pair.targetPageId,
          relation: 'similar_to',
          origin: ORIGIN_SIMILAR,
          confidence: pair.score,
          strength: pair.score,
        })),
        skipDuplicates: true,
      }).catch((error: unknown) => {
        this.logger.warn(`similar createMany failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    let removed = 0;
    if (toDelete.length) {
      const deletion = await this.prisma.knowledgeRelation.deleteMany({
        where: { id: { in: toDelete }, origin: ORIGIN_SIMILAR },
      });
      removed = deletion.count;
    }
    return { created: toCreate.length, removed, skipped };
  }

  private async proposeLlmRelations(
    spaceId: string,
    pages: Array<{ id: string; title: string; content: string }>,
  ): Promise<RefreshResult['llm']> {
    if (pages.length < 2) return { changeSetId: null, proposed: 0, reason: 'not_enough_pages' };
    const pending = await this.prisma.changeSet.findFirst({
      where: { spaceId, status: 'pending_review', title: { startsWith: 'Auto graph suggestions' } },
      select: { id: true },
    });
    if (pending) return { changeSetId: null, proposed: 0, reason: 'proposal_pending' };
    const batch = pages.slice(0, LLM_PAGE_BATCH);
    const prompt = this.buildLlmPrompt(batch);
    let text: string;
    try {
      const response = await this.llm.generateText(prompt);
      text = response.text;
    } catch (error) {
      this.logger.warn(`LLM graph proposal failed: ${error instanceof Error ? error.message : String(error)}`);
      return { changeSetId: null, proposed: 0, reason: 'llm_unavailable' };
    }
    const proposals = this.parseLlmProposals(text, batch.map((page) => page.id));
    if (!proposals.length) return { changeSetId: null, proposed: 0, reason: 'no_valid_proposals' };
    const changeSet = await this.prisma.changeSet.create({
      data: {
        spaceId,
        title: `Auto graph suggestions ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        status: 'pending_review',
        items: {
          create: proposals.map((proposal) => ({
            type: 'create_relation',
            status: 'pending',
            payload: proposal as Prisma.InputJsonValue,
          })),
        },
      },
    });
    return { changeSetId: changeSet.id, proposed: proposals.length };
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

  private parseLlmProposals(text: string, validPageIds: string[]) {
    const jsonSlice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonSlice);
    } catch {
      return [];
    }
    const value = parsed as { relations?: unknown };
    if (!Array.isArray(value.relations)) return [];
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

  private contentHash(pages: Array<{ id: string; content: string }>): string {
    return createHash('sha256').update(pages.map((page) => `${page.id}:${page.content ?? ''}`).join('\n')).digest('hex');
  }
}
