import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { saveConfig, saveCredentials } from '../config.js';
import { createGatewayEntry } from './entry.js';
import { createGatewayServer } from './server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'aw-multi-space-'));
  homes.push(home);
  const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.10.0', client: 'codex' as const, mcpName: 'agentwiki' };
  await saveConfig(home, { version: 1, defaultConnectionId: 'b', connections: {
    a: { ...common, id: 'a', spaceId: 'space-a', credentialId: 'cred-a' },
    b: { ...common, id: 'b', spaceId: 'space-b', credentialId: 'cred-b' },
    unrelated: { ...common, id: 'unrelated', agentId: 'other-agent', spaceId: 'space-c', credentialId: 'cred-c' },
  } });
  await saveCredentials(home, { version: 2, credentials: { 'cred-a': { apiKey: 'key-a' }, 'cred-b': { apiKey: 'key-b' }, 'cred-c': { apiKey: 'key-c' } } });
  const revoked = new Set<string>();
  const calls: Array<{ key: string; tool: string; args: Record<string, unknown> }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const key = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    if (revoked.has(key)) return new Response('private detail', { status: 401 });
    if (init?.method !== 'POST') return new Response('', { status: 405 });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } };
    else if (message.method === 'tools/list') result = { tools: [
      { name: 'list_spaces', inputSchema: { type: 'object', properties: {} } },
      { name: 'get_page', inputSchema: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] } },
      { name: 'list_pages', inputSchema: { type: 'object', properties: { spaceId: { type: 'string' } }, required: ['spaceId'] } },
    ] };
    else {
      const { name: tool, arguments: args } = message.params;
      calls.push({ key, tool, args });
      const data = tool === 'list_spaces' ? [{ id: key === 'key-a' ? 'space-a' : 'space-b', role: key === 'key-a' ? 'reader' : 'editor' }] : { space: key === 'key-a' ? 'space-a' : 'space-b', pageId: args.pageId ?? null };
      result = { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  });
  return { home, calls, revoked, entry: await createGatewayEntry({ home, connectionId: 'a' }) };
}

it('routes concurrent MCP calls by Space and aggregates authorized Space discovery', async () => {
  const { entry, calls } = await fixture();
  const { server } = await createGatewayServer(entry);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.callTool({ name: 'wiki_list_spaces', arguments: {} });
    expect(JSON.parse((listed.content as Array<{ text: string }>)[0]!.text).map((s: { id: string }) => s.id).sort()).toEqual(['space-a', 'space-b']);
    const results = await Promise.all(['space-a', 'space-b'].map((spaceId) => client.callTool({ name: 'wiki_get_page', arguments: { spaceId, __args: { pageId: 'page-1' } } })));
    expect(results.map((r) => JSON.parse((r.content as Array<{ text: string }>)[0]!.text).space)).toEqual(['space-a', 'space-b']);
    expect(calls.filter((call) => call.tool === 'get_page').map(({ key }) => key).sort()).toEqual(['key-a', 'key-b']);
    // Gateway routing metadata must not be sent to strict upstream page-only schemas.
    expect(calls.filter((call) => call.tool === 'get_page').every(({ args }) => !('spaceId' in args))).toBe(true);
  } finally { await client.close(); await server.close(); }
});

it('fails closed for missing, unknown, unrelated, and contradictory Space selectors', async () => {
  const { entry, calls } = await fixture();
  for (const args of [{}, { spaceId: 'unknown' }, { spaceId: 'space-c' }]) {
    const result = await entry.bridge.callGatewayTool('wiki_list_pages', args);
    expect(result.isError).toBe(true);
  }
  expect(calls).toHaveLength(0);
});

it('revoking one Space does not disable another or expose private diagnostics', async () => {
  const { entry, revoked } = await fixture();
  await entry.bridge.listTools();
  revoked.add('key-a');
  const a = await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-a' });
  const b = await entry.bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-b' });
  expect(a.isError).toBe(true);
  expect(b.isError).toBe(false);
  expect(JSON.stringify(a)).not.toMatch(/private detail|key-a|key-b/);
});

it('keeps a single-Space page-only call compatible without a Space selector', async () => {
  const { home } = await fixture();
  const config = await (await import('../config.js')).loadConfig(home);
  config.connections = { a: config.connections.a! };
  await saveConfig(home, config);
  const { bridge } = await createGatewayEntry({ home, connectionId: 'a' });
  await bridge.listTools();
  const result = await bridge.callGatewayTool('wiki_get_page', { pageId: 'page-1' });
  expect(result.isError).toBe(false);
  expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).space).toBe('space-a');
});

