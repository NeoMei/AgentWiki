import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function digest(algorithm, value) {
  return createHash(algorithm).update(value).digest('hex');
}

function deterministicId(prefix, value) {
  return `${prefix}-${digest('sha256', value).slice(0, 24)}`;
}

function databaseIdentity(value, label) {
  if (!value) {
    throw new Error(`${label} is required`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${label} must be a PostgreSQL URL`);
  }

  const host = (parsed.hostname || parsed.searchParams.get('host') || '').toLowerCase();
  const port = parsed.port || '5432';
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!host || !database) {
    throw new Error(`${label} must identify a PostgreSQL host and database`);
  }

  return `${host}:${port}/${database}`;
}

export function assertDistinctDatabaseUrls(sourceDatabaseUrl, targetDatabaseUrl) {
  const sourceIdentity = databaseIdentity(sourceDatabaseUrl, 'LEGACY_DATABASE_URL');
  const targetIdentity = databaseIdentity(targetDatabaseUrl, 'DATABASE_URL');
  if (sourceIdentity === targetIdentity) {
    throw new Error('LEGACY_DATABASE_URL and DATABASE_URL must identify different PostgreSQL databases');
  }
}

export function parseCliOptions(argv, env = process.env) {
  for (const argument of argv) {
    if (argument !== '--apply') {
      throw new Error('Unknown argument; only --apply is supported');
    }
  }

  const sourceDatabaseUrl = env.LEGACY_DATABASE_URL;
  const targetDatabaseUrl = env.DATABASE_URL;
  assertDistinctDatabaseUrls(sourceDatabaseUrl, targetDatabaseUrl);

  return {
    apply: argv.includes('--apply'),
    sourceDatabaseUrl,
    targetDatabaseUrl,
  };
}

function legacyRunState(status) {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'cancelled';
}

function explicitPageSourcePath(result, pageId) {
  const direct = result?.pageSources?.[pageId];
  if (typeof direct === 'string' && direct.length > 0) return direct;

  for (const collection of [result?.pages, result?.generatedPages]) {
    if (!Array.isArray(collection)) continue;
    const entry = collection.find((candidate) => candidate?.pageId === pageId || candidate?.id === pageId);
    const candidatePath = entry?.sourcePath ?? entry?.filePath ?? entry?.path;
    if (typeof candidatePath === 'string' && candidatePath.length > 0) return candidatePath;
  }

  return null;
}

function pageSourcePath(job, pageId, snapshots) {
  const explicit = explicitPageSourcePath(job.result, pageId);
  if (explicit && snapshots.some((snapshot) => snapshot.filePath === explicit)) {
    return {
      path: explicit,
      strategy: 'legacy-result',
      bundlePath: explicit,
      confidence: 1,
      requestedPath: null,
    };
  }
  if (explicit) {
    return {
      path: null,
      strategy: 'legacy-result-path-missing-snapshot',
      bundlePath: null,
      confidence: 0.25,
      requestedPath: explicit,
    };
  }
  if (snapshots.length === 1) {
    return {
      path: snapshots[0].filePath,
      strategy: 'single-snapshot',
      bundlePath: snapshots[0].filePath,
      confidence: 0.75,
      requestedPath: null,
    };
  }
  return {
    path: null,
    strategy: 'synthetic-page-link',
    bundlePath: null,
    confidence: 0.5,
    requestedPath: null,
  };
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, comparable(value[key])]));
  }
  return value ?? null;
}

function equalFields(existing, planned, fields) {
  return fields.every((field) =>
    JSON.stringify(comparable(existing[field])) === JSON.stringify(comparable(planned[field])));
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function buildJobRecoveryPlan({ job, snapshots, pageLinks, targetState }) {
  const orderedSnapshots = [...snapshots].sort((left, right) =>
    compareText(left.filePath, right.filePath) || compareText(left.id, right.id));
  const orderedPageLinks = [...pageLinks].sort((left, right) => compareText(left.id, right.id));
  const sourceId = `legacy-source-${job.id}`;
  const runId = `legacy-run-${job.id}`;
  const sourceVersionId = deterministicId('legacy-source-version', job.id);

  const filesByPath = Object.fromEntries(orderedSnapshots.map((snapshot) => [
    snapshot.filePath,
    {
      legacySnapshotId: snapshot.id,
      contentHash: snapshot.fileHash,
      content: snapshot.content,
      contentChecksum: `md5:${digest('md5', snapshot.content ?? '')}`,
    },
  ]));
  const content = JSON.stringify({
    format: 'agentwiki/legacy-codebase-snapshot-bundle@1',
    legacyJobId: job.id,
    filesByPath,
  });
  const contentHash = digest('sha256', content);

  const source = {
    id: sourceId,
    type: job.repoUrl ? 'git' : 'legacy-local-path',
    name: `Legacy document job ${job.id}`,
    uri: job.repoUrl,
    status: job.repoUrl ? 'active' : 'archived',
    contentHash: digest('md5', job.repoUrl ?? job.repoPath ?? job.id),
    config: { legacyJobId: job.id, gitHead: job.gitHead ?? null },
    spaceId: job.spaceId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    archivedAt: job.repoUrl ? null : job.updatedAt,
  };
  const runState = legacyRunState(job.status);
  const run = {
    id: runId,
    idempotencyKey: `legacy-document-job:${job.id}`,
    status: runState,
    stage: runState,
    attempts: job.attempts ?? 0,
    maxAttempts: job.maxAttempts ?? 3,
    error: job.error ?? (runState === 'cancelled' ? 'Legacy queue retired during migration' : null),
    result: { ...(job.result ?? {}), legacyJobId: job.id, recoveryFormat: 1 },
    sourceId,
    spaceId: job.spaceId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: runState === 'cancelled' ? null : job.updatedAt,
  };
  const sourceVersion = {
    id: sourceVersionId,
    version: 1,
    content,
    contentHash,
    metadata: {
      legacyJobId: job.id,
      legacyGitHead: job.gitHead ?? null,
      contentFormat: 'agentwiki/legacy-codebase-snapshot-bundle@1',
      fileCount: orderedSnapshots.length,
    },
    sourceId,
    createdAt: job.updatedAt,
  };
  const fileSnapshots = orderedSnapshots.map((snapshot) => ({
    id: deterministicId('legacy-file-snapshot', `${job.id}\0${snapshot.filePath}`),
    path: snapshot.filePath,
    contentHash: snapshot.fileHash,
    size: Buffer.byteLength(snapshot.content ?? '', 'utf8'),
    commit: job.gitHead ?? null,
    sourceVersionId,
    createdAt: snapshot.createdAt,
  }));
  const pageProvenance = orderedPageLinks.map((page) => {
    const resolved = pageSourcePath(job, page.id, orderedSnapshots);
    return {
      pageId: page.id,
      spaceId: job.spaceId,
      sourceId,
      sourceVersionId,
      sourcePath: resolved.path,
      linkStrategy: resolved.strategy,
      bundlePath: resolved.bundlePath,
      confidence: resolved.confidence,
      requestedPath: resolved.requestedPath,
    };
  });
  const evidences = pageProvenance.map((page) => {
    const location = {
      legacyJobId: job.id,
      sourcePath: page.sourcePath,
      linkStrategy: page.linkStrategy,
      bundlePath: page.bundlePath,
    };
    if (page.requestedPath) location.requestedPath = page.requestedPath;
    return {
      id: deterministicId('legacy-evidence', `${job.id}\0${page.pageId}`),
      quote: null,
      location,
      confidence: page.confidence,
      targetPageId: page.pageId,
      targetRelationId: null,
      sourceVersionId,
      runId,
      createdAt: job.updatedAt,
    };
  });

  const conflicts = [];
  const sources = targetState.sources ?? [];
  const runs = targetState.runs ?? [];
  const sourceVersions = targetState.sourceVersions ?? [];
  const existingFileSnapshots = targetState.fileSnapshots ?? [];
  const existingEvidences = targetState.evidences ?? [];
  const targetPages = targetState.pages ?? [];

  if (targetState.space === null) {
    conflicts.push({ kind: 'missing-space', spaceId: job.spaceId });
  }

  const snapshotPathCounts = new Map();
  for (const snapshot of orderedSnapshots) {
    snapshotPathCounts.set(snapshot.filePath, (snapshotPathCounts.get(snapshot.filePath) ?? 0) + 1);
  }
  for (const [path, snapshotCount] of [...snapshotPathCounts.entries()].sort()) {
    if (snapshotCount > 1) {
      conflicts.push({ kind: 'duplicate-snapshot-path', path, snapshotCount });
    }
  }

  const pagesBySourcePath = new Map();
  for (const page of pageProvenance) {
    if (page.sourcePath === null) continue;
    const pageIds = pagesBySourcePath.get(page.sourcePath) ?? [];
    pageIds.push(page.pageId);
    pagesBySourcePath.set(page.sourcePath, pageIds);
  }
  const duplicatePageSourcePaths = new Set();
  for (const [sourcePath, pageIds] of [...pagesBySourcePath.entries()].sort()) {
    if (pageIds.length > 1) {
      duplicatePageSourcePaths.add(sourcePath);
      conflicts.push({ kind: 'duplicate-page-source-path', sourcePath, pageIds });
    }
  }

  const existingSource = sources.find((candidate) => candidate.id === source.id);
  const sourceUniqueCollision = sources.find((candidate) =>
    candidate.spaceId === source.spaceId
    && candidate.type === source.type
    && candidate.contentHash === source.contentHash
    && candidate.id !== source.id);
  let createSource = source;
  if (existingSource) {
    createSource = null;
    if (!equalFields(existingSource, source, ['type', 'spaceId', 'contentHash', 'uri'])) {
      conflicts.push({ kind: 'source-identity', sourceId: source.id });
    }
  } else if (sourceUniqueCollision) {
    createSource = null;
    conflicts.push({
      kind: 'source-unique-key',
      sourceId: source.id,
      existingSourceId: sourceUniqueCollision.id,
    });
  }

  const existingRun = runs.find((candidate) => candidate.id === run.id);
  const runUniqueCollision = runs.find((candidate) =>
    candidate.sourceId === run.sourceId
    && candidate.idempotencyKey === run.idempotencyKey
    && candidate.id !== run.id);
  let createRun = run;
  if (existingRun) {
    createRun = null;
    if (!equalFields(existingRun, run, ['sourceId', 'spaceId'])) {
      conflicts.push({ kind: 'run-identity', runId: run.id });
    }
  } else if (runUniqueCollision) {
    createRun = null;
    conflicts.push({ kind: 'run-unique-key', runId: run.id, existingRunId: runUniqueCollision.id });
  }

  const existingVersion = sourceVersions.find((candidate) => candidate.id === sourceVersion.id);
  const versionUniqueCollision = sourceVersions.find((candidate) =>
    candidate.sourceId === sourceVersion.sourceId
    && (candidate.version === sourceVersion.version || candidate.contentHash === sourceVersion.contentHash)
    && candidate.id !== sourceVersion.id);
  let createSourceVersion = sourceVersion;
  if (existingVersion) {
    createSourceVersion = null;
    if (!equalFields(existingVersion, sourceVersion, ['sourceId', 'version', 'contentHash', 'content'])) {
      conflicts.push({ kind: 'source-version-identity', sourceVersionId: sourceVersion.id });
    }
  } else if (versionUniqueCollision) {
    createSourceVersion = null;
    conflicts.push({
      kind: 'source-version-unique-key',
      sourceVersionId: sourceVersion.id,
      existingSourceVersionId: versionUniqueCollision.id,
    });
  }

  const createFileSnapshots = [];
  for (const snapshot of fileSnapshots) {
    const existing = existingFileSnapshots.find((candidate) => candidate.id === snapshot.id);
    const uniqueCollision = existingFileSnapshots.find((candidate) =>
      candidate.sourceVersionId === snapshot.sourceVersionId
      && candidate.path === snapshot.path
      && candidate.id !== snapshot.id);
    if (existing) {
      if (!equalFields(existing, snapshot, ['sourceVersionId', 'path', 'contentHash', 'size', 'commit'])) {
        conflicts.push({ kind: 'file-snapshot-identity', fileSnapshotId: snapshot.id, path: snapshot.path });
      }
    } else if (uniqueCollision) {
      conflicts.push({
        kind: 'file-snapshot-unique-key',
        fileSnapshotId: snapshot.id,
        existingFileSnapshotId: uniqueCollision.id,
        path: snapshot.path,
      });
    } else {
      createFileSnapshots.push(snapshot);
    }
  }

  const createEvidences = [];
  for (const evidence of evidences) {
    const existing = existingEvidences.find((candidate) => candidate.id === evidence.id);
    if (existing) {
      if (!equalFields(
        existing,
        evidence,
        ['targetPageId', 'sourceVersionId', 'runId', 'location', 'confidence'],
      )) {
        conflicts.push({ kind: 'evidence-identity', evidenceId: evidence.id });
      }
    } else {
      createEvidences.push(evidence);
    }
  }

  const updatePages = [];
  for (const page of pageProvenance) {
    if (duplicatePageSourcePaths.has(page.sourcePath)) continue;
    const existing = targetPages.find((candidate) => candidate.id === page.pageId);
    if (!existing) {
      conflicts.push({ kind: 'missing-page', pageId: page.pageId });
      continue;
    }
    if (existing.spaceId !== page.spaceId) {
      conflicts.push({ kind: 'page-space', pageId: page.pageId });
      continue;
    }

    const planned = {
      sourceId: page.sourceId,
      sourceVersionId: page.sourceVersionId,
      sourcePath: page.sourcePath,
    };
    const current = {
      sourceId: existing.sourceId ?? null,
      sourceVersionId: existing.sourceVersionId ?? null,
      sourcePath: existing.sourcePath ?? null,
    };
    const hasDifferentProvenance = Object.keys(planned).some((field) =>
      current[field] !== null && current[field] !== planned[field]);
    const pathCollision = targetPages.find((candidate) =>
      page.sourcePath !== null
      && candidate.id !== page.pageId
      && candidate.spaceId === page.spaceId
      && candidate.sourceId === page.sourceId
      && candidate.sourcePath === page.sourcePath);
    if (hasDifferentProvenance) {
      conflicts.push({
        kind: 'page-provenance',
        pageId: page.pageId,
        existing: current,
        planned,
      });
    } else if (pathCollision) {
      conflicts.push({
        kind: 'page-source-path-unique-key',
        pageId: page.pageId,
        existingPageId: pathCollision.id,
        sourcePath: page.sourcePath,
      });
    } else if (!equalFields(current, planned, ['sourceId', 'sourceVersionId', 'sourcePath'])) {
      updatePages.push({ ...page, before: existing });
    }
  }

  return {
    jobId: job.id,
    records: { source, run, sourceVersion, fileSnapshots, evidences, pageProvenance },
    operations: {
      createSource,
      createRun,
      createSourceVersion,
      createFileSnapshots,
      createEvidences,
      updatePages,
    },
    conflicts,
  };
}

async function loadLegacyJobs(source) {
  return source.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return transaction.$queryRawUnsafe(`
      SELECT
        job."id",
        job."status",
        job."repoUrl",
        job."repoPath",
        job."spaceId",
        job."config",
        job."result",
        job."error",
        job."gitHead",
        COALESCE((to_jsonb(job)->>'attempts')::integer, 0) AS "attempts",
        COALESCE((to_jsonb(job)->>'maxAttempts')::integer, 3) AS "maxAttempts",
        job."createdAt",
        job."updatedAt"
      FROM "DocumentGenerationJob" job
      ORDER BY job."id"
    `);
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function loadLegacyJobData(source, jobId) {
  return source.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [snapshots, pageLinks] = await Promise.all([
      transaction.$queryRawUnsafe(`
        SELECT
          snapshot."id",
          snapshot."jobId",
          snapshot."fileHash",
          snapshot."filePath",
          snapshot."content",
          snapshot."createdAt"
        FROM "CodebaseSnapshot" snapshot
        WHERE snapshot."jobId" = $1
        ORDER BY snapshot."filePath", snapshot."id"
      `, jobId),
      transaction.$queryRawUnsafe(`
        SELECT
          page."id",
          to_jsonb(page)->>'documentGenerationJobId' AS "documentGenerationJobId"
        FROM "Page" page
        WHERE to_jsonb(page)->>'documentGenerationJobId' = $1
        ORDER BY page."id"
      `, jobId),
    ]);
    return { snapshots, pageLinks };
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function databaseServerIdentity(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT
      current_database() AS "databaseName",
      COALESCE(inet_server_addr()::text, 'local-socket') AS "serverAddress",
      inet_server_port() AS "serverPort"
  `);
  if (rows.length !== 1) {
    throw new Error('Unable to verify PostgreSQL database identity');
  }
  const identity = rows[0];
  const bareAddress = String(identity.serverAddress).split('/')[0];
  const address = ['127.0.0.1', '::1'].includes(bareAddress)
    ? 'loopback'
    : bareAddress;
  return [identity.databaseName, address, String(identity.serverPort)].join('|');
}

export async function assertPhysicallyDistinctDatabases(source, target) {
  const [sourceIdentity, targetIdentity] = await Promise.all([
    databaseServerIdentity(source),
    databaseServerIdentity(target),
  ]);
  if (sourceIdentity === targetIdentity) {
    throw new Error('Legacy source and target must be physically different PostgreSQL databases');
  }
}

function emptyPlanningState(pageLinks, spaceId) {
  return {
    space: { id: spaceId },
    sources: [],
    runs: [],
    sourceVersions: [],
    fileSnapshots: [],
    evidences: [],
    pages: pageLinks.map((page) => ({
      id: page.id,
      spaceId,
      sourceId: null,
      sourceVersionId: null,
      sourcePath: null,
    })),
  };
}

async function loadTargetState(target, records) {
  const source = records.source;
  const run = records.run;
  const version = records.sourceVersion;
  const fileIds = records.fileSnapshots.map((snapshot) => snapshot.id);
  const filePaths = records.fileSnapshots.map((snapshot) => snapshot.path);
  const evidenceIds = records.evidences.map((evidence) => evidence.id);
  const pageIds = records.pageProvenance.map((page) => page.pageId);
  const pagePathKeys = records.pageProvenance
    .filter((page) => page.sourcePath !== null)
    .map((page) => ({
      spaceId: page.spaceId,
      sourceId: page.sourceId,
      sourcePath: page.sourcePath,
    }));

  const [space, sources, runs, sourceVersions, fileSnapshots, evidences, pages] = await Promise.all([
    target.space.findUnique({ where: { id: source.spaceId }, select: { id: true } }),
    target.source.findMany({
      where: {
        OR: [
          { id: source.id },
          { spaceId: source.spaceId, type: source.type, contentHash: source.contentHash },
        ],
      },
      select: { id: true, type: true, uri: true, spaceId: true, contentHash: true },
    }),
    target.ingestRun.findMany({
      where: {
        OR: [
          { id: run.id },
          { sourceId: run.sourceId, idempotencyKey: run.idempotencyKey },
        ],
      },
      select: { id: true, sourceId: true, spaceId: true, idempotencyKey: true },
    }),
    target.sourceVersion.findMany({
      where: {
        OR: [
          { id: version.id },
          { sourceId: version.sourceId, version: version.version },
          { sourceId: version.sourceId, contentHash: version.contentHash },
        ],
      },
      select: {
        id: true,
        sourceId: true,
        version: true,
        content: true,
        contentHash: true,
      },
    }),
    target.sourceFileSnapshot.findMany({
      where: {
        OR: [
          { id: { in: fileIds } },
          { sourceVersionId: version.id, path: { in: filePaths } },
        ],
      },
      select: {
        id: true,
        sourceVersionId: true,
        path: true,
        contentHash: true,
        size: true,
        commit: true,
      },
    }),
    target.evidence.findMany({
      where: { id: { in: evidenceIds } },
      select: {
        id: true,
        targetPageId: true,
        sourceVersionId: true,
        runId: true,
        location: true,
        confidence: true,
      },
    }),
    target.page.findMany({
      where: { OR: [{ id: { in: pageIds } }, ...pagePathKeys] },
      select: {
        id: true,
        spaceId: true,
        sourceId: true,
        sourceVersionId: true,
        sourcePath: true,
      },
    }),
  ]);

  return { space, sources, runs, sourceVersions, fileSnapshots, evidences, pages };
}

function operationCount(plan) {
  return Number(Boolean(plan.operations.createSource))
    + Number(Boolean(plan.operations.createRun))
    + Number(Boolean(plan.operations.createSourceVersion))
    + plan.operations.createFileSnapshots.length
    + plan.operations.createEvidences.length
    + plan.operations.updatePages.length;
}

async function writeJobRecoveryPlan(transaction, plan) {
  if (plan.conflicts.length > 0) {
    throw new Error('Refusing to write a recovery plan with conflicts');
  }

  if (plan.operations.createSource) {
    await transaction.source.create({ data: plan.operations.createSource });
  }
  if (plan.operations.createRun) {
    await transaction.ingestRun.create({ data: plan.operations.createRun });
  }
  if (plan.operations.createSourceVersion) {
    await transaction.sourceVersion.create({ data: plan.operations.createSourceVersion });
  }
  if (plan.operations.createFileSnapshots.length > 0) {
    await transaction.sourceFileSnapshot.createMany({
      data: plan.operations.createFileSnapshots,
    });
  }
  if (plan.operations.createEvidences.length > 0) {
    await transaction.evidence.createMany({ data: plan.operations.createEvidences });
  }
  const pageBatchSize = 100;
  for (let offset = 0; offset < plan.operations.updatePages.length; offset += pageBatchSize) {
    const batch = plan.operations.updatePages.slice(offset, offset + pageBatchSize);
    const results = await Promise.all(batch.map(async (update) => ({
      update,
      result: await transaction.page.updateMany({
        where: {
          id: update.pageId,
          spaceId: update.spaceId,
          sourceId: update.before.sourceId ?? null,
          sourceVersionId: update.before.sourceVersionId ?? null,
          sourcePath: update.before.sourcePath ?? null,
        },
        data: {
          sourceId: update.sourceId,
          sourceVersionId: update.sourceVersionId,
          sourcePath: update.sourcePath,
        },
      }),
    })));
    for (const { update, result } of results) {
      if (result.count !== 1) {
        throw new Error(`Page provenance changed concurrently for ${update.pageId}`);
      }
    }
  }
}

function failureCode(error) {
  return typeof error?.code === 'string' ? error.code : 'transaction_failed';
}

export async function recoverLegacyDocumentData({ source, target, apply = false }) {
  await assertPhysicallyDistinctDatabases(source, target);
  const jobs = await loadLegacyJobs(source);
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    jobsScanned: jobs.length,
    jobsReady: 0,
    jobsApplied: 0,
    jobsUnchanged: 0,
    jobsBlocked: 0,
    plannedOperations: 0,
    conflicts: [],
    failures: [],
  };

  for (const job of jobs) {
    const { snapshots, pageLinks } = await loadLegacyJobData(source, job.id);
    const seedPlan = buildJobRecoveryPlan({
      job,
      snapshots,
      pageLinks,
      targetState: emptyPlanningState(pageLinks, job.spaceId),
    });

    if (!apply) {
      const targetState = await loadTargetState(target, seedPlan.records);
      const plan = buildJobRecoveryPlan({ job, snapshots, pageLinks, targetState });
      summary.plannedOperations += operationCount(plan);
      if (plan.conflicts.length > 0) {
        summary.jobsBlocked += 1;
        summary.conflicts.push({ jobId: job.id, items: plan.conflicts });
      } else {
        summary.jobsReady += 1;
      }
      continue;
    }

    try {
      const outcome = await target.$transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          `legacy-document-recovery:${job.id}`,
        );
        const targetState = await loadTargetState(transaction, seedPlan.records);
        const plan = buildJobRecoveryPlan({ job, snapshots, pageLinks, targetState });
        if (plan.conflicts.length > 0) return { plan, wrote: false };
        const writes = operationCount(plan);
        if (writes > 0) await writeJobRecoveryPlan(transaction, plan);
        return { plan, wrote: writes > 0 };
      }, { maxWait: 10_000, timeout: 120_000 });

      summary.plannedOperations += operationCount(outcome.plan);
      if (outcome.plan.conflicts.length > 0) {
        summary.jobsBlocked += 1;
        summary.conflicts.push({ jobId: job.id, items: outcome.plan.conflicts });
      } else {
        summary.jobsReady += 1;
        if (outcome.wrote) summary.jobsApplied += 1;
        else summary.jobsUnchanged += 1;
      }
    } catch (error) {
      summary.failures.push({ jobId: job.id, code: failureCode(error) });
    }
  }

  return summary;
}

