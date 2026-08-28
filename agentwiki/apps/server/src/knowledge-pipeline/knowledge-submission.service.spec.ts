import { KnowledgeSubmissionService } from './knowledge-submission.service';
import { parseKnowledgeBundle } from './knowledge-bundle';

jest.mock('./knowledge-bundle', () => ({
  ...jest.requireActual('./knowledge-bundle'),
  parseKnowledgeBundle: jest.fn(),
}));

describe('KnowledgeSubmissionService', () => {
  const validBundle = {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'code-wiki@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [{
      pageId: 'page-1',
      spaceId: 'space-1',
      path: '/home',
      title: 'Home',
      body: '# Home',
      artifactIds: ['a1'],
      contentHash: 'h1',
      updatedAt: '2026-07-31T00:00:00.000Z',
    }],
    memories: [],
    relations: [],
    provenance: [],
    deletions: [],
    contentHash: 'bundle-hash',
  };

  const makePrisma = (overrides: any = {}) => ({
    $transaction: jest.fn(async (fn: any) => fn(overrides.tx || makeTx(overrides))),
    ...overrides.prisma,
  } as any);

  const makeTx = (overrides: any = {}) => ({
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async () => overrides.latestRevision || null),
    },
    knowledgeSubmission: {
      findUnique: jest.fn(async () => overrides.existingSubmission || null),
      create: jest.fn(async ({ data }: any) => ({ id: 'sub-1', ...data })),
    },
    changeSet: {
      create: jest.fn(async ({ data }: any) => ({ id: 'cs-1', ...data })),
      update: jest.fn(async () => ({ id: 'cs-1' })),
    },
    space: {
      findUnique: jest.fn(async () => ({ contentTreeRevision: overrides.contentTreeRevision ?? 17n })),
    },
    page: {
      findMany: jest.fn(async () => overrides.existingPages || []),
    },
    agentMemory: {
      findMany: jest.fn(async () => overrides.existingMemories || []),
    },
    knowledgeRelation: {
      findMany: jest.fn(async () => overrides.existingRelations || []),
    },
    ...overrides.tx,
  } as any);

  const auth = {
    assertSpaceAccess: jest.fn(),
    assertLiveAgentWriteAccess: jest.fn().mockResolvedValue(undefined),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('requires explicit confirmation', async () => {
    const service = new KnowledgeSubmissionService(makePrisma(), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, contentHash: 'x' });
    await expect(service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', false)).rejects.toThrow(expect.objectContaining({ businessCode: 'SYNC_CONFIRMATION_REQUIRED' }));
  });

  it('rejects a bundle whose spaceId does not match route', async () => {
    const service = new KnowledgeSubmissionService(makePrisma(), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, spaceId: 'space-2', contentHash: 'x' });
    await expect(service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', true)).rejects.toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BUNDLE_INVALID' }));
  });

  it('rejects a stale base revision', async () => {
    const service = new KnowledgeSubmissionService(makePrisma(), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, baseRevision: 'rev-old', contentHash: 'x' });
    await expect(service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', true)).rejects.toThrow(expect.objectContaining({ businessCode: 'KNOWLEDGE_BASE_STALE' }));
  });

  it('returns existing submission for idempotent retry', async () => {
    const tx = makeTx({ existingSubmission: { id: 'sub-1', status: 'pending_review', changeSetId: 'cs-1' } });
    const service = new KnowledgeSubmissionService(makePrisma({ tx, latestRevision: { id: '0', sequence: 0 } }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, contentHash: 'x' });
    const result = await service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', true);
    expect(result.status).toBe('pending_review');
  });

  it('creates a pending review submission with compiled items', async () => {
    const tx = makeTx({ latestRevision: { id: '0', sequence: 0 } });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, contentHash: 'x' });
    const result = await service.submit('space-1', { userId: 'u1', agentId: 'agent-1', credentialId: 'cred-1' }, Buffer.from('{}'), 'idem-1', true);
    expect(result.status).toBe('pending_review');
    expect(result.changeSetId).toBe('cs-1');
    expect(auth.assertLiveAgentWriteAccess).toHaveBeenCalledWith(
      tx, expect.objectContaining({ agentId: 'agent-1', credentialId: 'cred-1' }),
      'space-1', ['pages:write'],
    );
    expect(tx.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        spaceId: 'space-1',
        title: expect.stringContaining('credential:cred-1'),
      }),
    }));
  });

  it('writes nothing when the Agent authorization changed before the transaction', async () => {
    const tx = makeTx({ latestRevision: { id: '0', sequence: 0 } });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, contentHash: 'x' });
    auth.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(service.submit(
      'space-1',
      { userId: 'u1', agentId: 'agent-1', credentialId: 'cred-1' },
      Buffer.from('{}'), 'idem-revoked', true,
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(tx.changeSet.create).not.toHaveBeenCalled();
    expect(tx.knowledgeSubmission.create).not.toHaveBeenCalled();
  });

  it('returns noop for an empty bundle', async () => {
    const tx = makeTx({ latestRevision: { id: '0', sequence: 0 } });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, pages: [], memories: [], relations: [], deletions: [], contentHash: 'x' });
    const result = await service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', true);
    expect(result.status).toBe('noop');
  });

  it('compiles an existing local knowledge page as an update instead of a duplicate create', async () => {
    const tx = makeTx({
      latestRevision: { id: 'rev-1', sequence: 1 },
      existingPages: [{ id: 'page-1', sourcePath: '/home', title: 'Home', content: '# Old', updatedAt: new Date('2026-07-31T00:00:00.000Z') }],
    });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, baseRevision: 'rev-1', contentHash: 'x' });

    await service.submit('space-1', { userId: 'u1', agentId: 'agent-1', credentialId: 'cred-1' }, Buffer.from('{}'), 'idem-update', true);

    expect(tx.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: { create: [expect.objectContaining({
          type: 'update_page',
          payload: expect.objectContaining({ pageId: 'page-1', changes: expect.objectContaining({ content: '# Home' }) }),
        })] },
      }),
    }));
  });

  it('captures one tree revision for every structural page proposal in the submission transaction', async () => {
    const updatedAt = new Date('2026-07-31T00:00:00.000Z');
    const tx = makeTx({
      latestRevision: { id: 'rev-1', sequence: 1 },
      contentTreeRevision: 23n,
      existingPages: [
        { id: 'page-update', knowledgeKey: 'page-update', sourcePath: '/update', title: 'Old', content: '# Old', updatedAt },
        { id: 'page-archive', knowledgeKey: 'page-archive', sourcePath: '/archive', title: 'Archive', content: '# Archive', updatedAt },
      ],
    });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({
      ...validBundle,
      baseRevision: 'rev-1',
      pages: [
        { ...validBundle.pages[0], pageId: 'page-create', path: '/create', title: 'Create' },
        { ...validBundle.pages[0], pageId: 'page-update', path: '/update', title: 'Updated' },
      ],
      deletions: [{ itemType: 'page', itemId: 'page-archive', reason: 'removed' }],
      contentHash: 'x',
    });

    await service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-tree-cas', true);

    const items = tx.changeSet.create.mock.calls[0][0].data.items.create;
    expect(items.filter((item: any) => ['create_page', 'update_page', 'archive_page'].includes(item.type)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'create_page', payload: expect.objectContaining({ expectedTreeRevision: '23' }) }),
        expect.objectContaining({ type: 'update_page', payload: expect.objectContaining({ expectedTreeRevision: '23' }) }),
        expect.objectContaining({ type: 'archive_page', payload: expect.objectContaining({ expectedTreeRevision: '23' }) }),
      ]));
    expect(tx.space.findUnique).toHaveBeenCalledWith({
      where: { id: 'space-1' },
      select: { contentTreeRevision: true },
    });
  });

  it('returns noop when a full bundle page is unchanged', async () => {
    const tx = makeTx({
      latestRevision: { id: 'rev-1', sequence: 1 },
      existingPages: [{ id: 'page-1', sourcePath: '/home', title: 'Home', content: '# Home', updatedAt: new Date('2026-07-31T00:00:00.000Z') }],
    });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, baseRevision: 'rev-1', contentHash: 'x' });

    await expect(service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-noop', true)).resolves.toMatchObject({ status: 'noop' });
    expect(tx.changeSet.create).not.toHaveBeenCalled();
  });

  it('compiles a changed graph relation as an update', async () => {
    const relation = {
      relationId: 'relation-1', spaceId: 'space-1', sourceId: 'page-a', targetId: 'page-b',
      relationType: 'contradicts', artifactIds: [],
    };
    const tx = makeTx({
      latestRevision: { id: 'rev-1', sequence: 1 },
      existingRelations: [{
        id: 'db-relation-1', knowledgeKey: 'relation-1', relation: 'supports', lastModifiedAt: new Date('2026-07-31T00:00:00.000Z'),
        sourcePage: { knowledgeKey: 'page-a' }, targetPage: { knowledgeKey: 'page-b' },
      }],
    });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({
      ...validBundle, baseRevision: 'rev-1', pages: [], relations: [relation], contentHash: 'x',
    });

    await service.submit('space-1', { userId: 'u1', agentId: 'agent-1', credentialId: 'cred-1' }, Buffer.from('{}'), 'idem-relation', true);

    expect(tx.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ items: { create: [expect.objectContaining({ type: 'update_relation' })] } }),
    }));
  });
});
