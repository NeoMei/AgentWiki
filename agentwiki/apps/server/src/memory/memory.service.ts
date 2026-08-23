import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessException } from '../core/filters/business-error';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ConsolidateMemoryDto, CreateMemoryDto } from '../core/dto/memory.dto';
import { createHash } from 'crypto';
import { LlmService } from '../integrations/llm/llm.service';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';

const ASCII_WHITESPACE_PATTERN = String.raw`[ \x09-\x0D]+`;

export function canonicalizeMemoryContent(content: string) {
  return content
    .replace(new RegExp(ASCII_WHITESPACE_PATTERN, 'g'), ' ')
    .replace(/^ +| +$/g, '')
    .replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32));
}

export function canonicalMemoryHash(content: string) {
  return createHash('md5').update(canonicalizeMemoryContent(content)).digest('hex');
}

@Injectable()
export class MemoryService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private llm: LlmService,
    private authorization: AuthorizationService,
  ) {}

  async create(agentId: string, dto: CreateMemoryDto, principal: Principal) {
    if (dto.sourceEvidenceId) {
      const evidence = await this.prisma.evidence.findUnique({
        where: { id: dto.sourceEvidenceId },
        select: { run: { select: { spaceId: true } } },
      });
      if (!evidence || evidence.run.spaceId !== dto.spaceId) {
        throw new BadRequestException('Source evidence must belong to the memory space');
      }
    }
    const contentHash = this.hash(dto.content);
    const duplicate = await this.prisma.agentMemory.findFirst({
      where: { agentId, spaceId: dto.spaceId, type: dto.type, contentHash, deletedAt: null },
    });
    if (duplicate) return { ...duplicate, deduplicated: true };
    const quota = Number(this.config.get('AGENT_MEMORY_QUOTA') || 10_000);
    const count = await this.prisma.agentMemory.count({
      where: { agentId, status: 'active', deletedAt: null },
    });
    if (count >= quota) throw new BusinessException('MEMORY_QUOTA_EXCEEDED', 'Memory quota exceeded');
    const embedded = await this.embedding(dto.content);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.authorization.assertLiveAgentWriteAccess(
          tx, principal, dto.spaceId, ['memory:write'],
        );
        return tx.agentMemory.create({
          data: {
            agentId, spaceId: dto.spaceId, type: dto.type, content: dto.content,
            importance: dto.importance ?? 0.5, tags: dto.tags || [],
            entities: dto.entities as any, sourceEvidenceId: dto.sourceEvidenceId,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
            visibility: dto.visibility || 'private', contentHash,
            embedding: embedded.embedding, embeddingModel: embedded.model,
          },
        });
      });
    } catch (error) {
      if ((error instanceof Prisma.PrismaClientKnownRequestError || (error as any)?.code === 'P2002') && (error as any).code === 'P2002') {
        const concurrentDuplicate = await this.prisma.agentMemory.findFirst({
          where: { agentId, spaceId: dto.spaceId, type: dto.type, contentHash, deletedAt: null },
        });
        if (concurrentDuplicate) return { ...concurrentDuplicate, deduplicated: true };
      }
      throw error;
    }
  }

  list(agentId: string, spaceId: string) {
    return this.prisma.agentMemory.findMany({
      where: {
        spaceId, status: 'active', deletedAt: null,
        OR: [{ agentId }, { visibility: 'space' }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      orderBy: [{ importance: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async recall(agentId: string, spaceId: string, query: string, limit: number | undefined, principal: Principal) {
    const memories = await this.list(agentId, spaceId);
    const queryTokens = this.tokens(query);
    const queryEmbedding = await this.embedding(query);
    const graphTerms = await this.graphTerms(spaceId, queryTokens);
    const ranked = memories
      .map((memory) => {
        const memoryTokens = this.tokens(memory.content + ' ' + memory.tags.join(' '));
        const overlap = [...queryTokens].filter((token) => memoryTokens.has(token)).length;
        const lexical = queryTokens.size ? overlap / queryTokens.size : 0;
        const vector = memory.embedding?.length && queryEmbedding.embedding.length
          ? this.numericCosine(queryEmbedding.embedding, memory.embedding)
          : this.cosine(this.trigrams(query), this.trigrams(memory.content));
        const entityTokens = this.tokens(JSON.stringify(memory.entities || {}));
        const entityOverlap = [...graphTerms].filter((token) => entityTokens.has(token)).length;
        const graph = graphTerms.size ? entityOverlap / graphTerms.size : 0;
        return {
          memory,
          score: lexical * 0.45 + vector * 0.25 + graph * 0.15 + memory.importance * 0.15,
          reasons: { lexical, vector, graph, importance: memory.importance },
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit ?? 10);
    await this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveAgentWriteAccess(
        tx, principal, spaceId, ['memory:read'],
      );
      await tx.agentMemory.updateMany({
        where: { id: { in: ranked.map((entry) => entry.memory.id) } },
        data: { lastAccessedAt: new Date() },
      });
    });
    return ranked;
  }

  async consolidate(agentId: string, dto: ConsolidateMemoryDto, principal: Principal) {
    const memories = await this.prisma.agentMemory.findMany({
      where: { id: { in: dto.memoryIds }, agentId, spaceId: dto.spaceId, status: 'active', deletedAt: null },
    });
    if (memories.length !== new Set(dto.memoryIds).size) throw new BadRequestException('One or more memories are unavailable');
    const content = dto.summary || memories.map((memory) => memory.content).join('\n\n');
    const contentHash = this.hash(content);
    const existing = await this.prisma.agentMemory.findFirst({
      where: { agentId, spaceId: dto.spaceId, type: 'semantic', contentHash, deletedAt: null },
    });
    if (existing) {
      if (dto.memoryIds.includes(existing.id)) return { ...existing, deduplicated: true };
      await this.prisma.$transaction(async (tx) => {
        await this.authorization.assertLiveAgentWriteAccess(
          tx, principal, dto.spaceId, ['memory:write'],
        );
        await tx.agentMemory.updateMany({
          where: { id: { in: memories.map((memory) => memory.id) } },
          data: { status: 'archived', archivedAt: new Date() },
        });
      });
      return { ...existing, deduplicated: true };
    }
    const embedded = await this.embedding(content);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.authorization.assertLiveAgentWriteAccess(
          tx, principal, dto.spaceId, ['memory:write'],
        );
        const consolidated = await tx.agentMemory.create({
          data: {
            agentId, spaceId: dto.spaceId, type: 'semantic', content,
            importance: Math.max(...memories.map((memory) => memory.importance)),
            tags: Array.from(new Set(memories.flatMap((memory) => memory.tags))),
            sourceMemoryIds: memories.map((memory) => memory.id),
            sourceEvidenceId: memories.find((memory) => memory.sourceEvidenceId)?.sourceEvidenceId,
            contentHash,
            visibility: memories.every((memory) => memory.visibility === 'space') ? 'space' : 'private',
            embedding: embedded.embedding, embeddingModel: embedded.model,
          },
        });
        await tx.agentMemory.updateMany({
          where: { id: { in: memories.map((memory) => memory.id) } },
          data: { status: 'archived', archivedAt: new Date() },
        });
        return consolidated;
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const winner = await this.prisma.agentMemory.findFirst({
          where: { agentId, spaceId: dto.spaceId, type: 'semantic', contentHash, deletedAt: null },
        });
        if (winner) {
          await this.prisma.$transaction(async (tx) => {
            await this.authorization.assertLiveAgentWriteAccess(
              tx, principal, dto.spaceId, ['memory:write'],
            );
            await tx.agentMemory.updateMany({
              where: { id: { in: memories.map((memory) => memory.id) } },
              data: { status: 'archived', archivedAt: new Date() },
            });
          });
          return { ...winner, deduplicated: true };
        }
      }
      throw error;
    }
  }

  async archive(agentId: string, spaceId: string, id: string, principal: Principal) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveAgentWriteAccess(
        tx, principal, spaceId, ['memory:write'],
      );
      return tx.agentMemory.updateMany({
        where: { id, agentId, spaceId, deletedAt: null },
        data: { status: 'archived', archivedAt: new Date() },
      });
    });
    if (!result.count) throw new NotFoundException('Memory not found');
    return { success: true };
  }

  async remove(agentId: string, spaceId: string, id: string, principal: Principal) {
    const result = await this.prisma.$transaction(async (tx) => {
      await this.authorization.assertLiveAgentWriteAccess(
        tx, principal, spaceId, ['memory:write'],
      );
      return tx.agentMemory.updateMany({
        where: { id, agentId, spaceId, deletedAt: null },
        data: {
          status: 'deleted', deletedAt: new Date(), content: '[deleted]', tags: [], entities: {},
          sourceEvidenceId: null, sourceMemoryIds: [], embedding: [], embeddingModel: null,
          contentHash: `deleted:${id}`,
        },
      });
    });
    if (!result.count) throw new NotFoundException('Memory not found');
    return { success: true };
  }

  async archiveExpired() {
    return this.prisma.agentMemory.updateMany({
      where: { status: 'active', deletedAt: null, expiresAt: { lte: new Date() } },
      data: { status: 'archived', archivedAt: new Date() },
    });
  }

  private tokens(value: string) {
    return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((token) => token.length > 1));
  }

  private trigrams(value: string) {
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    const vector = new Map<string, number>();
    for (let index = 0; index < normalized.length - 2; index += 1) {
      const gram = normalized.slice(index, index + 3);
      vector.set(gram, (vector.get(gram) || 0) + 1);
    }
    return vector;
  }

  private cosine(left: Map<string, number>, right: Map<string, number>) {
    if (!left.size || !right.size) return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const value of left.values()) leftNorm += value * value;
    for (const value of right.values()) rightNorm += value * value;
    for (const [key, value] of left) dot += value * (right.get(key) || 0);
    return dot / Math.sqrt(leftNorm * rightNorm);
  }

  private numericCosine(left: number[], right: number[]) {
    const length = Math.min(left.length, right.length);
    if (!length) return 0;
    let dot = 0; let leftNorm = 0; let rightNorm = 0;
    for (let index = 0; index < length; index += 1) {
      dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
    }
    return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
  }

  private async embedding(content: string): Promise<{ embedding: number[]; model?: string }> {
    try {
      const result = await this.llm.generateEmbedding(content);
      return { embedding: result.embedding, model: result.modelId };
    } catch {
      return { embedding: [] };
    }
  }

  private async graphTerms(spaceId: string, queryTokens: Set<string>) {
    const tokens = [...queryTokens].slice(0, 8);
    if (!tokens.length) return queryTokens;
    const seeds = await this.prisma.page.findMany({
      where: { spaceId, deletedAt: null, OR: tokens.flatMap((token) => [
        { title: { contains: token, mode: 'insensitive' as const } },
        { content: { contains: token, mode: 'insensitive' as const } },
      ]) },
      select: { id: true, title: true }, take: 20,
    });
    const seedIds = seeds.map((page) => page.id);
    if (!seedIds.length) return queryTokens;
    const relations = await this.prisma.knowledgeRelation.findMany({
      where: { OR: [{ sourcePageId: { in: seedIds } }, { targetPageId: { in: seedIds } }] },
      select: { sourcePageId: true, targetPageId: true }, take: 100,
    });
    const relatedIds = relations.flatMap((relation) => [relation.sourcePageId, relation.targetPageId]);
    const related = await this.prisma.page.findMany({ where: { id: { in: relatedIds }, deletedAt: null }, select: { title: true } });
    return this.tokens([...tokens, ...seeds.map((page) => page.title), ...related.map((page) => page.title)].join(' '));
  }

  private hash(content: string) {
    return canonicalMemoryHash(content);
  }
}
