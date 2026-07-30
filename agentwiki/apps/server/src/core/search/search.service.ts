import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../../integrations/llm/llm.service';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export interface SearchResult {
  page: any;
  similarity: number;
}

const SEARCH_AUTHOR_SELECT = {
  id: true,
  email: true,
  name: true,
  type: true,
} as const;

const SEARCH_SPACE_SELECT = {
  id: true,
  name: true,
  slug: true,
} as const;

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  async searchPages(
    query: string,
    spaceId?: string,
    limit = 10,
    accessibleSpaceIds: string[] = [],
  ): Promise<SearchResult[]> {
    this.logger.log('Searching authorized page index');

    // Try semantic search first (if LLM is available)
    let queryEmbedding: number[] | null = null;
    try {
      const embeddingResult = await this.llmService.generateEmbedding(query);
      queryEmbedding = embeddingResult?.embedding || null;
    } catch {
      this.logger.warn('Embedding generation failed, falling back to text search');
    }

    // If we have an embedding, try semantic search
    if (queryEmbedding && queryEmbedding.length > 0) {
      const pages = await this.prisma.page.findMany({
        where: {
          deletedAt: null,
          embedding: { not: Prisma.DbNull },
          spaceId: spaceId ?? { in: accessibleSpaceIds },
        },
        include: {
          author: { select: SEARCH_AUTHOR_SELECT },
          space: { select: SEARCH_SPACE_SELECT },
        },
      });

      if (pages.length > 0) {
        const semanticResults = pages
          .map((page) => ({
            page,
            similarity: cosineSimilarity(
              queryEmbedding!,
              (page.embedding as number[]) || [],
            ),
          }))
          .filter((r) => r.similarity > 0.5)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);
        if (semanticResults.length > 0) return semanticResults;
      }
    }

    // Fallback: text search using PostgreSQL ILIKE
    this.logger.log('Using text search fallback');
    const documents = await this.prisma.pageSearchDocument.findMany({
      where: {
        text: { contains: query, mode: 'insensitive' },
        page: {
          deletedAt: null,
          spaceId: spaceId ?? { in: accessibleSpaceIds },
        },
      },
      include: {
        page: {
          include: {
            author: { select: SEARCH_AUTHOR_SELECT },
            space: { select: SEARCH_SPACE_SELECT },
          },
        },
      },
      take: limit,
      orderBy: { indexedAt: 'desc' },
    });

    return documents.map((document) => ({ page: document.page, similarity: 1.0 }));
  }

  async indexPage(pageId: string): Promise<{ lexicalIndexed: boolean; semanticIndexed: boolean }> {
    this.logger.log('Indexing page: ' + pageId);

    const page = await this.prisma.page.findUnique({
      where: { id: pageId, deletedAt: null },
    });

    if (!page) {
      await this.prisma.pageSearchDocument.deleteMany({ where: { pageId } });
      return { lexicalIndexed: false, semanticIndexed: false };
    }

    const text = `${page.title}\n${page.content ?? ''}`;
    await this.prisma.pageSearchDocument.upsert({
      where: { pageId },
      create: {
        pageId,
        text,
        contentHash: createHash('sha256').update(text).digest('hex'),
      },
      update: {
        text,
        contentHash: createHash('sha256').update(text).digest('hex'),
        indexedAt: new Date(),
      },
    });

    try {
      const embeddingResult = await this.llmService.generateEmbedding(
        page.title + ' ' + (page.content ?? '').substring(0, 2000),
      );

      await this.prisma.page.update({
        where: { id: pageId },
        data: { embedding: embeddingResult.embedding },
      });
      this.logger.log('Page ' + pageId + ' indexed successfully');
      return { lexicalIndexed: true, semanticIndexed: true };
    } catch (err: any) {
      this.logger.warn('Failed to generate embedding for page ' + pageId + ': ' + err.message);
      return { lexicalIndexed: true, semanticIndexed: false };
    }
  }

  async deletePageIndex(pageId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.page.updateMany({ where: { id: pageId }, data: { embedding: Prisma.DbNull } }),
      this.prisma.pageSearchDocument.deleteMany({ where: { pageId } }),
    ]);
    this.logger.log('Page ' + pageId + ' index removed');
  }
}
