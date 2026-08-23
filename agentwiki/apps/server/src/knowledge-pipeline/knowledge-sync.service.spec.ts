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
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'source-1' }),
      },
      sourceVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'version-1' }),
      },
      sourceFileSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      ingestRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
      },
      $transaction: jest.fn(async (operation: any) => operation(prisma)),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const authorization = { assertLiveAgentWriteAccess: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      audit,
      authorization,
      service: new KnowledgeSyncService(prisma, audit as any, authorization as any),
    };
  };

  beforeEach(() => jest.clearAllMocks());

  it('creates one OKF source, version, and pinned queued run', async () => {
    const { service, prisma, audit, authorization } = makeHarness();

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
      .resolves.toMatchObject({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });

    expect(prisma.ingestRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputSourceVersionId: 'version-1', idempotencyKey: 'request-1' }),
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
    prisma.ingestRun.findUnique.mockResolvedValue({ id: 'run-1', sourceId: 'source-1', inputSourceVersionId: 'version-1' });

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-1', true))
      .resolves.toMatchObject({ status: 'existing', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1' });

    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
  });

  it('returns no-op without a new run when a completed version hash matches', async () => {
    const { service, prisma } = makeHarness();
    prisma.sourceVersion.findFirst.mockResolvedValue({ id: 'version-1', contentHash: normalizedHash });
    prisma.ingestRun.findFirst.mockResolvedValue({ id: 'run-1', status: 'completed', inputSourceVersionId: 'version-1' });

    await expect(service.createSync('space-1', agentPrincipal, okfBuffer, 'request-2', true))
      .resolves.toEqual({ status: 'noop', sourceId: 'source-1', sourceVersionId: 'version-1', runId: null });
  });

  it('reuses an active run and retries a failed version without duplicating SourceVersion', async () => {
    const { service, prisma } = makeHarness();
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
