import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const recovery = await import('./recover-legacy-document-data.mjs').catch(() => ({}));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8').catch(() => '');

test('refuses source and target URLs that resolve to the same PostgreSQL database', () => {
  assert.equal(typeof recovery.assertDistinctDatabaseUrls, 'function');

  assert.throws(
    () => recovery.assertDistinctDatabaseUrls(
      'postgresql://legacy_reader:source-secret@db.internal:5432/agentwiki?schema=public',
      'postgres://app_writer:target-secret@DB.INTERNAL/agentwiki?sslmode=require',
    ),
    /different PostgreSQL databases/,
  );
});

test('defaults to dry-run and enables writes only with --apply', () => {
  assert.equal(typeof recovery.parseCliOptions, 'function');

  const env = {
    LEGACY_DATABASE_URL: 'postgresql://reader@db.internal/agentwiki_legacy',
    DATABASE_URL: 'postgresql://writer@db.internal/agentwiki',
  };

  assert.equal(recovery.parseCliOptions([], env).apply, false);
  assert.equal(recovery.parseCliOptions(['--apply'], env).apply, true);
  assert.throws(() => recovery.parseCliOptions(['--write'], env), /Unknown argument/);
});

const legacyJob = {
  id: 'job-42',
  status: 'completed',
  repoUrl: 'https://git.example.test/acme/wiki.git',
  repoPath: null,
  spaceId: 'space-1',
  config: { branch: 'main' },
  result: { pageSources: { 'page-a': 'docs/a.md' } },
  error: null,
  gitHead: 'abc123',
  attempts: 1,
  maxAttempts: 3,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:05:00.000Z'),
};

const legacySnapshots = [
  {
    id: 'snapshot-b',
    jobId: 'job-42',
    fileHash: 'hash-b',
    filePath: 'docs/b.md',
    content: '# B\n内容 B',
    createdAt: new Date('2026-07-01T00:02:00.000Z'),
  },
  {
    id: 'snapshot-a',
    jobId: 'job-42',
    fileHash: 'hash-a',
    filePath: 'docs/a.md',
    content: '# A\ncontent A',
    createdAt: new Date('2026-07-01T00:01:00.000Z'),
  },
];

const legacyPageLinks = [
  { id: 'page-b', documentGenerationJobId: 'job-42' },
  { id: 'page-a', documentGenerationJobId: 'job-42' },
];

const emptyTargetState = {
  space: { id: 'space-1' },
  sources: [],
  runs: [],
  sourceVersions: [],
  fileSnapshots: [],
  evidences: [],
  pages: [
    { id: 'page-a', spaceId: 'space-1', sourceId: null, sourceVersionId: null, sourcePath: null },
    { id: 'page-b', spaceId: 'space-1', sourceId: null, sourceVersionId: null, sourcePath: null },
  ],
};

test('builds a deterministic recovery plan with a reversible filePath-to-content bundle', () => {
  assert.equal(typeof recovery.buildJobRecoveryPlan, 'function');

  const first = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });
  const reordered = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: [...legacySnapshots].reverse(),
    pageLinks: [...legacyPageLinks].reverse(),
    targetState: emptyTargetState,
  });

  assert.deepEqual(first, reordered);
  assert.deepEqual(first.conflicts, []);
  assert.match(first.records.sourceVersion.id, /^legacy-source-version-[a-f0-9]{24}$/);
  assert.match(first.records.sourceVersion.contentHash, /^[a-f0-9]{64}$/);

  const bundle = JSON.parse(first.records.sourceVersion.content);
  assert.equal(bundle.format, 'agentwiki/legacy-codebase-snapshot-bundle@1');
  assert.equal(bundle.filesByPath['docs/a.md'].content, '# A\ncontent A');
  assert.equal(bundle.filesByPath['docs/b.md'].content, '# B\n内容 B');
  assert.match(bundle.filesByPath['docs/a.md'].contentChecksum, /^md5:[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(bundle.filesByPath), ['docs/a.md', 'docs/b.md']);

  assert.deepEqual(
    first.records.fileSnapshots.map((snapshot) => snapshot.path),
    ['docs/a.md', 'docs/b.md'],
  );
  for (const snapshot of first.records.fileSnapshots) {
    assert.equal(Object.hasOwn(snapshot, 'content'), false);
  }

  assert.equal(first.records.pageProvenance[0].pageId, 'page-a');
  assert.equal(first.records.pageProvenance[0].sourcePath, 'docs/a.md');
  assert.equal(first.records.pageProvenance[1].pageId, 'page-b');
  assert.equal(first.records.pageProvenance[1].sourcePath, null);
  assert.equal(first.records.evidences[0].targetPageId, 'page-a');
  assert.equal(first.records.evidences[0].confidence, 1);
  assert.equal(first.records.evidences[0].location.linkStrategy, 'legacy-result');
  assert.equal(first.records.evidences[0].location.bundlePath, 'docs/a.md');
  assert.equal(first.records.evidences[1].location.sourcePath, null);
  assert.equal(first.records.evidences[1].location.linkStrategy, 'synthetic-page-link');
  assert.equal(first.records.evidences[1].location.bundlePath, null);
  assert.match(first.records.evidences[0].id, /^legacy-evidence-[a-f0-9]{24}$/);
});

