import { McpService } from './mcp.service';

const editor = {
  userId: 'agent-user', agentId: 'agent-1', agentRole: 'editor', authorizationId: 'grant-1',
  credentialId: 'credential-1', scopes: ['collaboration:read', 'collaboration:execute'],
} as any;
const reader = { ...editor, agentRole: 'reader', scopes: ['collaboration:read'] };

describe('collaboration MCP tools', () => {
  const execution = {
    joinRun: jest.fn().mockResolvedValue({
      runId: 'run-1', status: 'running', roleSlots: [],
      protocol: { nextActionTool: 'wiki_collaboration_next_action', stopOn: ['waiting_human', 'paused', 'completed', 'failed', 'cancelled'] },
    }),
    nextAction: jest.fn().mockResolvedValue({ action: 'waiting_dependency', retryAfterSeconds: 3 }),
    heartbeat: jest.fn(), updateTodo: jest.fn(), submitResult: jest.fn(),
    getAgentRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running', roleSlots: [], assignedTasks: [] }),
  } as any;
  const authorization = {} as any;
  const audit = { record: jest.fn() } as any;
  const prisma = { agentAuditEvent: { create: jest.fn() } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('registers exactly six canonical Agent collaboration tools with direct inputs', () => {
    const server = service().createServer(editor) as any;
    const names = Object.keys(server._registeredTools).filter((name) => name.startsWith('collaboration_'));
    expect(names).toEqual([
      'collaboration_join_run', 'collaboration_next_action', 'collaboration_heartbeat',
      'collaboration_update_todo', 'collaboration_submit_result', 'collaboration_get_run',
    ]);
    const schema = server._registeredTools.collaboration_next_action.inputSchema;
    expect(() => schema.parse({ runId: 'run-1', idempotencyKey: 'next-0001' })).not.toThrow();
    expect(() => schema.parse({ __args: { runId: 'run-1' } })).toThrow();
  });

  it('keeps a reader read-only and exposes no human-control tools', async () => {
    const server = service().createServer(reader) as any;
    await expect(server._registeredTools.collaboration_next_action.handler({
      runId: 'run-1', idempotencyKey: 'next-0001',
    })).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    await expect(server._registeredTools.collaboration_get_run.handler({ runId: 'run-1' })).resolves.toBeDefined();
    expect(Object.keys(server._registeredTools)).not.toEqual(expect.arrayContaining([
      'collaboration_approve_review', 'collaboration_reassign_task', 'collaboration_cancel_run',
    ]));
  });

  function service(): any {
    return new McpService(
      { get: jest.fn() } as any,
      authorization,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      audit,
      prisma,
      {} as any,
      execution,
    );
  }
});
