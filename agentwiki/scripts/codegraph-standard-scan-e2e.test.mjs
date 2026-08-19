#!/usr/bin/env node
/**
 * Gated acceptance for the real, independently installed CodeGraph CLI.
 *
 * This intentionally proves only the local scanner is real. Remote review and
 * publish are represented by the smallest controlled RemoteSync seam because
 * this repository has no disposable AgentWiki review server fixture.
 */
import { execFileSync } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { accessSync, constants, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptsRoot, '..');
const fixtureRoot = join(scriptsRoot, 'codegraph-standard-scan-fixture');
const rawSourceSentinel = 'AW_E2E_RAW_SOURCE_BODY_MUST_NOT_LEAVE_FIXTURE';
const credentialCanary = 'sk_FAKE_AW_E2E_CREDENTIAL_41a7c9';
const diagnosticCanary = 'AW_E2E_LOCAL_DIAGNOSTIC_72f9e1';
const gateEnabled = process.env.AGENTWIKI_CODEGRAPH_E2E === '1';

function codeGraphBin() {
  if (process.env.AGENTWIKI_CODEGRAPH_BIN) return realpathSync(resolve(process.env.AGENTWIKI_CODEGRAPH_BIN));
  for (const segment of (process.env.PATH ?? '').split(delimiter)) {
    if (!segment) continue;
    const candidate = join(segment, 'codegraph');
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through PATH. Enabling the gate without an installed scanner
      // is a hard test failure, not a skip.
    }
  }
  throw new Error('AGENTWIKI_CODEGRAPH_E2E=1 requires an independently installed codegraph executable on PATH or AGENTWIKI_CODEGRAPH_BIN');
}