test('marks an explicit Page path missing from the snapshot bundle as low-confidence fallback', () => {
  const job = {
    ...legacyJob,
    result: { pageSources: { 'page-a': 'docs/not-in-snapshot.md' } },
  };
  const plan = recovery.buildJobRecoveryPlan({
    job,
    snapshots: legacySnapshots,
    pageLinks: [{ id: 'page-a', documentGenerationJobId: job.id }],
    targetState: { ...emptyTargetState, pages: [emptyTargetState.pages[0]] },
  });
  const evidence = plan.records.evidences[0];

  assert.equal(plan.records.pageProvenance[0].sourcePath, null);
  assert.equal(evidence.confidence < 1, true);
  assert.deepEqual(evidence.location, {
    legacyJobId: 'job-42',
    sourcePath: null,
    linkStrategy: 'legacy-result-path-missing-snapshot',
    bundlePath: null,
    requestedPath: 'docs/not-in-snapshot.md',
  });
});

test('keeps every unmapped Page sourcePath null without treating NULL paths as duplicates', () => {
  const job = { ...legacyJob, result: {} };
  const plan = recovery.buildJobRecoveryPlan({
    job,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });

  assert.deepEqual(
    plan.records.pageProvenance.map((page) => page.sourcePath),
    [null, null],
  );
  assert.deepEqual(
    plan.conflicts.filter((conflict) => conflict.kind === 'duplicate-page-source-path'),
    [],
  );
  assert.deepEqual(
    plan.operations.updatePages.map((page) => page.sourcePath),
    [null, null],
  );
  assert.equal(plan.records.evidences.every((evidence) => evidence.location.sourcePath === null), true);
});

test('recovery planning is independent of the host locale collation', () => {
  const originalLocaleCompare = String.prototype.localeCompare;
  const baseline = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });

  try {
    String.prototype.localeCompare = function reversedLocaleCompare(other) {
      return -originalLocaleCompare.call(this, other);
    };
    const withDifferentHostCollation = recovery.buildJobRecoveryPlan({
      job: legacyJob,
      snapshots: legacySnapshots,
      pageLinks: legacyPageLinks,
      targetState: emptyTargetState,
    });
    assert.deepEqual(withDifferentHostCollation, baseline);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test('plans no writes when the deterministic recovery records already exist', () => {
  const initial = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });
  const existingState = {
    sources: [initial.records.source],
    runs: [initial.records.run],
    sourceVersions: [initial.records.sourceVersion],
    fileSnapshots: initial.records.fileSnapshots,
    evidences: initial.records.evidences,
    pages: initial.records.pageProvenance.map((page) => ({
      id: page.pageId,
      spaceId: page.spaceId,
      sourceId: page.sourceId,
      sourceVersionId: page.sourceVersionId,
      sourcePath: page.sourcePath,
    })),
  };

  const rerun = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: existingState,
  });

  assert.deepEqual(rerun.conflicts, []);
  assert.equal(rerun.operations.createSource, null);
  assert.equal(rerun.operations.createRun, null);
  assert.equal(rerun.operations.createSourceVersion, null);
  assert.deepEqual(rerun.operations.createFileSnapshots, []);
  assert.deepEqual(rerun.operations.createEvidences, []);
  assert.deepEqual(rerun.operations.updatePages, []);
});

