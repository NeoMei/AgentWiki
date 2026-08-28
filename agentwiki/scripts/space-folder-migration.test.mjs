import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  SpaceFolderMigrationPreflightError,
  buildSpaceFolderMigrationPlan,
  legacyFolderId,
  operatorReport,
  reserveReportTarget,
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
    asOf: date,
    contentTreeRevision: 0n,
    pages: [],
    pageVersions: [],
    folders: [],
    pathAliases: [],
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

  assert.equal(buildSpaceFolderMigrationPlan(snapshot({ folders })).status, 'ready');
  expectPreflightCode(snapshot({
    folders: [...folders, {
      ...folders[0], id: 'existing-10000', name: 'existing-10000', nameKey: 'existing-10000',
      path: 'pages/existing-10000', pathKey: 'pages/existing-10000',
    }],
  }), 'FOLDER_COUNT_LIMIT');
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
      sidecar: { spaceFolderMigration: {
        version: 1,
        status: 'completed',
        batchKey: 'space-folders-v1:space-1',
        inputHash: 'a'.repeat(64),
      } },
    },
  }));
  assert.equal(plan.status, 'completed');
  assert.equal(plan.revisionId, 'revision-complete');
  assert.equal(plan.counts.foldersToCreate, 0);
  assert.deepEqual(plan.pages, []);
  assert.deepEqual(plan.rejections, []);
});

test('completed migration evidence fails closed unless the complete sidecar contract is valid', () => {
  const valid = {
    revisionId: 'revision-complete',
    sidecar: { spaceFolderMigration: {
      version: 1,
      status: 'completed',
      batchKey: 'space-folders-v1:space-1',
      inputHash: 'a'.repeat(64),
    } },
  };
  const invalid = [
    { revisionId: valid.revisionId, sidecar: null },
    { revisionId: valid.revisionId, sidecar: [] },
    { revisionId: valid.revisionId, sidecar: {} },
    { ...valid, sidecar: { spaceFolderMigration: { ...valid.sidecar.spaceFolderMigration, version: 2 } } },
    { ...valid, sidecar: { spaceFolderMigration: { ...valid.sidecar.spaceFolderMigration, status: 'running' } } },
    { ...valid, sidecar: { spaceFolderMigration: { ...valid.sidecar.spaceFolderMigration, batchKey: 'wrong' } } },
    { ...valid, sidecar: { spaceFolderMigration: { ...valid.sidecar.spaceFolderMigration, inputHash: 'not-a-hash' } } },
  ];
  for (const completedBatch of invalid) {
    expectPreflightCode(snapshot({
      pages: [page('bad', 'bad', 'missing')],
      completedBatch,
    }), 'MIGRATION_BATCH_EVIDENCE_INVALID');
  }
});