function scannerVersion(bin) {
  return execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function assertAbsent(path) {
  await assert.rejects(access(path, constants.F_OK));
}

function assertPrivatePayload(value, forbidden) {
  const rendered = JSON.stringify(value);
  for (const token of forbidden) assert.equal(rendered.includes(token), false, `private token leaked: ${token}`);
}

async function loadLocalRuntime() {
  const dist = join(repositoryRoot, 'packages', 'local-sync', 'dist');
  return {
    createCodeGraphProvider: (await import(join(dist, 'codegraph', 'provider.js'))).createCodeGraphProvider,
    CodeSnapshotStore: (await import(join(dist, 'codegraph', 'snapshot-store.js'))).CodeSnapshotStore,
    CodeGraphPipeline: (await import(join(dist, 'codegraph', 'pipeline.js'))).CodeGraphPipeline,
    createKnowledgeWorkflowRuntime: (await import(join(dist, 'gateway', 'workflow-runtime.js'))).createKnowledgeWorkflowRuntime,
    workspacePaths: (await import(join(dist, 'workspace', 'layout.js'))).workspacePaths,
    ensureWorkspace: (await import(join(dist, 'workspace', 'state.js'))).ensureWorkspace,
    writeBase: (await import(join(dist, 'workspace', 'state.js'))).writeBase,
    writeManifest: (await import(join(dist, 'workspace', 'state.js'))).writeManifest,
  };
}

test('gated real CodeGraph standard scan keeps private scanner and source data local', { skip: gateEnabled ? false : 'set AGENTWIKI_CODEGRAPH_E2E=1 to run the independently installed CodeGraph acceptance' }, async () => {
  const bin = codeGraphBin();
  const detectedVersion = scannerVersion(bin); // Diagnostic only: no version allowlist or equality assertion.
  assert.ok(detectedVersion.length > 0, 'installed CodeGraph must report a diagnostic version');

  const root = await mkdtemp(join(tmpdir(), 'agentwiki-codegraph-e2e-'));
  const home = join(root, 'home');
  const source = join(root, 'fixture');
  try {
    await cp(fixtureRoot, source, { recursive: true });
    assert.match(await readFile(join(source, 'src', 'index.ts'), 'utf8'), new RegExp(credentialCanary));
    const {
      createCodeGraphProvider, CodeSnapshotStore, CodeGraphPipeline, createKnowledgeWorkflowRuntime,
      workspacePaths, ensureWorkspace, writeBase, writeManifest,
    } = await loadLocalRuntime();
    const provider = createCodeGraphProvider({
      home,
      environment: { ...process.env, AGENTWIKI_CODEGRAPH_BIN: bin, AGENTWIKI_CODEGRAPH_LOCAL_DIAGNOSTIC: diagnosticCanary },
      now: () => new Date('2026-08-19T00:00:00.000Z'),
    });

    const pipeline = new CodeGraphPipeline({ home, provider });

    const plan = await pipeline.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });
    assert.ok(plan, 'real CodeGraph must return a standard local plan');
    assert.equal(plan.analysisMode, 'standard');
    assert.equal(plan.provider, 'codegraph');
    assert.equal(plan.sources.length, 1);
    assert.equal(plan.sources[0].action, 'init');
    await assertAbsent(join(source, '.codegraph'));

    const paths = workspacePaths(home, 'space-e2e');
    await ensureWorkspace(paths);
    await writeBase(paths, 'revision-before-codegraph', {
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId: 'space-e2e', baseRevision: 'revision-before-codegraph',
      pages: [{ pageId: 'legacy-overview', spaceId: 'space-e2e', path: 'code/architecture/overview.md', title: 'Codebase architecture', body: 'retired generated overview', artifactIds: ['legacy-artifact'], contentHash: 'legacy-hash', updatedAt: '2026-08-19T00:00:00.000Z' }],
      memories: [], relations: [], provenance: [{ itemId: 'legacy-overview', artifactIds: ['legacy-artifact'], sensitivity: 'shareable' }], deletions: [],
    });
    await writeManifest(paths, {
      schemaVersion: '1.0', spaceId: 'space-e2e', createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:00.000Z',
      baseRevision: { revision: 'revision-before-codegraph', contentHash: 'base-hash', pulledAt: '2026-08-19T00:00:00.000Z' }, pendingRevision: null, sources: [], checkpoints: [],
    });

    const published = [];
    let generatedArtifacts = [];
    const scanSources = {
      plan: (input) => pipeline.plan(input),
      collect: async (input) => {
        const collected = await pipeline.collect(input);
        generatedArtifacts = collected.artifacts;
        return collected;
      },
    };
    const runtime = createKnowledgeWorkflowRuntime({
      home,
      scanSources,
      adapters: { ensure: async () => { throw new Error('standard code flow must not install a document adapter'); } },
      sync: {
        pull: async () => ({ revisionId: 'revision-before-codegraph' }),
        push: async (_spaceId, bundle) => {
          published.push(bundle);
          return { conflict: false, revisionId: 'revision-after-codegraph', status: 'published', submissionId: 'controlled-remote-review' };
        },
      },
      now: () => new Date('2026-08-19T00:00:00.000Z'),
    });

    const preview = await runtime.prepare({
      spaceId: 'space-e2e', sourcePaths: [source], sourceType: 'code', analysisMode: 'standard',
      localScanPlanHash: plan.localScanPlanHash, confirmedLocalScan: true,
    });
    await access(join(source, '.codegraph'), constants.F_OK);
    assert.ok(preview.jobId);
    assert.ok(preview.previewHash);
    assert.equal(preview.diff?.deleted, 0, 'a legacy-looking tuple has no verifiable ownership and must be retained');
    assert.ok(preview.warnings.some((warning) => /^Legacy migration candidate retained: legacy-[a-f0-9]{12}$/u.test(warning)));
    assert.ok(generatedArtifacts.length > 0, 'real snapshot analysis must produce SourceArtifacts');
    assert.ok(generatedArtifacts.every((artifact) => artifact.adapterId === 'agentwiki-codegraph-generated'));

    const snapshot = await new CodeSnapshotStore({ home }).read(plan.sources[0].sourceKey);
    assert.ok(snapshot);
    assert.equal(snapshot.manifest.schemaVersion, 'agentwiki-code-snapshot@1');
    assert.equal(snapshot.manifest.counts.files, 1);
    assert.equal(snapshot.files.length, 1);
    assert.equal(snapshot.files[0].path, 'src/index.ts');

    const previewFile = join(home, '.agentwiki', 'runtime', 'previews', `${preview.jobId}.json`);
    const previewPayload = JSON.parse(await readFile(previewFile, 'utf8'));
    assert.equal(previewPayload.data.schemaVersion, 'knowledge-bundle@1');
    assert.match(JSON.stringify(previewPayload), /Repository overview/);
    assert.ok(previewPayload.data.provenance.length > 0, 'generated artifacts must be represented in the KnowledgeBundle provenance');
    assert.ok(previewPayload.data.pages.some((item) => item.pageId === 'legacy-overview'));
    assert.ok(!previewPayload.data.deletions.some((item) => item.itemId === 'legacy-overview'));
    assert.equal(published.length, 0, 'Preview must remain upload-free before the separate sync confirmation');

    const synced = await runtime.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true });
    assert.deepEqual(synced, { revisionId: 'revision-after-codegraph', synced: true, status: 'published', submissionId: 'controlled-remote-review' });
    assert.equal(published.length, 1, 'controlled remote seam receives only the explicitly confirmed Preview bundle');

    const localOutputs = { snapshot, preview: previewPayload, controlledRemotePublish: published };
    const privacyAuditTokens = [
      root,
      rawSourceSentinel,
      credentialCanary,
      diagnosticCanary,
      '.codegraph/codegraph.db',
      bin,
      'AGENTWIKI_CODEGRAPH_BIN',
    ];
    assert.equal(privacyAuditTokens.includes(credentialCanary), true, 'credential canary must be part of the real payload audit');
    assert.equal(privacyAuditTokens.includes(diagnosticCanary), true, 'diagnostic canary must be part of the real payload audit');
    assertPrivatePayload(localOutputs, privacyAuditTokens);
    const lockfile = await readFile(join(repositoryRoot, 'pnpm-lock.yaml'), 'utf8');
    assert.equal(lockfile.includes('@colbymchenry/codegraph'), false, 'AgentWiki must not depend on CodeGraph');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
