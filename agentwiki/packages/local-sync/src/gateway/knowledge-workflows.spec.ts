import { describe, expect, it, vi } from 'vitest';
import { KnowledgeWorkflows, createInMemoryPreviewStore, type PrepareFn, type RemoteSync } from './knowledge-workflows.js';
import { assertKnowledgeBundle, type KnowledgeBundle } from '../protocol/bundle.js';

function bundle(): KnowledgeBundle {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'code-wiki@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [{
      pageId: 'page-1', spaceId: 'space-1', path: 'architecture/overview.md', title: 'Overview', body: '# Overview',
      artifactIds: ['artifact-1'], contentHash: 'hash-1', updatedAt: '2026-08-11T00:00:00.000Z',
    }],
    memories: [], relations: [],
    provenance: [{ itemId: 'page-1', artifactIds: ['artifact-1'], sensitivity: 'shareable' }],
    deletions: [],
  };
}

function mockDeps(overrides?: {
  prepare?: Partial<Awaited<ReturnType<PrepareFn>>>;
  remoteConflict?: boolean;
  remoteRevision?: string;
}) {
  const remoteCalls: string[] = [];
  let pushed: unknown;
  const remote: RemoteSync = {
    pull: vi.fn(async () => {
      remoteCalls.push('pull');
      return { revisionId: overrides?.remoteRevision ?? '0' };
    }),
    push: vi.fn(async (_spaceId, value) => {
      remoteCalls.push('push');
      pushed = value;
      return { conflict: overrides?.remoteConflict ?? false, revisionId: 'rev-2' };
    }),
  };
  const prepare: PrepareFn = vi.fn(async () => ({
    envelope: { documents: [{ path: 'a.ts', contentHash: 'h1' }] },
    sourceKey: 'src-1',
    processedFiles: 5,
    skippedFiles: [{ path: 'x', reason: 'binary' }],
    bundle: bundle(),
    ...overrides?.prepare,
  })) as PrepareFn;
  return { prepare, remote, remoteCalls, previews: createInMemoryPreviewStore(), pushed: () => pushed };
}

describe('KnowledgeWorkflows.prepare', () => {
  it('persists a preview with a stable hash and makes zero network calls', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const result = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    expect(result.jobId).toHaveLength(36); // UUID
    expect(result.previewHash).toHaveLength(64); // sha256
    expect(result.summary.filesProcessed).toBe(5);
    expect(result.summary.filesSkipped).toBe(1);
    expect(deps.remoteCalls).toEqual([]); // zero network
    expect(deps.prepare).toHaveBeenCalledTimes(1);
  });

  it('produces the same hash for identical content', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const a = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    const b = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    expect(a.previewHash).toBe(b.previewHash);
  });
});

describe('KnowledgeWorkflows.confirmAndSync', () => {
  it('pulls before pushing in the correct order', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    const result = await wf.confirmAndSync({
      jobId: preview.jobId,
      previewHash: preview.previewHash,
      confirmed: true,
    });
    expect(result.synced).toBe(true);
    expect(result.revisionId).toBe('rev-2');
    expect(deps.remoteCalls).toEqual(['pull', 'push']);
    expect(() => assertKnowledgeBundle(deps.pushed())).not.toThrow();
  });

  it('removes the preview after a successful sync', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    await wf.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true });
    const second = await wf.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true }).catch((e) => e);
    expect(second).toMatchObject({ code: 'PREVIEW_CHANGED' });
  });

  it('rejects an unconfirmed sync', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    await expect(
      wf.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: false }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
  });

  it('rejects a changed preview hash', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    await expect(
      wf.confirmAndSync({ jobId: preview.jobId, previewHash: 'wronghash', confirmed: true }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
  });

  it('rejects an expired/missing preview', async () => {
    const deps = mockDeps();
    const wf = new KnowledgeWorkflows(deps);
    await expect(
      wf.confirmAndSync({ jobId: 'nonexistent', previewHash: 'h', confirmed: true }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
  });

  it('blocks on a three-way conflict', async () => {
    const deps = mockDeps({ remoteConflict: true });
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    await expect(
      wf.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true }),
    ).rejects.toMatchObject({ code: 'SYNC_CONFLICT' });
  });

  it('rejects the saved preview when the authoritative revision changed before confirmation', async () => {
    const deps = mockDeps({ remoteRevision: 'rev-new' });
    const wf = new KnowledgeWorkflows(deps);
    const preview = await wf.prepare({ spaceId: 'space-1', sourcePaths: ['.'] });
    await expect(
      wf.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true }),
    ).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    expect(deps.remote.push).not.toHaveBeenCalled();
  });
});

describe('KnowledgeWorkflows.pull', () => {
  it('refreshes from the authoritative revision', async () => {
    const deps = mockDeps({ remoteRevision: 'rev-1' });
    const wf = new KnowledgeWorkflows(deps);
    const result = await wf.pull({ spaceId: 'space-1' });
    expect(result.revisionId).toBe('rev-1');
    expect(deps.remoteCalls).toEqual(['pull']);
  });
});
