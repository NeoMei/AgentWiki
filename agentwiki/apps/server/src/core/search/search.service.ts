import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { LlmService } from '../../integrations/llm/llm.service';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

export interface SearchResult {
  page: any;
  similarity: number;
  matchType?: 'text' | 'semantic';
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

function withCanonicalPath<T extends { syncPath?: string | null }>(page: T): T & { path: string | null } {
  return { ...page, path: page.syncPath ?? null };
}

@Injectable()
export class SearchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchService.name);
  private indexRepairTimer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  onModuleInit() {
    // Index writes happen after the page transaction commits, so a transient
    // failure there would leave an active page invisible to search until its
    // next edit. This periodic pass heals those gaps without waiting for one.
    this.indexRepairTimer = setInterval(() => {
      void this.repairMissingIndexes().catch((error: unknown) => {
        this.logger.warn(`search index repair pass failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 10 * 60_000);
    this.indexRepairTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.indexRepairTimer) clearInterval(this.indexRepairTimer);
    this.indexRepairTimer = undefined;
  }

  async repairMissingIndexes(limit = 50): Promise<number> {
    const missing = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT page."id"
      FROM "Page" AS page
      LEFT JOIN "PageSearchDocument" AS document ON document."pageId" = page."id"
      WHERE page."deletedAt" IS NULL AND document."pageId" IS NULL
      ORDER BY page."updatedAt" ASC
      LIMIT ${limit}
    `);
    let repaired = 0;
    for (const row of missing) {
      try {
        const result = await this.indexPage(row.id);
        if (result.lexicalIndexed) repaired += 1;
      } catch (error) {
        this.logger.warn(`index repair failed for ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (repaired > 0) this.logger.log(`Repaired search index for ${repaired} page(s)`);
    return repaired;
  }

  async searchPages(
    query: string,
    spaceId?: string,
    limit = 10,
    accessibleSpaceIds: string[] = [],
  ): Promise<SearchResult[]> {
    this.logger.log('Searching authorized page index');

    // An explicit space is authorized by the caller; global search uses its allowlist.
    if ((!spaceId && accessibleSpaceIds.length === 0) || limit <= 0) return [];
    const pageScope = { deletedAt: null, spaceId: spaceId ?? { in: accessibleSpaceIds } };
    const pageInclude = {
      author: { select: SEARCH_AUTHOR_SELECT },
      space: { select: SEARCH_SPACE_SELECT },
    };
    type Candidate = { id: string; titleRank: number; similarity: number; textMatch: boolean };
    const scope = spaceId ? Prisma.sql`page."spaceId" = ${spaceId}`
      : Prisma.sql`page."spaceId" IN (${Prisma.join(accessibleSpaceIds)})`;
    const titleRank = Prisma.sql`CASE
      WHEN LOWER(page."title") = LOWER(${query}) THEN 2
      WHEN POSITION(LOWER(${query}) IN LOWER(page."title")) > 0 THEN 1
      ELSE 0 END`;
    const textMatch = Prisma.sql`POSITION(LOWER(${query}) IN LOWER(document."text")) > 0`;
    // SQL ranks the entire authorized match set before selecting its prefix.
    // Only IDs/scores cross this boundary, never document text or Page bodies.
    const lexicalPromise = this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      SELECT page."id", ${titleRank} AS "titleRank", 0::float8 AS "similarity", TRUE AS "textMatch"
      FROM "PageSearchDocument" AS document
      JOIN "Page" AS page ON page."id" = document."pageId"
      WHERE page."deletedAt" IS NULL AND ${scope} AND ${textMatch}
      ORDER BY "titleRank" DESC, document."indexedAt" DESC, page."id" ASC
      LIMIT ${limit}
    `);
    const semanticPromise = (async (): Promise<Candidate[]> => {
      let embedding: number[] | undefined;
      try {
        embedding = (await this.llmService.generateEmbedding(query))?.embedding;
      } catch {
        this.logger.warn('Embedding generation failed; returning text matches');
      }
      if (!embedding?.length) return [];
      const queryVector = vectorLiteral(embedding);
      return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
        SELECT page."id", ${titleRank} AS "titleRank",
          1 - (page."embeddingVector" OPERATOR(public.<=>) ${queryVector}::public.halfvec) AS "similarity",
          COALESCE(${textMatch}, FALSE) AS "textMatch"
        FROM "Page" AS page
        LEFT JOIN "PageSearchDocument" AS document ON document."pageId" = page."id"
        WHERE page."deletedAt" IS NULL AND ${scope}
          AND page."embeddingVector" IS NOT NULL
          AND 1 - (page."embeddingVector" OPERATOR(public.<=>) ${queryVector}::public.halfvec) > 0.5
        ORDER BY page."embeddingVector" OPERATOR(public.<=>) ${queryVector}::public.halfvec
        LIMIT ${limit}
      `);
    })();
    const [lexical, semantic] = await Promise.all([lexicalPromise, semanticPromise]);
    const combined = new Map(lexical.map(candidate => [candidate.id, candidate]));
    for (const candidate of semantic) {
      combined.set(candidate.id, {
        ...candidate,
        textMatch: candidate.textMatch || combined.get(candidate.id)?.textMatch || false,
      });
    }
    // Each route's ranked prefix is bounded by limit; semantic overlaps carry
    // their measured score even if outside the lexical prefix. Text-only rows
    // have zero (unmeasured) similarity and retain SQL order for ties.
    const winners = [...combined.values()].sort((a, b) => b.titleRank - a.titleRank
      || b.similarity - a.similarity).slice(0, limit);
    if (!winners.length) return [];
    const pages = await this.prisma.page.findMany({
      where: { id: { in: winners.map(candidate => candidate.id) }, ...pageScope },
      include: pageInclude,
      take: limit,
    });
    const byId = new Map(pages.map(page => [page.id, page]));
    return winners.flatMap(candidate => {
      const page = byId.get(candidate.id);
      return page ? [{
        page: withCanonicalPath(page), similarity: candidate.similarity,
        matchType: candidate.textMatch ? 'text' as const : 'semantic' as const,
      }] : [];
    });
  }

  async indexPage(
    pageId: string,
    options: { requireSemanticWrite?: boolean } = {},
  ): Promise<{
    lexicalIndexed: boolean;
    semanticIndexed: boolean;
    skipped?: boolean;
    superseded?: boolean;
  }> {
    this.logger.log('Indexing page: ' + pageId);

    const snapshot = await this.prisma.$transaction(async (tx) => {
      // Serialize lexical publication with Page edits/deletes and other indexers.
      // Read the text only after acquiring the lock; a pre-lock snapshot could
      // otherwise overwrite a newer document after waiting for another writer.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Page" WHERE "id" = ${pageId} FOR UPDATE`);
      const page = await tx.page.findUnique({
        where: { id: pageId, deletedAt: null },
      });
      if (!page) {
        await tx.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = NULL WHERE "id" = ${pageId}`);
        await tx.pageSearchDocument.deleteMany({ where: { pageId } });
        return null;
      }

      const text = `${page.title}\n${page.content ?? ''}`;
      const contentHash = createHash('sha256').update(text).digest('hex');
      const existingDoc = await tx.pageSearchDocument.findUnique({
        where: { pageId }, select: { contentHash: true },
      });
      if (existingDoc?.contentHash !== contentHash) {
        // The lexical hash also identifies the vector's source. Invalidate the
        // old vector atomically with changing it so failures remain retryable.
        await tx.$executeRaw(Prisma.sql`UPDATE "Page" SET "embeddingVector" = NULL WHERE "id" = ${pageId}`);
      } else if (!options.requireSemanticWrite) {
        const [vectorExists] = await tx.$queryRaw<Array<{ exists: boolean }>>(
          Prisma.sql`SELECT "embeddingVector" IS NOT NULL AS "exists" FROM "Page" WHERE "id" = ${pageId}`,
        );
        if (vectorExists?.exists) return { page, contentHash, skipped: true };
      }
      await tx.pageSearchDocument.upsert({
        where: { pageId },
        create: { pageId, text, contentHash },
        update: { text, contentHash, indexedAt: new Date() },
      });
      return { page, contentHash, skipped: false };
    });
    if (!snapshot) return { lexicalIndexed: false, semanticIndexed: false };
    if (snapshot.skipped) return { lexicalIndexed: true, semanticIndexed: true, skipped: true };
    const { page, contentHash } = snapshot;
    // Remote embedding generation must never hold the Page row lock.

    try {
      const embeddingResult = await this.llmService.generateEmbedding(
        page.title + ' ' + (page.content ?? '').substring(0, 2000),
      );

      // Write the vector only while the lexical document still carries the
      // content hash this embedding was computed from. A concurrent editor's
      // indexPage run owns a newer hash, so this statement is a no-op for the
      // superseded writer instead of clobbering the newer vector.
      const embeddingVector = vectorLiteral(embeddingResult.embedding);
      const written = await this.prisma.$executeRaw(
        Prisma.sql`
          UPDATE "Page" AS page
          SET "embeddingVector" = ${embeddingVector}::public.halfvec
          FROM "PageSearchDocument" AS document
          WHERE page."id" = ${pageId}
            AND page."deletedAt" IS NULL
            AND page."title" = ${page.title}
            AND COALESCE(page."content", '') = ${page.content ?? ''}
            AND document."pageId" = ${pageId}
            AND document."contentHash" = ${contentHash}
        `,
      );
      if (written === 0) {
        this.logger.warn('Page ' + pageId + ' changed during embedding; newer index run owns the vector');
        return { lexicalIndexed: true, semanticIndexed: false, superseded: true };
      }
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
