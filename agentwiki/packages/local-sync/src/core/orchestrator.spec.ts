import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PHASE_ORDER,
  advanceAfterWorkItem,
  appendWorkItem,
  checkpoint,
  completeWorkItem,
  failWorkItem,
  getNextWorkItem,
  isPhaseComplete,
  loadLatestCheckpoint,
  makeOrchestratorContext,
  persistCheckpoint,
  planPhaseWorkItems,
  pruneCheckpoints,
  startJob,
  transition,
  transitionOnFailure,
} from './orchestrator.js';
import { workspacePaths } from '../workspace/index.js';
import type { Recipe, SourceAdapter } from '../protocol/index.js';

const testAdapter: SourceAdapter = {
  manifest: () => ({
    adapterId: 'test',
    version: '0.1.0',
    protocolVersion: '1.0',
    inputKinds: ['directory'],
    artifactKinds: ['document'],
    supportsIncremental: false,
    permissions: ['read-source-path'],
    runtime: { kind: 'node-module' },
  }),
  inspect: async () => ({
    adapterId: 'test',
    sourcePath: '/tmp/docs',
    displayName: 'docs',
    kind: 'documents',
    estimatedArtifacts: 1,
    sourceHash: 'sh1',
  }),
  collect: async () => ({ artifacts: [], hasMore: false }),
};

const testRecipe: Recipe = {
  recipeId: 'document-library@1',
  version: '1.0',
  name: 'Document Library',
  description: 'Organize a document folder into wiki pages.',
  steps: [
    { stepId: 'discover', phase: 'discover', description: 'Inspect source', retryCount: 0 },
    { stepId: 'collect', phase: 'collect', description: 'Collect artifacts', retryCount: 0 },
    { stepId: 'organize', phase: 'organize', description: 'Organize pages', retryCount: 0 },
  ],
  constraints: {
    requireProvenance: true,
    requireEvidence: true,
    maxRepairCycles: 3,
    maxArtifactsPerWorkItem: 10,
    maxConflictFields: 20,
    sensitivityGate: 'shareable-only',
  },
  requiredArtifactKinds: ['document'],
  identityFields: ['pageId'],
  mergeStrategy: 'by-field',
};

const multiPhaseRecipe: Recipe = {
  ...testRecipe,
  recipeId: 'multi-phase@1',
  steps: [
    { stepId: 'discover', phase: 'discover', description: 'Inspect', retryCount: 0 },
    { stepId: 'collect', phase: 'collect', description: 'Collect', retryCount: 0 },
    { stepId: 'organize', phase: 'organize', description: 'Organize', retryCount: 0 },
    { stepId: 'validate', phase: 'validate', description: 'Validate', retryCount: 0 },
    { stepId: 'preview', phase: 'preview', description: 'Preview', retryCount: 0 },
    { stepId: 'confirm', phase: 'confirm', description: 'Confirm', retryCount: 0 },
  ],
};

describe('orchestrator skeleton', () => {
  it('starts a job in discover phase', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    expect(state.phase).toBe('discover');
    expect(state.recipeId).toBe('document-library@1');
    expect(state.adapterIds).toContain('test');
  });

  it('advances phase forward', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    const collected = transition(state, 'collect');
    expect(collected.phase).toBe('collect');
  });

  it('blocks backward transitions', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    const collected = transition(state, 'collect');
    expect(() => transition(collected, 'discover')).toThrow();
  });

  it('allows transition to failed from any phase', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    const failed = transition(state, 'failed');
    expect(failed.phase).toBe('failed');
  });

  it('manages work items', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    let state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    state = appendWorkItem(state, {
      type: 'inspect-adapter',
      instructions: 'Inspect the adapter',
      status: 'pending',
      maxAttempts: 3,
    });
    expect(state.workItems).toHaveLength(1);

    const next = getNextWorkItem(state);
    expect(next).not.toBeNull();
    expect(next?.type).toBe('inspect-adapter');

    state = completeWorkItem(state, next!.workItemId, { ok: true });
    expect(state.workItems[0].status).toBe('completed');
  });

  it('fails work item after max attempts', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    let state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    state = appendWorkItem(state, {
      type: 'inspect-adapter',
      instructions: 'Inspect',
      status: 'pending',
      maxAttempts: 1,
    });
    const next = getNextWorkItem(state)!;
    state = failWorkItem(state, next.workItemId, 'boom');
    expect(getNextWorkItem(state)).toBeNull();
  });

  it('generates a checkpoint', () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    const cp = checkpoint(state);
    expect(cp.checkpoint).toMatch(/^job-1:discover:/);
  });

  it('phase order is defined', () => {
    expect(PHASE_ORDER[0]).toBe('idle');
    expect(PHASE_ORDER[PHASE_ORDER.length - 1]).toBe('done');
    expect(PHASE_ORDER).toContain('discover');
    expect(PHASE_ORDER).toContain('merge');
  });
});

