import { BadRequestException } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

describe('McpService transport security', () => {
  const config = { get: jest.fn().mockReturnValue('agentwiki.example,localhost') } as any;
  const dependency = {} as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = { agentAuditEvent: { create: jest.fn().mockResolvedValue({}) } } as any;
  const service = new McpService(
    config,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    dependency,
    audit,
    prisma,
    dependency,
  );

  it('accepts an explicitly allowlisted Host header', () => {
    expect(() => (service as any).validateHost({ headers: { host: 'agentwiki.example:443' } })).not.toThrow();
  });

  it('rejects DNS rebinding through an untrusted Host header', () => {
    expect(() => (service as any).validateHost({ headers: { host: 'attacker.example' } })).toThrow(BadRequestException);
  });

  it('records capability-level success without persisting argument values', async () => {
    await expect((service as any).executeMcpCall(
      'tool.search_pages',
      { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
      { ipAddress: '203.0.113.10', userAgent: 'test' },
      { query: 'secret search', spaceId: 'space-1' },
      async () => 'ok',
    )).resolves.toBe('ok');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mcp.tool.search_pages',
      outcome: 'success',
      metadata: { argumentNames: ['query', 'spaceId'], credentialId: 'credential-1' },
    }));
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain('secret search');
    expect(prisma.agentAuditEvent.create).toHaveBeenCalled();
  });
});

describe('McpService knowledge-sync tool', () => {
  const principal = {
    userId: 'owner-1',
    agentId: 'agent-1',
    credentialId: 'credential-1',
    scopes: ['sources:read'],
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn().mockResolvedValue(undefined),
  } as any;
  const syncs = {
    getState: jest.fn().mockResolvedValue({
      exists: true,
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      syncedAt: new Date('2026-07-29T00:00:00.000Z'),
      documents: [{ path: 'docs/guide.md', contentHash: 'hash-1' }],
    }),
  } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = { agentAuditEvent: { create: jest.fn().mockResolvedValue({}) } } as any;

  beforeEach(() => jest.clearAllMocks());

  it('authorizes sources:read before returning sync state', async () => {
    const service = new (McpService as any)(
      { get: jest.fn() },
      authorization,
      {}, {}, {}, {}, {}, {}, {}, {},
      audit,
      prisma,
      syncs,
    );
    const server = (service as any).createServer(principal);
    const tool = server._registeredTools.get_knowledge_sync_state;

    expect(tool).toBeDefined();
    await tool.handler({ spaceId: 'space-1', sourceKey: 'repo-7f4e' });

    expect(authorization.assertSpaceAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'sources:read',
    );
    expect(syncs.getState).toHaveBeenCalledWith('space-1', 'repo-7f4e');
  });

  it('does not read sync state when sources:read authorization fails', async () => {
    authorization.assertSpaceAccess.mockRejectedValueOnce(new Error('SPACE_ACCESS_DENIED'));
    const service = new (McpService as any)(
      { get: jest.fn() },
      authorization,
      {}, {}, {}, {}, {}, {}, {}, {},
      audit,
      prisma,
      syncs,
    );
    const server = (service as any).createServer(principal);
    const tool = server._registeredTools.get_knowledge_sync_state;

    await expect(tool.handler({ spaceId: 'space-1', sourceKey: 'repo-7f4e' }))
      .rejects.toThrow('SPACE_ACCESS_DENIED');

    expect(syncs.getState).not.toHaveBeenCalled();
  });

  it('advertises the knowledge-sync state tool as sources:read', async () => {
    const controller = new McpController(
      {} as any,
      {
        integrationAccess: jest.fn().mockResolvedValue({}),
        recentMcpCalls: jest.fn().mockResolvedValue([]),
      } as any,
    );

    const result = await controller.info({ user: principal } as any);

    expect(result.tools).toContainEqual({
      name: 'get_knowledge_sync_state',
      requiredScope: 'sources:read',
    });
  });

  it('describes publisher auto-publish as governed by Agent and Space policy', async () => {
    const controller = new McpController(
      {} as any,
      {
        integrationAccess: jest.fn().mockResolvedValue({}),
        recentMcpCalls: jest.fn().mockResolvedValue([]),
      } as any,
    );

    const result = await controller.info({ user: principal } as any);

    expect(result.note).toContain('Publisher');
    expect(result.note).toContain('Space policy');
    expect(result.note).not.toContain('cannot bypass review');
  });
});

describe('McpService relation proposals', () => {
  it('preserves an explicit zero confidence value', async () => {
    const principal = {
      userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1', scopes: ['graph:write'],
    } as any;
    const authorization = {
      assertSpaceAccess: jest.fn().mockResolvedValue(undefined),
      assertPageAccess: jest.fn()
        .mockResolvedValueOnce({ id: 'page-1', spaceId: 'space-1' })
        .mockResolvedValueOnce({ id: 'page-2', spaceId: 'space-1' }),
    } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-1' }) } as any;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const prisma = { agentAuditEvent: { create: jest.fn().mockResolvedValue({}) } } as any;
    const service = new (McpService as any)(
      { get: jest.fn() }, authorization,
      {}, {}, {}, {}, {}, review, {}, {}, audit, prisma, {},
    );
    const tool = (service as any).createServer(principal)._registeredTools.propose_relation;

    await tool.handler({
      spaceId: 'space-1', sourcePageId: 'page-1', targetPageId: 'page-2',
      relation: 'contradicts', confidence: 0,
    });

    expect(review.propose).toHaveBeenCalledWith(
      principal,
      'space-1',
      'Proposed relation',
      expect.objectContaining({ payload: expect.objectContaining({ confidence: 0 }) }),
    );
  });
});
