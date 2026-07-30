import { PageController } from '../core/page/page.controller';
import { KnowledgeController } from '../core/knowledge/knowledge.controller';

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
});
