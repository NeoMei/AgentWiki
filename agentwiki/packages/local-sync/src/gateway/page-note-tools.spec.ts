import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { exactRemoteToolSchema } from './collaboration-tools.js';
import { createGatewayServer, type GatewayHandlers } from './server.js';
import { type RemoteMcpBridge } from './remote-mcp-bridge.js';

const scope = { spaceId: 'space-1', pageId: 'page-1' };
const fields = { clientNoteId: 'client-1', body: 'Hello', target: { kind: 'selection', from: 0, to: 5, quote: 'Hello', prefix: '', suffix: '', baseUpdatedAt: '2026-10-14T00:00:00.000Z' } };

describe('shared notes gateway schemas', () => {
  it('exports bounded direct schemas for all shared note operations', () => {
    for (const name of ['list_page_notes', 'create_page_note', 'update_page_note', 'delete_page_note']) expect(exactRemoteToolSchema(name)).toBeDefined();
    const schema = z.object(exactRemoteToolSchema('create_page_note')!).strict();
    expect(schema.parse({ ...scope, ...fields })).toEqual({ ...scope, ...fields });
    expect(() => schema.parse({ ...scope, ...fields, authorId: 'victim' })).toThrow();
    expect(() => schema.parse({ ...scope, ...fields, body: '' })).toThrow();
    expect(() => schema.parse({ ...fields })).toThrow();
  });

  it('advertises and forwards named note parameters through the real SDK transport', async () => {
    const forwarded = vi.fn(async (_name, args) => ({ content: [{ type: 'text' as const, text: JSON.stringify(args) }], isError: false }));
    const bridge = {
      listTools: async () => ['list_page_notes', 'create_page_note', 'update_page_note', 'delete_page_note'].map(name => ({ name })),
      callGatewayTool: forwarded,
    } as unknown as RemoteMcpBridge;
    const { server } = await createGatewayServer({ bridge, handlers: {} as GatewayHandlers });
    const [left, right] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'notes-gateway-test', version: '1' });
    try {
      await server.connect(right); await client.connect(left);
      const catalog = await client.listTools();
      const descriptor = catalog.tools.find(tool => tool.name === 'wiki_create_page_note')!;
      expect(descriptor.inputSchema.properties).toHaveProperty('target');
      expect(descriptor.inputSchema.required).toContain('clientNoteId');
      const result = await client.callTool({ name: 'wiki_create_page_note', arguments: { ...scope, ...fields } });
      expect(result.isError).toBe(false);
      expect(forwarded).toHaveBeenCalledWith('wiki_create_page_note', { ...scope, ...fields });
      const invalid = await client.callTool({ name: 'wiki_create_page_note', arguments: { ...scope, ...fields, target: {} } });
      expect(invalid.isError).toBe(true); expect(forwarded).toHaveBeenCalledTimes(1);
    } finally { await client.close(); await server.close(); }
  });
});
