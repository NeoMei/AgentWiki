import { AuthorizationService } from '../core/authorization/authorization.service';
import { ReviewService } from '../review/review.service';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

describe('MCP governed Page proposals', () => {
  const principal = { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' };
  const baseline = {
    spaceId: 'space-1', pageId: 'page-1',
    expectedUpdatedAt: '2026-10-14T00:00:00.000Z', expectedTreeRevision: '41',
  };

  function fixture(options: { role?: string; agentMode?: string; spacePolicy?: string; pageSpace?: string } = {}) {
    const freshness = { projectChangeSets: async (rows: any[]) => rows };
    const writes: any[] = [];
    const prisma: any = {
      space: { findUnique: async () => ({ id: 'space-1', deletedAt: null,
        approvalPolicy: options.spacePolicy ?? 'scoped-auto-publish' }) },
      page: { findUnique: async () => ({ id: 'page-1', spaceId: options.pageSpace ?? 'space-1' }) },
      agent: { findUnique: async () => ({ status: 'active', revokedAt: null,
        approvalMode: options.agentMode ?? 'scoped-auto-publish', owner: { deletedAt: null, lockedAt: null } }) },
      agentCredential: { findFirst: async () => ({ revokedAt: null, expiresAt: null }) },
      agentGrant: { findUnique: async () => ({ id: 'grant-1', role: options.role ?? 'editor', folderScopes: [],
        agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } }) },
      changeSet: { create: async ({ data }: any) => {
        writes.push(data);
        return { id: 'change-1', ...data, items: [{ id: 'item-1', ...data.items.create }] };
      } },
      agentAuditEvent: { create: jest.fn() },
      $queryRaw: async () => [{ id: 'locked-row' }],
      $transaction: async (callback: (db: any) => Promise<any>) => callback(prisma),
    };
    const review = new ReviewService(freshness as any, prisma, {} as any, {} as any, {} as any);
    const publish = jest.spyOn(review, 'publish').mockResolvedValue({ id: 'change-1', status: 'published' } as any);
    const service = new (McpService as any)(freshness, {}, new AuthorizationService(prisma), {}, {}, {}, {}, {},
      review, {}, { record: jest.fn() }, prisma, {}, {});
    const tools = service.createServer(principal)._registeredTools;
    return { tools, writes, publish };
  }

  it.each(['expectedUpdatedAt', 'expectedTreeRevision'] as const)('requires producer %s before proposing an update', async (field) => {
    const { tools, writes } = fixture();
    expect(tools.propose_page_update).toBeDefined();
    const input: Record<string, unknown> = { ...baseline, content: 'New Markdown' };
    delete input[field];
    expect(tools.propose_page_update.inputSchema.safeParse(input).success).toBe(false);
    await expect(tools.propose_page_update.handler(input)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it.each([
    { expectedTreeRevision: 41 }, { expectedTreeRevision: '041' }, { expectedUpdatedAt: 'yesterday' },
    { title: null }, { title: ' \t\u3000' }, { content: null }, { folderId: '' },
    { sourceId: 'other-source' }, { format: 'html' }, { changes: { authorId: 'other-user' } },
  ])('rejects invalid versions or unsupported update fields: %j', async (invalid) => {
    const { tools, writes } = fixture();
    expect(tools.propose_page_update).toBeDefined();
    const input = { ...baseline, content: 'New Markdown', ...invalid };
    expect(tools.propose_page_update.inputSchema.safeParse(input).success).toBe(false);
    await expect(tools.propose_page_update.handler(input)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('rejects an empty update instead of creating a review without changes', async () => {
    const { tools, writes } = fixture();
    expect(tools.propose_page_update).toBeDefined();
    await expect(tools.propose_page_update.handler(baseline)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });

  it('maps only requested Page fields with both producer baselines and preserves the existing format', async () => {
    const { tools, writes, publish } = fixture();
    expect(tools.propose_page_update).toBeDefined();
    const response = await tools.propose_page_update.handler({ ...baseline, title: '项目状态', content: '# 今日进展', folderId: 'folder-1' });
    expect(JSON.parse(response.content[0].text)).toMatchObject({ status: 'pending_review', autoPublished: false });
    expect(writes[0].items.create).toEqual({ type: 'update_page', status: 'pending', payload: {
      pageId: 'page-1', expectedUpdatedAt: '2026-10-14T00:00:00.000Z', expectedTreeRevision: '41',
      changes: { title: '项目状态', content: '# 今日进展', folderId: 'folder-1' },
    } });
    expect(publish).not.toHaveBeenCalled();
  });

  it('preserves explicit folderId null for a root move without clearing omitted content or title', async () => {
    const { tools, writes } = fixture();
    expect(tools.propose_page_update).toBeDefined();
    await tools.propose_page_update.handler({ ...baseline, folderId: null });
    expect(writes[0].items.create.payload.changes).toEqual({ folderId: null });
  });

  it('rejects a target Page from another authorized Space before creating a ChangeSet', async () => {
    const { tools, writes } = fixture({ pageSpace: 'space-2' });
    expect(tools.propose_page_update).toBeDefined();
    await expect(tools.propose_page_update.handler({ ...baseline, content: 'New' }))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(writes).toHaveLength(0);
  });

  it('rejects Reader updates before creating a ChangeSet', async () => {
    const { tools, writes } = fixture({ role: 'reader' });
    expect(tools.propose_page_update).toBeDefined();
    await expect(tools.propose_page_update.handler({ ...baseline, content: 'New' }))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['scoped-auto-publish', 'scoped-auto-publish', true],
    ['review-required', 'scoped-auto-publish', false],
    ['scoped-auto-publish', 'review-required', false],
  ])('Publisher update follows Review policy: Agent %s / Space %s', async (agentMode, spacePolicy, autoPublish) => {
    const { tools, writes, publish } = fixture({ role: 'publisher', agentMode, spacePolicy });
    expect(tools.propose_page_update).toBeDefined();
    const response = await tools.propose_page_update.handler({ ...baseline, content: 'New' });
    expect(JSON.parse(response.content[0].text)).toMatchObject({
      status: autoPublish ? 'published' : 'pending_review', autoPublished: autoPublish,
    });
    expect(writes[0].status).toBe(autoPublish ? 'approved' : 'pending_review');
    expect(publish).toHaveBeenCalledTimes(autoPublish ? 1 : 0);
    if (autoPublish) expect(publish).toHaveBeenCalledWith('change-1', {
      ownerId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
    });
  });

  it.each(['folder-1', null])('creates a Page in the requested Folder %s through Review', async (folderId) => {
    const { tools, writes } = fixture();
    const input = tools.propose_page.inputSchema.parse({
      spaceId: 'space-1', title: '测试报告', content: '# 执行结果', folderId, expectedTreeRevision: '41',
    });
    await tools.propose_page.handler(input);
    expect(writes[0].items.create.payload).toEqual({ title: '测试报告', content: '# 执行结果', folderId, expectedTreeRevision: '41' });
  });

  it('advertises the Page update tool with its write scope', async () => {
    const controller = new McpController({} as any, { integrationAccess: async () => [], recentMcpCalls: async () => [] } as any);
    const result = await controller.info({ user: principal } as any);
    expect(result.tools).toContainEqual({ name: 'propose_page_update', requiredScope: 'pages:write' });
  });
});
