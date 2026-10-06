import { ReviewController } from '../../review/review.controller';
import { ReviewService } from '../../review/review.service';
import { SearchController } from '../search/search.controller';
import { McpService } from '../../mcp/mcp.service';

const principal = { userId: 'u' };
const req = { user: principal } as any;
const raw = { id: 'cs', sourceId: 'private', items: [] };
const projected = { id: 'cs', sourceStatus: { status: 'unavailable', reason: 'source_unavailable' } };

describe('Public source projection boundaries', () => {
  it.each(['submit', 'approve', 'reject', 'publish', 'reviewPublish', 'revert'])('projects ReviewController %s response with original Principal', async method => {
    const review: any = { toPublic: jest.fn().mockResolvedValue(projected) };
    for (const name of ['submitForReview','approve','reject','publish','reviewPublish','revert']) review[name] = jest.fn().mockResolvedValue(raw);
    const controller = new ReviewController(review, { assertChangeSetAccess: jest.fn() } as any);
    const result = await (controller as any)[method]('cs', req, { expectedTreeRevision: '1' });
    expect(result).toBe(projected); expect(review.toPublic).toHaveBeenCalledWith(raw, principal);
  });
  it.each([false, true])('projects pending and auto-published propose response (%s) without passing Agent into human publication guard', async autoPublish => {
    const projection = { projectChangeSets: jest.fn(async (rows: any[]) => rows.map(() => projected)) };
    const prisma: any = { changeSet: { create: jest.fn().mockResolvedValue(raw) }, $transaction: async (fn: any) => fn(prisma) };
    const review = new ReviewService(projection as any, prisma, {} as any, {} as any, {} as any);
    const caller = autoPublish ? { userId: 'u', agentId: 'a', credentialId: 'c' } : principal;
    jest.spyOn(review as any, 'assertLiveAgentProposalAccess').mockResolvedValue({});
    jest.spyOn(review as any, 'hasAgentAutoPublishAccess').mockReturnValue(autoPublish);
    const publish = jest.spyOn(review, 'publish').mockResolvedValue({ ...raw, status: 'published' } as any);
    expect(await review.propose(caller, 's', 'title', { type: 'create_page', payload: { title: 'p', content: 'body' } })).toBe(projected);
    expect(projection.projectChangeSets).toHaveBeenCalledWith([expect.objectContaining({ autoPublished: autoPublish })], caller);
    if (autoPublish) expect(publish.mock.calls[0]).toHaveLength(2);
  });
  it('projects nested search Page snapshots without changing ranking', async () => {
    const page = { id: 'p', content: 'body' };
    const search = { searchPages: jest.fn().mockResolvedValue([{ page, similarity: 0, matchType: 'lexical' }]) };
    const freshness = { projectPages: jest.fn().mockResolvedValue([{ ...page, sourceStatus: projected.sourceStatus }]) };
    const controller = new SearchController(freshness as any, search as any, { getAccessibleSpaceIds: jest.fn().mockResolvedValue(['s']) } as any);
    const result = await controller.search(req, 'term');
    expect(result.results[0]).toMatchObject({ similarity: 0, matchType: 'lexical', page: { content: 'body', sourceStatus: projected.sourceStatus } });
    expect(freshness.projectPages).toHaveBeenCalledWith([page], principal);
  });
  it('passes Principal for MCP Page tool/resource, list, graph and Review outputs', async () => {
    const page = { id: 'p', content: 'body', sourceStatus: projected.sourceStatus };
    const pages = { findOne: jest.fn().mockResolvedValue(page), findAll: jest.fn().mockResolvedValue({ data: [page] }) };
    const knowledge = { getGraph: jest.fn().mockResolvedValue({ nodes: [] }) };
    const review = { list: jest.fn().mockResolvedValue([projected]), approve: jest.fn().mockResolvedValue(raw), toPublic: jest.fn().mockResolvedValue(projected) };
    const auth = { assertPageAccess: jest.fn(), assertSpaceAccess: jest.fn(), assertChangeSetAccess: jest.fn(), getAccessibleSpaceIds: jest.fn().mockResolvedValue(['s']) };
    const service = new McpService({} as any, {} as any, auth as any, {} as any, pages as any, knowledge as any, {} as any, {} as any, review as any, {} as any, { record: jest.fn() } as any, {} as any, {} as any, {} as any);
    const server = (service as any).createServer(principal);
    await server._registeredTools.get_page.handler({ pageId: 'p' });
    await server._registeredTools.list_pages.handler({ spaceId: 's' });
    await server._registeredTools.list_graph.handler({ spaceId: 's' });
    await server._registeredTools.list_reviews.handler({ spaceId: 's' });
    await server._registeredTools.approve_change_set.handler({ changeSetId: 'cs' });
    const resource = server._registeredResourceTemplates.page;
    const result = await resource.readCallback(new URL('agentwiki://pages/p'), { pageId: 'p' });
    expect(JSON.parse(result.contents[0].text)).toEqual(page);
    expect(pages.findOne).toHaveBeenCalledTimes(2);
    expect(pages.findOne).toHaveBeenCalledWith('p', principal);
    expect(pages.findAll).toHaveBeenCalledWith(['s'], principal, 's', 0, 20);
    expect(knowledge.getGraph).toHaveBeenCalledWith('s', principal);
    expect(review.list).toHaveBeenCalledWith(['s'], principal);
    expect(review.toPublic).toHaveBeenCalledWith(raw, principal);
  });
});

describe('Source-state personal credentials', () => {
  it('blocks MCP source enumeration and sync-state before loading source data', async () => {
    const failure = new Error('denied');
    const auth = { assertPersonalSourceRead: jest.fn().mockRejectedValue(failure), assertSpaceAccess: jest.fn() };
    const sources = { list: jest.fn() }; const syncs = { getState: jest.fn() };
    const service = new McpService({} as any, {} as any, auth as any, {} as any, {} as any, {} as any, {} as any, sources as any, {} as any, {} as any, { record: jest.fn() } as any, {} as any, syncs as any, {} as any);
    const tools = (service as any).createServer({ userId: 'u', credentialId: 'pat' })._registeredTools;
    await expect(tools.list_sources.handler({ spaceId: 's' })).rejects.toBe(failure);
    await expect(tools.get_knowledge_sync_state.handler({ spaceId: 's', sourceKey: 'key' })).rejects.toBe(failure);
    expect(sources.list).not.toHaveBeenCalled(); expect(syncs.getState).not.toHaveBeenCalled();
  });
});
