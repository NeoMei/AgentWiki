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
    ...overrides.tx,
  } as any);

  const auth = { assertSpaceAccess: jest.fn() } as any;

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
    expect(tx.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        spaceId: 'space-1',
        title: expect.stringContaining('credential:cred-1'),
      }),
    }));
  });

  it('returns noop for an empty bundle', async () => {
    const tx = makeTx({ latestRevision: { id: '0', sequence: 0 } });
    const service = new KnowledgeSubmissionService(makePrisma({ tx }), {} as any, auth);
    (parseKnowledgeBundle as jest.Mock).mockReturnValue({ ...validBundle, pages: [], memories: [], relations: [], deletions: [], contentHash: 'x' });
    const result = await service.submit('space-1', { userId: 'u1' }, Buffer.from('{}'), 'idem-1', true);
    expect(result.status).toBe('noop');
  });
});