test('treats Evidence location and confidence as part of its idempotency identity', () => {
  const initial = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });
  const baseState = {
    sources: [initial.records.source],
    runs: [initial.records.run],
    sourceVersions: [initial.records.sourceVersion],
    fileSnapshots: initial.records.fileSnapshots,
    pages: initial.records.pageProvenance.map((page) => ({
      id: page.pageId,
      spaceId: page.spaceId,
      sourceId: page.sourceId,
      sourceVersionId: page.sourceVersionId,
      sourcePath: page.sourcePath,
    })),
  };

  for (const malformedEvidence of [
    {
      ...initial.records.evidences[0],
      location: { ...initial.records.evidences[0].location, sourcePath: 'docs/wrong.md' },
    },
    { ...initial.records.evidences[0], confidence: 0.5 },
  ]) {
    const plan = recovery.buildJobRecoveryPlan({
      job: legacyJob,
      snapshots: legacySnapshots,
      pageLinks: legacyPageLinks,
      targetState: {
        ...baseState,
        evidences: [malformedEvidence, initial.records.evidences[1]],
      },
    });

    assert.deepEqual(
      plan.conflicts.filter((conflict) => conflict.kind === 'evidence-identity'),
      [{ kind: 'evidence-identity', evidenceId: malformedEvidence.id }],
    );
    assert.equal(
      plan.operations.createEvidences.some((evidence) => evidence.id === malformedEvidence.id),
      false,
    );
  }
});

test('reports existing Page provenance conflicts without planning an overwrite', () => {
  const targetState = {
    ...emptyTargetState,
    pages: emptyTargetState.pages.map((page) => page.id === 'page-a'
      ? {
          ...page,
          sourceId: 'new-source',
          sourceVersionId: 'new-version',
          sourcePath: 'current/source.md',
        }
      : page),
  };

  const plan = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState,
  });

  assert.deepEqual(
    plan.conflicts.filter((conflict) => conflict.kind === 'page-provenance'),
    [{
      kind: 'page-provenance',
      pageId: 'page-a',
      existing: {
        sourceId: 'new-source',
        sourceVersionId: 'new-version',
        sourcePath: 'current/source.md',
      },
      planned: {
        sourceId: plan.records.source.id,
        sourceVersionId: plan.records.sourceVersion.id,
        sourcePath: 'docs/a.md',
      },
    }],
  );
  assert.equal(
    plan.operations.updatePages.some((update) => update.pageId === 'page-a'),
    false,
  );
});

test('blocks duplicate legacy snapshot paths instead of losing one file content', () => {
  const plan = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: [
      legacySnapshots[0],
      { ...legacySnapshots[0], id: 'snapshot-b-duplicate', content: 'different content' },
    ],
    pageLinks: [],
    targetState: { ...emptyTargetState, pages: [] },
  });

  assert.deepEqual(
    plan.conflicts.filter((conflict) => conflict.kind === 'duplicate-snapshot-path'),
    [{ kind: 'duplicate-snapshot-path', path: 'docs/b.md', snapshotCount: 2 }],
  );
});

test('blocks duplicate planned Page source paths before the target unique constraint', () => {
  const job = {
    ...legacyJob,
    result: { pageSources: { 'page-a': 'docs/a.md', 'page-b': 'docs/a.md' } },
  };
  const plan = recovery.buildJobRecoveryPlan({
    job,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });

  assert.deepEqual(
    plan.conflicts.filter((conflict) => conflict.kind === 'duplicate-page-source-path'),
    [{
      kind: 'duplicate-page-source-path',
      sourcePath: 'docs/a.md',
      pageIds: ['page-a', 'page-b'],
    }],
  );
});

