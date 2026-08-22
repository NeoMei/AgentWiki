import { scopesForAgentAccessRole, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService, type Principal } from '../core/authorization/authorization.service';
import { ReviewService } from '../review/review.service';
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
  let spaceApprovalPolicy = 'scoped-auto-publish';
  let agentApprovalMode = 'scoped-auto-publish';
  const prisma = {
    space: { findUnique: jest.fn() },
    agent: { findUnique: jest.fn() },
    spaceMember: { findUnique: jest.fn(), findMany: jest.fn() },
    agentGrant: { findUnique: jest.fn(), findMany: jest.fn() },
    page: { findUnique: jest.fn() },
    knowledgeRelation: { findUnique: jest.fn() },
    changeSet: { create: jest.fn() },
    agentAuditEvent: { create: jest.fn() },
  } as any;
  const pages = { findAll: jest.fn() } as any;
  const review = new ReviewService(prisma, {} as any, {} as any, {} as any, {} as any);
  const propose = jest.spyOn(review, 'propose');
  const approve = jest.spyOn(review, 'approve');
  const publish = jest.spyOn(review, 'publish').mockImplementation(async (changeSetId) => ({
    id: changeSetId,
    status: 'published',
  } as any));
  const audit = { record: jest.fn() } as any;
  const authorization = new AuthorizationService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    spaceApprovalPolicy = 'scoped-auto-publish';
    agentApprovalMode = 'scoped-auto-publish';
    prisma.space.findUnique.mockImplementation(async ({ select }: any) =>
      select?.approvalPolicy
        ? { approvalPolicy: spaceApprovalPolicy }
        : { id: 'space-1', deletedAt: null });
    prisma.agent.findUnique.mockImplementation(async () => ({ approvalMode: agentApprovalMode }));
    prisma.agentGrant.findUnique.mockImplementation(async () => grant);
    prisma.agentGrant.findMany.mockImplementation(async () => [{
      role: grant.role,
      space: grant.space,
    }]);
    prisma.changeSet.create.mockImplementation(async ({ data }: any) => ({
      id: 'change-1',
      status: data.status,
      items: [{ type: data.items.create.type, status: data.items.create.status }],
    }));
    prisma.agentAuditEvent.create.mockResolvedValue({});
    pages.findAll.mockResolvedValue([{ id: 'page-1', title: '吃饭睡觉打豆豆' }]);
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
      const result = JSON.parse(response.content[0].text);
      if (role === 'editor') {
        expect(result).toMatchObject({ status: 'pending_review', autoPublished: false });
        expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'pending_review' }),
        }));
        expect(publish).not.toHaveBeenCalled();
      } else {
        expect(result).toMatchObject({ status: 'published', autoPublished: true });
        expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'approved' }),
        }));
        expect(publish).toHaveBeenCalledWith('change-1');
      }
      expect(propose).toHaveBeenCalledWith(
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
      expect(propose).not.toHaveBeenCalled();
      expect(prisma.changeSet.create).not.toHaveBeenCalled();
    }

    await expect(tools.approve_change_set.handler({ changeSetId: 'change-1' }))
      .rejects.toThrow('Agents cannot approve change sets');
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([
    ['Credential role', () => ({
      credentialRole: 'editor' as const,
      credentialScopes: scopesForAgentAccessRole('publisher'),
    })],
    ['Credential scope', () => ({
      credentialRole: 'publisher' as const,
      credentialScopes: scopesForAgentAccessRole('publisher')
        .filter((scope) => scope !== 'review:auto-publish'),
    })],
    ['Grant role', () => {
      grant.role = 'editor';
      grant.scopes = scopesForAgentAccessRole('publisher');
      return {
        credentialRole: 'publisher' as const,
        credentialScopes: scopesForAgentAccessRole('publisher'),
      };
    }],
    ['Grant scope', () => {
      grant.scopes = scopesForAgentAccessRole('publisher')
        .filter((scope) => scope !== 'review:auto-publish');
      return {
        credentialRole: 'publisher' as const,
        credentialScopes: scopesForAgentAccessRole('publisher'),
      };
    }],
    ['Agent approval mode', () => {
      agentApprovalMode = 'always-review';
      return {
        credentialRole: 'publisher' as const,
        credentialScopes: scopesForAgentAccessRole('publisher'),
      };
    }],
    ['Space policy', () => {
      spaceApprovalPolicy = 'always-review';
      return {
        credentialRole: 'publisher' as const,
        credentialScopes: scopesForAgentAccessRole('publisher'),
      };
    }],
  ] as const)('keeps the MCP proposal pending when the %s gate is missing', async (_gate, arrange) => {
    grant.role = 'publisher';
    grant.scopes = scopesForAgentAccessRole('publisher');
    const { credentialRole, credentialScopes } = arrange();
    const principal: Principal = {
      userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
      agentRole: credentialRole, scopes: credentialScopes,
    };
    const tools = createTools(principal);

    const response = await tools.propose_page.handler({
      spaceId: 'space-1', title: '吃饭睡觉打豆豆', content: '豆豆不能随便打',
    });

    expect(JSON.parse(response.content[0].text)).toMatchObject({
      status: 'pending_review', autoPublished: false,
    });
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
    expect(publish).not.toHaveBeenCalled();
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
