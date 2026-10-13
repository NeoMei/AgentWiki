import { McpService } from './mcp.service';
import { setupNotes, agent, human, input } from '../page-notes/page-note.testing';

function setup() {
  const s = setupNotes();
  const deps = {};
  const audit = { record: jest.fn(async () => undefined) };
  const mcp = new (McpService as any)(deps, deps, s.authorization, deps, deps, deps, deps, deps, deps, deps, audit, s.db, deps, deps, undefined, undefined, s.service);
  const server = mcp.createServer(agent);
  return { ...s, server, audit };
}

async function withClient(run: (fixture: ReturnType<typeof setup> & { client: any; call: (name: string, body: any) => Promise<any> }) => Promise<void>) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const fixture = setup();
  const client = new Client({ name: 'shared-notes-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await fixture.server.connect(right); await client.connect(left);
    const call = async (name: string, body: any) => {
      const result = await client.callTool({ name, arguments: { spaceId: 'space-1', pageId: 'page-1', ...body } });
      return { ...result, data: result.isError ? undefined : JSON.parse(result.content[0].text) };
    };
    await run({ ...fixture, client, call });
  } finally { await client.close(); await fixture.server.close(); }
}

describe('shared notes over existing MCP transport', () => {
  it('advertises precise parameters and executes create/read/update/delete under Agent identity', async () => {
    await withClient(async ({ client, call, audit }) => {
      const catalog = await client.listTools();
      const descriptor = catalog.tools.find((t: any) => t.name === 'create_page_note');
      expect(descriptor.inputSchema.properties).toHaveProperty('clientNoteId');
      expect(descriptor.inputSchema.properties.target.type).toBe('object');
      expect(descriptor.inputSchema.required).toEqual(expect.arrayContaining(['spaceId', 'pageId', 'clientNoteId', 'target', 'body']));
      const created = await call('create_page_note', input);
      expect(created.isError).not.toBe(true);
      expect(created.data).toMatchObject({ author: { type: 'agent', id: 'agent-1', name: 'Codex' }, canEdit: true });
      expect((await call('list_page_notes', {})).data.notes).toHaveLength(1);
      const changed = await call('update_page_note', { noteId: created.data.id, expectedUpdatedAt: created.data.updatedAt, status: 'resolved' });
      expect(changed.data.status).toBe('resolved');
      expect((await call('delete_page_note', { noteId: created.data.id, expectedUpdatedAt: changed.data.updatedAt })).data).toEqual({ deleted: true });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorAgentId: 'agent-1', action: 'mcp.tool.create_page_note', outcome: 'success' }));
    });
  });

  it('exposes human notes read-only and rejects Agent impersonation, cross-space access, and revocation', async () => {
    await withClient(async ({ service, access, call, rows }) => {
      const note = await service.create(human, 'space-1', 'page-1', input);
      expect((await call('list_page_notes', {})).data.notes[0]).toMatchObject({ author: { type: 'user' }, canEdit: false });
      expect((await call('update_page_note', { noteId: note.id, expectedUpdatedAt: note.updatedAt, body: 'not mine' })).isError).toBe(true);
      expect((await call('create_page_note', { ...input, authorId: 'user-1' })).isError).toBe(true);
      expect((await call('list_page_notes', { spaceId: 'space-2' })).isError).toBe(true);
      access.agent = false;
      expect((await call('list_page_notes', {})).isError).toBe(true);
      expect(rows).toHaveLength(1); expect(rows[0].body).toBe(input.body);
    });
  });

  it('keeps reader grants read-only and detects stale writes through MCP', async () => {
    await withClient(async ({ access, call }) => {
      const created = (await call('create_page_note', input)).data;
      await call('update_page_note', { noteId: created.id, expectedUpdatedAt: created.updatedAt, body: 'edited' });
      expect((await call('update_page_note', { noteId: created.id, expectedUpdatedAt: created.updatedAt, body: 'stale' })).isError).toBe(true);
      access.role = 'reader';
      expect((await call('list_page_notes', {})).data.canCreate).toBe(false);
      expect((await call('create_page_note', { ...input, clientNoteId: 'another' })).isError).toBe(true);
    });
  });
});
