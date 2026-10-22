import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveConfig, saveCredentials } from '../config.js';
import { createGatewayEntry } from './entry.js';
import { createGatewayServer } from './server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { workspacePaths } from '../workspace/layout.js';

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'aw-agent-identity-')); homes.push(home);
  const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.13.5', client: 'codex' as const, mcpName: 'agentwiki' };
  await saveConfig(home, { version: 1, defaultConnectionId: 'b', connections: {
    a: { ...common, id: 'a', spaceId: 'space-a', credentialId: 'cred-a' },
    b: { ...common, id: 'b', spaceId: 'space-b', credentialId: 'cred-b' },
    otherAgent: { ...common, id: 'otherAgent', agentId: 'agent-other', spaceId: 'space-c', credentialId: 'cred-c' },
    otherClient: { ...common, id: 'otherClient', client: 'claude', spaceId: 'space-d', credentialId: 'cred-d' },
    otherServer: { ...common, id: 'otherServer', serverUrl: 'https://other.test/api', spaceId: 'space-e', credentialId: 'cred-e' },
  } });
  await saveCredentials(home, { version: 2, credentials: Object.fromEntries(['a','b','c','d','e'].map((id) => [`cred-${id}`, { apiKey: `key-${id}`, ...(id === 'a' ? { syncDeviceCredential: 'device-a' } : {}) }])) });
  const grants = new Map<string, 'reader' | 'editor' | 'publisher'>([['space-a', 'reader']]);
  const calls: Array<{ key: string; tool: string; args: Record<string, unknown> }> = [];
  const access = vi.spyOn(AgentWikiClient.prototype, 'access').mockImplementation(async (connection, key) => {
    expect(connection.credentialId).toBe('cred-a'); expect(key).toBe('key-a');
    return { access: [{ id: 'agent-1', name: 'Agent', status: 'active', credentialScope: 'agent', grants: [...grants].map(([id, role]) => ({ role, scopes: [], folderScopes: [], space: { id, name: id } })), credentials: [{ id: 'cred-a', active: true, credentialScope: 'agent' }] }] };
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const key = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    expect(key).toBe('key-a');
    if (init?.method !== 'POST') return new Response('', { status: 405 });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } };
    else if (message.method === 'tools/list') result = { tools: [
      { name: 'list_spaces', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_page', inputSchema: { type: 'object', properties: { pageId: { type: 'string' }, spaceId: { type: 'string' } }, required: ['pageId'] } },
      { name: 'list_pages', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'] } },
      { name: 'propose_page', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } } } },
    ] };
    else {
      const { name: tool, arguments: args } = message.params; calls.push({ key, tool, args });
      const role = grants.get(args.spaceId);
      const denied = tool !== 'list_spaces' && (!role || (tool === 'propose_page' && role === 'reader'));
      const data = tool === 'list_spaces' ? [...grants].map(([id, role]) => ({ id, name: id, role }))
        : denied ? { code: 'FORBIDDEN' } : { space: args.spaceId, role, pageId: args.pageId ?? null };
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], isError: denied };
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  });
  return { home, calls, grants, access, entry: await createGatewayEntry({ home, connectionId: 'a' }) };
}
const data = (value: unknown) => JSON.parse((value as { content: Array<{ text: string }> }).content[0]!.text);

