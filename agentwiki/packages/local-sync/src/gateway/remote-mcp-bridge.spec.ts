import { describe, expect, it, vi } from 'vitest';
import { toRemoteGatewayName, fromRemoteGatewayName } from './manifest.js';

describe('remote bridge name mapping', () => {
  it('maps remote names to gateway names', () => {
    expect(toRemoteGatewayName('list_pages')).toBe('wiki_list_pages');
    expect(fromRemoteGatewayName('wiki_list_pages')).toBe('list_pages');
  });

  it('rejects non-remote names in fromRemoteGatewayName', () => {
    expect(fromRemoteGatewayName('local_scan_sources')).toBeNull();
    expect(fromRemoteGatewayName('knowledge_prepare')).toBeNull();
  });
});

import { RemoteMcpBridge } from './remote-mcp-bridge.js';

function remoteFetch(state: { status: number }): typeof fetch {
  return vi.fn(async (_url, init) => {
    if (state.status !== 200) return new Response('private-server-body agk_do-not-log', { status: state.status });
    if (init?.method === 'GET') return new Response('', { status: 405 });
    const message = JSON.parse(String(init?.body));
    if (message.id === undefined) return new Response(null, { status: 202 });
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-03-26', serverInfo: { name: 'fixture', version: '1' }, capabilities: { tools: {} } }
      : { tools: [{ name: 'list_pages', inputSchema: { type: 'object' } }] };
    return Response.json({ jsonrpc: '2.0', id: message.id, result });
  }) as typeof fetch;
}

it.each([
  [401, 'authorization_required', 'REMOTE_AUTH_REQUIRED'],
  [403, 'access_denied', 'REMOTE_ACCESS_DENIED'],
  [503, 'unavailable', 'REMOTE_UNAVAILABLE'],
] as const)('reports safe current diagnostics for HTTP %s while keeping cached tools', async (status, expected, code) => {
  const state = { status: 200 };
  const notify = vi.fn();
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: async () => 'agk_private', fetchImpl: remoteFetch(state), onDiagnostic: notify });
  expect(await bridge.listTools()).toHaveLength(1);
  expect(bridge.isOnline()).toBe(true);
  state.status = status;
  expect(await bridge.listTools()).toHaveLength(1);
  expect(bridge.diagnostic()).toMatchObject({ status: expected, code, cachedToolCount: 1 });
  expect(bridge.isOnline()).toBe(false);
  expect(JSON.stringify(notify.mock.calls)).not.toMatch(/private-server-body|agk_private|agk_do-not-log/);
  const calls = notify.mock.calls.length;
  await bridge.listTools();
  expect(notify.mock.calls).toHaveLength(calls);
  state.status = 200;
  await bridge.listTools();
  expect(bridge.diagnostic()).toMatchObject({ status: 'connected', code: 'REMOTE_CONNECTED' });
});

it('bounds discovery even when fetch ignores abort and retains a timeout diagnostic', async () => {
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: async () => 'agk_private', fetchImpl: (() => new Promise(() => {})) as typeof fetch, deadlineMs: 25 });
  const before = Date.now();
  expect(await bridge.listTools()).toEqual([]);
  expect(Date.now() - before).toBeLessThan(1000);
  expect(bridge.diagnostic()).toMatchObject({ status: 'unavailable', code: 'REMOTE_TIMEOUT' });
});


it('reports a safe authorization failure when an already registered remote tool loses access', async () => {
  const state = { status: 200 };
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: async () => 'agk_private', fetchImpl: remoteFetch(state) });
  await bridge.listTools();
  state.status = 401;
  const result = await bridge.callGatewayTool('wiki_list_pages', {});
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain('REMOTE_AUTH_REQUIRED');
  expect(JSON.stringify(result)).not.toMatch(/private-server-body|agk_private|agk_do-not-log/);
  expect(bridge.isOnline()).toBe(false);
});

it('bounds a stalled credential read without starting a late discovery', async () => {
  let release!: (value: string) => void;
  const fetchImpl = vi.fn(remoteFetch({ status: 200 }));
  const bridge = new RemoteMcpBridge({ serverUrl: 'https://wiki.test/api/mcp', readCredential: () => new Promise((resolve) => { release = resolve; }), fetchImpl, deadlineMs: 25 });
  expect(await bridge.listTools()).toEqual([]);
  release('agk_private');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(bridge.diagnostic().code).toBe('REMOTE_TIMEOUT');
});
