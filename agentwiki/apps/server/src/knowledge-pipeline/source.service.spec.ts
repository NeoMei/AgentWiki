import { BadRequestException } from '@nestjs/common';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { gitCloneArguments, gitSafeEnvironment, SourceService, validateGitTreeInventory } from './source.service';
import axios from 'axios';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { AddressInfo, getDefaultAutoSelectFamily, setDefaultAutoSelectFamily } from 'net';
import { getCACertificates, setDefaultCACertificates } from 'tls';

const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgactuuNQmoisPoOPn
Ycy+WbJir+lvDoj9fO9YODtVPcyhRANCAASdrAj2f8pBQU6Zq9w+JdJj4NgWZ+WE
NWU3y2Lo9lAUrrj1s4lOHLN+ctRij2Frz9cACMxCozr1omzSGCKKtIcl
-----END PRIVATE KEY-----`;

const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUFcxJfIXOj9jTUd/9qnJSfMLzub8wCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLcmVtb3RlLnRlc3QwIBcNMjYwODE5MTQxMDM4WhgPMjEyNjA3
MjYxNDEwMzhaMBYxFDASBgNVBAMMC3JlbW90ZS50ZXN0MFkwEwYHKoZIzj0CAQYI
KoZIzj0DAQcDQgAEnawI9n/KQUFOmavcPiXSY+DYFmflhDVlN8ti6PZQFK649bOJ
ThyzfnLUYo9ha8/XAAjMQqM69aJs0hgiirSHJaNrMGkwHQYDVR0OBBYEFO9t+n3g
kBMvf1aCW5sdzHNDI1paMB8GA1UdIwQYMBaAFO9t+n3gkBMvf1aCW5sdzHNDI1pa
MA8GA1UdEwEB/wQFMAMBAf8wFgYDVR0RBA8wDYILcmVtb3RlLnRlc3QwCgYIKoZI
zj0EAwIDSAAwRQIhAKjSbaJtpBIggERTwkgc0AErtHYED4S6ROLBPMLXsgZxAiAL
4C2nTHhuf8VP66SxPLu9ChpyUNamS/5YNnlDP4Zo6Q==
-----END CERTIFICATE-----`;

type LocalServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