it('keeps resolved Spaces available but blocks implicit routing when a legacy binding is unavailable', async () => {
  const { home, calls } = await fixture();
  const config = await (await import('../config.js')).loadConfig(home);
  delete config.connections.a!.spaceId;
  await saveConfig(home, config);
  const previousFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/integrations/mcp')) return new Response('unavailable', { status: 503 });
    return previousFetch(url, init);
  });
  const { bridge } = await createGatewayEntry({ home, connectionId: 'a' });
  await bridge.listTools();
  expect((await bridge.callGatewayTool('wiki_get_page', { pageId: 'page-1' })).isError).toBe(true);
  expect((await bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-a' })).isError).toBe(true);
  expect(calls).toHaveLength(0);
  expect((await bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-b' })).isError).toBe(false);
  const listed = await bridge.callGatewayTool('wiki_list_spaces', {});
  expect(listed.isError).toBe(true);
  expect(JSON.parse((listed.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ spaces: [{ id: 'space-b' }], unresolvedConnectionIds: ['a'] });
  expect(bridge.diagnostic()).toMatchObject({ allSpacesConnected: false, unresolvedConnectionIds: ['a'] });
});

it('starts the local gateway when its only legacy binding is unavailable and blocks all Space routes', async () => {
  const { home, calls } = await fixture();
  const config = await (await import('../config.js')).loadConfig(home);
  config.connections = { a: config.connections.a! };
  delete config.connections.a!.spaceId;
  await saveConfig(home, config);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
  const entry = await createGatewayEntry({ home, connectionId: 'a' });
  const { server, toolNames } = await createGatewayServer(entry);
  try {
    expect(toolNames).toContain('local_scan_sources');
    expect(toolNames).toContain('local_read_artifacts');
    expect((await entry.bridge.callGatewayTool('wiki_get_page', { pageId: 'page-1' })).isError).toBe(true);
    await expect(entry.handlers.prepare({ spaceId: 'space-b', sourcePaths: ['/unused'] })).rejects.toThrow(/spaceId space-b/);
    expect(calls).toHaveLength(0);
  } finally { await server.close(); }
});

it('resolves a single legacy credential and rejects explicit routing to another Space', async () => {
  const { home, calls } = await fixture();
  const config = await (await import('../config.js')).loadConfig(home);
  config.connections = { a: config.connections.a! };
  delete config.connections.a!.spaceId;
  await saveConfig(home, config);
  const previousFetch = vi.mocked(globalThis.fetch).getMockImplementation()!;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/integrations/mcp')) return Response.json({ access: [{ id: 'agent-1', credentials: [{ id: 'cred-a', active: true, authorization: { space: { id: 'space-a', name: 'A' } } }], grants: [] }] });
    return previousFetch(url, init);
  });
  const { handlers, bridge } = await createGatewayEntry({ home, connectionId: 'a' });
  await bridge.listTools();
  expect((await bridge.callGatewayTool('wiki_list_pages', { spaceId: 'space-b' })).isError).toBe(true);
  await expect(handlers.prepare({ spaceId: 'space-b', sourcePaths: ['/unused'] })).rejects.toThrow(/spaceId space-b/);
  expect(calls).toHaveLength(0);
  const result = await bridge.callGatewayTool('wiki_get_page', { pageId: 'page-1' });
  expect(result.isError).toBe(false);
  expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text).space).toBe('space-a');
});

it('rejects contradictory gateway selectors without issuing an upstream business call', async () => {
  const { entry, calls } = await fixture();
  const { server } = await createGatewayServer(entry);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' }, { capabilities: {} });
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: 'wiki_list_pages', arguments: { spaceId: 'space-a', __args: { spaceId: 'space-b' } } });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  } finally { await client.close(); await server.close(); }
});

it('marks discovery and diagnostics incomplete when one configured Space is unavailable', async () => {
  const { entry, revoked } = await fixture();
  revoked.add('key-a');
  await entry.bridge.listTools();
  const result = await entry.bridge.callGatewayTool('wiki_list_spaces', {});
  expect(result.isError).toBe(true);
  expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ spaces: [{ id: 'space-b' }], unavailableSpaceIds: ['space-a'] });
  expect(entry.bridge.diagnostic()).toMatchObject({ allSpacesConnected: false, spaces: [
    { spaceId: 'space-a', status: 'authorization_required' }, { spaceId: 'space-b', status: 'connected' },
  ] });
});