test('plans existing alias reuse, ambiguity, current-path shadowing, and deterministic retention', () => {
  const historical = Array.from({ length: 20 }, (_, index) => ({
    id: `history-${String(index).padStart(2, '0')}`,
    spaceId: 'space-1',
    pageId: 'child',
    path: `pages/history-${index}.md`,
    pathKey: `pages/history-${index}.md`,
    createdAt: new Date(`2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`),
    expiresAt: null,
  }));
  const plan = buildSpaceFolderMigrationPlan(snapshot({
    pages: [
      page('root', 'root'),
      page('child', 'child', 'root'),
      page('current', 'current', null, {
        syncPath: 'pages/current.md', syncPathKey: 'pages/current.md',
      }),
    ],
    pathAliases: [
      ...historical,
      {
        id: 'ambiguous', spaceId: 'space-1', pageId: 'current',
        path: 'pages/child.md', pathKey: 'pages/child.md',
        createdAt: new Date('2026-07-01T00:00:00.000Z'), expiresAt: null,
      },
      {
        id: 'shadowed', spaceId: 'space-1', pageId: 'root',
        path: 'pages/current.md', pathKey: 'pages/current.md',
        createdAt: new Date('2026-07-02T00:00:00.000Z'), expiresAt: null,
      },
    ],
  }));

  assert.deepEqual(plan.aliases.map(({ pageId, path, action }) => ({ pageId, path, action })), [
    { pageId: 'child', path: 'pages/child.md', action: 'created' },
  ]);
  assert.deepEqual(plan.aliasRetention, [{
    pageId: 'child',
    prunedAliasIds: ['history-00'],
  }]);
  assert.deepEqual(plan.aliasResolutions, [
    {
      path: 'pages/child.md', pathKey: 'pages/child.md', currentPageIds: [],
      aliasPageIds: ['child', 'current'], resolution: 'ambiguous-alias',
    },
    {
      path: 'pages/current.md', pathKey: 'pages/current.md', currentPageIds: ['current'],
      aliasPageIds: ['root'], resolution: 'current-page',
    },
  ]);
  assert.equal(plan.counts.aliasesCreated, 1);
  assert.equal(plan.counts.aliasesReused, 0);
  assert.equal(plan.counts.aliasesRefreshed, 0);
  assert.equal(plan.counts.aliasesPruned, 1);

  const reused = buildSpaceFolderMigrationPlan(snapshot({
    pages: [page('root', 'root'), page('child', 'child', 'root')],
    pathAliases: [{
      id: 'reuse', spaceId: 'space-1', pageId: 'child',
      path: 'pages/child.md', pathKey: 'pages/child.md',
      createdAt: date, expiresAt: null,
    }],
  }));
  assert.equal(reused.aliases[0].action, 'reused');
  assert.equal(reused.counts.aliasesReused, 1);

  const refreshed = buildSpaceFolderMigrationPlan(snapshot({
    pages: [page('root', 'root'), page('child', 'child', 'root')],
    pathAliases: [{
      id: 'refresh', spaceId: 'space-1', pageId: 'child',
      path: 'pages/CHILD.md', pathKey: 'pages/child.md',
      createdAt: date, expiresAt: date,
    }],
  }));
  assert.equal(refreshed.aliases[0].action, 'refreshed');
  assert.equal(refreshed.counts.aliasesRefreshed, 1);
});

test('alias resolution uses one asOf for future, equal, past, and deleted-owner aliases without omitting retention evidence from the hash', () => {
  const pages = [
    page('root', 'root'),
    page('child', 'child', 'root'),
    page('active-owner', 'active-owner'),
    page('future-owner', 'future-owner'),
    page('equal-owner', 'equal-owner'),
    page('past-owner', 'past-owner'),
    page('deleted-owner', 'deleted-owner', null, { deletedAt: date }),
  ];
  const pathAliases = [
    {
      id: 'active-duplicate', spaceId: 'space-1', pageId: 'active-owner',
      path: 'pages/child.md', pathKey: 'pages/child.md', createdAt: date, expiresAt: null,
    },
    {
      id: 'future-duplicate', spaceId: 'space-1', pageId: 'future-owner',
      path: 'pages/child.md', pathKey: 'pages/child.md', createdAt: date,
      expiresAt: new Date('2026-08-29T00:00:00.000Z'),
    },
    {
      id: 'equal-duplicate', spaceId: 'space-1', pageId: 'equal-owner',
      path: 'pages/child.md', pathKey: 'pages/child.md', createdAt: date, expiresAt: date,
    },
    {
      id: 'past-duplicate', spaceId: 'space-1', pageId: 'past-owner',
      path: 'pages/child.md', pathKey: 'pages/child.md', createdAt: date,
      expiresAt: new Date('2026-08-27T00:00:00.000Z'),
    },
    {
      id: 'deleted-duplicate', spaceId: 'space-1', pageId: 'deleted-owner',
      path: 'pages/child.md', pathKey: 'pages/child.md', createdAt: date, expiresAt: null,
    },
  ];
  const plan = buildSpaceFolderMigrationPlan(snapshot({ pages, pathAliases }));
  assert.equal(operatorReport(plan).snapshotAsOf, date.toISOString());
  assert.deepEqual(plan.aliasResolutions, [{
    path: 'pages/child.md', pathKey: 'pages/child.md', currentPageIds: [],
    aliasPageIds: ['active-owner', 'child', 'future-owner'], resolution: 'ambiguous-alias',
  }]);

  const changedExpiredEvidence = buildSpaceFolderMigrationPlan(snapshot({
    pages,
    pathAliases: pathAliases.map((alias) => alias.id === 'past-duplicate'
      ? { ...alias, path: 'pages/expired-other.md', pathKey: 'pages/expired-other.md' }
      : alias),
  }));
  assert.notEqual(changedExpiredEvidence.inputHash, plan.inputHash);

  const afterFutureExpiry = buildSpaceFolderMigrationPlan(snapshot({
    asOf: new Date('2026-08-30T00:00:00.000Z'), pages, pathAliases,
  }));
  assert.deepEqual(afterFutureExpiry.aliasResolutions[0].aliasPageIds, ['active-owner', 'child']);
  assert.notEqual(afterFutureExpiry.inputHash, plan.inputHash);
});

