import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { HttpAdapterHost } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { AllExceptionsFilter } from '../../core/filters/all-exceptions.filter';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncV1Controller } from './sync-v1.controller';
import { SyncRevisionService } from './sync-revision.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { PushSessionService } from './push-session.service';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';

describe('sync v1 HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;

  const activeCredential = {
    id: 'cred-1',
    credentialFamilyId: 'family-1',
    userId: 'user-1',
    deviceId: 'device-1',
    vaultId: 'vault-1',
    status: 'active',
    user: { deletedAt: null, lockedAt: null, type: 'human' },
  };
  const prisma = {
    humanDeviceCredential: {
      findUnique: jest.fn(async ({ where }: any) => (
        where.credentialHash === 'h:device-secret' ? activeCredential : null
      )),
      update: jest.fn().mockResolvedValue({}),
    },
    spaceMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'editor', space: { deletedAt: null } }),
    },
  } as any;
  const crypto = {
    credentialHash: jest.fn((value: string) => `h:${value}`),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncV1Controller],
      providers: [
        HumanDeviceGuard,
        { provide: ObsidianCryptoService, useValue: crypto },
        { provide: PrismaService, useValue: prisma },
        { provide: SyncRevisionService, useValue: { head: jest.fn().mockResolvedValue({
          revision: '0', sequence: 0, revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n, publishedAt: null,
        }) } },
        { provide: SyncCursorService, useValue: {} },
        { provide: SyncCapabilitiesService, useValue: {} },
        { provide: PushSessionService, useValue: {} },
        { provide: SpaceRevisionWriterService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  it('returns a terminal 200/401 response with no 3xx redirect', async () => {
    const response = await fetch(`${baseUrl}/sync/v1/spaces/space-1/head`, {
      redirect: 'manual',
      headers: { Authorization: 'Bearer device-secret' },
    });
    expect(response.status).toBe(200);
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
    const body = await response.json();
    expect(body.protocolVersion).toBe('1');
  });

  it('rejects an AgentCredential-style bearer with the sync error envelope', async () => {
    // An AgentCredential key never hashes into the human device credential
    // table, so the guard must reject it as AUTHENTICATION_REQUIRED.
    const response = await fetch(`${baseUrl}/sync/v1/spaces/space-1/head`, {
      redirect: 'manual',
      headers: { Authorization: 'Bearer agk_agent_credential' },
    });
    expect(response.status).toBe(401);
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
    const body = await response.json();
    expect(body.protocolVersion).toBe('1');
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(typeof body.error.retryable).toBe('boolean');
  });

  it('rejects a missing bearer without a 3xx', async () => {
    const response = await fetch(`${baseUrl}/sync/v1/spaces/space-1/head`, { redirect: 'manual' });
    expect(response.status).toBe(401);
    expect([301, 302, 303, 307, 308]).not.toContain(response.status);
  });
});
