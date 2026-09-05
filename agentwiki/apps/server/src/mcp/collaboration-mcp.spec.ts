import { McpService } from './mcp.service';

const editor = {
  userId: 'agent-user', agentId: 'agent-1', agentRole: 'editor', authorizationId: 'grant-1',
  credentialId: 'credential-1', scopes: ['collaboration:read', 'collaboration:execute'],
} as any;
const reader = { ...editor, agentRole: 'reader', scopes: ['collaboration:read'] };
const assignedTask = {
  id: 'task-1', nodeId: 'draft', name: 'Draft', objective: 'Draft the Page',
  todos: [], inputs: {}, acceptedArtifacts: [],
  targetPage: {
    id: 'page-1', spaceId: 'space-1', title: 'Target', content: '# Target', format: 'markdown',
    updatedAt: '2026-09-05T08:00:00.000Z',
    baseline: { pageVersionId: null, updatedAt: '2026-09-05T07:00:00.000Z', contentHash: 'a'.repeat(64) },
  },
  dependencyPages: [],
  authorizationContext: { spaceId: 'space-1', scope: 'collaboration:execute', targetPageId: 'page-1' },
  outputRequirements: { kind: 'markdown', targetPageId: 'page-1', humanReviewRequired: true, requiredEvidence: [] },
};

describe('collaboration MCP tools', () => {
  const execution = {
    joinRun: jest.fn().mockResolvedValue({
      runId: 'run-1', status: 'running', roleSlots: [],
      assignedTasks: [assignedTask],
      protocol: { nextActionTool: 'wiki_collaboration_next_action', stopOn: ['waiting_human', 'paused', 'completed', 'failed', 'cancelled'] },
    }),
    nextAction: jest.fn().mockResolvedValue({ action: 'waiting_dependency', retryAfterSeconds: 3 }),
    heartbeat: jest.fn(), updateTodo: jest.fn(), submitResult: jest.fn(),
    getAgentRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'running', roleSlots: [], assignedTasks: [assignedTask] }),
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
    execution.getAgentRun.mockResolvedValueOnce({
      runId: 'run-1', status: 'running', roleSlots: [],
      assignedTasks: [{
        ...assignedTask,
        authorizationContext: { ...assignedTask.authorizationContext, scope: 'collaboration:read' },
      }],
    });
    const server = service().createServer(reader) as any;
    await expect(server._registeredTools.collaboration_next_action.handler({
      runId: 'run-1', idempotencyKey: 'next-0001',
    })).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    const response = await server._registeredTools.collaboration_get_run.handler({ runId: 'run-1' });
    expect(JSON.parse(response.content[0].text).assignedTasks[0].authorizationContext.scope)
      .toBe('collaboration:read');
    expect(Object.keys(server._registeredTools)).not.toEqual(expect.arrayContaining([
      'collaboration_approve_review', 'collaboration_reassign_task', 'collaboration_cancel_run',
    ]));
  });

  it('returns the server target, authorization context, and output requirements through join', async () => {
    const server = service().createServer(editor) as any;
    const response = await server._registeredTools.collaboration_join_run.handler({ runId: 'run-1' });
    const payload = JSON.parse(response.content[0].text);
    expect(payload.assignedTasks[0]).toMatchObject({
      targetPage: { id: 'page-1', spaceId: 'space-1', content: '# Target' },
      authorizationContext: { spaceId: 'space-1', scope: 'collaboration:execute', targetPageId: 'page-1' },
      outputRequirements: { kind: 'markdown', targetPageId: 'page-1', humanReviewRequired: true },
    });
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
