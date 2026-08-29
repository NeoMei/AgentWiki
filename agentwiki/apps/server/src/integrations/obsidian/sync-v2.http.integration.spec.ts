import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HttpAdapterHost } from '@nestjs/core';
import { AddressInfo } from 'net';
import { AllExceptionsFilter } from '../../core/filters/all-exceptions.filter';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncV2Controller } from './sync-v2.controller';
import { SyncV2RevisionService } from './sync-v2-revision.service';
import { PushSessionService } from './push-session.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';

describe('sync v2 HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const prisma = {
    humanDeviceCredential: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cred-1', credentialFamilyId: 'family-1', userId: 'user-1',
        deviceId: 'device-1', vaultId: 'vault-1', status: 'active',
        user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
    spaceMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'editor' }),
      findMany: jest.fn().mockResolvedValue([{
        role: 'admin', createdAt: new Date('2026-08-29T00:00:00.000Z'),
        space: { id: 'space-1', name: 'Space', deletedAt: null },
      }]),
    },
  } as any;
  const revisions = {
    head: jest.fn().mockResolvedValue({
      protocolVersion: '2', spaceId: 'space-1', revision: '0', sequence: 0,
      revisionContentHash: emptyHash, folderCount: '0', pageCount: '0',
      revisionManifestByteLength: '0', revisionBodyBytes: '0', publishedAt: null,
    }),
    snapshot: jest.fn().mockResolvedValue({
      protocolVersion: '2', spaceId: 'space-1', revision: '0', sequence: 0,
      revisionContentHash: emptyHash, folderCount: '0', pageCount: '0',
      revisionManifestByteLength: '0', revisionBodyBytes: '0',
      folders: [], pages: [], nextCursor: null,
    }),
    delta: jest.fn().mockResolvedValue({
      protocolVersion: '2', spaceId: 'space-1', fromRevision: '0', toRevision: '0',
      toSequence: 0, toRevisionContentHash: emptyHash, toFolderCount: '0', toPageCount: '0',
      toRevisionManifestByteLength: '0', toRevisionBodyBytes: '0', items: [], nextCursor: null,
    }),
  };
  const pushSessions = {
    createV2: jest.fn().mockResolvedValue({ protocolVersion: '2', sessionId: 'session-1' }),
    uploadV2: jest.fn().mockResolvedValue({ protocolVersion: '2', sessionId: 'session-1' }),
    finalizeV2: jest.fn().mockResolvedValue({ protocolVersion: '2', status: 'noop', revision: '0' }),
    getV2: jest.fn(), abortV2: jest.fn(),
  };
  const capabilities = {
    capabilitiesV2: jest.fn().mockReturnValue({
      maxPageBytes: 1_048_576, maxBatchBytes: 4_194_304, maxBatchItems: 100,
      maxChangeCount: 100, maxConfirmationBytes: 4_194_304, maxClientSpacePages: 5_000,
      maxClientSpaceFolders: 10_000, maxSnapshotObjects: 15_000,
      maxClientManifestBytes: 4_194_304, maxClientTotalBodyBytes: 2_097_152,
      maxDeltaItems: 15_000,
      maxResponseBytes: 4_194_304, maxPageItems: 100, pushSessionTtlSeconds: 900,
    }),
    hashV2: jest.fn().mockResolvedValue('a'.repeat(64)),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncV2Controller],
      providers: [
        HumanDeviceGuard,
        { provide: ObsidianCryptoService, useValue: { credentialHash: (value: string) => `h:${value}` } },
        { provide: PrismaService, useValue: prisma },
        { provide: SyncV2RevisionService, useValue: revisions },
        { provide: PushSessionService, useValue: pushSessions },
        { provide: SyncCapabilitiesService, useValue: capabilities },
      ],
    }).compile();
    prisma.humanDeviceCredential.findUnique.mockImplementation(async ({ where }: any) => (
      where.credentialHash === 'h:device-secret' ? {
        id: 'cred-1', credentialFamilyId: 'family-1', userId: 'user-1',
        deviceId: 'device-1', vaultId: 'vault-1', status: 'active',
        user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
      } : null
    ));
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  const auth = { Authorization: 'Bearer device-secret' };

  it('negotiates the exact v2 capabilities and binding hash under device authentication', async () => {
    const response = await fetch(`${baseUrl}/sync/v2/capabilities`, { headers: auth });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocolVersion: '2',
      capabilities: capabilities.capabilitiesV2(),
      capabilitiesHash: 'a'.repeat(64),
    });
    expect(capabilities.hashV2).toHaveBeenCalledTimes(1);
  });

  it('serves the v2 head with no redirect', async () => {
    const response = await fetch(`${baseUrl}/sync/v2/spaces/space-1/head`, {
      headers: auth, redirect: 'manual',
    });
    expect(response.status).toBe(200);
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
    expect(await response.json()).toEqual(expect.objectContaining({
      protocolVersion: '2', folderCount: '0', pageCount: '0',
    }));
  });

  it('returns a retryable protocol-v2 INTERNAL_ERROR when a logical read transaction fails', async () => {
    const failingReader = new SyncV2RevisionService(
      {
        $transaction: jest.fn().mockRejectedValue(
          Object.assign(new Error('transaction expired with private details'), { code: 'P2028' }),
        ),
      } as any,
      {} as any,
      {} as any,
    );
    revisions.head.mockImplementationOnce((spaceId: string) => failingReader.head(spaceId));

    const response = await fetch(`${baseUrl}/sync/v2/spaces/space-1/head`, { headers: auth });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      protocolVersion: '2',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Revision read temporarily unavailable',
        retryable: true,
      },
    });
  });

  it('reports Space Admin as read-only for Folder-aware publishing', async () => {
    const response = await fetch(`${baseUrl}/sync/v2/spaces`, { headers: auth });

    expect(response.status).toBe(200);
    expect((await response.json()).spaces).toEqual([
      expect.objectContaining({ spaceId: 'space-1', role: 'admin', canRead: true, canPublish: false }),
    ]);
  });

  it('binds snapshot and delta query parameters to the immutable revision service', async () => {
    await fetch(`${baseUrl}/sync/v2/spaces/space-1/snapshot?revision=rev-1&cursor=cursor-1&limit=7`, { headers: auth });
    await fetch(`${baseUrl}/sync/v2/spaces/space-1/delta?from=rev-1&cursor=cursor-2&limit=8`, { headers: auth });

    expect(revisions.snapshot).toHaveBeenCalledWith('space-1', 'rev-1', 'cursor-1', 7);
    expect(revisions.delta).toHaveBeenCalledWith('space-1', 'rev-1', 'cursor-2', 8);
  });

  it('strictly rejects unknown v2 push-session fields with a v2 error envelope', async () => {
    const response = await fetch(`${baseUrl}/sync/v2/spaces/space-1/push-sessions`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '2', baseRevision: '0',
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        capabilitiesHash: 'a'.repeat(64), confirmationHash: 'b'.repeat(64),
        confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
        unexpected: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({
      protocolVersion: '2', error: expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    }));
    expect(pushSessions.createV2).not.toHaveBeenCalled();
  });

  it('requires explicit user confirmation before finalize reaches the service', async () => {
    const response = await fetch(`${baseUrl}/sync/v2/spaces/space-1/push-sessions/session-1/finalize`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ protocolVersion: '2', confirmationHash: 'a'.repeat(64), userConfirmed: false }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('PAYLOAD_INVALID');
    expect(pushSessions.finalizeV2).not.toHaveBeenCalled();
  });
});
