import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveConfig, saveCredentials } from '../config.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { workspacePaths } from '../workspace/layout.js';
import { ensureWorkspace, initManifest, readManifest, writeBase, writeManifest } from '../workspace/state.js';
import { createGatewayEntry } from './entry.js';

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

it.each(['pull', 'prepare'])('isolates old device tree state and preserves dirty files when the first operation is %s', async (firstOperation) => {
  const home = await mkdtemp(join(tmpdir(), 'aw-old-tree-')); homes.push(home);
  const connection = { id: 'a', serverUrl: 'https://wiki.test/api', agentId: 'agent-a', credentialId: 'cred-a', pluginVersion: '0.13.1', client: 'codex' as const, mcpName: 'agentwiki', spaceId: 'space-a' };
  await saveConfig(home, { version: 1, connections: { a: connection } });
  await saveCredentials(home, { version: 2, credentials: { 'cred-a': { apiKey: 'agent-key', syncDeviceCredential: 'human-device-key' } } });
  const legacy = workspacePaths(home, 'space-a');
  await ensureWorkspace(legacy);
  const manifest = await initManifest(legacy, 'space-a');
  await writeManifest(legacy, { ...manifest, baseRevision: { revision: 'old-tree-revision', contentHash: 'old-tree-hash', pulledAt: new Date().toISOString() } });
  await writeBase(legacy, 'old-tree-revision', { protocolVersion: '2', spaceId: 'space-a', folders: [], pages: [] });
  const dirty = join(legacy.pagesDir, 'unsynced-user-edit.md'); await writeFile(dirty, '# Human edit\nDo not lose this unsynced text.');
  const beforeManifest = await readFile(legacy.manifestFile, 'utf8');
  const beforeDirty = await readFile(dirty, 'utf8');
  const credentials = await readFile(join(home, '.agentwiki/credentials.json'), 'utf8');
  vi.spyOn(AgentWikiClient.prototype, 'access').mockResolvedValue({ access: [{ id: 'agent-a', name: 'Agent', status: 'active', credentialScope: 'agent', grants: [{ role: 'publisher', space: { id: 'space-a', name: 'A' } }], credentials: [{ id: 'cred-a', active: true, credentialScope: 'agent' }] }] });
  vi.spyOn(AgentWikiClient.prototype, 'getRevisionHead').mockImplementation(async (_connection, key) => {
    expect(key).toBe('agent-key'); return { revisionId: 'new-agent-revision', sequence: 2, contentHash: 'new-hash' };
  });
  const delta = vi.spyOn(AgentWikiClient.prototype, 'getDelta').mockResolvedValue({ fromRevision: 'old-tree-revision', toRevision: 'new-agent-revision', revisions: [] });
  vi.spyOn(AgentWikiClient.prototype, 'getSnapshot').mockResolvedValue({ revisionId: 'new-agent-revision', sequence: 2, contentHash: 'new-hash', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', bundle: { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId: 'space-a', baseRevision: '0', pages: [], memories: [], relations: [], deletions: [], provenance: [] } });
  const submit = vi.spyOn(AgentWikiClient.prototype, 'submitKnowledge').mockImplementation(async (_connection, key, spaceId, bundle) => {
    expect(key).toBe('agent-key'); expect(spaceId).toBe('space-a'); expect(bundle.baseRevision).toBe('new-agent-revision');
    expect(JSON.stringify(bundle)).not.toContain('Do not lose');
    return { status: 'noop', submissionId: 'submission-1', changeSetId: null, currentRevision: 'new-agent-revision' };
  });
  const tree = vi.spyOn(AgentWikiClient.prototype, 'getTreeRevisionHeadV2');
  const entry = await createGatewayEntry({ home, connectionId: 'a' });
  if (firstOperation === 'pull') {
    const pulled = await entry.handlers.pull({ spaceId: 'space-a' });
    expect(pulled).toMatchObject({ revisionId: 'new-agent-revision', workspaceMode: 'isolated_agent_knowledge', legacyWorkspacePreserved: true });
  }
  const source = join(home, 'source'); await mkdir(source); await writeFile(join(source, 'readme.md'), '# Agent knowledge\nConfirmed source.');
  const prepared = await entry.handlers.prepare({ spaceId: 'space-a', sourcePaths: [source], sourceType: 'documents' }) as { jobId: string; previewHash: string; warnings: string[] };
  expect(prepared.warnings).toContain('Existing device/tree workspace and unsynced edits were preserved. Agent knowledge uses a separate Space workspace; device edits are not automatically submitted.');
  await expect(entry.handlers.confirmAndSync({ jobId: prepared.jobId, previewHash: prepared.previewHash, confirmed: true })).resolves.toMatchObject({ synced: true, status: 'noop' });
  expect(submit).toHaveBeenCalledOnce(); expect(tree).not.toHaveBeenCalled(); expect(delta).not.toHaveBeenCalled();
  expect(await readFile(legacy.manifestFile, 'utf8')).toBe(beforeManifest);
  expect(await readFile(dirty, 'utf8')).toBe(beforeDirty);
  expect(await readFile(join(home, '.agentwiki/credentials.json'), 'utf8')).toBe(credentials);
  expect(await readManifest(workspacePaths(join(home, '.agentwiki/agent-knowledge'), 'space-a'))).toMatchObject({ spaceId: 'space-a', baseRevision: { revision: 'new-agent-revision' } });
});

it('isolates partial tree control state even when its base is unavailable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aw-old-tree-partial-')); homes.push(home);
  const legacy = workspacePaths(home, 'space-a'); await ensureWorkspace(legacy);
  await writeFile(legacy.folderIdentityFile, '{"private":"incomplete tree control state"}');
  const before = await readFile(legacy.folderIdentityFile, 'utf8');
  const { agentKnowledgeWorkspace } = await import('./agent-knowledge-workspace.js');
  expect(await agentKnowledgeWorkspace(home, 'space-a')).toEqual({ home: join(home, '.agentwiki', 'agent-knowledge'), isolated: true });
  expect(await readFile(legacy.folderIdentityFile, 'utf8')).toBe(before);
  expect(await agentKnowledgeWorkspace(home, 'space-b')).toEqual({ home, isolated: false });
});