function safeCliError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (
    message.startsWith('LEGACY_DATABASE_URL')
    || message.startsWith('DATABASE_URL')
    || message.startsWith('Unknown argument')
    || message === 'Legacy source and target must be physically different PostgreSQL databases'
  ) {
    return message;
  }
  const code = typeof error?.code === 'string' ? ` (${error.code})` : '';
  return `Legacy recovery failed${code}; inspect the database logs without exposing connection URLs.`;
}

async function createDatabaseClients(sourceDatabaseUrl, targetDatabaseUrl) {
  const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
  const { PrismaClient } = requireFromServer('@prisma/client');
  return {
    source: new PrismaClient({ datasources: { db: { url: sourceDatabaseUrl } } }),
    target: new PrismaClient({ datasources: { db: { url: targetDatabaseUrl } } }),
  };
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const clients = await createDatabaseClients(
    options.sourceDatabaseUrl,
    options.targetDatabaseUrl,
  );
  try {
    const summary = await recoverLegacyDocumentData({
      source: clients.source,
      target: clients.target,
      apply: options.apply,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (summary.jobsBlocked > 0 || summary.failures.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await Promise.allSettled([clients.source.$disconnect(), clients.target.$disconnect()]);
  }
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write(`${safeCliError(error)}\n`);
    process.exitCode = 1;
  });
}
