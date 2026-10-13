import { McpService } from './mcp.service';

describe('MCP explicit Space context', () => {
  const principal = { userId: 'owner', agentId: 'agent', credentialId: 'credential' };
  const authorization = {
    assertPageAccess: jest.fn(async () => ({ spaceId: 'space-b' })),
    assertSourceAccess: jest.fn(async () => ({ spaceId: 'space-b' })),
  };
  const pages = { findOne: jest.fn(async () => ({})) };
  const sources = { createRun: jest.fn(async () => ({})) };
  const execution = { joinRun: jest.fn(async () => ({})) };
  const prisma = {
    agentAuditEvent: { create: jest.fn() },
    collaborationRun: { findUnique: jest.fn(async () => ({ spaceId: 'space-b' })) },
  };
  const service = new (McpService as any)({}, {}, authorization, {}, pages, {}, {}, sources, { enqueue: jest.fn() }, {}, { record: jest.fn() }, prisma, {}, execution);
  beforeEach(() => jest.clearAllMocks());
  it.each([
    ['get_page', { pageId: 'page-b' }],
    ['start_source_run', { sourceId: 'source-b' }],
    ['collaboration_join_run', { runId: 'run-b' }],
  ])('rejects %s when the resource belongs to another granted Space', async (name, args) => {
    const tool = service.createServer(principal)._registeredTools[name];
    const parsed = tool.inputSchema.parse({ ...args, spaceId: 'space-a' });
    expect(parsed.spaceId).toBe('space-a');
    await expect(tool.handler(parsed)).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(pages.findOne).not.toHaveBeenCalled();
    expect(sources.createRun).not.toHaveBeenCalled();
    expect(execution.joinRun).not.toHaveBeenCalled();
  });
});
