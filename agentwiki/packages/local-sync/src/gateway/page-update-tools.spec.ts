import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGatewayServer } from './server.js';

const payload = { spaceId: 'space-a', pageId: 'page-a', expectedUpdatedAt: '2026-10-17T00:00:00.000Z', expectedTreeRevision: '41', title: 'Title', content: '', folderId: null };
async function fixture(run: (client: Client, forwarded: ReturnType<typeof vi.fn>) => Promise<void>) {
  const forwarded = vi.fn(async (_name: string, args: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(args) }] }));
  const { server } = await createGatewayServer({ handlers: {} as never, bridge: { listTools: async () => [{ name: 'propose_page_update' }], callGatewayTool: forwarded } as never });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'page-update-contract', version: '1' });
  await server.connect(st); await client.connect(ct);
  try { await run(client, forwarded); } finally { await client.close(); await server.close(); }
}
it('advertises and forwards named, wrapped and agreeing mixed page update inputs through the SDK', async () => {
  await fixture(async (client, forwarded) => {
    const tool = (await client.listTools()).tools.find(t => t.name === 'wiki_propose_page_update')!;
    for (const key of Object.keys(payload)) expect(tool.inputSchema.properties).toHaveProperty(key);
    expect(tool.inputSchema.properties).toHaveProperty('__args');
    for (const args of [payload, { __args: payload }, { ...payload, __args: payload }, { spaceId: payload.spaceId, __args: payload }]) {
      const result = await client.callTool({ name: 'wiki_propose_page_update', arguments: args });
      expect(result.isError).not.toBe(true);
      expect(forwarded).toHaveBeenLastCalledWith('wiki_propose_page_update', payload);
      expect(JSON.parse((result.content as Array<{text:string}>)[0]!.text)).toEqual(payload);
    }
  });
});
it.each(Object.keys(payload))('rejects conflicting %s before forwarding', async key => {
  await fixture(async (client, forwarded) => {
    const result = await client.callTool({ name: 'wiki_propose_page_update', arguments: { ...payload, __args: { ...payload, [key]: key === 'folderId' ? 'other-folder' : 'different' } } });
    expect(result.isError).toBe(true); expect(forwarded).not.toHaveBeenCalled();
  });
});
it.each([
  { ...payload, extra: true }, { __args: { ...payload, extra: true } },
  { ...payload, expectedUpdatedAt: 'yesterday' }, { ...payload, expectedTreeRevision: '041' },
  { ...payload, title: ' ' }, { spaceId: 'space-a' },
  { spaceId: payload.spaceId, pageId: payload.pageId, expectedUpdatedAt: payload.expectedUpdatedAt, expectedTreeRevision: payload.expectedTreeRevision },
])('rejects invalid or incomplete input %j without forwarding', async args => {
  await fixture(async (client, forwarded) => {
    const result = await client.callTool({ name: 'wiki_propose_page_update', arguments: args });
    expect(result.isError).toBe(true); expect(forwarded).not.toHaveBeenCalled();
  });
});

it.each(['spaceId', 'pageId', 'expectedUpdatedAt', 'expectedTreeRevision'])('requires merged %s', async key => {
  await fixture(async (client, forwarded) => {
    const args: Record<string, unknown> = { ...payload }; delete args[key];
    const result = await client.callTool({ name: 'wiki_propose_page_update', arguments: { __args: args } });
    expect(result.isError).toBe(true); expect(forwarded).not.toHaveBeenCalled();
  });
});
