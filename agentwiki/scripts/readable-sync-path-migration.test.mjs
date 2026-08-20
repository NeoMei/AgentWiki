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
      findUnique: async () => revisionCount === 0
        ? null : { id: 'revision-1' },
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
    assert.deepEqual(second, { migrated: 0, revisionId: 'revision-1' });
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

test('completed migration batch no-ops before scanning pages added later', async () => {
  const [{ SpaceRevisionWriterService }, { migrateReadablePathsForSpace }] = await Promise.all([
    import(pathToFileURL(resolve(
      root,
      'apps/server/dist/core/sync/space-revision-writer.service.js',
    )).href),
    import('./migrate-readable-sync-paths.mjs'),
  ]);
  const originalLockSpace = SpaceRevisionWriterService.prototype.lockSpace;
  const originalAdvance = SpaceRevisionWriterService.prototype.advance;
  const batchId = 'readable-sync-path-v1:space-completed';
  const page = {
    id: 'internal-page-later',
    knowledgeKey: 'page-later',
    title: `p-${'f'.repeat(64)}`,
    slug: 'page-later',
    content: '# Added later',
    format: 'markdown',
    parentId: null,
    authorId: 'user-1',
    spaceId: 'space-completed',
    syncPath: opaquePath('f'),
    syncPathKey: opaquePath('f'),
    deletedAt: null,
  };
  const pages = [page];
  const versions = [];
  const revisions = [{
    id: 'completed-revision',
    spaceId: 'space-completed',
    migrationBatchId: batchId,
  }];
  const events = [];
  const tx = {
    page: {
      findMany: async () => {
        events.push('page-scan');
        return pages.map((entry) => ({ ...entry }));
      },
      update: async ({ data }) => {
        events.push('page-update');
        Object.assign(page, data);
        return { ...page };
      },
    },
    pageVersion: {
      upsert: async ({ create }) => {
        events.push('page-version');
        versions.push(create);
        return create;
      },
    },
    spaceKnowledgeRevision: {
      findUnique: async (args) => {
        events.push('batch-lookup');
        assert.deepEqual(args, {
          where: {
            spaceId_migrationBatchId: {
              spaceId: 'space-completed',
              migrationBatchId: batchId,
            },
          },
          select: { id: true },
        });
        return revisions[0];
      },
      findFirst: async () => {
        events.push('parent-lookup');
        return { id: 'completed-revision' };
      },
    },
  };
  const prisma = {
    $transaction: async (callback) => callback(tx),
  };

  try {
    SpaceRevisionWriterService.prototype.lockSpace = async (transaction) => {
      events.push('lock');
      return transaction;
    };
    SpaceRevisionWriterService.prototype.advance = async () => {
      events.push('advance');
      const error = new Error('duplicate migration revision');
      error.code = 'P2002';
      throw error;
    };

    const before = {
      pages: structuredClone(pages),
      pageVersions: versions.length,
      revisions: revisions.length,
    };
    const result = await migrateReadablePathsForSpace(
      prisma,
      'space-completed',
      batchId,
    );

    assert.deepEqual(result, { migrated: 0, revisionId: 'completed-revision' });
    assert.deepEqual(events, ['lock', 'batch-lookup']);
    assert.deepEqual(pages, before.pages);
    assert.equal(versions.length, before.pageVersions);
    assert.equal(revisions.length, before.revisions);
  } finally {
    SpaceRevisionWriterService.prototype.lockSpace = originalLockSpace;
    SpaceRevisionWriterService.prototype.advance = originalAdvance;
  }
});

test('CLI aggregation counts only revisions created by mixed migration results', async () => {
  const { migrateReadablePathsForSpaces } = await import('./migrate-readable-sync-paths.mjs');
  const spaces = [{ id: 'first' }, { id: 'retry' }, { id: 'empty' }];
  const results = new Map([
    ['first', { migrated: 2, revisionId: 'new-revision' }],
    ['retry', { migrated: 0, revisionId: 'completed-revision' }],
    ['empty', { migrated: 0, revisionId: null }],
  ]);
  const calls = [];
  const prisma = {
    space: {
      findMany: async (args) => {
        assert.deepEqual(args, {
          where: { deletedAt: null },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        return spaces;
      },
    },
  };

  const summary = await migrateReadablePathsForSpaces(prisma, async (_prisma, spaceId, batchId) => {
    calls.push({ spaceId, batchId });
    return results.get(spaceId);
  });

  assert.deepEqual(calls, spaces.map(({ id }) => ({
    spaceId: id,
    batchId: `readable-sync-path-v1:${id}`,
  })));
  assert.deepEqual(summary, {
    migrated: 2,
    revisions: 1,
    spaces: 3,
    output: 'Migrated 2 page paths across 3 spaces (1 revisions)',
  });
});
