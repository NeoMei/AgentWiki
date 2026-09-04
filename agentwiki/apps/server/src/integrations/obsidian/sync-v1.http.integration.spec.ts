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
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';
import { SyncApiException } from './sync-error';

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
    user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    humanDeviceCredential: {
      findUnique: jest.fn(async ({ where }: any) => (
        where.credentialHash === 'h:device-secret' ? activeCredential : null
      )),
      update: jest.fn().mockResolvedValue({}),
    },
    space: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null }),
    },
    spaceMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'editor', space: { deletedAt: null } }),
    },
    folder: {
      count: jest.fn().mockResolvedValue(0),
    },
    page: {
      count: jest.fn().mockResolvedValue(0),
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
        { provide: SyncRevisionService, useValue: {
          head: jest.fn().mockResolvedValue({
          revision: '0', sequence: 0, revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n, publishedAt: null,
          }),
          resolveRevision: jest.fn().mockResolvedValue('0'),
          snapshotPage: jest.fn().mockResolvedValue({
            items: [], nextPageId: undefined,
            head: {
              revision: '0', sequence: 0,
              revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n,
              publishedAt: null,
            },
          }),
          deltaPage: jest.fn().mockResolvedValue({
            items: [], nextPageId: undefined, toRevision: '0',
            head: {
              revision: '0', sequence: 0,
              revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              pageCount: 0n, revisionManifestByteLength: 0n, revisionBodyBytes: 0n,
              publishedAt: null,
            },
          }),
        } },
        { provide: SyncCursorService, useValue: new SyncCursorService({
          get: () => 'task5-v1-http-cursor-pepper',
        } as any) },
        SyncCapabilitiesService,
        { provide: SyncV3RevisionWriterService, useValue: {
          inspectCurrentLocked: jest.fn().mockResolvedValue({ mode: 'legacy_v2' }),
        } },
        { provide: PushSessionService, useValue: {
          create: jest.fn().mockResolvedValue({ protocolVersion: '1', sessionId: 'session-1' }),
        } },
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
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    prisma.folder.count.mockResolvedValue(0);
    prisma.page.count.mockResolvedValue(0);
  });

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

  it('does not let a query-string path spoof change the v1 guard error protocol', async () => {
    const response = await fetch(
      `${baseUrl}/sync/v1/spaces/space-1/head?next=/sync/v3/spaces/private/head`,
      { redirect: 'manual' },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(expect.objectContaining({
      protocolVersion: '1',
      error: expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }),
    }));
  });

  it.each([
    ['head', '/sync/v1/spaces/space-1/head', 'GET'],
    ['snapshot', '/sync/v1/spaces/space-1/snapshot', 'GET'],
    ['delta', '/sync/v1/spaces/space-1/delta?from=0', 'GET'],
    ['push-session creation', '/sync/v1/spaces/space-1/push-sessions', 'POST'],
  ])('fails closed with 409 on %s when an active Folder exists', async (_name, path, method) => {
    prisma.folder.count.mockResolvedValue(1);
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer device-secret',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? {
        body: JSON.stringify({
          baseRevision: '0', idempotencyKey: '11111111-1111-4111-8111-111111111111',
          capabilitiesHash: 'a'.repeat(64), confirmationHash: 'b'.repeat(64),
          confirmationByteLength: 1, changeCount: 0, totalBodyBytes: 0,
        }),
      } : {}),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({
      protocolVersion: '1',
      error: expect.objectContaining({
        code: 'SYNC_PROTOCOL_UPGRADE_REQUIRED', retryable: false,
      }),
    }));
  });

  it('fails closed when an active Page has folderId even if no active Folder row is visible', async () => {
    prisma.page.count.mockResolvedValue(1);
    const response = await fetch(`${baseUrl}/sync/v1/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('SYNC_PROTOCOL_UPGRADE_REQUIRED');
    expect(prisma.page.count).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', deletedAt: null, folderId: { not: null } },
    });
  });

  it('keeps the exact empty v1 head fixture for a Folder-free Space', async () => {
    const response = await fetch(`${baseUrl}/sync/v1/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      protocolVersion: '1', spaceId: 'space-1', revision: '0', sequence: 0,
      revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      pageCount: '0', revisionManifestByteLength: '0', revisionBodyBytes: '0',
      publishedAt: null,
    });
  });

  it('does not apply the new current bootstrap gate to a fixed historical snapshot', async () => {
    const capabilities = app.get(SyncCapabilitiesService);
    jest.spyOn(capabilities, 'assertV1Compatible').mockRejectedValueOnce(new SyncApiException(
      'SYNC_PROTOCOL_UPGRADE_REQUIRED', 'Current candidate now requires v3', undefined, '1',
    ));
    const reader: any = app.get(SyncRevisionService);
    reader.resolveRevision.mockResolvedValueOnce('rev-fixed');

    const response = await fetch(
      `${baseUrl}/sync/v1/spaces/space-1/snapshot?revision=rev-fixed&limit=1`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe('rev-fixed');
    expect(capabilities.assertV1Compatible).not.toHaveBeenCalled();
  });

  it('keeps snapshot cursor continuation fixed after the current candidate changes', async () => {
    const cursors = app.get(SyncCursorService);
    const cursor = cursors.encode({
      kind: 'snapshot', spaceId: 'space-1', revision: 'rev-fixed', lastPageId: 'page-1',
    });
    const capabilities = app.get(SyncCapabilitiesService);
    jest.spyOn(capabilities, 'assertV1Compatible').mockRejectedValueOnce(new SyncApiException(
      'SYNC_PROTOCOL_UPGRADE_REQUIRED', 'Current candidate now requires v3', undefined, '1',
    ));
    const reader: any = app.get(SyncRevisionService);

    const response = await fetch(
      `${baseUrl}/sync/v1/spaces/space-1/snapshot?cursor=${encodeURIComponent(cursor)}&limit=1`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );

    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe('rev-fixed');
    expect(reader.snapshotPage).toHaveBeenCalledWith('space-1', 'rev-fixed', 1, 'page-1');
    expect(capabilities.assertV1Compatible).not.toHaveBeenCalled();
  });

  it('uses the signed fixed delta endpoint on continuation after a new head appears', async () => {
    const fixedHead = {
      revision: 'rev-fixed', sequence: 7, revisionContentHash: 'c'.repeat(64),
      pageCount: 2n, revisionManifestByteLength: 200n, revisionBodyBytes: 20n,
      publishedAt: new Date('2026-09-04T00:00:00.000Z').toISOString(),
    };
    const reader: any = app.get(SyncRevisionService);
    reader.deltaPage
      .mockResolvedValueOnce({
        items: [{ operation: 'archive', pageId: 'page-1', previousPath: 'pages/one.md' }],
        nextPageId: 'page-1', toRevision: 'rev-fixed', head: fixedHead,
      })
      .mockImplementationOnce(async (
        _spaceId: string, _from: string, _limit: number, _after: string, toRevision?: string,
      ) => toRevision === 'rev-fixed'
        ? {
          items: [{ operation: 'archive', pageId: 'page-2', previousPath: 'pages/two.md' }],
          nextPageId: undefined, toRevision: 'rev-fixed', head: fixedHead,
        }
        : {
          items: [], nextPageId: undefined, toRevision: 'rev-new',
          head: { ...fixedHead, revision: 'rev-new', sequence: 8 },
        });

    const firstResponse = await fetch(`${baseUrl}/sync/v1/spaces/space-1/delta?from=0&limit=1`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    const first = await firstResponse.json();
    expect(first.nextCursor).not.toBeNull();

    const capabilities = app.get(SyncCapabilitiesService);
    jest.spyOn(capabilities, 'assertV1Compatible').mockRejectedValueOnce(new SyncApiException(
      'SYNC_PROTOCOL_UPGRADE_REQUIRED', 'New current candidate requires v3', undefined, '1',
    ));
    const secondResponse = await fetch(
      `${baseUrl}/sync/v1/spaces/space-1/delta?from=0&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );
    const second = await secondResponse.json();

    expect(secondResponse.status).toBe(200);
    expect(second).toEqual(expect.objectContaining({
      fromRevision: '0', toRevision: 'rev-fixed', toSequence: 7,
      items: [{ operation: 'archive', pageId: 'page-2', previousPath: 'pages/two.md' }],
    }));
    expect(reader.deltaPage).toHaveBeenLastCalledWith(
      'space-1', '0', 1, 'page-1', 'rev-fixed',
    );
    expect(capabilities.assertV1Compatible).not.toHaveBeenCalled();
  });

  it.each([
    ['current head', 'head', '/sync/v1/spaces/space-1/head'],
    ['fixed snapshot', 'snapshotPage', '/sync/v1/spaces/space-1/snapshot?revision=rev-attached'],
    ['delta whose fixed endpoint has an attachment', 'deltaPage', '/sync/v1/spaces/space-1/delta?from=0'],
  ])('returns the v1 upgrade envelope for %s', async (_name, method, path) => {
    const reader: any = app.get(SyncRevisionService);
    if (method === 'snapshotPage') {
      reader.resolveRevision.mockResolvedValueOnce('rev-attached');
    }
    reader[method].mockRejectedValueOnce(new SyncApiException(
      'SYNC_PROTOCOL_UPGRADE_REQUIRED',
      'This revision requires Sync v3',
      undefined,
      '1',
    ));

    const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer device-secret' } });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({
      protocolVersion: '1',
      error: expect.objectContaining({ code: 'SYNC_PROTOCOL_UPGRADE_REQUIRED', retryable: false }),
    }));
  });
});