async function listen(server: LocalServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: LocalServer): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('SourceService safety and idempotency', () => {
  const prisma = {
    source: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    ingestRun: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    changeSet: { deleteMany: jest.fn() },
    artifact: { deleteMany: jest.fn() },
    evidence: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const config = { get: jest.fn() } as any;
  const authorization = { assertLiveAgentWriteAccess: jest.fn().mockResolvedValue(undefined) } as any;
  const revisionWriter = { lockContentTreeSpace: jest.fn(async (tx: any) => Object.assign(tx, { contentTreeRevision: 0n })) } as any;
  const service = new SourceService(prisma, config, {} as any, authorization, revisionWriter);
  const agentPrincipal = { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (operation: any) => operation(prisma));
    authorization.assertLiveAgentWriteAccess.mockResolvedValue(undefined);
  });

  it('writes no Source when the Agent Credential is revoked before commit', async () => {
    prisma.source.findUnique.mockResolvedValue(null);
    authorization.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(service.create(
      'space-1',
      { userId: 'owner-1', agentId: 'agent-1', credentialId: 'credential-1' },
      { type: 'text', name: 'Source', content: 'content' },
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.source.create).not.toHaveBeenCalled();
  });

  it('does not return an existing Source after the Agent Credential is revoked', async () => {
    prisma.source.findUnique.mockResolvedValue({ id: 'source-existing', spaceId: 'space-1' });
    authorization.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(service.create(
      'space-1', agentPrincipal,
      { type: 'text', name: 'Source', content: 'content' },
    )).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
  });

  it.each([
    ['update Source', () => service.update('source-1', { name: 'Renamed' }, agentPrincipal)],
    ['create Run', () => service.createRun('source-1', agentPrincipal)],
    ['retry Run', () => service.retryRun('run-1', agentPrincipal)],
    ['cancel Run', () => service.cancelRun('run-1', agentPrincipal)],
  ])('writes nothing when live authorization rejects %s', async (_label, invoke) => {
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active' });
    prisma.ingestRun.findUnique.mockResolvedValue({
      id: 'run-1', sourceId: 'source-1', spaceId: 'space-1', status: 'failed', changeSet: null,
    });
    authorization.assertLiveAgentWriteAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );

    await expect(invoke()).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });

    expect(prisma.source.update).not.toHaveBeenCalled();
    expect(prisma.ingestRun.create).not.toHaveBeenCalled();
    expect(prisma.ingestRun.update).not.toHaveBeenCalled();
    expect(prisma.ingestRun.updateMany).not.toHaveBeenCalled();
  });

  it('returns the existing run for the same source idempotency key', async () => {
    prisma.source.findUnique.mockResolvedValue({ id: 'source-1', spaceId: 'space-1', status: 'active' });
    prisma.ingestRun.findUnique.mockResolvedValue({ id: 'run-1', idempotencyKey: 'request-1' });
    await expect(service.createRun('source-1', { userId: 'user-1' }, 'request-1')).resolves.toMatchObject({ id: 'run-1' });
    expect(prisma.ingestRun.create).not.toHaveBeenCalled();
  });

  it.each([
    ['requeued run', null, 'update'],
    ['replacement run', { status: 'published' }, 'create'],
  ])('attributes a %s retry to the current principal', async (_label, changeSet, operation) => {
    prisma.ingestRun.findUnique.mockResolvedValue({
      id: 'run-1', sourceId: 'source-1', spaceId: 'space-1', status: 'failed', changeSet,
      requestedByUserId: null, requestedByAgentId: 'publisher-agent',
      requestedScopes: ['review:auto-publish'], requestedCredentialId: 'publisher-credential',
      requestedCredentialType: 'agent',
    });
    prisma.ingestRun[operation].mockResolvedValue({ id: 'retried-run' });

    await service.retryRun('run-1', agentPrincipal);

    expect(prisma.ingestRun[operation]).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        requestedByUserId: null,
        requestedByAgentId: 'agent-1',
        requestedScopes: [],
        requestedCredentialId: 'credential-1',
        requestedCredentialType: 'agent',
      }),
    }));
  });

  it('rejects private-network URL sources', async () => {
    await expect((service as any).validateRemoteUrl('http://127.0.0.1/admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects Git inventories that exceed file-count or checkout-byte limits', () => {
    const row = (index: number, size: number) => `100644 blob ${String(index).padStart(40, '0')} ${size}\tfile-${index}.md\0`;
    const tooManyFiles = Array.from({ length: 20_001 }, (_, index) => row(index, 1)).join('');
    expect(() => validateGitTreeInventory(tooManyFiles)).toThrow('Git repository exceeds');

    const tooManyBytes = row(1, 101 * 1024 * 1024);
    expect(() => validateGitTreeInventory(tooManyBytes)).toThrow('Git repository exceeds');
  });

  it('requests a partial clone and disables interactive checkout smudge filters', () => {
    expect(gitCloneArguments('https://github.com/example/repo.git', '/tmp/repo')).toEqual(expect.arrayContaining([
      '--no-checkout', '--filter=blob:none',
    ]));
    const environment = gitSafeEnvironment({ PATH: '/usr/bin', HOME: '/sensitive/home' });
    expect(environment).toEqual(expect.objectContaining({
      PATH: '/usr/bin',
      GIT_LFS_SKIP_SMUDGE: '1',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_ATTR_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    }));
  });

  it.each(['::ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:ffff:c0a8:101'])(
    'rejects hexadecimal IPv4-mapped private address %s', (address) => {
    expect((service as any).isPrivateAddress(address)).toBe(true);
    },
  );

  it('rejects malformed remote URLs as a client error', async () => {
    await expect((service as any).validateRemoteUrl('not a url')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a LookupAddress array when Node 24/26 requests all pinned addresses', async () => {
    const request = jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: Buffer.from('ok'),
    } as any);
    jest.spyOn(service as any, 'validateRemoteUrl').mockResolvedValue({
      url: new URL('https://remote.test/article'), address: '203.0.113.10', family: 4,
    });

    await (service as any).fetchRemoteUrl('https://remote.test/article');

    const config = request.mock.calls[0][1] as any;
    for (const agent of [config.httpAgent, config.httpsAgent]) {
      const resolved = await new Promise<{ address: unknown; family?: number }>((resolve, reject) => {
        agent.options.lookup('remote.test', { all: true }, (error: Error | null, address: unknown, family?: number) => {
          if (error) reject(error);
          else resolve({ address, family });
        });
      });
      expect(resolved).toEqual({ address: [{ address: '203.0.113.10', family: 4 }], family: undefined });
    }
  });

  it.each([
    ['HTTP', 'http', () => createHttpServer((_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<h1>HTTP article</h1>');
    })],
    ['HTTPS', 'https', () => createHttpsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end('<h1>HTTPS article</h1>');
    })],
  ])('fetches through a real local %s server with Axios and the production Agent', async (_label, scheme, makeServer) => {
    const server = makeServer();
    const originalCAs = getCACertificates('default');
    if (scheme === 'https') setDefaultCACertificates([...originalCAs, TEST_TLS_CERT]);
    try {
      const port = await listen(server);
      const remoteUrl = `${scheme}://remote.test:${port}/article`;
      jest.spyOn(service as any, 'validateRemoteUrl').mockImplementation(async (value: string) => ({
        url: new URL(value), address: '127.0.0.1', family: 4,
      }));

      await expect((service as any).fetchRemoteUrl(remoteUrl)).resolves.toMatchObject({
        content: expect.stringContaining(`${_label} article`),
        metadata: expect.objectContaining({ finalUrl: remoteUrl }),
      });
      expect(jest.isMockFunction(axios.get)).toBe(false);
    } finally {
      if (scheme === 'https') setDefaultCACertificates(originalCAs);
      if (server.listening) await close(server);
    }
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
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);
    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'revoked-credential', requestedCredentialType: 'agent',
    })).rejects.toThrow('Run requester is no longer authorized');
  });

  it('returns scopes derived solely from the Credential-bound Grant role', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1', role: 'editor',
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-1',
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    })).resolves.toEqual(scopesForAgentAccessRole('editor'));
  });

  it.each(['editor', 'publisher'] as const)(
    'derives queued-run scopes from the live %s Grant',
    async (grantRole) => {
      const authorizationPrisma = {
        agentGrant: { findUnique: jest.fn().mockResolvedValue({
          id: 'grant-1', role: grantRole,
          agent: { status: 'active', revokedAt: null, owner: { deletedAt: null, lockedAt: null } },
          space: { deletedAt: null },
        }) },
        agentCredential: { findFirst: jest.fn().mockResolvedValue({
          authorizationId: 'grant-1',
        }) },
      } as any;
      const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

      await expect((authorizationService as any).assertRequesterStillAuthorized({
        requestedByAgentId: 'agent-1', spaceId: 'space-1',
        requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
      })).resolves.toEqual(scopesForAgentAccessRole(grantRole));
    },
  );

  it('crosses the Space advisory boundary before locking the authoritative Space row', async () => {
    const lockEvents: string[] = [];
    const authorizationPrisma = {
      $queryRaw: jest.fn(async (query: any) => {
        const sql = query.strings.join('');
        lockEvents.push(`lock:${/FROM\s+"([^"]+)"/u.exec(sql)?.[1]}`);
        return [{ id: 'locked' }];
      }),
      agent: { findUnique: jest.fn().mockImplementation(async ({ select }: any) => (
        select?.ownerId
          ? { ownerId: 'owner-1' }
          : {
            status: 'active', revokedAt: null, approvalMode: 'always-review', memoryEnabled: true,
            owner: { deletedAt: null, lockedAt: null },
          }
      )) },
      agentGrant: { findUnique: jest.fn().mockResolvedValue({ id: 'grant-1', role: 'editor' }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
      }) },
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, approvalPolicy: 'always-review' }) },
    } as any;
    const lockedTx = Object.assign(authorizationPrisma, { contentTreeRevision: 0n });
    const revisionWriter = {
      lockContentTreeSpace: jest.fn(async () => {
        lockEvents.push('space-advisory');
        return lockedTx;
      }),
    };
    const authorizationService = new SourceService(
      authorizationPrisma, config, {} as any, {} as any, revisionWriter as any,
    );

    await expect((authorizationService as any).lockRequesterContentTreeSpace({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    }, authorizationPrisma)).resolves.toMatchObject({
      lockedTx,
      currentScopes: scopesForAgentAccessRole('editor'),
    });

    expect(lockEvents).toEqual([
      'lock:User',
      'lock:Agent',
      'lock:AgentGrant',
      'lock:AgentCredential',
      'space-advisory',
      'lock:Space',
    ]);
  });

  it('allows a queued publisher run when credential and grant remain authorized', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1', role: 'publisher',
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null, lockedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-1',
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    })).resolves.toEqual(scopesForAgentAccessRole('publisher'));
  });

  it('rejects a queued run when the Credential is bound to another Grant', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1', role: 'publisher',
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null, lockedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-other',
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    })).rejects.toThrow('Run requester is no longer authorized');
  });

  it('rejects a queued run when the sole Grant role is Reader', async () => {
    const authorizationPrisma = {
      agentGrant: { findUnique: jest.fn().mockResolvedValue({
        id: 'grant-1', role: 'reader',
        agent: { status: 'active', revokedAt: null, owner: { deletedAt: null, lockedAt: null } },
        space: { deletedAt: null },
      }) },
      agentCredential: { findFirst: jest.fn().mockResolvedValue({
        authorizationId: 'grant-1',
      }) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

    await expect((authorizationService as any).assertRequesterStillAuthorized({
      requestedByAgentId: 'agent-1', spaceId: 'space-1',
      requestedCredentialId: 'credential-1', requestedCredentialType: 'agent',
    })).rejects.toThrow('Run requester is no longer authorized');
  });

  it('keeps a queued super-admin run authorized without a space membership', async () => {
    const authorizationPrisma = {
      user: { findUnique: jest.fn().mockResolvedValue({
        id: 'admin-1', type: 'human', platformRole: 'super_admin', deletedAt: null,
      }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

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
    const authorizationService = new SourceService(authorizationPrisma, config, {} as any, {} as any, {} as any);

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
      space: { findUnique: jest.fn().mockResolvedValue({ approvalPolicy: 'always-review', contentTreeRevision: 17n }) },
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
    const revisionWriter = {
      lockContentTreeSpace: jest.fn(async (tx: any, spaceId: string) => {
        const space = await tx.space.findUnique({
          where: { id: spaceId, deletedAt: null },
          select: { contentTreeRevision: true },
        });
        return space ? Object.assign(tx, { contentTreeRevision: space.contentTreeRevision }) : null;
      }),
    } as any;
    const service = new SourceService(
      prisma, { get: jest.fn() } as any, review, {} as any, revisionWriter,
    );
    return { service, prisma, review, run, revisionWriter };
  };

  beforeEach(() => jest.restoreAllMocks());

  it('persists structured safe diagnostics when a URL Run fails during fetching', async () => {
    const { service, prisma, run } = makeHarness();
    const originalAutoSelectFamily = getDefaultAutoSelectFamily();
    setDefaultAutoSelectFamily(false);
    const server = createHttpServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    const port = await listen(server);
    const remoteUrl = `http://remote.test:${port}/binary`;
    run.source = { id: 'source-1', type: 'url', name: 'Remote article', uri: remoteUrl };
    run.attempts = run.maxAttempts;
    jest.spyOn(service as any, 'validateRemoteUrl').mockImplementation(async (value: string) => ({
      url: new URL(value), address: '127.0.0.1', family: 4,
    }));

    try {
      await service.processRun('run-1').catch(() => undefined);
    } finally {
      setDefaultAutoSelectFamily(originalAutoSelectFamily);
      if (server.listening) await close(server);
    }

    const failedUpdate = prisma.ingestRun.update.mock.calls
      .map((call: any[]) => call[0])
      .find((call: any) => call.data.status === 'failed');
    expect(failedUpdate).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        error: expect.any(String),
        result: {
          failure: { stage: 'fetching', code: 'REMOTE_CONTENT_TYPE_UNSUPPORTED' },
          sourceMetadata: {
            finalUrl: remoteUrl,
            resolvedAddress: '127.0.0.1',
            contentType: 'image/png',
            statusCode: 200,
            redirectCount: 0,
          },
        },
      }),
    }));
    expect(JSON.stringify(failedUpdate)).not.toContain('89504e47');

    prisma.ingestRun.findUnique.mockResolvedValueOnce({
      id: 'run-1',
      sourceId: 'source-1',
      status: 'failed',
      stage: 'failed',
      ...failedUpdate.data,
    });
    await expect(service.getRun('run-1')).resolves.toMatchObject({
      status: 'failed',
      result: {
        failure: { stage: 'fetching', code: 'REMOTE_CONTENT_TYPE_UNSUPPORTED' },
        sourceMetadata: expect.objectContaining({
          finalUrl: remoteUrl,
          resolvedAddress: '127.0.0.1',
          contentType: 'image/png',
          statusCode: 200,
        }),
      },
    });
  });

  it('redacts signed redirect credentials before persisting failed URL diagnostics', async () => {
    const { service, prisma, run } = makeHarness();
    const originalAutoSelectFamily = getDefaultAutoSelectFamily();
    setDefaultAutoSelectFamily(false);
    let port = 0;
    const server = createHttpServer((request, response) => {
      if (request.url === '/start') {
        response.statusCode = 302;
        response.setHeader(
          'location',
          `http://remote.test:${port}/binary?X-Amz-Signature=top-secret&token=also-secret#private-fragment`,
        );
        response.end();
        return;
      }
      response.statusCode = 200;
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    port = await listen(server);
    run.source = { id: 'source-1', type: 'url', name: 'Signed redirect', uri: `http://remote.test:${port}/start` };
    run.attempts = run.maxAttempts;
    jest.spyOn(service as any, 'validateRemoteUrl').mockImplementation(async (value: string) => ({
      url: new URL(value), address: '127.0.0.1', family: 4,
    }));

    try {
      await service.processRun('run-1').catch(() => undefined);
    } finally {
      setDefaultAutoSelectFamily(originalAutoSelectFamily);
      if (server.listening) await close(server);
    }

    const failedUpdate = prisma.ingestRun.update.mock.calls
      .map((call: any[]) => call[0])
      .find((call: any) => call.data.status === 'failed');
    expect(failedUpdate.data.result).toEqual({
      failure: { stage: 'fetching', code: 'REMOTE_CONTENT_TYPE_UNSUPPORTED' },
      sourceMetadata: expect.objectContaining({
        finalUrl: `http://remote.test:${port}/binary`,
        redirectCount: 1,
      }),
    });
    expect(JSON.stringify(failedUpdate.data.result)).not.toContain('top-secret');
    expect(JSON.stringify(failedUpdate.data.result)).not.toContain('also-secret');
    expect(JSON.stringify(failedUpdate.data.result)).not.toContain('private-fragment');

    prisma.ingestRun.findUnique.mockResolvedValueOnce({
      id: 'run-1',
      status: 'failed',
      stage: 'failed',
      ...failedUpdate.data,
    });
    const exposedRun = await service.getRun('run-1');
    expect(exposedRun.result).toEqual(expect.objectContaining({
      sourceMetadata: expect.objectContaining({ finalUrl: `http://remote.test:${port}/binary` }),
    }));
    expect(JSON.stringify(exposedRun)).not.toContain('top-secret');
    expect(JSON.stringify(exposedRun)).not.toContain('also-secret');
    expect(JSON.stringify(exposedRun)).not.toContain('private-fragment');
  });

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

  it('passes the current Agent and Credential identity into background auto-publish revalidation', async () => {
    const { service, prisma, review, run } = makeHarness();
    run.requestedByUserId = null as any;
    run.requestedByAgentId = 'agent-1' as any;
    (run as any).requestedCredentialId = 'credential-1';
    (run as any).requestedCredentialType = 'agent';
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ id: 'locked' }]);
    prisma.space.findUnique.mockResolvedValue({
      deletedAt: null, approvalPolicy: 'scoped-auto-publish', contentTreeRevision: 17n,
    });
    prisma.agent.findUnique.mockResolvedValue({
      ownerId: 'owner-1', status: 'active', revokedAt: null,
      approvalMode: 'scoped-auto-publish', memoryEnabled: true,
      owner: { deletedAt: null, lockedAt: null },
    });
    prisma.agentGrant.findUnique.mockResolvedValue({
      id: 'grant-1', role: 'publisher',
      agent: {
        status: 'active', revokedAt: null,
        owner: { deletedAt: null, lockedAt: null },
      },
      space: { deletedAt: null },
    });
    prisma.agentCredential = { findFirst: jest.fn().mockResolvedValue({
      authorizationId: 'grant-1', revokedAt: null, expiresAt: null,
    }) };
    jest.spyOn(service as any, 'fetch').mockResolvedValue({ content: 'content' });

    await service.processRun('run-1');

    expect(review.publish).toHaveBeenCalledWith('change-1', {
      agentId: 'agent-1',
      credentialId: 'credential-1',
    });
    expect(prisma.agentCredential.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'credential-1', agentId: 'agent-1' }),
      select: { authorizationId: true },
    }));
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

  it('captures one tree revision for create, update, and archive page proposals', async () => {
    const { service, prisma, revisionWriter } = makeHarness();
    const updatedAt = new Date('2026-08-28T00:00:00.000Z');
    jest.spyOn(service as any, 'fetch').mockResolvedValue({
      content: 'unused',
      segments: [
        { sourcePath: 'create.md', title: 'Create', content: '# Create', format: 'markdown' },
        { sourcePath: 'update.md', title: 'Updated', content: '# Updated', format: 'markdown' },
      ],
    });
    prisma.page.findMany.mockResolvedValue([
      { id: 'page-update', sourcePath: 'update.md', title: 'Old', content: '# Old', format: 'markdown', sourceVersionId: 'version-old', updatedAt },
      { id: 'page-archive', sourcePath: 'archive.md', title: 'Archive', content: '# Archive', format: 'markdown', sourceVersionId: 'version-old', updatedAt },
    ]);
    prisma.space.findUnique.mockResolvedValue({ approvalPolicy: 'always-review', contentTreeRevision: 29n });

    await service.processRun('run-1');

    const items = prisma.changeSet.create.mock.calls[0][0].data.items.create;
    expect(items.filter((item: any) => ['create_page', 'update_page', 'archive_page'].includes(item.type)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'create_page', payload: expect.objectContaining({ expectedTreeRevision: '29' }) }),
        expect.objectContaining({ type: 'update_page', payload: expect.objectContaining({ expectedTreeRevision: '29' }) }),
        expect.objectContaining({ type: 'archive_page', payload: expect.objectContaining({ expectedTreeRevision: '29' }) }),
      ]));
    expect(revisionWriter.lockContentTreeSpace).toHaveBeenCalledWith(prisma, 'space-1');
    expect(prisma.space.findUnique).toHaveBeenCalledWith({
      where: { id: 'space-1' },
      select: { approvalPolicy: true },
    });
  });

  it('locks live requester policy before the Space lock, then scans and persists one locked snapshot', async () => {
    const { service, prisma } = makeHarness();
    const events: string[] = [];
    const revisionWriter = {
      lockContentTreeSpace: jest.fn(async (tx: any) => {
        events.push('lock');
        return Object.assign(tx, { contentTreeRevision: 31n });
      }),
    };
    (service as any).revisionWriter = revisionWriter;
    jest.spyOn(service as any, 'assertRequesterStillAuthorized').mockImplementation(
      async (_run: unknown, db?: unknown) => {
        if (db) events.push('authorization');
        return [];
      },
    );
    jest.spyOn(service as any, 'fetch').mockResolvedValue({ content: 'content' });
    prisma.page.findMany.mockImplementation(async () => {
      events.push('page-scan');
      return [];
    });
    prisma.changeSet.create.mockImplementation(async ({ data }: any) => {
      events.push('change-set');
      return { id: 'change-1', ...data };
    });
    prisma.space.findUnique.mockResolvedValue({
      approvalPolicy: 'always-review', contentTreeRevision: 99n,
    });

    await service.processRun('run-1');

    expect(revisionWriter.lockContentTreeSpace).toHaveBeenCalledWith(prisma, 'space-1');
    expect(events).toEqual(expect.arrayContaining(['authorization', 'lock', 'page-scan', 'change-set']));
    expect(events.indexOf('authorization')).toBeLessThan(events.indexOf('lock'));
    expect(events.indexOf('lock')).toBeLessThan(events.indexOf('page-scan'));
    expect(events.indexOf('page-scan')).toBeLessThan(events.indexOf('change-set'));
    expect(prisma.changeSet.create.mock.calls[0][0].data.items.create[0].payload)
      .toEqual(expect.objectContaining({ expectedTreeRevision: '31' }));
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