test('operator report contains stable per-Page paths and planned Folder/alias detail', () => {
  const plan = buildSpaceFolderMigrationPlan(snapshot({
    pages: [page('root', 'root'), page('z-child', 'z', 'root'), page('a-root', 'a')],
  }));
  const report = operatorReport(plan);
  assert.deepEqual(report.pathChanges.map(({ pageId, oldPath, newPath, changed }) => ({
    pageId, oldPath, newPath, changed,
  })), [
    { pageId: 'a-root', oldPath: 'pages/a.md', newPath: 'pages/a.md', changed: false },
    { pageId: 'root', oldPath: 'pages/root.md', newPath: 'pages/root.md', changed: false },
    { pageId: 'z-child', oldPath: 'pages/z.md', newPath: 'pages/root/z.md', changed: true },
  ]);
  assert.deepEqual(report.plannedFolders.map(({ sourcePageId, path }) => ({ sourcePageId, path })), [
    { sourcePageId: 'root', path: 'pages/root' },
  ]);
  assert.deepEqual(report.plannedAliases.map(({ pageId, path, action }) => ({ pageId, path, action })), [
    { pageId: 'z-child', path: 'pages/z.md', action: 'created' },
  ]);
  assert.deepEqual(report.conversionSummary, {
    transformedFolderNames: 0,
    folderNameCollisions: 0,
    aliasAmbiguities: 0,
    aliasCurrentPathShadows: 0,
  });
  const twice = operatorReport(report);
  assert.equal(twice.pathChanges.length, 3);
  assert.equal(twice.plannedFolders.length, 1);
  assert.equal(twice.plannedAliases.length, 1);
  assert.deepEqual(twice, report);
});

test('a worst-order 10,000 Page chain returns structured preflight rejection instead of RangeError', () => {
  const pages = Array.from({ length: 10_000 }, (_, index) => page(
    `deep-${String(index).padStart(5, '0')}`,
    `n${index}`,
    index === 9_999 ? null : `deep-${String(index + 1).padStart(5, '0')}`,
  ));
  assert.throws(
    () => buildSpaceFolderMigrationPlan(snapshot({ pages })),
    (error) => error instanceof SpaceFolderMigrationPreflightError
      && error.report.rejections.some((entry) => entry.code === 'FOLDER_DEPTH_LIMIT'),
  );
});

test('an over-depth cycle is still reported as a cycle by iterative graph validation', () => {
  const pages = Array.from({ length: 100 }, (_, index) => page(
    `cycle-${String(index).padStart(3, '0')}`,
    `cycle-${index}`,
    `cycle-${String((index + 1) % 100).padStart(3, '0')}`,
  ));
  expectPreflightCode(snapshot({ pages }), 'LEGACY_PAGE_CYCLE');
});

test('rejection operator reports retain stable Page path and partial conversion detail', () => {
  let rejection;
  try {
    buildSpaceFolderMigrationPlan(snapshot({
      pages: [page('root', 'root'), page('orphan', 'orphan', 'missing')],
    }));
  } catch (error) {
    rejection = error;
  }
  assert.ok(rejection instanceof SpaceFolderMigrationPreflightError);
  const report = operatorReport(rejection.report);
  assert.equal(report.status, 'rejected');
  assert.deepEqual(report.pathChanges.map(({ pageId, oldPath, newPath }) => ({
    pageId, oldPath, newPath,
  })), [
    { pageId: 'orphan', oldPath: 'pages/orphan.md', newPath: 'pages/orphan.md' },
    { pageId: 'root', oldPath: 'pages/root.md', newPath: 'pages/root.md' },
  ]);
  assert.ok(report.rejections.some((entry) => entry.code === 'LEGACY_PAGE_ORPHAN'));
});

