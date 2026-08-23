import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSpaceWorkspace, isWorkspaceInitialized, setBaseRevision, resolveAgentWikiHome, stableSpaceId, workspacePaths } from './index.js';

describe('space workspace', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'agentwiki-home-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('initializes all directories and a manifest', async () => {
    const space = await initSpaceWorkspace(home, 'space-1');
    const paths = workspacePaths(home, 'space-1');
    expect(space.paths.root).toBe(paths.root);
    expect(await isWorkspaceInitialized(home, 'space-1')).toBe(true);
  });

  it('does not overwrite an existing manifest', async () => {
    const first = await initSpaceWorkspace(home, 'space-1');
    await setBaseRevision(home, 'space-1', 'rev-1', 'hash-1');
    const second = await initSpaceWorkspace(home, 'space-1');
    expect(second.paths.root).toBe(first.paths.root);
  });

  it('updates base revision', async () => {
    await initSpaceWorkspace(home, 'space-1');
    await setBaseRevision(home, 'space-1', 'rev-1', 'hash-1');
  });

  it('resolves a custom home override', () => {
    expect(resolveAgentWikiHome('/custom')).toBe('/custom');
  });

  it('produces a stable space id from a name', () => {
    expect(stableSpaceId('my space')).toBe(stableSpaceId('my space'));
    expect(stableSpaceId('my space')).not.toBe(stableSpaceId('other space'));
  });

  it.each([
    '../Documents',
    '..\\Documents',
    '/tmp/escaped',
    '.',
    'space/id',
    `space-${'x'.repeat(100)}`,
    'space\u0000id',
  ])('rejects unsafe space ids before deriving workspace paths: %j', (spaceId) => {
    expect(() => workspacePaths(home, spaceId)).toThrow('Invalid Space id');
  });
});
