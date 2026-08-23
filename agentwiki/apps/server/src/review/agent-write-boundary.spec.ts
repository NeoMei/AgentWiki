import { PageController } from '../core/page/page.controller';
import { KnowledgeController } from '../core/knowledge/knowledge.controller';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { SpaceController } from '../core/space/space.controller';
import { ReviewController } from './review.controller';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

describe('Agent write review boundary', () => {
  it('turns Agent REST page creation into a ChangeSet proposal', async () => {
    const pages = { create: jest.fn() } as any;
    const authorization = { assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-1', status: 'pending_review' }) } as any;
    const controller = new PageController(pages, authorization, review);
    const result = await controller.create({ spaceId: 'space-1', title: 'Candidate', content: 'Draft' } as any, { user: { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write'] } } as any);
    expect(result).toMatchObject({ id: 'change-1', status: 'pending_review' });
    expect(review.propose).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-1' }), 'space-1', expect.any(String), expect.objectContaining({ type: 'create_page' }));
    expect(pages.create).not.toHaveBeenCalled();
  });

  it('turns Agent REST page updates into reversible candidate changes', async () => {
    const updatedAt = new Date('2026-07-15T00:00:00.000Z');
    const pages = { update: jest.fn(), findOne: jest.fn().mockResolvedValue({ updatedAt }) } as any;
    const authorization = { assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-2' }) } as any;
    const controller = new PageController(pages, authorization, review);
    await controller.update('page-1', { content: 'Updated', expectedUpdatedAt: updatedAt.toISOString() }, { user: { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write'] } } as any);
    expect(review.propose).toHaveBeenCalledWith(expect.anything(), 'space-1', expect.any(String), { type: 'update_page', payload: { pageId: 'page-1', expectedUpdatedAt: updatedAt.toISOString(), changes: { content: 'Updated' } } });
    expect(pages.update).not.toHaveBeenCalled();
  });

  it('pins the page version when an Agent proposes deleting a page', async () => {
    const updatedAt = new Date('2026-07-15T00:00:00.000Z');
    const pages = { remove: jest.fn(), findOne: jest.fn().mockResolvedValue({ updatedAt }) } as any;
    const authorization = { assertPageAccess: jest.fn().mockResolvedValue({ id: 'page-1', spaceId: 'space-1' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-delete' }) } as any;
    const controller = new PageController(pages, authorization, review);

    await controller.remove('page-1', {
      user: { userId: 'owner-1', agentId: 'agent-1', scopes: ['pages:write'] },
    } as any);

    expect(review.propose).toHaveBeenCalledWith(expect.anything(), 'space-1', expect.any(String), {
      type: 'archive_page',
      payload: { pageId: 'page-1', expectedUpdatedAt: updatedAt.toISOString() },
    });
    expect(pages.remove).not.toHaveBeenCalled();
  });

  it('turns Agent REST relationship creation into a ChangeSet proposal', async () => {
    const knowledge = { createRelation: jest.fn() } as any;
    const authorization = { assertPageAccess: jest.fn().mockResolvedValueOnce({ id: 'page-1', spaceId: 'space-1' }).mockResolvedValueOnce({ id: 'page-2', spaceId: 'space-1' }) } as any;
    const review = { propose: jest.fn().mockResolvedValue({ id: 'change-3' }) } as any;
    const controller = new KnowledgeController(knowledge, authorization, review);
    await controller.createRelation({ sourcePageId: 'page-1', targetPageId: 'page-2', relation: 'depends_on', strength: 1 } as any, { user: { userId: 'owner-1', agentId: 'agent-1', scopes: ['graph:write'] } } as any);
    expect(review.propose).toHaveBeenCalledWith(expect.anything(), 'space-1', expect.any(String), expect.objectContaining({ type: 'create_relation' }));
    expect(knowledge.createRelation).not.toHaveBeenCalled();
  });

  it.each([
    ['decide-item', 'explicit', (controller: ReviewController, request: any) => controller.decideItem(
      'change-1', 'item-1', request, { status: 'accepted' },
    )],
    ['submit', 'role-ceiling', (controller: ReviewController, request: any) => controller.submit('change-1', request)],
    ['approve', 'explicit', (controller: ReviewController, request: any) => controller.approve('change-1', request, {})],
    ['reject', 'explicit', (controller: ReviewController, request: any) => controller.reject('change-1', request, {})],
    ['publish', 'explicit', (controller: ReviewController, request: any) => controller.publish('change-1', request)],
    ['review-publish', 'explicit', (controller: ReviewController, request: any) => controller.reviewPublish('change-1', request, {})],
    ['revert', 'explicit', (controller: ReviewController, request: any) => controller.revert('change-1', request)],
  ] as const)('denies publisher Agents the human-only %s boundary', async (_action, denial, invoke) => {
    const prisma = {
      changeSet: { findUnique: jest.fn().mockResolvedValue({ id: 'change-1', spaceId: 'space-1' }) },
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1',
        role: 'publisher',
        agent: { status: 'active', revokedAt: null },
        space: { deletedAt: null },
      }) },
    } as any;
    const review = {
      decideItem: jest.fn(), submitForReview: jest.fn(), approve: jest.fn(), reject: jest.fn(),
      publish: jest.fn(), reviewPublish: jest.fn(), revert: jest.fn(),
    } as any;
    const controller = new ReviewController(review, new AuthorizationService(prisma));
    const request = {
      user: {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
        authorizationId: 'grant-1', authorizationSpaceId: 'space-1',
        agentRole: 'publisher',
        scopes: [...scopesForAgentAccessRole('publisher'), 'review:decide'],
      },
    } as any;

    if (denial === 'explicit') {
      await expect(invoke(controller, request))
        .rejects.toThrow('Agents cannot approve or publish change sets');
    } else {
      await expect(invoke(controller, request)).rejects.toMatchObject({
        businessCode: 'SPACE_ACCESS_DENIED',
      });
    }
    expect(review.decideItem).not.toHaveBeenCalled();
    expect(review.submitForReview).not.toHaveBeenCalled();
    expect(review.approve).not.toHaveBeenCalled();
    expect(review.reject).not.toHaveBeenCalled();
    expect(review.publish).not.toHaveBeenCalled();
    expect(review.reviewPublish).not.toHaveBeenCalled();
    expect(review.revert).not.toHaveBeenCalled();
  });

  it.each([
    ['add', (controller: SpaceController, request: any) => controller.addMember(
      'space-1', { email: 'member@example.com', role: 'viewer' }, request,
    )],
    ['update', (controller: SpaceController, request: any) => controller.updateMemberRole(
      'space-1', 'user-2', { role: 'editor' }, request,
    )],
    ['remove', (controller: SpaceController, request: any) => controller.removeMember(
      'space-1', 'user-2', request,
    )],
  ] as const)('denies publisher Agents the %s member mutation boundary', async (_action, invoke) => {
    const prisma = {
      space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1',
        role: 'publisher',
        agent: { status: 'active', revokedAt: null },
        space: { deletedAt: null },
      }) },
    } as any;
    const spaces = {
      addMember: jest.fn(), updateMemberRoleAs: jest.fn(), removeMemberAs: jest.fn(),
    } as any;
    const controller = new SpaceController(spaces, new AuthorizationService(prisma));
    const request = {
      user: {
        userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1',
        authorizationId: 'grant-1', authorizationSpaceId: 'space-1',
        agentRole: 'publisher', scopes: scopesForAgentAccessRole('publisher'),
      },
    } as any;

    await expect(invoke(controller, request)).rejects.toMatchObject({
      businessCode: 'SPACE_ACCESS_DENIED',
    });
    expect(spaces.addMember).not.toHaveBeenCalled();
    expect(spaces.updateMemberRoleAs).not.toHaveBeenCalled();
    expect(spaces.removeMemberAs).not.toHaveBeenCalled();
  });
});
