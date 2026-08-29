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
    authorizationId: 'grant-1',
    authorizationSpaceId: 'space-1',
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
    const integrationAccess = jest.fn().mockResolvedValue({});
    const controller = new McpController(
      {} as any,
      {
        integrationAccess,
        recentMcpCalls: jest.fn().mockResolvedValue([]),
      } as any,
    );

    const result = await controller.info({ user: principal } as any);

    expect(result.tools).toContainEqual({
      name: 'get_knowledge_sync_state',
      requiredScope: 'sources:read',
    });
    expect(integrationAccess).toHaveBeenCalledWith(
      principal.userId, principal.agentId, principal.authorizationId,
    );
    expect((controller as any).agents.recentMcpCalls).toHaveBeenCalledWith(
      principal.userId, principal.agentId, principal.credentialId,
    );
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
    expect(result.note).not.toContain('Credential and Space Grant');
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

describe('McpService Folder primitives', () => {
  const principal = {
    userId: 'owner-1',
    agentId: 'agent-1',
    credentialId: 'credential-1',
    authorizationId: 'grant-1',
    authorizationSpaceId: 'space-1',
    agentRole: 'publisher',
    scopes: ['folders:read', 'folders:write', 'folders:delete'],
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'publisher' }),
    assertLiveAgentAccess: jest.fn().mockResolvedValue(undefined),
  } as any;
  const review = {
    propose: jest.fn().mockResolvedValue({ id: 'change-1', status: 'pending_review', autoPublished: false }),
  } as any;
  const contentTree = {
    listFolders: jest.fn().mockResolvedValue({
      spaceId: 'space-1',
      treeRevision: 7n,
      data: [{
        id: 'folder-1', parentId: null, name: '私密项目', path: 'pages/私密项目',
        createdAt: new Date('2026-08-29T00:00:00.000Z'),
        updatedAt: new Date('2026-08-29T01:00:00.000Z'),
      }],
      nextCursor: 'cursor-2',
    }),
    deleteImpact: jest.fn().mockResolvedValue({
      treeRevision: 7n,
      rootUpdatedAt: new Date('2026-08-29T01:00:00.000Z'),
      folderCount: 2,
      pageCount: 3,
      impactHash: 'a'.repeat(64),
    }),
  } as any;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const prisma = { agentAuditEvent: { create: jest.fn().mockResolvedValue({}) } } as any;

  const createTools = () => {
    const service = new (McpService as any)(
      { get: jest.fn() }, authorization,
      {}, {}, {}, {}, {}, review, {}, {}, audit, prisma, {}, {}, contentTree,
    );
    return service.createServer(principal)._registeredTools as Record<string, any>;
  };

  beforeEach(() => jest.clearAllMocks());

  it('registers strict, bounded Folder schemas as discriminated MCP primitives', () => {
    const tools = createTools();
    expect(tools.list_folders).toBeDefined();
    expect(tools.propose_folder_change).toBeDefined();

    const listSchema = tools.list_folders.inputSchema;
    expect(() => listSchema.parse({ spaceId: 'space-1', parentFolderId: null, query: 'roadmap', take: 200 }))
      .not.toThrow();
    expect(() => listSchema.parse({ spaceId: 'space-1', take: 0 })).toThrow();
    expect(() => listSchema.parse({ spaceId: 'space-1', take: 201 })).toThrow();
    expect(() => listSchema.parse({ spaceId: 'space-1', query: 'x'.repeat(201) })).toThrow();
    expect(() => listSchema.parse({ spaceId: 'space-1', unknown: true })).toThrow();

    const proposalSchema = tools.propose_folder_change.inputSchema;
    const common = { spaceId: 'space-1', expectedTreeRevision: '7' };
    expect(() => proposalSchema.parse({ ...common, operation: 'create', name: 'Docs', parentId: null }))
      .not.toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'rename', folderId: 'folder-1', name: 'Renamed',
      expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    })).not.toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'move', folderId: 'folder-1', targetParentFolderId: null,
      expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    })).not.toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'delete', folderId: 'folder-1',
      expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    })).not.toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'restore', folderId: 'folder-1', deletionBatchId: 'batch-1',
      mode: 'original', expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    })).not.toThrow();
    expect(() => proposalSchema.parse({ ...common, operation: 'reorder', folderId: 'folder-1' }))
      .toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'rename', folderId: 'folder-1', name: 'Renamed',
    })).toThrow();
    expect(() => proposalSchema.parse({
      ...common, operation: 'create', name: 'Docs', parentId: null, unknown: true,
    })).toThrow();
  });

  it('lists one parent-scoped page and serializes BigInt and Date values', async () => {
    const tools = createTools();
    const response = await tools.list_folders.handler({
      spaceId: 'space-1', parentFolderId: null, query: '项目', cursor: 'cursor-1', take: 20,
    });

    expect(authorization.assertLiveAgentAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['folders:read'],
    );
    expect(contentTree.listFolders).toHaveBeenCalledWith({
      spaceId: 'space-1', parentFolderId: null, query: '项目', cursor: 'cursor-1', take: 20,
    });
    expect(JSON.parse(response.content[0].text)).toEqual({
      spaceId: 'space-1',
      treeRevision: '7',
      data: [{
        id: 'folder-1', parentId: null, name: '私密项目', path: 'pages/私密项目',
        createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T01:00:00.000Z',
      }],
      nextCursor: 'cursor-2',
    });
  });

  it('pins delete impact in the ChangeSet and returns only a bounded summary', async () => {
    const tools = createTools();
    const response = await tools.propose_folder_change.handler({
      operation: 'delete', spaceId: 'space-1', folderId: 'folder-1',
      expectedTreeRevision: '7', expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    });

    expect(authorization.assertLiveAgentAccess).toHaveBeenCalledWith(
      principal, 'space-1', ['folders:write', 'folders:delete'],
    );
    expect(review.propose).toHaveBeenCalledWith(
      principal,
      'space-1',
      'Proposed Folder delete',
      {
        type: 'delete_folder',
        payload: {
          folderId: 'folder-1', expectedTreeRevision: '7',
          expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
          expectedImpactHash: 'a'.repeat(64), folderCount: 2, pageCount: 3,
        },
      },
    );
    expect(JSON.parse(response.content[0].text)).toEqual({
      changeSetId: 'change-1', status: 'pending_review', autoPublished: false,
      impact: {
        operation: 'delete', folderId: 'folder-1', folderCount: 2, pageCount: 3,
        impactHash: 'a'.repeat(64),
      },
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('私密项目');
  });

  it('audits failed private-Space proposals without recording Folder names', async () => {
    review.propose.mockRejectedValueOnce(new BadRequestException('proposal failed'));
    const tools = createTools();

    await expect(tools.propose_folder_change.handler({
      operation: 'rename', spaceId: 'space-1', folderId: 'folder-1',
      name: '私密财务项目', expectedTreeRevision: '7',
      expectedUpdatedAt: '2026-08-29T01:00:00.000Z',
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mcp.tool.propose_folder_change',
      outcome: 'failure',
      metadata: {
        argumentNames: [
          'expectedTreeRevision', 'expectedUpdatedAt', 'folderId', 'name', 'operation', 'spaceId',
        ],
        credentialId: 'credential-1',
      },
    }));
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('私密财务项目');
  });
});
