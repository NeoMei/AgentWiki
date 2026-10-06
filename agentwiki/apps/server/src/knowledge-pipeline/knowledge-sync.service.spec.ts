import { createHash } from 'crypto';
import { KnowledgeSyncService } from './knowledge-sync.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const envelope = {
  okfVersion: '0.1' as const,
  sourceKey: 'workspace-docs',
  name: 'Workspace docs',
  kind: 'documents' as const,
  producer: { name: 'agentwiki-local-sync', version: '0.1.0' },
  documents: [{
    path: 'README.md',
    content: '# Read me\n',
    contentHash: hash('# Read me\n'),
    evidence: [],
  }],
};
const okfBuffer = Buffer.from(JSON.stringify(envelope));
const normalizedHash = hash(JSON.stringify({
  okfVersion: envelope.okfVersion,
  sourceKey: envelope.sourceKey,
  name: envelope.name,
  kind: envelope.kind,
  producer: envelope.producer,
  documents: [{
    path: 'README.md', title: 'Read me', content: '# Read me\n', contentHash: hash('# Read me\n'), evidence: [],
  }],
}));
const agentPrincipal = {
  userId: 'user-1', agentId: 'agent-1', credentialId: 'credential-1', scopes: ['sources:write', 'runs:write'],
};

describe('KnowledgeSyncService', () => {
  const makeHarness = () => {
    const prisma: any = {
      source: {
        findUnique: jest.fn().mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active', currentSourceVersionId: null, currentSourceGeneration: 0 }),
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'source-1' }),
      },
      sourceVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'version-1' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'source-1' }]),
      sourceSyncReceipt: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      sourceFileSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ingestRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      },
      $transaction: jest.fn(async (operation: any) => operation(prisma)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const authorization = { assertLiveAgentWriteAccess: jest.fn().mockResolvedValue(undefined), lockLiveAgentWriteAccessAcrossSpaceBoundary: jest.fn(async (tx, p, space, scopes, lock) => { await authorization.assertLiveAgentWriteAccess(tx, p, space, scopes); return lock(); }) };
    const revisions = { lockSyncSpace: jest.fn(async () => prisma) };
    return {
      prisma,
      audit,
      authorization,
      service: new KnowledgeSyncService(prisma, audit as any, authorization as any, revisions as any),
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates one OKF source, version, and pinned queued run', async () => {
    const { service, prisma, audit, authorization } = makeHarness();

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
      .resolves.toMatchObject({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });

    expect(prisma.ingestRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputSourceVersionId: 'version-1', inputSourceGeneration: 1, idempotencyKey: 'request-1' }),
    }));
    expect(prisma.sourceVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        files: { create: [expect.objectContaining({ path: 'README.md', contentHash: hash('# Read me\n') })] },
      }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'knowledge_sync.create', actorAgentId: 'agent-1',
      metadata: expect.objectContaining({ credentialId: 'credential-1', sourceKey: 'workspace-docs', userConfirmed: true, status: 'queued' }),
    }));
    expect(authorization.assertLiveAgentWriteAccess).toHaveBeenCalledWith(
      prisma, agentPrincipal, 'space-1', ['sources:write', 'runs:write'],
    );
  });

  it('writes nothing when the Agent authorization changed before persistence', async () => {
    const { service, prisma, authorization } = makeHarness();
    authorization.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-revoked', true))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.source.upsert).not.toHaveBeenCalled();
    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
    expect(prisma.ingestRun.create).not.toHaveBeenCalled();
  });

  it('returns the original result for a repeated idempotency key', async () => {
    const { service, prisma } = makeHarness();
    prisma.ingestRun.findUnique.mockResolvedValue({ id: 'run-1', sourceId: 'source-1', inputSourceVersionId: 'version-1', inputSourceVersion: { sourceId: 'source-1', contentHash: normalizedHash } });

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
      .resolves.toMatchObject({ status: 'existing', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });

    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
  });

  it('returns no-op without a new run when a completed version hash matches', async () => {
    const { service, prisma } = makeHarness();
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active', currentSourceVersionId: 'version-1', currentSourceGeneration: 1 });
    prisma.sourceVersion.findFirst.mockResolvedValue({ id: 'version-1', contentHash: normalizedHash });
    prisma.ingestRun.findFirst.mockResolvedValue({ id: 'run-1', status: 'completed', inputSourceVersionId: 'version-1' });

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-2', true))
      .resolves.toEqual({ status: 'noop', sourceId: 'source-1', sourceVersionId: 'version-1', runId: null });
  });

  it('reuses an active run and retries a failed version without duplicating SourceVersion', async () => {
    const { service, prisma } = makeHarness();
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active', currentSourceVersionId: 'version-1', currentSourceGeneration: 1 });
    prisma.sourceVersion.findFirst.mockResolvedValue({ id: 'version-1', contentHash: normalizedHash });
    prisma.ingestRun.findFirst.mockResolvedValueOnce({ id: 'run-active', status: 'extracting', inputSourceVersionId: 'version-1' });

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-2', true))
      .resolves.toMatchObject({ status: 'existing', runId: 'run-active' });

    prisma.ingestRun.findFirst.mockResolvedValueOnce({ id: 'run-failed', status: 'failed', inputSourceVersionId: 'version-1' });
    await service.createSync('space-1', agentPrincipal, okfBuffer, 'request-3', true);

    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
    expect(prisma.ingestRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputSourceVersionId: 'version-1' }),
    }));
  });

  it('refuses an upload without the explicit confirmation declaration', async () => {
    const { service } = makeHarness();

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-3', false))
      .rejects.toMatchObject({ businessCode: 'SYNC_CONFIRMATION_REQUIRED' });
  });

  it('returns only the newest completed or partial snapshot paths and hashes', async () => {
    const { service, prisma } = makeHarness();
    const syncedAt = new Date('2026-07-29T00:00:00.000Z');
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1' });
    prisma.ingestRun.findFirst.mockResolvedValue({
      completedAt: syncedAt,
      inputSourceVersion: {
        id: 'version-2',
        files: [{ path: 'README.md', contentHash: 'new-hash', content: 'must not leak' }],
      },
    });

    await expect(service.getState('space-1', 'workspace-docs')).resolves.toEqual({
      exists: true,
      sourceId: 'source-1',
      sourceVersionId: 'version-2',
      syncedAt,
      documents: [{ path: 'README.md', contentHash: 'new-hash' }],
    });
    expect(prisma.ingestRun.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['completed', 'partial'] } }),
    }));
  });
});