describe('orchestrator persistence', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'orch-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('persists and resumes a checkpoint', async () => {
    const ctx = makeOrchestratorContext([testAdapter], [testRecipe]);
    const paths = workspacePaths(base, 'space-1');
    let state = startJob(ctx, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
    state = await persistCheckpoint(paths, state);
    expect(state.checkpoint).toBeTruthy();

    const resumed = await loadLatestCheckpoint(paths, 'job-1');
    expect(resumed?.jobId).toBe('job-1');
    expect(resumed?.phase).toBe('discover');
  });

  it('prunes old checkpoints keeping the newest', async () => {
    makeOrchestratorContext([testAdapter], [testRecipe], () => new Date('2024-01-01T00:00:00Z'));
    const paths = workspacePaths(base, 'space-1');
    for (let i = 0; i < 5; i++) {
      const date = new Date(`2024-01-01T00:00:0${i}Z`);
      const ctxNow = makeOrchestratorContext([testAdapter], [testRecipe], () => date);
      const state = startJob(ctxNow, 'job-1', 'space-1', 'document-library@1', ['/tmp/docs']);
      await persistCheckpoint(paths, state);
    }
    let ids = await import('../workspace/index.js').then((m) => m.listCheckpoints(paths));
    expect(ids.length).toBeGreaterThan(0);
    await pruneCheckpoints(paths, 2);
    ids = await import('../workspace/index.js').then((m) => m.listCheckpoints(paths));
    expect(ids.length).toBe(2);
  });
});

describe('orchestrator phase advancement', () => {
  it('plans work items from recipe steps', () => {
    const items = planPhaseWorkItems(multiPhaseRecipe, 'discover');
    expect(items.length).toBe(1);
    expect(items[0].type).toBe('inspect-adapter');
    expect(items[0].instructions).toBe('Inspect');
  });

  it('advances phase when all work items complete', () => {
    const ctx = makeOrchestratorContext([testAdapter], [multiPhaseRecipe]);
    let state = startJob(ctx, 'job-1', 'space-1', 'multi-phase@1', ['/tmp/docs']);
    state = appendWorkItem(state, {
      type: 'inspect-adapter',
      instructions: 'Inspect',
      status: 'pending',
      maxAttempts: 1,
    });
    const next = getNextWorkItem(state)!;
    state = completeWorkItem(state, next.workItemId, { ok: true });
    state = advanceAfterWorkItem(state);
    expect(state.phase).toBe('collect');
    expect(isPhaseComplete(state)).toBe(true);
  });

  it('stays in phase when pending work remains', () => {
    const ctx = makeOrchestratorContext([testAdapter], [multiPhaseRecipe]);
    let state = startJob(ctx, 'job-1', 'space-1', 'multi-phase@1', ['/tmp/docs']);
    state = appendWorkItem(state, {
      type: 'inspect-adapter',
      instructions: 'Inspect',
      status: 'pending',
      maxAttempts: 3,
    });
    state = advanceAfterWorkItem(state);
    expect(state.phase).toBe('discover');
  });

  it('transitions to failed after max failed attempts', () => {
    const ctx = makeOrchestratorContext([testAdapter], [multiPhaseRecipe]);
    let state = startJob(ctx, 'job-1', 'space-1', 'multi-phase@1', ['/tmp/docs']);
    state = appendWorkItem(state, {
      type: 'inspect-adapter',
      instructions: 'Inspect',
      status: 'pending',
      maxAttempts: 1,
    });
    const next = getNextWorkItem(state)!;
    state = failWorkItem(state, next.workItemId, 'boom');
    state = transitionOnFailure(state);
    expect(state.phase).toBe('failed');
  });
});
