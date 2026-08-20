import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const opaquePagePath = /^pages\/p-[0-9a-f]{64}\.md$/u;

function opaquePath(character) {
  return `pages/p-${character.repeat(64)}.md`;
}

test('migration rejects an opaque title candidate when its hash differs from the legacy path', async () => {
  const [{ SpaceRevisionWriterService }, { migrateReadablePathsForSpace }] = await Promise.all([
    import(pathToFileURL(resolve(
      root,
      'apps/server/dist/core/sync/space-revision-writer.service.js',
    )).href),
    import('./migrate-readable-sync-paths.mjs'),
  ]);
  const originalLockSpace = SpaceRevisionWriterService.prototype.lockSpace;
  const originalAdvance = SpaceRevisionWriterService.prototype.advance;
  const title = `p-${'f'.repeat(64)}`;
  const page = {
    id: 'internal-page-1',
    knowledgeKey: 'page-1',
    title,
    slug: 'page-1',
    content: '# Preserved\n\nBody',
    format: 'markdown',
    parentId: null,
    authorId: 'user-1',
    spaceId: 'space-1',
    syncPath: opaquePath('e'),
    syncPathKey: opaquePath('e'),
    deletedAt: null,
  };
  const migrationVersions = new Map();
  let revisionCount = 0;
  const tx = {
    page: {
      findMany: async () => [{ ...page }],
      update: async ({ data }) => {
        Object.assign(page, data);
        return { ...page };
      },
    },
    pageVersion: {
      upsert: async ({ where, create }) => {
        const key = `${where.pageId_migrationBatchId.pageId}:${where.pageId_migrationBatchId.migrationBatchId}`;
        if (!migrationVersions.has(key)) migrationVersions.set(key, create);
        return migrationVersions.get(key);
      },
    },
    spaceKnowledgeRevision: {
      findFirst: async () => revisionCount === 0 ? null : { id: 'revision-1' },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
  };

  try {
    SpaceRevisionWriterService.prototype.lockSpace = async (transaction) => transaction;
    SpaceRevisionWriterService.prototype.advance = async () => {
      revisionCount += 1;
      if (revisionCount > 1) {
        const error = new Error('duplicate migration revision');
        error.code = 'P2002';
        throw error;
      }
      return { revisionId: 'revision-1' };
    };

    const batchId = 'readable-sync-path-v1:space-1';
    const first = await migrateReadablePathsForSpace(prisma, 'space-1', batchId);
    const firstPath = page.syncPath;
    const second = await migrateReadablePathsForSpace(prisma, 'space-1', batchId);

    assert.deepEqual(first, { migrated: 1, revisionId: 'revision-1' });
    assert.deepEqual(second, { migrated: 0, revisionId: null });
    assert.doesNotMatch(firstPath, opaquePagePath);
    assert.equal(firstPath, `pages/${title} (2).md`);
    assert.equal(page.title, title);
    assert.equal(page.content, '# Preserved\n\nBody');
    assert.equal(migrationVersions.size, 1);
    assert.equal(revisionCount, 1);
  } finally {
    SpaceRevisionWriterService.prototype.lockSpace = originalLockSpace;
    SpaceRevisionWriterService.prototype.advance = originalAdvance;
  }
});
