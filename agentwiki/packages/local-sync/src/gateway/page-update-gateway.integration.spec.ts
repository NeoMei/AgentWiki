import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SpaceMcpBridge } from './space-mcp-bridge.js';
import { createGatewayServer } from './server.js';

// Isolated transport fixture: these permission/CAS rules are fixture behavior,
// not evidence that production authorization or publishing has been exercised.
it('updates and reads exact state through SDK gateway and real HTTP bridges; rejected writes preserve state', async () => {
  const page = { spaceId: 'space-a', pageId: 'page-a', title: 'Initial', content: 'Before', folderId: null as string | null, updatedAt: '2026-10-17T00:00:00.000Z' };
  let treeRevision = '41';
  let canWrite = true;
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const descriptors = ['get_page', 'list_folders', 'propose_page_update'].map(name => ({ name, inputSchema: { type: 'object', properties: {} } }));
  const http = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    let body = ''; for await (const part of request) body += part;
    const message = JSON.parse(body);
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    let result: unknown;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'isolated-page-state', version: '1' }, capabilities: { tools: {} } };
    else if (message.method === 'tools/list') result = { tools: descriptors };
    else {
      const { name, arguments: args } = message.params;
      calls.push({ name, args });
      let data: unknown; let isError = false;
      if (name === 'get_page') data = { ...page };
      else if (name === 'list_folders') data = { treeRevision };
      else if (!canWrite || args.spaceId !== page.spaceId || args.pageId !== page.pageId || args.expectedUpdatedAt !== page.updatedAt || args.expectedTreeRevision !== treeRevision) {
        isError = true; data = { code: !canWrite ? 'FORBIDDEN' : args.spaceId !== page.spaceId ? 'SPACE_MISMATCH' : 'CAS_CONFLICT' };
      } else {
        for (const key of ['title', 'content', 'folderId'] as const) if (args[key] !== undefined) Object.assign(page, { [key]: args[key] });
        page.updatedAt = new Date(Date.parse(page.updatedAt) + 1000).toISOString();
        treeRevision = String(Number(treeRevision) + 1);
        data = { status: 'published', page: { ...page }, treeRevision };
      }
      result = { content: [{ type: 'text', text: JSON.stringify(data) }], isError };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as { port: number };
  const bridge = new SpaceMcpBridge({ serverUrl: `http://127.0.0.1:${address.port}`, readCredential: async () => 'fixture-only' });
  const { server } = await createGatewayServer({ handlers: {} as never, bridge });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'page-state-acceptance', version: '1' });
  await server.connect(st); await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name: `wiki_${name}`, arguments: args });
    return { isError: result.isError, data: JSON.parse((result.content as Array<{ text: string }>)[0]!.text) };
  };
  const read = async () => (await call('get_page', { spaceId: 'space-a', pageId: 'page-a' })).data;
  try {
    expect((await client.listTools()).tools.map(t => t.name)).toContain('wiki_propose_page_update');
    for (const wrapper of [false, true]) {
      const before = await read();
      const revision = (await call('list_folders', { spaceId: 'space-a' })).data.treeRevision;
      const args = { spaceId: before.spaceId, pageId: before.pageId, expectedUpdatedAt: before.updatedAt, expectedTreeRevision: revision, title: wrapper ? 'Wrapped' : 'Named', content: wrapper ? '' : '# Exact\n中文内容', folderId: null };
      const update = await call('propose_page_update', wrapper ? { __args: args } : args);
      expect(update.isError).not.toBe(true);
      expect(calls.filter(c => c.name === 'propose_page_update').at(-1)!.args).toEqual(args);
      expect(await read()).toEqual({ ...before, title: args.title, content: args.content, folderId: null, updatedAt: new Date(Date.parse(before.updatedAt) + 1000).toISOString() });
      expect(update.data.page).toEqual(await read());
      expect((await call('list_folders', { spaceId: 'space-a' })).data.treeRevision).toBe(String(Number(revision) + 1));
    }
    const unchanged = await read(); const unchangedRevision = treeRevision;
    const valid = { spaceId: 'space-a', pageId: 'page-a', expectedUpdatedAt: unchanged.updatedAt, expectedTreeRevision: treeRevision, content: 'Must not apply' };
    for (const patch of [{ expectedUpdatedAt: '2026-10-17T00:00:00.000Z' }, { expectedTreeRevision: '0' }, { spaceId: 'space-b' }]) {
      expect((await call('propose_page_update', { ...valid, ...patch })).isError).toBe(true);
      expect(await read()).toEqual(unchanged); expect(treeRevision).toBe(unchangedRevision);
    }
    canWrite = false;
    expect((await call('propose_page_update', { __args: valid })).isError).toBe(true);
    expect(await read()).toEqual(unchanged); expect(treeRevision).toBe(unchangedRevision);
  } finally {
    await client.close(); await server.close();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});