describe('accepted input epochs and durable receipt replay', () => {
  function fixture() {
    const source: any = { id: 'source-1', spaceId: 'space-1', status: 'active', currentSourceVersionId: null, currentSourceGeneration: 0 };
    const versions: any[] = []; const runs: any[] = []; const receipts: any[] = [];
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: source.id }]),
      source: { upsert: jest.fn(async ({ update }) => Object.assign(source, update)), findUnique: jest.fn(async () => source), update: jest.fn(async ({ data }) => Object.assign(source, data)) },
      sourceVersion: {
        findFirst: jest.fn(async ({ where, orderBy }) => orderBy ? versions[versions.length - 1] : versions.find(v => Object.entries(where).every(([k, value]) => v[k] === value)) ?? null),
        create: jest.fn(async ({ data }) => { const v = { ...data, id: `version-${versions.length + 1}` }; versions.push(v); return v; }),
      },
      ingestRun: {
        findUnique: jest.fn(async () => null),
        findFirst: jest.fn(async ({ where }) => [...runs].reverse().find(r => Object.entries(where).every(([k, value]) => r[k] === value)) ?? null),
        create: jest.fn(async ({ data }) => { const run = { ...data, id: `run-${runs.length + 1}`, status: 'queued' }; runs.push(run); return run; }),
      },
      sourceSyncReceipt: {
        findUnique: jest.fn(async ({ where }) => receipts.find(r => r.idempotencyKey === where.sourceId_idempotencyKey.idempotencyKey) ?? null),
        create: jest.fn(async ({ data }) => { receipts.push(structuredClone(data)); return data; }),
      },
      $transaction: jest.fn(async cb => cb(tx)),
    };
    const authorization: any = { lockLiveAgentWriteAccessAcrossSpaceBoundary: jest.fn(async (_tx, _p, _s, _sc, lock) => lock()) };
    const service = new KnowledgeSyncService(tx, { record: jest.fn() } as any, authorization, { lockSyncSpace: async () => tx } as any);
    const input = (content: string) => Buffer.from(JSON.stringify({ ...envelope, name: `${content} name`, producer: { name: `${content} producer`, version: '1.0' }, documents: [{ ...envelope.documents[0], content, contentHash: hash(content) }] }));
    return { source, versions, runs, receipts, service, authorization, input };
  }
  it('A1 -> B2 -> A3 reuses A version but pins a new Run; same content does not advance again', async () => {
    const f = fixture();
    const a1 = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K1', true);
    await f.service.createSync('space-1', agentPrincipal, f.input('B'), 'K2', true);
    const a3 = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K3', true);
    expect(a3.sourceVersionId).toBe(a1.sourceVersionId);
    expect(f.runs.map(r => r.inputSourceGeneration)).toEqual([1, 2, 3]);
    await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K4', true);
    expect(f.source.currentSourceGeneration).toBe(3); expect(f.runs).toHaveLength(3);
  });
  it('records no-op K2 and replays it after B without moving the head or requeueing', async () => {
    const f = fixture();
    await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K1', true); f.runs[0].status = 'completed';
    const noop = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K2', true);
    await f.service.createSync('space-1', agentPrincipal, f.input('B'), 'K3', true);
    expect(await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K2', true)).toEqual(noop);
    expect(f.source.currentSourceGeneration).toBe(2); expect(f.receipts).toHaveLength(3);
    const first = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K1', true);
    expect(first.status).toBe('existing'); expect(f.runs).toHaveLength(2);
    await expect(f.service.createSync('space-1', agentPrincipal, f.input('B'), 'K2', true)).rejects.toMatchObject({ businessCode: 'SOURCE_VERSION_CONFLICT' });
    f.authorization.lockLiveAgentWriteAccessAcrossSpaceBoundary.mockRejectedValueOnce(new Error('revoked'));
    await expect(f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K2', true)).rejects.toThrow('revoked');
  });
  it.each(['ordinary', 'noop', 'manual rename'])('preserves current metadata and head on %s receipt replay', async (scenario) => {
    const f = fixture();
    const first = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K1', true);
    let replayKey = 'K1';
    let expected = { ...first, status: 'existing' };
    if (scenario === 'noop') {
      f.runs[0].status = 'completed';
      expected = await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K-noop', true);
      replayKey = 'K-noop';
    }
    await f.service.createSync('space-1', agentPrincipal, f.input('B'), 'K2', true);
    expect(f.source).toMatchObject({ name: 'B name', config: { kind: 'documents', producer: { name: 'B producer', version: '1.0' } } });
    if (scenario === 'manual rename') f.source.name = 'Manual name';
    const before = structuredClone({ source: f.source, versions: f.versions, runs: f.runs, receipts: f.receipts });

    await expect(f.service.createSync('space-1', agentPrincipal, f.input('A'), replayKey, true)).resolves.toEqual(expected);

    expect({ source: f.source, versions: f.versions, runs: f.runs, receipts: f.receipts }).toEqual(before);
  });
  it('rejects mismatched input for an existing key before changing source state', async () => {
    const f = fixture();
    await f.service.createSync('space-1', agentPrincipal, f.input('A'), 'K1', true);
    const before = structuredClone({ source: f.source, versions: f.versions, runs: f.runs, receipts: f.receipts });

    await expect(f.service.createSync('space-1', agentPrincipal, f.input('B'), 'K1', true))
      .rejects.toMatchObject({ businessCode: 'SOURCE_VERSION_CONFLICT' });

    expect({ source: f.source, versions: f.versions, runs: f.runs, receipts: f.receipts }).toEqual(before);
  });

});
