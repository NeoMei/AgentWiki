const freshnessMock: any = { projectPages: async (rows: any[]) => rows, projectChangeSets: async (rows: any[]) => rows, forPages: async () => new Map(), projectEvidence: async (rows: any[]) => new Map(rows.map(row => [row.id, row])) };
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

  it('keeps a reader read-only through run authorization and exposes no human-control tools', async () => {
    execution.nextAction.mockRejectedValueOnce({ businessCode: 'AUTH_SCOPE_REQUIRED' });
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

  it.each([
    { action: 'submitted', artifactId: 'artifact-1', version: 1, artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review', replayed: false },
    { action: 'repair_result', issues: [{ code: 'EVIDENCE_REQUIRED', path: 'private-path', message: 'private-message' }], repairsRemaining: 2, replayed: false },
  ])('audits submit_result handler business branch $action without repair text or lease', async (output) => {
    execution.submitResult.mockResolvedValueOnce(output);
    const server = service().createServer(editor);
    await server._registeredTools.collaboration_submit_result.handler({ runId: 'run-1', attemptId: 'attempt-1', leaseToken: 'private-lease'.repeat(4), artifact: { kind: 'markdown', markdown: 'private-content', evidence: [] }, idempotencyKey: 'submit-0001' });
    const summary = output.action === 'submitted'
      ? { action: 'submitted', artifactStatus: 'pending', taskStatus: 'submitted', runStatus: 'waiting_review', replayed: false }
      : { action: 'repair_result', repairsRemaining: 2, issueCount: 1, replayed: false };
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ resultSummary: summary }) }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('private-');
  });

  it('audits next_action handler branch and retry count without free-form message', async () => {
    execution.nextAction.mockResolvedValueOnce({ action: 'waiting_dependency', retryAfterSeconds: 3 });
    const server = service().createServer(editor);
    await server._registeredTools.collaboration_next_action.handler({ runId: 'run-1', idempotencyKey: 'next-0002' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ resultSummary: { action: 'waiting_dependency', retryAfterSeconds: 3 } }) }));
  });

  it.each(['draft', 'waiting_review', 'running'])('records top-level run status %s for registered join/get handlers without page body', async (status) => {
    for (const tool of ['collaboration_join_run', 'collaboration_get_run']) {
      jest.clearAllMocks();
      const output = { runId: 'run-1', status, roleSlots: [], assignedTasks: [{ ...assignedTask, targetPage: { ...assignedTask.targetPage, content: 'private-page-body' } }] };
      if (tool === 'collaboration_join_run') execution.joinRun.mockResolvedValueOnce({ ...output, protocol: { nextActionTool: 'wiki_collaboration_next_action', stopOn: ['waiting_human', 'paused', 'completed', 'failed', 'cancelled'] } });
      else execution.getAgentRun.mockResolvedValueOnce(output);
      const server = service().createServer(editor);
      await server._registeredTools[tool].handler({ runId: 'run-1' });
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: `mcp.tool.${tool}`, metadata: expect.objectContaining({ resultSummary: { runStatus: status } }) }));
      expect(JSON.stringify(audit.record.mock.calls)).not.toContain('private-page-body');
      expect(prisma.agentAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ resultSummary: { runStatus: status } }) }) }));
    }
  });

  function service(): any {
    return new McpService(freshnessMock,
      { get: jest.fn() } as any,
      authorization,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      audit,
      prisma,
      {} as any,
      execution,
    );
  }
});