it('discovers new grants live through one installed Agent connection without reload or config changes', async () => {
  const { entry, grants, home } = await fixture();
  const before = await readFile(join(home, '.agentwiki/local-sync.json'), 'utf8');
  await entry.bridge.listTools();
  expect(data(await entry.bridge.callGatewayTool('wiki_list_spaces', {})).map((s: { id: string }) => s.id)).toEqual(['space-a']);
  grants.set('space-new', 'publisher');
  expect(data(await entry.bridge.callGatewayTool('wiki_list_spaces', {})).map((s: { id: string }) => s.id)).toEqual(['space-a', 'space-new']);
  expect(data(await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-new' })).space).toBe('space-new');
  expect(await readFile(join(home, '.agentwiki/local-sync.json'), 'utf8')).toBe(before);
});

it('uses the same selected identity for concurrent named and legacy MCP calls, regardless of stored default or alternate keys', async () => {
  const { entry, calls, grants } = await fixture(); grants.set('space-b', 'editor');
  const { server } = await createGatewayServer(entry);
  const [ct, st] = InMemoryTransport.createLinkedPair(); const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  await server.connect(st); await client.connect(ct);
  try {
    const results = await Promise.all([
      client.callTool({ name: 'wiki_get_page', arguments: { spaceId: 'space-a', pageId: 'page-a' } }),
      client.callTool({ name: 'wiki_get_page', arguments: { __args: { spaceId: 'space-b', pageId: 'page-b' } } }),
    ]);
    expect(results.map((r) => data(r).space)).toEqual(['space-a', 'space-b']);
    expect(calls.map((c) => c.key)).toEqual(['key-a','key-a']);
    for (const spaceId of ['space-c','space-d','space-e']) expect((await client.callTool({ name: 'wiki_list_pages', arguments: { spaceId } })).isError).toBe(true);
    expect(calls.every((c) => c.key === 'key-a')).toBe(true);
    const count = calls.length;
    expect((await client.callTool({ name: 'wiki_list_pages', arguments: { spaceId: 'space-a', __args: { spaceId: 'space-b' } } })).isError).toBe(true);
    expect(calls).toHaveLength(count);
  } finally { await client.close(); await server.close(); }
});

it('honors remote role changes and revocation without disabling other Spaces or requiring discovery first', async () => {
  const { entry, grants } = await fixture(); grants.set('space-b', 'editor');
  expect((await entry.bridge.callGatewayTool('wiki_propose_page', { spaceId: 'space-a' })).isError).toBe(true);
  grants.set('space-a', 'publisher');
  expect((await entry.bridge.callGatewayTool('wiki_propose_page', { spaceId: 'space-a' })).isError).toBe(false);
  grants.delete('space-a');
  expect((await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-a' })).isError).toBe(true);
  expect((await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-b' })).isError).toBe(false);
  expect(data(await entry.bridge.callGatewayTool('wiki_list_spaces', {})).map((s: { id: string }) => s.id)).toEqual(['space-b']);
});

it('treats the saved Space as default context only and forwards it without switching credentials', async () => {
  const { entry } = await fixture();
  expect(data(await entry.bridge.callGatewayTool('wiki_get_page', { pageId: 'page-1' })).space).toBe('space-a');
});

it('checks live grants before knowledge preparation and pull, including cached local workspaces', async () => {
  const { entry, grants, access } = await fixture();
  grants.delete('space-a');
  await expect(entry.handlers.prepare({ spaceId: 'space-a', sourcePaths: ['/unused'] })).rejects.toThrow(/Space access denied/);
  await expect(entry.handlers.pull({ spaceId: 'space-b' })).rejects.toThrow(/Space access denied/);
  expect(access).toHaveBeenCalledTimes(2);
});

it('pulls two authorized knowledge workspaces with the selected Agent key, never a saved device or other Space key', async () => {
  const { entry, grants, home } = await fixture(); grants.set('space-b', 'editor');
  const head = vi.spyOn(AgentWikiClient.prototype, 'getRevisionHead').mockImplementation(async (_connection, key, spaceId) => {
    expect(key).toBe('key-a'); return { revisionId: `rev-${spaceId}`, sequence: 1, contentHash: 'hash' };
  });
  vi.spyOn(AgentWikiClient.prototype, 'getSnapshot').mockImplementation(async (_connection, key, spaceId) => {
    expect(key).toBe('key-a'); return { revisionId: `rev-${spaceId}`, sequence: 1, contentHash: 'hash', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', bundle: { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId, baseRevision: '0', pages: [], memories: [], relations: [], deletions: [], provenance: [] } };
  });
  const tree = vi.spyOn(AgentWikiClient.prototype, 'getTreeRevisionHeadV2');
  await entry.handlers.pull({ spaceId: 'space-a' }); await entry.handlers.pull({ spaceId: 'space-b' });
  expect(head.mock.calls.map((c) => c[2])).toEqual(['space-a','space-b']); expect(tree).not.toHaveBeenCalled();
  const a = JSON.parse(await readFile(workspacePaths(home, 'space-a').manifestFile, 'utf8'));
  const b = JSON.parse(await readFile(workspacePaths(home, 'space-b').manifestFile, 'utf8'));
  expect(a.spaceId).toBe('space-a'); expect(b.spaceId).toBe('space-b');
});

it('keeps local tools available during an identity outage and never falls back to other stored credentials', async () => {
  const { entry, calls } = await fixture();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private server detail', { status: 401 }));
  const { server, toolNames } = await createGatewayServer(entry);
  try {
    expect(toolNames).toContain('local_scan_sources');
    const denied = await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-b' });
    expect(denied.isError).toBe(true); expect(calls).toHaveLength(0);
    expect(JSON.stringify(denied)).not.toMatch(/private server detail|key-a|key-b/);
    expect(entry.bridge.diagnostic()).toMatchObject({ credentialScope: 'agent', authorizationSource: 'live_agent_grants', status: 'authorization_required' });
  } finally { await server.close(); }
});

it('accepts explicit Spaces for legacy configuration without a saved Space and rejects ambiguous or malformed selectors', async () => {
  const { home, grants, calls } = await fixture();
  const { loadConfig } = await import('../config.js');
  const config = await loadConfig(home); delete config.connections.a!.spaceId; await saveConfig(home, config);
  grants.set('space-new', 'reader');
  const { bridge } = await createGatewayEntry({ home, connectionId: 'a' });
  expect((await bridge.callGatewayTool('wiki_list_pages', {})).isError).toBe(true);
  expect((await bridge.callGatewayTool('wiki_list_pages', { spaceId: '../bad' })).isError).toBe(true);
  expect(calls).toHaveLength(0);
  expect(data(await bridge.callGatewayTool('wiki_list_spaces', {})).map((s: { id: string }) => s.id)).toEqual(['space-a','space-new']);
  expect(data(await bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-new' })).space).toBe('space-new');
});

it('fails knowledge preflight closed when access discovery is unavailable or the selected credential is inactive', async () => {
  const { entry, access } = await fixture();
  access.mockRejectedValueOnce(new Error('Access discovery unavailable'));
  await expect(entry.handlers.prepare({ spaceId: 'space-a', sourcePaths: ['/unused'] })).rejects.toThrow(/unavailable/);
  access.mockResolvedValueOnce({ access: [{ id: 'agent-1', name: 'Agent', status: 'active', grants: [{ role: 'publisher', space: { id: 'space-a', name: 'A' } }], credentials: [{ id: 'cred-a', active: false }] }] });
  await expect(entry.handlers.pull({ spaceId: 'space-a' })).rejects.toThrow(/Space access denied/);
});
