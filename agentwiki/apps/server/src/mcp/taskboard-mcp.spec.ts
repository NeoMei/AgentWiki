import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { ProjectTaskboardService } from '../project-taskboard/project-taskboard.service';
import { makeDb } from '../project-taskboard/testing/fake-taskboard-db';
import { McpService } from './mcp.service';

const editor: Principal = { userId: 'owner', agentId: 'agent-1', authorizationId: 'grant-1', authorizationSpaceId: 'space-1', agentRole: 'editor' };
const plan = (title: string) => `# ${title}\n\n### Task 1: ${title} task\n\n- [ ] **Step 1: Verify**`;

function setup(role = 'editor') {
  const { prisma, db } = makeDb();
  const grant = { id: 'grant-1', role, folderScopes: [], agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } };
  prisma.agentGrant = { findUnique: async () => grant };
  const authorization = new AuthorizationService(prisma);
  const service = new ProjectTaskboardService(prisma, authorization, { publish: async () => undefined } as any);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const deps: any = {};
  const mcp = new (McpService as any)(deps, authorization, deps, deps, deps, deps, deps, deps, deps, audit, prisma, deps, deps, undefined, service);
  const server = mcp.createServer({ ...editor, agentRole: role });
  const tools = server._registeredTools;
  const call = async (name: string, args: unknown) => {
    const result = await tools[name].handler(args);
    return { ...result, data: JSON.parse(result.content[0].text) };
  };
  return { call, tools, db, grant, audit, server };
}

describe('taskboard through the existing MCP connection', () => {
  it('advertises usable schemas and imports through the real MCP transport', async () => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
    const { server } = setup();
    const client = new Client({ name: 'taskboard-test', version: '1' });
    const [left, right] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(right);
      await client.connect(left);
      const catalog = await client.listTools();
      const descriptor = catalog.tools.find((tool: any) => tool.name === 'import_taskboard_plans');
      expect(descriptor.inputSchema.properties.documents).toBeDefined();
      const result = await client.callTool({ name: 'import_taskboard_plans', arguments: { spaceId: 'space-1', documents: [{ sourcePath: 'a.md', content: plan('A') }] } });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse(result.content[0].text)).toMatchObject({ imported: 1, failed: 0 });
      const invalid = await client.callTool({ name: 'import_taskboard_plans', arguments: { spaceId: 'space-1', documents: [] } });
      expect(invalid.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('imports multiple plans, reports per-file failure and preserves remote execution on retry', async () => {
    const { call, db, audit } = setup();
    const documents = [
      { sourcePath: '/project/docs/superpowers/plans/a.md', content: plan('A') },
      { sourcePath: '/project/docs/superpowers/plans/empty.md', content: '# No tasks' },
      { sourcePath: '/project/docs/superpowers/plans/b.md', content: plan('B') },
    ];
    const first = await call('import_taskboard_plans', { spaceId: 'space-1', documents });
    expect(first.isError).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mcp.tool.import_taskboard_plans', outcome: 'failure' }));
    expect(first.data.results.map((r: any) => [r.sourcePath, r.status, r.code])).toEqual([
      [documents[0].sourcePath, 'imported', undefined],
      [documents[1].sourcePath, 'failed', 'TASKBOARD_PLAN_NO_TASKS'],
      [documents[2].sourcePath, 'imported', undefined],
    ]);
    const read = await call('get_taskboard', { spaceId: 'space-1' });
    expect(read.data.board.tasks.filter((t: any) => t.kind === 'implementation_task')).toHaveLength(2);
    const id = read.data.board.tasks.find((t: any) => t.title === 'A task').id;
    await call('update_taskboard_status', { spaceId: 'space-1', taskId: id, status: 'in_progress', expected_status: 'todo', session_id: 'session-a', current_step: 'Verify MCP' });
    await call('import_taskboard_plans', { spaceId: 'space-1', documents: [documents[0], documents[2]] });
    const after = (await call('get_taskboard', { spaceId: 'space-1' })).data.board;
    expect(after.tasks).toHaveLength(6);
    expect(after.tasks.find((t: any) => t.id === id)).toMatchObject({ status: 'in_progress', current_step: 'Verify MCP', claim: { owner: 'agent:agent-1', session: 'session-a' } });
    expect(db.events.some((e) => e.actorId === 'agent-1' && e.operation === 'import')).toBe(true);
    await expect(call('update_taskboard_status', { spaceId: 'space-1', taskId: id, status: 'done', expected_status: 'todo', session_id: 'session-a' })).rejects.toThrow();
  });

  it('imports board.json through MCP and rejects forged request identity', async () => {
    const { call, db } = setup();
    await call('import_taskboard_plans', { spaceId: 'space-1', documents: [{ sourcePath: 'board.json', content: JSON.stringify({ tasks: [{ id: 'one', title: 'One', kind: 'task' }] }) }] });
    expect((await call('get_taskboard', { spaceId: 'space-1' })).data.board.tasks[0]).toMatchObject({ id: 'one', title: 'One' });
    await expect(call('update_taskboard_status', { spaceId: 'space-1', taskId: 'one', status: 'done', actorId: 'other' })).rejects.toThrow();
    expect(db.tasks[0].status).toBe('todo');
  });

  it('allows reader access but rejects writes and cross-space access', async () => {
    const { call, db } = setup('reader');
    expect((await call('get_taskboard', { spaceId: 'space-1' })).data.board.tasks).toEqual([]);
    await expect(call('import_taskboard_plans', { spaceId: 'space-1', documents: [{ sourcePath: 'a.md', content: plan('A') }] })).rejects.toThrow();
    await expect(call('update_taskboard_status', { spaceId: 'space-1', taskId: 'one', status: 'done' })).rejects.toThrow();
    db.spaces.push({ id: 'space-2', name: 'Other' });
    await expect(call('get_taskboard', { spaceId: 'space-2' })).rejects.toThrow();
    expect(db.boards).toHaveLength(0);
  });

  it('rejects revoked grants and oversized or empty batches before any mutation', async () => {
    const { call, db, grant } = setup();
    await expect(call('import_taskboard_plans', { spaceId: 'space-1', documents: [] })).rejects.toThrow();
    await expect(call('import_taskboard_plans', { spaceId: 'space-1', documents: Array.from({ length: 21 }, (_, i) => ({ sourcePath: `${i}.md`, content: plan('A') })) })).rejects.toThrow();
    grant.agent.status = 'revoked';
    await expect(call('get_taskboard', { spaceId: 'space-1' })).rejects.toThrow();
    await expect(call('import_taskboard_plans', { spaceId: 'space-1', documents: [{ sourcePath: 'a.md', content: plan('A') }] })).rejects.toThrow();
    expect(db.boards).toHaveLength(0);
  });
});
