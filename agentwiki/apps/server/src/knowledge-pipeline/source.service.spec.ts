import { BadRequestException } from '@nestjs/common';
import { SourceService } from './source.service';
import axios from 'axios';

describe('SourceService safety and idempotency', () => {
  const prisma = {
    source: { findUnique: jest.fn() },
    ingestRun: { findUnique: jest.fn(), create: jest.fn() },
  } as any;
  const config = { get: jest.fn() } as any;
  const service = new SourceService(prisma, config, {} as any);

  beforeEach(() => jest.clearAllMocks());

  it('returns the existing run for the same source idempotency key', async () => {
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active' });
    prisma.ingestRun.findUnique.mockResolvedValue({ id: 'run-1', idempotencyKey: 'request-1' });
    await expect(service.createRun('source-1', { userId: 'user-1' }, 'request-1')).resolves.toMatchObject({ id: 'run-1' });
    expect(prisma.ingestRun.create).not.toHaveBeenCalled();
  });

  it('rejects private-network URL sources', async () => {
    await expect((service as any).validateRemoteUrl('http://127.0.0.1/admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['::ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:ffff:c0a8:101'])(
    'rejects hexadecimal IPv4-mapped private address %s', (address) => {
    expect((service as any).isPrivateAddress(address)).toBe(true);
    },
  );

  it('rejects malformed remote URLs as a client error', async () => {
    await expect((service as any).validateRemoteUrl('not a url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revalidates every redirect and returns extracted HTML', async () => {
    const validate = jest.spyOn(service as any, 'validateRemoteUrl')
      .mockResolvedValueOnce({ url: new URL('https://example.com/start'), address: '93.184.216.34', family: 4 })
      .mockResolvedValueOnce({ url: new URL('https://www.example.com/page'), address: '93.184.216.34', family: 4 });
    jest.spyOn(axios, 'get')
      .mockResolvedValueOnce({ status: 302, headers: { location: 'https://www.example.com/page' }, data: Buffer.alloc(0) } as any)
      .mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, data: Buffer.from('<h1>正文</h1><p>内容</p>') } as any);
    await expect((service as any).fetchRemoteUrl('https://example.com/start')).resolves.toMatchObject({
      content: expect.stringContaining('# 正文'),
      metadata: expect.objectContaining({ redirectCount: 1, finalUrl: 'https://www.example.com/page' }),
    });
    expect(validate).toHaveBeenCalledTimes(2);
    for (const [, requestConfig] of jest.mocked(axios.get).mock.calls) {
      expect(requestConfig).toEqual(expect.objectContaining({ proxy: false, maxRedirects: 0 }));
    }
  });

  it('rejects a redirect when the next hop resolves to a private address', async () => {
    jest.spyOn(service as any, 'validateRemoteUrl')
      .mockResolvedValueOnce({ url: new URL('https://example.com'), address: '93.184.216.34', family: 4 })
      .mockRejectedValueOnce(new BadRequestException('Private network URLs are not allowed'));
    jest.spyOn(axios, 'get').mockResolvedValueOnce({ status: 302, headers: { location: 'http://127.0.0.1/admin' }, data: Buffer.alloc(0) } as any);
    await expect((service as any).fetchRemoteUrl('https://example.com')).rejects.toThrow('Private network');
  });

  it('rejects a queued Agent run after its credential is revoked even if the grant remains', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        role: 'editor',
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any);
    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'revoked-credential', requestedCredentialType: 'agent',
    })).rejects.toThrow('Run requester is no longer authorized');
  });

  it('returns only the intersection of credential and non-empty grant scopes', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        role: 'editor',
        scopes: ['runs:write', 'pages:read'],
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        scopes: ['runs:write', 'review:auto-publish'],
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    })).resolves.toEqual(['runs:write']);
  });

  it('keeps a queued super-admin run authorized without a space membership', async () => {
    const authorizationPrisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 'admin-1', type: 'human', platformRole: 'super_admin', deletedAt: null,
      }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByUserId: 'admin-1',
      requestedByAgentId: null,
      spaceId: 'space-1',
      requestedCredentialId: null,
      requestedCredentialType: null,
    })).resolves.toEqual([]);
    expect(authorizationPrisma.spaceMember.findUnique).not.toHaveBeenCalled();
  });

  it('keeps a queued human space-admin run authorized for editor-level work', async () => {
    const authorizationPrisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 'admin-1', type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null,
      }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({
        role: 'admin', space: { deletedAt: null }, user: { deletedAt: null, type: 'human' },
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByUserId: 'admin-1', requestedByAgentId: null, spaceId: 'space-1',
      requestedCredentialId: null, requestedCredentialType: null,
    })).resolves.toEqual([]);
  });
});

