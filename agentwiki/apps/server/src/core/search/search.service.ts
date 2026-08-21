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

function vectorLiteral(embedding: number[]): string {
  return '[' + embedding.join(',') + ']';
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

    // If we have an embedding, try pgvector semantic search (HNSW cosine)
    if (queryEmbedding && queryEmbedding.length > 0) {
      const queryVector = vectorLiteral(queryEmbedding);
      const rows = await this.prisma.$queryRaw<Array<{ id: string; similarity: number }>>(Prisma.sql`
        SELECT "id", 1 - ("embeddingVector" <=> ${queryVector}::halfvec) AS "similarity"
        FROM "Page"
        WHERE "deletedAt" IS NULL
          AND "embeddingVector" IS NOT NULL
          AND 1 - ("embeddingVector" <=> ${queryVector}::halfvec) > 0.5
          ${spaceId ? Prisma.sql`AND "spaceId" = ${spaceId}` : Prisma.sql`AND "spaceId" IN (${Prisma.join(accessibleSpaceIds)})`}
        ORDER BY "embeddingVector" <=> ${queryVector}::halfvec
        LIMIT ${limit}
      `);

      if (rows.length > 0) {
        const pages = await this.prisma.page.findMany({
          where: { id: { in: rows.map((row) => row.id) } },
          include: {
            author: { select: SEARCH_AUTHOR_SELECT },
            space: { select: SEARCH_SPACE_SELECT },
          },
        });
        const byId = new Map(pages.map((page) => [page.id, page]));
        const semanticResults = rows
          .map((row) => ({ page: byId.get(row.id), similarity: row.similarity }))
          .filter((row) => row.page);
        if (semanticResults.length > 0) return semanticResults as SearchResult[];
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

  async indexPage(pageId: string): Promise<{ lexicalIndexed: boolean; semanticIndexed: boolean; skipped?: boolean }> {
    this.logger.log('Indexing page: ' + pageId);

    const page = await this.prisma.page.findUnique({
      where: { id: pageId, deletedAt: null },
    });

    if (!page) {
      await this.prisma.pageSearchDocument.deleteMany({ where: { pageId } });
      return { lexicalIndexed: false, semanticIndexed: false };
    }

    const text = `${page.title}\n${page.content ?? ''}`;
    const contentHash = createHash('sha256').update(text).digest('hex');

    // Hash short-circuit: when the lexical document already matches the page
    // text and a vector exists, skip both the lexical rewrite and the
    // embedding API call.
    const [existingDoc] = await this.prisma.pageSearchDocument.findMany({
      where: { pageId },
      select: { contentHash: true },
      take: 1,
    });
    if (existingDoc?.contentHash === contentHash) {
      const [vectorExists] = await this.prisma.$queryRaw<Array<{ exists: boolean }>>(
        Prisma.sql`SELECT EXISTS (SELECT 1 FROM "Page" WHERE "id" = ${pageId} AND "embeddingVector" IS NOT NULL) AS "exists"`,
      );
      if (vectorExists?.exists) {
        return { lexicalIndexed: true, semanticIndexed: true, skipped: true };
      }
    }

    await this.prisma.pageSearchDocument.upsert({
      where: { pageId },
      create: {
        pageId,
        text,
        contentHash,
      },
      update: {
        text,
        contentHash,
        indexedAt: new Date(),
      },
    });

    try {
      const embeddingResult = await this.llmService.generateEmbedding(
        page.title + ' ' + (page.content ?? '').substring(0, 2000),
      );

      const embeddingVector = vectorLiteral(embeddingResult.embedding);
      await this.prisma.$executeRaw(
        Prisma.sql`UPDATE "Page" SET "embeddingVector" = ${embeddingVector}::halfvec WHERE "id" = ${pageId}`,
      );
      this.logger.log('Page ' + pageId + ' indexed successfully');
      return { lexicalIndexed: true, semanticIndexed: true };
    } catch (err: any) {
      this.logger.warn('Failed to generate embedding for page ' + pageId + ': ' + err.message);
      return { lexicalIndexed: true, semanticIndexed: false };
    }
  }

  async deletePageIndex(pageId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = NULL WHERE "id" = ${pageId}`),
      this.prisma.pageSearchDocument.deleteMany({ where: { pageId } }),
    ]);
    this.logger.log('Page ' + pageId + ' index removed');
  }
}
