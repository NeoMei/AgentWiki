import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SpaceFolderMigrationPreflightError,
  buildSpaceFolderMigrationPlan,
  legacyFolderId,
  sanitizeLegacyFolderName,
} from './space-folder-migration.mjs';

const date = new Date('2026-08-28T00:00:00.000Z');

function page(id, title, parentId = null, overrides = {}) {
  return {
    id,
    knowledgeKey: `knowledge-${id}`,
    spaceId: 'space-1',
    title,
    slug: `slug-${id}`,
    content: `content-${id}`,
    format: 'markdown',
    authorId: 'user-1',
    parentId,
    folderId: null,
    syncPath: `pages/${title}.md`,
    syncPathKey: `pages/${title}.md`.toLowerCase(),
    sortOrder: 0,
    createdAt: date,
    updatedAt: date,
    lastModifiedAt: date,
    deletedAt: null,
    ...overrides,
  };
}

function version(id, pageId, parentId, overrides = {}) {
  return {
    id,
    pageId,
    title: `version-${id}`,
    content: `version-content-${id}`,
    authorId: 'user-1',
    parentId,
    folderId: null,
    createdAt: date,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    spaceId: 'space-1',
    contentTreeRevision: 0n,
    pages: [],
    pageVersions: [],
    folders: [],
    referencedPages: [],
    referencedFolders: [],
    completedBatch: null,
    ...overrides,
  };
}

function expectPreflightCode(input, code) {
  assert.throws(
    () => buildSpaceFolderMigrationPlan(input),
    (error) => error instanceof SpaceFolderMigrationPreflightError
      && error.report.rejections.some((entry) => entry.code === code),
  );
}

test('translates a legacy Page chain without changing Page identity or content evidence', () => {
  const pages = [
    page('page-a', '项目'),
    page('page-b', '周报', 'page-a'),
    page('page-c', '第35周', 'page-b'),
  ];
  const plan = buildSpaceFolderMigrationPlan(snapshot({
    pages,
    pageVersions: [
      version('version-b', 'page-b', 'page-a'),
      version('version-c', 'page-c', 'page-b'),
    ],
  }));

  const projectFolderId = legacyFolderId('space-1', 'page-a');
  const weeklyFolderId = legacyFolderId('space-1', 'page-b');
  assert.deepEqual(plan.folders.map(({ id, parentId, name, path }) => ({ id, parentId, name, path })), [
    { id: projectFolderId, parentId: null, name: '项目', path: 'pages/项目' },
    { id: weeklyFolderId, parentId: projectFolderId, name: '周报', path: 'pages/项目/周报' },
  ]);
  assert.deepEqual(plan.pages.map(({ id, folderId, syncPath, oldSyncPath }) => ({
    id, folderId, syncPath, oldSyncPath,
  })), [
    { id: 'page-a', folderId: null, syncPath: 'pages/项目.md', oldSyncPath: 'pages/项目.md' },
    { id: 'page-b', folderId: projectFolderId, syncPath: 'pages/项目/周报.md', oldSyncPath: 'pages/周报.md' },
    { id: 'page-c', folderId: weeklyFolderId, syncPath: 'pages/项目/周报/第35周.md', oldSyncPath: 'pages/第35周.md' },
  ]);
  assert.deepEqual(plan.aliases.map(({ pageId, path }) => ({ pageId, path })), [
    { pageId: 'page-b', path: 'pages/周报.md' },
    { pageId: 'page-c', path: 'pages/第35周.md' },
  ]);
  assert.deepEqual(plan.pageVersionBackfills, [
    { versionId: 'version-b', folderId: projectFolderId },
    { versionId: 'version-c', folderId: weeklyFolderId },
  ]);
  for (const original of pages) {
    const planned = plan.pages.find((entry) => entry.id === original.id);
    assert.equal(planned.title, original.title);
    assert.equal(planned.content, original.content);
    assert.equal(planned.authorId, original.authorId);
    assert.equal(planned.createdAt.toISOString(), original.createdAt.toISOString());
    assert.equal(planned.updatedAt.toISOString(), original.updatedAt.toISOString());
  }
  assert.equal(plan.counts.pagesMoved, 2);
  assert.equal(plan.counts.aliasesToCreate, 2);
  assert.equal(plan.counts.pageVersionsToBackfill, 2);
});

test('sanitizes invalid and reserved titles and assigns portable collisions in Page-ID order', () => {
  assert.deepEqual(sanitizeLegacyFolderName('  A///B  '), {
    name: 'A B',
    transformed: true,
    reasons: ['trim', 'forbidden-characters'],
  });
  assert.equal(sanitizeLegacyFolderName('CON.txt').name, 'CON-folder.txt');
  assert.equal(sanitizeLegacyFolderName('\u0000 /:*?"<>| ').name, 'untitled-folder');
  assert.equal(sanitizeLegacyFolderName(' .  ').name, 'untitled-folder');
  assert.deepEqual(sanitizeLegacyFolderName('e\u0301'), {
    name: 'é',
    transformed: true,
    reasons: ['nfc'],
  });
  const truncated = sanitizeLegacyFolderName('界'.repeat(200));
  assert.match(truncated.name, /-[0-9a-f]{8}$/u);
  assert.ok(Buffer.byteLength(truncated.name, 'utf8') <= 255);

  const plan = buildSpaceFolderMigrationPlan(snapshot({
    pages: [
      page('page-b', 'con', null, { syncPath: 'pages/root-b.md', syncPathKey: 'pages/root-b.md' }),
      page('child-b', 'child-b', 'page-b'),
      page('page-a', 'CON', null, { syncPath: 'pages/root-a.md', syncPathKey: 'pages/root-a.md' }),
      page('child-a', 'child-a', 'page-a'),
    ],
  }));
  assert.deepEqual(plan.folders.map(({ sourcePageId, name }) => ({ sourcePageId, name })), [
    { sourcePageId: 'page-a', name: 'CON-folder' },
    { sourcePageId: 'page-b', name: 'con-folder (2)' },
  ]);
  assert.equal(plan.transformations.length, 2);
  assert.deepEqual(plan.collisions, [{
    sourcePageId: 'page-b',
    parentId: null,
    requestedName: 'con-folder',
    allocatedName: 'con-folder (2)',
  }]);
});