it('keeps the chosen isolated Space after the old tree workspace is moved', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aw-old-tree-moved-')); homes.push(home);
  const isolatedHome = join(home, '.agentwiki', 'agent-knowledge');
  await ensureWorkspace(workspacePaths(isolatedHome, 'space-a'));
  const { agentKnowledgeWorkspace } = await import('./agent-knowledge-workspace.js');
  expect(await agentKnowledgeWorkspace(home, 'space-a')).toEqual({ home: isolatedHome, isolated: true });
});

it('fails closed when a referenced legacy base is missing and preserves dirty files before remote sync or preparation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aw-old-base-missing-')); homes.push(home);
  const connection = { id: 'a', serverUrl: 'https://wiki.test/api', agentId: 'agent-a', credentialId: 'cred-a', pluginVersion: '0.13.1', client: 'codex' as const, mcpName: 'agentwiki', spaceId: 'space-a' };
  await saveConfig(home, { version: 1, connections: { a: connection } });
  await saveCredentials(home, { version: 2, credentials: { 'cred-a': { apiKey: 'agent-key' } } });
  const legacy = workspacePaths(home, 'space-a'); await ensureWorkspace(legacy);
  const manifest = await initManifest(legacy, 'space-a');
  await writeManifest(legacy, { ...manifest, baseRevision: { revision: 'lost-base', contentHash: 'old-hash', pulledAt: new Date().toISOString() } });
  const dirty = join(legacy.pagesDir, 'dirty.md'); await writeFile(dirty, 'Unsynced legacy edit must survive.');
  const beforeManifest = await readFile(legacy.manifestFile, 'utf8');
  vi.spyOn(AgentWikiClient.prototype, 'access').mockResolvedValue({ access: [{ id: 'agent-a', name: 'Agent', status: 'active', grants: [{ role: 'publisher', space: { id: 'space-a', name: 'A' } }], credentials: [{ id: 'cred-a', active: true }] }] });
  const head = vi.spyOn(AgentWikiClient.prototype, 'getRevisionHead');
  const entry = await createGatewayEntry({ home, connectionId: 'a' });
  await expect(entry.handlers.pull({ spaceId: 'space-a' })).rejects.toMatchObject({ code: 'AGENT_KNOWLEDGE_BASE_MISSING' });
  await expect(entry.handlers.prepare({ spaceId: 'space-a', sourcePaths: ['/unused'], sourceType: 'documents' })).rejects.toMatchObject({ code: 'AGENT_KNOWLEDGE_BASE_MISSING' });
  expect(head).not.toHaveBeenCalled();
  expect(await readFile(legacy.manifestFile, 'utf8')).toBe(beforeManifest);
  expect(await readFile(dirty, 'utf8')).toBe('Unsynced legacy edit must survive.');
});