test('blocks a job when its target Space does not exist', () => {
  const plan = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: { ...emptyTargetState, space: null },
  });

  assert.deepEqual(
    plan.conflicts.filter((conflict) => conflict.kind === 'missing-space'),
    [{ kind: 'missing-space', spaceId: 'space-1' }],
  );
});

test('forward migration reports PAT rotation and aborts memory hash conflicts before updating', async () => {
  const migration = await read(
    'apps/server/prisma/migrations/20260727010000_remove_legacy_user_api_key/migration.sql',
  );

  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /COUNT\(\*\).*"apiKey" IS NOT NULL/s);
  assert.match(migration, /RAISE WARNING.*rotate/s);
  assert.match(migration, /UPDATE "User"[\s\S]*SET "apiKey" = NULL/);
  assert.match(migration, /DROP COLUMN(?: IF EXISTS)? "apiKey"/);
  assert.match(migration, /lower\(trim\(regexp_replace\("content", '\\s\+', ' ', 'g'\)\)\)/);
  assert.match(migration, /RAISE EXCEPTION.*canonical memory hash conflict/s);
  assert.ok(
    migration.indexOf('RAISE EXCEPTION') < migration.indexOf('UPDATE "AgentMemory"'),
    'conflict detection must precede the memory hash update',
  );
  assert.doesNotMatch(migration, /DELETE FROM "AgentMemory"/);
  assert.match(migration, /COMMIT;\s*$/);

  const schema = await read('apps/server/prisma/schema.prisma');
  const userModel = schema.match(/model User \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(userModel, /\bapiKey\b/);
});