test('reserved report writes fail closed if the exclusively reserved target identity changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-folder-report-identity-'));
  const target = join(directory, 'report.json');
  try {
    const reservation = await reserveReportTarget(target);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    await rm(target);
    await writeFile(target, 'replacement-must-survive', { mode: 0o600 });
    await assert.rejects(
      () => reservation.write({ status: 'applied' }),
      /identity changed/,
    );
    assert.equal(await readFile(target, 'utf8'), 'replacement-must-survive');
    await reservation.close?.();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('one report reservation can replace its own atomic output after a later transaction failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-folder-report-rewrite-'));
  const target = join(directory, 'report.json');
  try {
    const reservation = await reserveReportTarget(target);
    const original = await stat(target, { bigint: true });
    await reservation.write({ status: 'applied' });
    await reservation.write({ status: 'rejected', rejections: ['commit failed'] });
    const final = await stat(target, { bigint: true });
    assert.equal(final.dev, original.dev);
    assert.equal(final.ino, original.ino);
    assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), {
      status: 'rejected', rejections: ['commit failed'],
    });
    await reservation.close?.();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('report writes remain bound to the original file when the parent path is renamed or replaced by a symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-folder-report-parent-'));
  const parent = join(directory, 'reports');
  const movedParent = join(directory, 'moved-reports');
  const target = join(parent, 'report.json');
  try {
    await mkdir(parent, { mode: 0o700 });
    const reservation = await reserveReportTarget(target);
    await rename(parent, movedParent);
    await mkdir(parent, { mode: 0o700 });
    await writeFile(target, 'other-target-must-survive', { mode: 0o600 });
    await assert.rejects(() => reservation.write({ status: 'applied' }), /identity changed/);
    assert.equal(await readFile(target, 'utf8'), 'other-target-must-survive');
    await rm(parent, { recursive: true });
    await symlink(movedParent, parent, 'dir');
    await assert.rejects(() => reservation.write({ status: 'rejected' }), /identity changed/);
    assert.equal(JSON.parse(await readFile(join(movedParent, 'report.json'), 'utf8')).status, 'rejected');
    await reservation.close?.();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reservation initialization failures leave a closed O_EXCL placeholder and never unlink its pathname', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-folder-report-init-'));
  try {
    for (const method of ['chmod', 'stat']) {
      const target = join(directory, `${method}.json`);
      let reportHandleClosed = 0;
      let parentHandleClosed = 0;
      const injectedOpen = async (path, flags, mode) => {
        const handle = await open(path, flags, mode);
        return new Proxy(handle, {
          get(realHandle, property) {
            if (path === target && property === method) {
              return async () => { throw new Error(`forced ${method} failure`); };
            }
            if (property === 'close') return async () => {
              if (path === target) reportHandleClosed += 1;
              else parentHandleClosed += 1;
              return realHandle.close();
            };
            const value = Reflect.get(realHandle, property, realHandle);
            return typeof value === 'function' ? value.bind(realHandle) : value;
          },
        });
      };
      await assert.rejects(
        () => reserveReportTarget(target, { open: injectedOpen }),
        new RegExp(`forced ${method} failure`, 'u'),
      );
      assert.equal(reportHandleClosed, 1);
      assert.equal(parentHandleClosed, 1);
      assert.equal((await stat(target)).isFile(), true);
      const rejection = JSON.parse(await readFile(target, 'utf8'));
      assert.equal(rejection.status, 'rejected');
      assert.match(rejection.rejections[0].message, new RegExp(`forced ${method} failure`, 'u'));
    }

    const unwritableTarget = join(directory, 'write.json');
    let unwritableClosed = 0;
    let unwritableParentClosed = 0;
    const unwritableOpen = async (path, flags, mode) => {
      const handle = await open(path, flags, mode);
      return new Proxy(handle, {
        get(realHandle, property) {
          if (path === unwritableTarget && property === 'write') {
            return async () => { throw new Error('forced fd write failure'); };
          }
          if (property === 'close') return async () => {
            if (path === unwritableTarget) unwritableClosed += 1;
            else unwritableParentClosed += 1;
            return realHandle.close();
          };
          const value = Reflect.get(realHandle, property, realHandle);
          return typeof value === 'function' ? value.bind(realHandle) : value;
        },
      });
    };
    await assert.rejects(
      () => reserveReportTarget(unwritableTarget, { open: unwritableOpen }),
      /forced fd write failure/u,
    );
    assert.equal(unwritableClosed, 1);
    assert.equal(unwritableParentClosed, 1);
    assert.equal((await stat(unwritableTarget)).isFile(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
