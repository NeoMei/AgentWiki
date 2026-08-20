import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opaquePagePath = /^pages\/p-[0-9a-f]{64}\.md$/u;

async function loadServices() {
  const [{ SpaceRevisionWriterService }, { ReadableSyncPathService }] = await Promise.all([
    import(pathToFileURL(resolve(
      root,
      'apps/server/dist/core/sync/space-revision-writer.service.js',
    )).href),
    import(pathToFileURL(resolve(
      root,
      'apps/server/dist/core/sync/readable-sync-path.service.js',
    )).href),
  ]);
  if (!SpaceRevisionWriterService || !ReadableSyncPathService) {
    throw new Error('Compiled sync services are unavailable; build @agentwiki/server first');
  }
  return { SpaceRevisionWriterService, ReadableSyncPathService };
}

export async function migrateReadablePathsForSpace(prisma, spaceId, batchId) {
  if (!spaceId || !batchId) throw new Error('spaceId and batchId are required');
  const { SpaceRevisionWriterService, ReadableSyncPathService } = await loadServices();
  const writer = new SpaceRevisionWriterService(prisma);
  const allocator = new ReadableSyncPathService();

  return prisma.$transaction(async (tx) => {
    const lockedTx = await writer.lockSpace(tx, spaceId);
    const completedRevision = await tx.spaceKnowledgeRevision.findUnique({
      where: {
        spaceId_migrationBatchId: {
          spaceId,
          migrationBatchId: batchId,
        },
      },
      select: { id: true },
    });
    if (completedRevision) {
      return { migrated: 0, revisionId: completedRevision.id };
    }

    const persistedPages = await tx.page.findMany({
      where: { spaceId },
      orderBy: { knowledgeKey: 'asc' },
    });
    const allPages = persistedPages.filter((page) => page.deletedAt === null);
    const pages = allPages.filter((page) => opaquePagePath.test(page.syncPath));

    if (pages.length === 0) {
      return { migrated: 0, revisionId: null };
    }

    const parentRevision = await tx.spaceKnowledgeRevision.findFirst({
      where: { spaceId },
      orderBy: { sequence: 'desc' },
      select: { id: true },
    });
    const migratedPathByPageId = new Map();
    const occupiedPathKeys = new Set(persistedPages.map((page) => page.syncPathKey));
    for (const page of pages) {
      let allocated;
      do {
        allocated = await allocator.allocate(lockedTx, {
          spaceId,
          directory: 'pages',
          title: page.title,
          excludePageId: page.id,
        }, occupiedPathKeys);
        // Migration output must leave the selector permanently. A legitimate
        // title can itself be `p-<64 lowercase hex>` even when the legacy path
        // used a different hash, so reject every still-opaque candidate here
        // without changing ordinary allocator behavior.
        if (opaquePagePath.test(allocated.path)) {
          occupiedPathKeys.add(allocated.pathKey);
        }
      } while (opaquePagePath.test(allocated.path));
      occupiedPathKeys.add(allocated.pathKey);
      await tx.pageVersion.upsert({
        where: {
          pageId_migrationBatchId: {
            pageId: page.id,
            migrationBatchId: batchId,
          },
        },
        create: {
          pageId: page.id,
          title: page.title,
          content: page.content,
          authorId: page.authorId,
          slug: page.slug,
          format: page.format,
          parentId: page.parentId,
          syncPath: page.syncPath,
          syncPathKey: page.syncPathKey,
          migrationBatchId: batchId,
        },
        update: {},
      });
      await tx.page.update({
        where: { id: page.id },
        data: {
          syncPath: allocated.path,
          syncPathKey: allocated.pathKey,
        },
      });
      migratedPathByPageId.set(page.id, allocated.path);
    }

    // The writer normally copies every unchanged Page row from its parent.
    // Legacy Spaces can predate the revision stream, so their first migration
    // revision must seed the complete active Page set instead of exposing only
    // the renamed subset.
    const revisionPages = parentRevision ? pages : allPages;
    const changes = revisionPages.map((page) => ({
      operation: 'upsert',
      pageId: page.knowledgeKey,
      path: migratedPathByPageId.get(page.id) ?? page.syncPath,
      title: page.title,
      body: page.content,
    }));

    const revision = await writer.advance(tx, spaceId, changes, {
      origin: 'migration',
      migrationBatchId: batchId,
    });
    return { migrated: pages.length, revisionId: revision.revisionId };
  }, { maxWait: 10_000, timeout: 30 * 60_000 });
}

export function createdMigrationRevision(result) {
  return result.migrated > 0 && Boolean(result.revisionId);
}

function databaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  return value;
}

function prismaClient() {
  const require = createRequire(resolve(root, 'apps/server/package.json'));
  const { PrismaClient } = require('@prisma/client');
  return new PrismaClient({
    datasources: { db: { url: databaseUrl() } },
  });
}

async function main() {
  const prisma = prismaClient();
  try {
    const spaces = await prisma.space.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    let migrated = 0;
    let revisions = 0;
    for (const space of spaces) {
      const result = await migrateReadablePathsForSpace(
        prisma,
        space.id,
        `readable-sync-path-v1:${space.id}`,
      );
      migrated += result.migrated;
      if (createdMigrationRevision(result)) revisions += 1;
    }
    console.log(`Migrated ${migrated} page paths across ${spaces.length} spaces (${revisions} revisions)`);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
