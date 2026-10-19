import { AssistDocumentWriter } from './assist-document-writer';

const version = new Date('2026-01-01T00:00:00.000Z');
describe('AssistDocumentWriter atomic page mutations', () => {
  let tx: any; let tree: any; let auth: any; let search: any; let graph: any; let writer: AssistDocumentWriter;
  const task: any = { id: 't1', spaceId: 's1', requestedByUserId: 'u1', pageId: 'p1', pageSnapshot: { title: 'Original', content: 'saved', updatedAt: version.toISOString() } };
  const context: any = { pageId: 'p1', references: [], noteIds: [], directory: { folderId: 'f1', title: 'Folder', recursive: true, documents: [] } };
  beforeEach(() => {
    const page = { id: 'p1', spaceId: 's1', title: 'Original', content: 'saved', updatedAt: version, knowledgeKey: 'k1', folderId: 'f1', syncPath: 'pages/f1/Original.md', syncPathKey: 'pages/f1/original.md', format: 'markdown' };
    tx = { contentTreeRevision: 4n, page: { findFirst: jest.fn().mockResolvedValue(page), create: jest.fn(async ({ data }) => ({ ...data, updatedAt: version })), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn().mockResolvedValue({ ...page, content: 'new', updatedAt: new Date('2026-01-02') }) }, pageVersion: { create: jest.fn() } };
    tree = { lockPageMutationSpace: jest.fn().mockResolvedValue(tx), placePage: jest.fn().mockResolvedValue({ folderId: 'f1', syncPath: 'pages/f1/New.md', syncPathKey: 'pages/f1/new.md' }), advancePageMutation: jest.fn() };
    auth = { assertLiveHumanSpaceAccess: jest.fn().mockResolvedValue({ role: 'editor' }) };
    search = { indexPage: jest.fn() }; graph = { enqueue: jest.fn() };
    writer = new AssistDocumentWriter(auth, tree, search, graph);
  });
  it('updates only the current page with CAS, a saved version, source invalidation and a revision', async () => {
    const receipt = await writer.write(tx, task, context, { action: 'update', summary: 'Saved', changes: 'new' });
    expect(tx.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p1', spaceId: 's1', deletedAt: null, updatedAt: version }, data: expect.objectContaining({ content: 'new', sourceGeneration: null }) }));
    expect(tx.pageVersion.create.mock.calls[0][0].data).toMatchObject({ pageId: 'p1', content: 'saved', authorId: 'u1' });
    expect(tree.advancePageMutation.mock.calls[0][1]).toMatchObject({ structural: false, expectedTreeRevision: 4n, changes: [{ operation: 'upsert', pageId: 'k1', body: 'new' }] });
    expect(receipt).toEqual({ operation: 'updated', pageId: 'p1', title: 'Original', updatedAt: '2026-01-02T00:00:00.000Z', url: '/pages/p1' });
  });
  it('creates only in the captured directory and uses its canonical placement and tree revision', async () => {
    const receipt = await writer.write(tx, { ...task, pageId: null, pageSnapshot: null }, context, { action: 'create', title: 'New', summary: 'Saved', changes: 'new' });
    expect(tree.placePage.mock.calls[0][1]).toMatchObject({ spaceId: 's1', folderId: 'f1', title: 'New', requireUniqueTitle: true });
    expect(tx.page.create.mock.calls[0][0].data).toMatchObject({ spaceId: 's1', folderId: 'f1', title: 'New', content: 'new', syncPath: 'pages/f1/New.md', authorId: 'u1' });
    expect(tree.advancePageMutation.mock.calls[0][1]).toMatchObject({ structural: true, expectedTreeRevision: 4n });
    expect(receipt.operation).toBe('created');
  });
  it('denies writes when membership was revoked or changed to viewer', async () => {
    auth.assertLiveHumanSpaceAccess.mockRejectedValue(new Error('denied'));
    await expect(writer.write(tx, task, context, { action: 'update', summary: 'Saved', changes: 'new' })).rejects.toThrow('denied');
    expect(tx.page.updateMany).not.toHaveBeenCalled(); expect(tx.pageVersion.create).not.toHaveBeenCalled();
  });
  it('rejects stale saved versions before creating history or updating a page', async () => {
    await expect(writer.write(tx, { ...task, pageSnapshot: { ...task.pageSnapshot, updatedAt: '2025-01-01' } }, context, { action: 'update', summary: 'Saved', changes: 'new' })).rejects.toThrow();
    expect(tx.pageVersion.create).not.toHaveBeenCalled(); expect(tx.page.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a lost update even after the initial version read', async () => {
    tx.page.updateMany.mockResolvedValue({ count: 0 });
    await expect(writer.write(tx, task, context, { action: 'update', summary: 'Saved', changes: 'new' })).rejects.toThrow();
    expect(tree.advancePageMutation).not.toHaveBeenCalled();
  });
  it('rejects an update without a current page and create without a directory', async () => {
    await expect(writer.write(tx, { ...task, pageId: null }, context, { action: 'update', summary: 'Saved', changes: 'new' })).rejects.toThrow();
    await expect(writer.write(tx, task, { ...context, directory: undefined }, { action: 'create', title: 'New', summary: 'Saved', changes: 'new' })).rejects.toThrow();
    expect(tx.page.create).not.toHaveBeenCalled(); expect(tx.page.updateMany).not.toHaveBeenCalled();
  });
  it('uses root for a root directory and never accepts a model-supplied target', async () => {
    await writer.write(tx, task, { ...context, directory: { ...context.directory, folderId: null } }, { action: 'create', title: 'New', summary: 'Saved', changes: 'new' });
    expect(tree.placePage.mock.calls[0][1].folderId).toBeNull();
    await expect(writer.write(tx, task, context, { action: 'update', summary: 'Saved', changes: 'new', pageId: 'foreign' } as any)).rejects.toThrow();
  });
  it('preserves all content outside a selected edit and rejects scope escapes', async () => {
    const snapshot = { title: 'Original', content: 'before BODY after', updatedAt: version.toISOString(), assistTarget: { kind: 'selection', from: 7, to: 11, quote: 'BODY', prefix: 'before ', suffix: ' after', baseUpdatedAt: version.toISOString() } };
    await expect(writer.write(tx, { ...task, pageSnapshot: snapshot }, context, { action: 'update', summary: 'Saved', changes: 'outside' })).rejects.toThrow('outside');
    expect(tx.page.updateMany).not.toHaveBeenCalled();
    await writer.write(tx, { ...task, pageSnapshot: snapshot }, context, { action: 'update', summary: 'Saved', changes: 'before NEW after' });
    expect(tx.page.updateMany.mock.calls[0][0].data.content).toBe('before NEW after');
  });
  it('preserves a same-name document when canonical placement reports a conflict', async () => {
    tree.placePage.mockRejectedValue(new Error('PAGE_TITLE_CONFLICT'));
    await expect(writer.write(tx, task, context, { action: 'create', title: 'Original', summary: 'Saved', changes: 'new' })).rejects.toThrow('PAGE_TITLE_CONFLICT');
    expect(tx.page.create).not.toHaveBeenCalled(); expect(tree.advancePageMutation).not.toHaveBeenCalled();
  });
  it('rejects blank or overlong titles, answer writes, and untrusted path/receipt fields', async () => {
    for (const result of [
      { action: 'answer', summary: 'Read' }, { action: 'create', summary: 'Saved', title: ' ', changes: 'new' },
      { action: 'create', summary: 'Saved', title: 'x'.repeat(201), changes: 'new' },
      { action: 'update', summary: 'Saved', changes: 'new', path: '/foreign' },
      { action: 'update', summary: 'Saved', changes: 'new', document: { pageId: 'foreign' } },
    ]) await expect(writer.write(tx, task, context, result)).rejects.toThrow();
    expect(tx.page.updateMany).not.toHaveBeenCalled(); expect(tx.page.create).not.toHaveBeenCalled();
  });
  it('does not turn a committed write into failure when indexing fails', async () => {
    search.indexPage.mockRejectedValue(new Error('offline'));
    await expect(writer.afterCommit('s1', { pageId: 'p1' } as any)).resolves.toBeUndefined();
    expect(graph.enqueue).toHaveBeenCalledWith('s1');
  });
});