test('second forward migration aligns Memory hashes with ASCII-only canonicalization', async () => {
  const migration = await read(
    'apps/server/prisma/migrations/20260727011000_align_memory_hash_canonicalization/migration.sql',
  );

  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /translate\(/);
  assert.match(migration, /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.match(migration, /abcdefghijklmnopqrstuvwxyz/);
  assert.match(migration, /E'\[ \\x09-\\x0D\]\+'/);
  assert.match(migration, /RAISE EXCEPTION.*canonical memory hash conflict/s);
  assert.ok(
    migration.indexOf('RAISE EXCEPTION') < migration.indexOf('UPDATE "AgentMemory"'),
    'conflict detection must precede the hash update',
  );
  assert.doesNotMatch(migration, /DELETE FROM "AgentMemory"/);
  assert.doesNotMatch(migration, /\blower\(/);
  assert.match(migration, /COMMIT;\s*$/);
});

function createFakeLegacyDatabase(identity = {
  databaseName: 'agentwiki_legacy',
  serverAddress: '127.0.0.1',
  serverPort: 5432,
}, data = {
  jobs: [legacyJob],
  snapshots: legacySnapshots,
  pageLinks: legacyPageLinks,
}) {
  let legacyReads = 0;
  const readOnlyStatements = [];
  const transactionOptions = [];
  const client = {
    async $queryRawUnsafe(sql) {
      if (sql.includes('current_database()')) return [identity];
      if (sql.includes('FROM "DocumentGenerationJob"')) {
        legacyReads += 1;
        return data.jobs;
      }
      if (sql.includes('FROM "CodebaseSnapshot"')) {
        legacyReads += 1;
        return data.snapshots;
      }
      if (sql.includes('FROM "Page"')) {
        legacyReads += 1;
        return data.pageLinks;
      }
      throw new Error('unexpected legacy query');
    },
    async $executeRawUnsafe(sql) {
      readOnlyStatements.push(sql);
      return 0;
    },
    async $transaction(callback, options) {
      transactionOptions.push(options);
      return callback(client);
    },
  };
  return {
    client,
    legacyReadCount: () => legacyReads,
    readOnlyStatements,
    transactionOptions,
  };
}

function createFakeTargetDatabase(
  pages = emptyTargetState.pages,
  identity = { databaseName: 'agentwiki', serverAddress: '127.0.0.1', serverPort: 5432 },
  evidences = [],
) {
  const writes = [];
  let transactions = 0;
  const transactionOptions = [];
  let evidenceFindArgs = null;
  const recordWrite = (model) => async (args) => {
    writes.push({ model, args });
    return model === 'page' ? { count: 1 } : args.data;
  };
  const target = {
    space: { findUnique: async () => ({ id: 'space-1' }) },
    source: { findMany: async () => [], create: recordWrite('source') },
    ingestRun: { findMany: async () => [], create: recordWrite('ingestRun') },
    sourceVersion: { findMany: async () => [], create: recordWrite('sourceVersion') },
    sourceFileSnapshot: { findMany: async () => [], createMany: recordWrite('sourceFileSnapshot') },
    evidence: {
      findMany: async (args) => {
        evidenceFindArgs = args;
        return evidences;
      },
      createMany: recordWrite('evidence'),
    },
    page: { findMany: async () => pages, updateMany: recordWrite('page') },
    async $queryRawUnsafe(sql) {
      if (sql.includes('current_database()')) return [identity];
      return [{ pg_advisory_xact_lock: null }];
    },
    async $transaction(callback, options) {
      transactions += 1;
      transactionOptions.push(options);
      return callback(target);
    },
  };
  return {
    target,
    writes,
    transactionCount: () => transactions,
    transactionOptions,
    evidenceFindArgs: () => evidenceFindArgs,
  };
}

test('loads Evidence location and confidence before deciding a dry-run is idempotent', async () => {
  const planned = recovery.buildJobRecoveryPlan({
    job: legacyJob,
    snapshots: legacySnapshots,
    pageLinks: legacyPageLinks,
    targetState: emptyTargetState,
  });
  const malformedEvidence = {
    ...planned.records.evidences[0],
    confidence: 0.125,
  };
  const { client: source } = createFakeLegacyDatabase();
  const database = createFakeTargetDatabase(
    emptyTargetState.pages,
    undefined,
    [malformedEvidence],
  );

  const summary = await recovery.recoverLegacyDocumentData({
    source,
    target: database.target,
    apply: false,
  });

  assert.deepEqual(database.evidenceFindArgs().select, {
    id: true,
    targetPageId: true,
    sourceVersionId: true,
    runId: true,
    location: true,
    confidence: true,
  });
  assert.equal(summary.jobsBlocked, 1);
  assert.deepEqual(
    summary.conflicts[0].items.filter((conflict) => conflict.kind === 'evidence-identity'),
    [{ kind: 'evidence-identity', evidenceId: malformedEvidence.id }],
  );
});

test('dry-run reads and reports recovery operations without opening a target write transaction', async () => {
  assert.equal(typeof recovery.recoverLegacyDocumentData, 'function');
  const sourceDatabase = createFakeLegacyDatabase();
  const { target, writes, transactionCount } = createFakeTargetDatabase();

  const summary = await recovery.recoverLegacyDocumentData({
    source: sourceDatabase.client,
    target,
    apply: false,
  });

  assert.equal(summary.mode, 'dry-run');
  assert.equal(summary.jobsScanned, 1);
  assert.equal(summary.jobsReady, 1);
  assert.equal(transactionCount(), 0);
  assert.deepEqual(writes, []);
  assert.deepEqual(sourceDatabase.readOnlyStatements, [
    'SET TRANSACTION READ ONLY',
    'SET TRANSACTION READ ONLY',
  ]);
});

test('--apply writes each legacy job in one target transaction', async () => {
  const { client: source } = createFakeLegacyDatabase();
  const { target, writes, transactionCount, transactionOptions } = createFakeTargetDatabase();

  const summary = await recovery.recoverLegacyDocumentData({ source, target, apply: true });

  assert.equal(summary.mode, 'apply');
  assert.equal(summary.jobsApplied, 1);
  assert.equal(transactionCount(), 1);
  assert.deepEqual(transactionOptions, [{ maxWait: 10_000, timeout: 120_000 }]);
  assert.deepEqual(
    writes.map((write) => write.model),
    ['source', 'ingestRun', 'sourceVersion', 'sourceFileSnapshot', 'evidence', 'page', 'page'],
  );
});

test('applies 250 Page provenance updates under the extended transaction timeout', async () => {
  const pageLinks = Array.from({ length: 250 }, (_, index) => ({
    id: `scale-page-${String(index).padStart(3, '0')}`,
    documentGenerationJobId: legacyJob.id,
  }));
  const pages = pageLinks.map((page) => ({
    id: page.id,
    spaceId: legacyJob.spaceId,
    sourceId: null,
    sourceVersionId: null,
    sourcePath: null,
  }));
  const { client: source } = createFakeLegacyDatabase(undefined, {
    jobs: [legacyJob],
    snapshots: legacySnapshots,
    pageLinks,
  });
  const { target, writes, transactionOptions } = createFakeTargetDatabase(pages);

  const summary = await recovery.recoverLegacyDocumentData({ source, target, apply: true });

  assert.equal(summary.jobsApplied, 1);
  assert.equal(writes.filter((write) => write.model === 'page').length, 250);
  assert.deepEqual(transactionOptions, [{ maxWait: 10_000, timeout: 120_000 }]);
});

test('rejects the same physical PostgreSQL database before reading legacy tables', async () => {
  const identity = {
    databaseName: 'agentwiki',
    serverAddress: '127.0.0.1',
    serverPort: 5432,
  };
  const sourceDatabase = createFakeLegacyDatabase(identity);
  const { target, writes } = createFakeTargetDatabase(emptyTargetState.pages, identity);

  await assert.rejects(
    recovery.recoverLegacyDocumentData({ source: sourceDatabase.client, target, apply: false }),
    /physically different PostgreSQL databases/,
  );
  assert.equal(sourceDatabase.legacyReadCount(), 0);
  assert.deepEqual(writes, []);
});

test('CLI rejects the same database before connecting and never prints URL credentials', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/recover-legacy-document-data.mjs'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        LEGACY_DATABASE_URL: 'postgresql://legacy:SOURCE_SECRET@db.internal/agentwiki',
        DATABASE_URL: 'postgresql://target:TARGET_SECRET@db.internal/agentwiki?sslmode=require',
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different PostgreSQL databases/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SOURCE_SECRET|TARGET_SECRET/);
});

