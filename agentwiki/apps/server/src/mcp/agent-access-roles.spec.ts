import { scopesForAgentAccessRole, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { McpService } from './mcp.service';

describe('MCP Agent access roles', () => {
  const grant: {
    role: AgentAccessRole;
    scopes: string[];
    agent: { status: string; revokedAt: null };
    space: { id: string; name: string; deletedAt: null };
  } = {
    role: 'reader',
    scopes: scopesForAgentAccessRole('reader'),
    agent: { status: 'active', revokedAt: null },
    space: { id: 'space-1', name: 'NeoMei-Space', deletedAt: null },
  };
  const prisma = {
    space: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
    agentGrant: { findUnique: jest.fn(), findMany: jest.fn() },
    page: { findUnique: jest.fn() },
    knowledgeRelation: { findUnique: jest.fn() },
    agentAuditEvent: { create: jest.fn() },
  } as any;
  const pages = { findAll: jest.fn() } as any;
  const review = { propose: jest.fn(), approve: jest.fn() } as any;
  const audit = { record: jest.fn() } as any;
  const authorization = new AuthorizationService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.space.findUnique.mockResolvedValue({ id: 'space-1', deletedAt: null });
    prisma.agentGrant.findUnique.mockImplementation(async () => grant);
    prisma.agentGrant.findMany.mockImplementation(async () => [{
      role: grant.role,
      space: grant.space,
    }]);
    prisma.agentAuditEvent.create.mockResolvedValue({});
    pages.findAll.mockResolvedValue([{ id: 'page-1', title: '吃饭睡觉打豆豆' }]);
    review.propose.mockResolvedValue({ id: 'change-1', status: 'pending_review' });
    audit.record.mockResolvedValue(undefined);
  });

  function createTools(principal: Principal): Record<string, {
    description?: string;
    handler: (args: any) => Promise<any>;
  }> {
    const service = new (McpService as any)(
      { get: jest.fn() },
      authorization,
      {},
      pages,
      {},
      {},
      {},
      review,
      {},
      {},
      audit,
      prisma,
      {},
    );
    return service.createServer(principal)._registeredTools;
  }

  it.each([
    ['reader', false],
    ['editor', true],
    ['publisher', true],
  ] as const)('enforces %s page proposal access', async (role, canPropose) => {
    const principal: Principal = {
      userId: 'owner-1',
      agentId: 'agent-1',
      credentialId: `credential-${role}`,
      agentRole: role,
      scopes: scopesForAgentAccessRole(role),
    };
    grant.role = role;
    grant.scopes = scopesForAgentAccessRole(role);
    const tools = createTools(principal);

    await expect(tools.list_spaces.handler({})).resolves.toBeDefined();
    await expect(tools.list_pages.handler({ spaceId: 'space-1' })).resolves.toBeDefined();

    const proposal = tools.propose_page.handler({
      spaceId: 'space-1',
      title: '吃饭睡觉打豆豆',
      content: '豆豆不能随便打',
    });
    if (canPropose) {
      const response = await proposal;
      expect(response).toBeDefined();
      if (role === 'editor') {
        expect(response.content[0].text).toContain('pending_review');
      }
      expect(review.propose).toHaveBeenCalledWith(
        principal,
        'space-1',
        'Proposed page: 吃饭睡觉打豆豆',
        expect.objectContaining({
          type: 'create_page',
          payload: { title: '吃饭睡觉打豆豆', content: '豆豆不能随便打' },
        }),
      );
    } else {
      await expect(proposal).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
      expect(review.propose).not.toHaveBeenCalled();
    }

    await expect(tools.approve_change_set.handler({ changeSetId: 'change-1' }))
      .rejects.toThrow('Agents cannot approve change sets');
    expect(review.approve).not.toHaveBeenCalled();
  });

  it('does not expose reject, publish, or membership mutation tools to Agents', () => {
    const tools = createTools({
      userId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-publisher',
      agentRole: 'publisher',
      scopes: scopesForAgentAccessRole('publisher'),
    });

    const forbiddenTools = [
      'reject_change_set',
      'publish_change_set',
      'review_publish_change_set',
      'add_space_member',
      'update_space_member',
      'remove_space_member',
    ];
    for (const toolName of forbiddenTools) expect(tools).not.toHaveProperty(toolName);
  });

  it('describes proposals without hiding the governed Publisher path', () => {
    const tools = createTools({
      userId: 'owner-1',
      agentId: 'agent-1',
      credentialId: 'credential-publisher',
      agentRole: 'publisher',
      scopes: scopesForAgentAccessRole('publisher'),
    });

    expect(tools.propose_page.description).toContain('Publisher');
    expect(tools.propose_page.description).toContain('Space policy');
    expect(tools.propose_page.description).not.toContain('never bypasses review');
  });
});
