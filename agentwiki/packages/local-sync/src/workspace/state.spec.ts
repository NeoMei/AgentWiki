import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspacePaths, ensureWorkspace, initManifest, readManifest, writeCheckpoint, readCheckpoint, listCheckpoints, writeDraft, readDraft, listDrafts, writeBase, readBase, appendProvenance, readProvenance, writeWikiPage, readWikiPage, listWikiPages, writeWikiMemory, readWikiMemory, writeWikiRelations, readWikiRelations } from './index.js';
import { assertLocalManifest } from './manifest.js';
import { JobStateSchema } from '../protocol/job.js';

describe('workspace state persistence', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'agentwiki-local-sync-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('creates all workspace directories', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    const manifest = await readManifest(paths);
    expect(manifest).toBeNull();
  });

  it('initializes and reads a manifest', async () => {
    const paths = workspacePaths(base, 'space-1');
    const created = await initManifest(paths, 'space-1', '2024-01-01T00:00:00Z');
    expect(created.spaceId).toBe('space-1');

    const read = await readManifest(paths);
    expect(read?.schemaVersion).toBe('1.0');
    expect(read?.baseRevision).toBeNull();
  });

  it('rejects a malformed manifest file', async () => {
    const paths = workspacePaths(base, 'space-1');
    await initManifest(paths, 'space-1', '2024-01-01T00:00:00Z');
    expect(() =>
      assertLocalManifest({ schemaVersion: '1.0', spaceId: 'space-1', createdAt: 'bad', updatedAt: 'bad', baseRevision: null, pendingRevision: null, sources: [], checkpoints: [] }),
    ).toThrow();
  });

  it('writes and reads checkpoints', async () => {
    const paths = workspacePaths(base, 'space-1');
    const state: import('../protocol/job.js').JobState = {
      jobId: 'job-1',
      spaceId: 'space-1',
      recipeId: 'recipe-1',
      recipeVersion: '1.0',
      phase: 'discover',
      adapterIds: ['a'],
      sourcePaths: ['/tmp'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      workItems: [],
    };
    const id = await writeCheckpoint(paths, JobStateSchema.parse(state));
    expect(id).toContain('job-1:discover');

    const ids = await listCheckpoints(paths);
    expect(ids).toContain(id);

    const loaded = await readCheckpoint(paths, id);
    expect(loaded?.jobId).toBe('job-1');
  });

  it('writes and reads drafts', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeDraft(paths, 'd1', { title: 'Draft' });
    const loaded = await readDraft(paths, 'd1');
    expect(loaded).toEqual({ title: 'Draft' });
    expect(await listDrafts(paths)).toContain('d1');
  });

  it('writes and reads base revisions', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeBase(paths, 'rev-1', { revision: 1 });
    expect(await readBase(paths, 'rev-1')).toEqual({ revision: 1 });
    expect(await readBase(paths, 'rev-2')).toBeNull();
  });

  it('appends provenance', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await appendProvenance(paths, [{ action: 'a' }]);
    await appendProvenance(paths, [{ action: 'b' }]);
    const all = await readProvenance(paths);
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({ action: 'b' });
  });

  it('writes and reads wiki pages', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiPage(paths, 'p1', '# Hello');
    expect(await readWikiPage(paths, 'p1')).toBe('# Hello');
    expect(await listWikiPages(paths)).toContain('p1');
  });

  it('writes and reads wiki memories', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiMemory(paths, 'm1', { content: 'x' });
    expect(await readWikiMemory(paths, 'm1')).toEqual({ content: 'x' });
  });

  it('writes and reads wiki relations', async () => {
    const paths = workspacePaths(base, 'space-1');
    await ensureWorkspace(paths);
    await writeWikiRelations(paths, [{ a: 1 }]);
    expect(await readWikiRelations(paths)).toEqual([{ a: 1 }]);
  });
});