test('operations runbook documents isolated restore, dry-run, apply, and provenance verification', async () => {
  const operations = await read('../design/OPERATIONS.md');

  assert.match(operations, /isolated database/i);
  assert.match(operations, /LEGACY_DATABASE_URL/);
  assert.match(operations, /recover-legacy-document-data\.mjs/);
  assert.match(operations, /dry-run/i);
  assert.match(operations, /--apply/);
  assert.match(operations, /User" WHERE "apiKey" IS NOT NULL/);
  assert.match(operations, /canonical_hash/);
  assert.match(operations, /filesByPath/);
  assert.match(operations, /contentChecksum/);
  assert.match(operations, /LEFT JOIN/);
  assert.match(operations, /IS DISTINCT FROM/);
  assert.match(
    operations,
    /evidence\."location"->>'sourcePath' IS DISTINCT FROM page\."sourcePath"/,
  );
  assert.match(operations, /evidence_confidence_mismatch/);
  assert.match(operations, /evidence\."location"->>'linkStrategy' IS NULL/);
  assert.match(operations, /evidence\."confidence" IS NULL/);
  assert.match(operations, /high_confidence_bundle_path_mismatch/);
  assert.match(operations, /evidence_mapped_path_invalid/);
  assert.match(operations, /evidence_fallback_path_invalid/);
  assert.match(operations, /evidence_requested_path_invalid/);
  assert.match(operations, /page_missing_evidence/);
  assert.match(operations, /BEGIN LEGACY_FULLY_LINKED_COUNT/);
  assert.match(operations, /END LEGACY_FULLY_LINKED_COUNT/);
  assert.match(operations, /SourceVersion[\s\S]*SourceFileSnapshot[\s\S]*Evidence[\s\S]*Page/);
  assert.match(operations, /```\s*\n\s*## Incident response/);
});