describe('SourceService pipeline lifecycle', () => {
  const makeHarness = () => {
    const run = {
      id: 'run-1', sourceId: 'source-1', spaceId: 'space-1', requestedByUserId: 'user-1',
      requestedByAgentId: null, requestedScopes: [], cancelRequested: false, attempts: 1, maxAttempts: 3,
      source: { id: 'source-1', type: 'git', name: 'Repository', uri: 'https://github.com/example/repo' },
    };
    const prisma: any = {
      ingestRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      changeSet: { findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({ id: 'change-1' }) },
      artifact: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({}) },
      evidence: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'evidence-1', location: { sourcePath: '__root__' } }]),
      },
      page: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeRelation: { findMany: jest.fn().mockResolvedValue([]) },
      sourceVersion: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null), findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'version-1' }) },
      sourceFileSnapshot: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      space: { findUnique: jest.fn().mockResolvedValue({ approvalPolicy: 'always-review' }) },
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 'user-1', type: 'human', platformRole: 'user', deletedAt: null,
      }) },
      agent: { findUnique: jest.fn() },
      agentGrant: { findUnique: jest.fn() },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'editor', space: { deletedAt: null }, user: { deletedAt: null, type: 'human' } }) },
      agentAuditEvent: { create: jest.fn().mockResolvedValue({}) },
      securityAuditEvent: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (operations: any) => Array.isArray(operations) ? Promise.all(operations) : operations(prisma)),
    };
    prisma.ingestRun.findUnique.mockImplementation(({ include, select }: any) => {
      if (include?.source) return Promise.resolve(run);
      if (select?.cancelRequested) return Promise.resolve({ cancelRequested: false });
      return Promise.resolve(run);
    });
    const review = { publish: jest.fn() } as any;
    const service = new SourceService(prisma, { get: jest.fn() } as any, review);
    return { service, prisma, review, run };
  };

  it('persists Git file snapshots and records every pipeline stage including partial completion', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service as any, 'fetch').mockResolvedValue({
      content: 'repository content',
      metadata: { commit: 'abc123', skippedFiles: 1 },
      files: [{ path: 'README.md', contentHash: 'hash-1', size: 18, commit: 'abc123' }],
    });
    await service.processRun('run-1');
    expect(prisma.sourceFileSnapshot.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ path: 'README.md', commit: 'abc123', sourceVersionId: 'version-1' })] });
    const stages = [
      ...prisma.ingestRun.update.mock.calls,
      ...prisma.ingestRun.updateMany.mock.calls,
    ].map((call: any[]) => call[0].data.stage);
    expect(stages).toEqual(expect.arrayContaining(['extracting', 'compiling', 'indexing', 'partial']));
    expect(prisma.artifact.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'index' }) }));
  });

  it('compiles the pinned OKF version with linked pages and explicit evidence without creating a second version', async () => {
    const { service, prisma, run } = makeHarness();
    const envelope = {
      okfVersion: '0.1', sourceKey: 'workspace-docs', name: 'Workspace docs', kind: 'code',
      producer: { name: 'agentwiki-local-sync', version: '0.1.0' },
      documents: [
        {
          path: 'a.md', title: 'A', content: '# A\n[Read B](b.md)\nexport class App {}', contentHash: 'a'.repeat(64),
          evidence: [{ sourcePath: 'src/app.ts', sourceHash: 'b'.repeat(64), quote: 'export class App\ntoken=top-secret' }],
        },
        { path: 'b.md', title: 'B', content: '# B', contentHash: 'c'.repeat(64), evidence: [] },
      ],
      contentHash: 'd'.repeat(64),
    };
    const pinnedVersion = { id: 'version-pinned', version: 1, contentHash: envelope.contentHash, content: JSON.stringify(envelope) };
    run.source = { id: 'source-1', type: 'okf', name: 'Workspace docs', uri: '' };
    (run as any).inputSourceVersion = pinnedVersion;
    prisma.sourceVersion.findUnique.mockResolvedValue(pinnedVersion);

    await expect(service.processRun('run-1')).resolves.toBeUndefined();

    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
    expect(prisma.artifact.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ type: 'compiled_page', metadata: expect.objectContaining({ sourcePath: 'a.md' }) }),
        expect.objectContaining({ type: 'relation_candidate' }),
      ]),
    }));
    expect(prisma.evidence.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({
          quote: 'export class App\ntoken=[REDACTED]',
          location: expect.objectContaining({
            sourcePath: 'a.md',
            originalSourcePath: 'src/app.ts',
            sourceHash: 'b'.repeat(64),
          }),
        }),
      ]),
    }));
    expect(prisma.changeSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending_review' }),
    }));
  });

  it('fails a pinned OKF run when the version is deleted instead of reading a newer version', async () => {
    const { service, prisma, run } = makeHarness();
    const pinnedVersion = {
      id: 'version-pinned', version: 1, contentHash: 'a'.repeat(64),
      content: JSON.stringify({ documents: [] }),
    };
    run.source = { id: 'source-1', type: 'okf', name: 'Workspace docs', uri: '' };
    (run as any).inputSourceVersion = pinnedVersion;
    prisma.sourceVersion.findUnique.mockResolvedValue(null);

    await expect(service.processRun('run-1')).rejects.toThrow('Pinned source version no longer exists');

    expect(prisma.sourceVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.sourceVersion.create).not.toHaveBeenCalled();
  });

  it('keeps a completed run completed when audit persistence fails', async () => {
    const { service, prisma } = makeHarness();
    jest.spyOn(service as any, 'fetch').mockResolvedValue({ content: 'content' });
    prisma.securityAuditEvent.create.mockRejectedValue(new Error('audit database unavailable'));

    await expect(service.processRun('run-1')).resolves.toBeUndefined();

    const terminalStatuses = prisma.ingestRun.update.mock.calls
      .map((call: any[]) => call[0].data.status)
      .filter(Boolean);
    expect(terminalStatuses).toContain('completed');
    expect(terminalStatuses).not.toContain('queued');
  });

  it('honors cancellation between stages and removes an unpublished candidate set', async () => {
    const { service, prisma, run } = makeHarness();
    jest.spyOn(service as any, 'fetch').mockResolvedValue({ content: 'content' });
    let cancellationChecks = 0;
    prisma.ingestRun.findUnique.mockImplementation(({ include, select }: any) => {
      if (include?.source) return Promise.resolve(run);
      if (select?.cancelRequested) return Promise.resolve({ cancelRequested: ++cancellationChecks === 1 });
      return Promise.resolve({ ...run, cancelRequested: true });
    });
    await expect(service.processRun('run-1')).rejects.toThrow('Run cancelled');
    expect(prisma.changeSet.deleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1', status: { in: ['pending_review', 'approved', 'rejected'] } } });
    expect(prisma.ingestRun.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', stage: 'cancelled' }) }));
  });

  it('recovers all interrupted stages for an independent worker to reclaim', async () => {
    const { service, prisma } = makeHarness();
    await service.recoverInterruptedRuns();
    expect(prisma.ingestRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['reserved', 'fetching', 'extracting', 'compiling', 'indexing'] } }),
      data: expect.objectContaining({ status: 'queued', stage: 'queued', lockedAt: null }),
    }));
  });
});