test('accepts exactly 32 generated Folder levels and rejects level 33', () => {
  const chain = (count) => Array.from({ length: count + 1 }, (_, index) => page(
    `page-${String(index).padStart(2, '0')}`,
    `n${index}`,
    index === 0 ? null : `page-${String(index - 1).padStart(2, '0')}`,
  ));
  assert.equal(buildSpaceFolderMigrationPlan(snapshot({ pages: chain(32) })).folders.length, 32);
  expectPreflightCode(snapshot({ pages: chain(33) }), 'FOLDER_DEPTH_LIMIT');
});

test('fails closed on Page cycles, missing parents, cross-Space parents, path overflow, and the mutation cap', () => {
  expectPreflightCode(snapshot({ pages: [
    page('page-a', 'a', 'page-b'),
    page('page-b', 'b', 'page-a'),
  ] }), 'LEGACY_PAGE_CYCLE');
  expectPreflightCode(snapshot({ pages: [page('page-a', 'a', 'missing')] }), 'LEGACY_PAGE_ORPHAN');
  expectPreflightCode(snapshot({
    pages: [page('page-a', 'a', 'outside')],
    referencedPages: [page('outside', 'outside', null, { spaceId: 'space-2' })],
  }), 'LEGACY_PAGE_CROSS_SPACE');

  const long = '界'.repeat(200);
  const longChain = Array.from({ length: 5 }, (_, index) => page(
    `long-${index}`,
    long,
    index === 0 ? null : `long-${index - 1}`,
  ));
  expectPreflightCode(snapshot({ pages: longChain }), 'FOLDER_PATH_TOO_LONG');

  const parents = Array.from({ length: 5_001 }, (_, index) => page(`p-${index}`, `p-${index}`));
  const children = parents.map((parent, index) => page(`c-${index}`, `c-${index}`, parent.id));
  expectPreflightCode(snapshot({ pages: [...parents, ...children] }), 'FOLDER_MUTATION_LIMIT');
});

test('counts existing active Folders toward 10,000 and validates their graph before planning', () => {
  const folders = Array.from({ length: 10_000 }, (_, index) => ({
    id: `existing-${index}`,
    spaceId: 'space-1',
    parentId: null,
    name: `existing-${index}`,
    nameKey: `existing-${index}`,
    path: `pages/existing-${index}`,
    pathKey: `pages/existing-${index}`,
    deletedAt: null,
  }));
  expectPreflightCode(snapshot({
    folders,
    pages: [page('parent', 'parent'), page('child', 'child', 'parent')],
  }), 'FOLDER_COUNT_LIMIT');

  expectPreflightCode(snapshot({
    folders: [{ ...folders[0], parentId: 'foreign-folder' }],
    referencedFolders: [{ ...folders[1], id: 'foreign-folder', spaceId: 'space-2' }],
  }), 'FOLDER_CROSS_SPACE');
});

test('preserves Page and Folder basename coexistence and ignores deleted current Pages', () => {
  const plan = buildSpaceFolderMigrationPlan(snapshot({ pages: [
    page('project', '项目'),
    page('child', '子页', 'project'),
    page('deleted-parent', '不应迁移', null, { deletedAt: date }),
    page('deleted-child', '已删除', 'deleted-parent', { deletedAt: date }),
  ] }));
  assert.ok(plan.folders.some((folder) => folder.path === 'pages/项目'));
  assert.ok(plan.pages.some((entry) => entry.syncPath === 'pages/项目.md'));
  assert.equal(plan.pages.some((entry) => entry.id === 'deleted-parent'), false);
  assert.equal(plan.counts.deletedPagesSkipped, 2);
});

test('a completed batch is a strict no-op before inspecting later malformed rows', () => {
  const plan = buildSpaceFolderMigrationPlan(snapshot({
    pages: [page('bad', 'bad', 'missing')],
    completedBatch: {
      revisionId: 'revision-complete',
      inputHash: 'a'.repeat(64),
    },
  }));
  assert.equal(plan.status, 'completed');
  assert.equal(plan.revisionId, 'revision-complete');
  assert.equal(plan.counts.foldersToCreate, 0);
  assert.deepEqual(plan.pages, []);
  assert.deepEqual(plan.rejections, []);
});

test('already backfilled PageVersion rows are preserved while mismatches fail closed', () => {
  const folderId = legacyFolderId('space-1', 'parent');
  const base = snapshot({
    pages: [page('parent', 'parent'), page('child', 'child', 'parent')],
    pageVersions: [version('version-child', 'child', 'parent', { folderId })],
  });
  assert.deepEqual(buildSpaceFolderMigrationPlan(base).pageVersionBackfills, []);
  expectPreflightCode({
    ...base,
    pageVersions: [version('version-child', 'child', 'parent', { folderId: 'wrong-folder' })],
  }, 'PAGE_VERSION_FOLDER_CONFLICT');
});
