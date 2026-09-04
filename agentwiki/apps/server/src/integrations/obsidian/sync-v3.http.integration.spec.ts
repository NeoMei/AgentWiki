import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  SyncV3ErrorEnvelopeSchema,
  TreeBootstrapPreviewV3Schema,
  TreeCapabilitiesResponseV3Schema,
  TreeDeltaPageV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncSpaceListResponseV3Schema,
} from '@neomei/agentwiki-sync-protocol';
import { AddressInfo } from 'net';
import { AllExceptionsFilter } from '../../core/filters/all-exceptions.filter';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncV3Controller } from './sync-v3.controller';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';
import { SyncApiException } from './sync-error';

describe('sync v3 HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  const hash = 'a'.repeat(64);

  const prisma = {
    humanDeviceCredential: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'cred-1', credentialFamilyId: 'family-1', userId: 'user-1',
        deviceId: 'device-1', vaultId: 'vault-1', status: 'active',
        user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const revisions = {
    listSpaces: jest.fn().mockResolvedValue({
      protocolVersion: '3',
      spaces: [{
        spaceId: 'space-1', displayName: 'Space', role: 'editor', canRead: true,
        canPublish: true, syncMode: 'bootstrap_required', currentRevision: 'rev-1',
        folderCount: '0', pageCount: '1', attachmentCount: '1',
        revisionManifestByteLength: '200', revisionBodyBytes: '12', revisionAttachmentBytes: '4',
      }],
    }),
    head: jest.fn().mockResolvedValue({
      protocolVersion: '3', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
      revisionContentHash: hash, folderCount: '0', pageCount: '1', attachmentCount: '1',
      revisionManifestByteLength: '200', revisionBodyBytes: '12', revisionAttachmentBytes: '4',
      publishedAt: '2026-09-04T00:00:00.000Z',
    }),
    snapshot: jest.fn().mockResolvedValue({
      protocolVersion: '3', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
      revisionContentHash: hash, folderCount: '0', pageCount: '1', attachmentCount: '1',
      revisionManifestByteLength: '200', revisionBodyBytes: '12', revisionAttachmentBytes: '4',
      folders: [], pages: [], attachments: [], nextCursor: null,
    }),
    delta: jest.fn().mockResolvedValue({
      protocolVersion: '3', spaceId: 'space-1', fromRevision: '0', toRevision: 'rev-2', toSequence: 2,
      toRevisionContentHash: hash, toFolderCount: '0', toPageCount: '1', toAttachmentCount: '1',
      toRevisionManifestByteLength: '200', toRevisionBodyBytes: '12', toRevisionAttachmentBytes: '4',
      items: [], nextCursor: null,
    }),
    assertReadable: jest.fn().mockResolvedValue(undefined),
  };
  const bootstrap = {
    previewBootstrap: jest.fn().mockResolvedValue({
      protocolVersion: '3', mode: 'bootstrap_required', baseRevision: 'rev-1',
      candidateHash: hash, attachmentCount: '1', transferBytes: '4', blockers: [],
    }),
    bootstrapConfirmed: jest.fn().mockResolvedValue({
      protocolVersion: '3', status: 'published', revision: 'rev-2', sequence: 2,
      publishedAt: '2026-09-04T00:00:00.000Z', revisionContentHash: hash,
      folderCount: '0', pageCount: '1', attachmentCount: '1',
      revisionManifestByteLength: '200', revisionBodyBytes: '12', revisionAttachmentBytes: '4',
      changeSetId: null,
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncV3Controller],
      providers: [
        HumanDeviceGuard,
        { provide: ObsidianCryptoService, useValue: { credentialHash: (value: string) => `h:${value}` } },
        { provide: PrismaService, useValue: prisma },
        SyncCapabilitiesService,
        { provide: SyncV3RevisionService, useValue: revisions },
        { provide: SyncV3BootstrapService, useValue: bootstrap },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app?.close());

  beforeEach(() => jest.clearAllMocks());

  it('serves strict v3 capabilities through the real Nest HTTP graph', async () => {
    const response = await fetch(`${baseUrl}/sync/v3/capabilities`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    expect(response.status).toBe(200);
    expect(TreeCapabilitiesResponseV3Schema.parse(await response.json()).protocolVersion).toBe('3');
  });

  it('serves strict spaces, head, fixed snapshot, and delta responses', async () => {
    const auth = { Authorization: 'Bearer device-secret' };
    const [spacesResponse, headResponse, snapshotResponse, deltaResponse] = await Promise.all([
      fetch(`${baseUrl}/sync/v3/spaces`, { headers: auth }),
      fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, { headers: auth }),
      fetch(`${baseUrl}/sync/v3/spaces/space-1/snapshot?revision=rev-2&limit=1`, { headers: auth }),
      fetch(`${baseUrl}/sync/v3/spaces/space-1/delta?from=0&limit=1`, { headers: auth }),
    ]);
    expect(TreeSyncSpaceListResponseV3Schema.parse(await spacesResponse.json()).spaces[0]?.syncMode)
      .toBe('bootstrap_required');
    expect(TreeRevisionHeadResponseV3Schema.parse(await headResponse.json()).revision).toBe('rev-2');
    expect(TreeSnapshotPageV3Schema.parse(await snapshotResponse.json()).revision).toBe('rev-2');
    expect(TreeDeltaPageV3Schema.parse(await deltaResponse.json()).toRevision).toBe('rev-2');
    expect(revisions.snapshot).toHaveBeenCalledWith(expect.anything(), 'space-1', 'rev-2', undefined, 1);
    expect(revisions.delta).toHaveBeenCalledWith(expect.anything(), 'space-1', '0', undefined, 1);
  });

  it('serves strict bootstrap preview and confirmation without weakening the writer service', async () => {
    const auth = { Authorization: 'Bearer device-secret', 'content-type': 'application/json' };
    const preview = await fetch(`${baseUrl}/sync/v3/spaces/space-1/bootstrap-preview`, { headers: auth });
    const confirmed = await fetch(`${baseUrl}/sync/v3/spaces/space-1/bootstrap`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        protocolVersion: '3', baseRevision: 'rev-1', confirmationHash: hash, userConfirmed: true,
      }),
    });
    expect(TreeBootstrapPreviewV3Schema.parse(await preview.json()).candidateHash).toBe(hash);
    expect(TreeFinalizePushResponseV3Schema.parse(await confirmed.json()).revision).toBe('rev-2');
    expect(revisions.assertReadable).toHaveBeenCalledWith(expect.anything(), 'space-1');
    expect(bootstrap.bootstrapConfirmed).toHaveBeenCalledWith(
      'space-1',
      expect.objectContaining({ userId: 'user-1', credentialId: 'cred-1' }),
      { baseRevision: 'rev-1', confirmationHash: hash },
    );
  });

  it('strictly rejects unknown bootstrap fields', async () => {
    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/bootstrap`, {
      method: 'POST',
      headers: { Authorization: 'Bearer device-secret', 'content-type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '3', baseRevision: 'rev-1', confirmationHash: hash,
        userConfirmed: true, unexpected: true,
      }),
    });
    expect(response.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe('PAYLOAD_INVALID');
    expect(bootstrap.bootstrapConfirmed).not.toHaveBeenCalled();
  });

  it('strictly rejects unknown snapshot query fields', async () => {
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/snapshot?revision=rev-2&unexpected=true`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );

    expect(response.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code)
      .toBe('PAYLOAD_INVALID');
    expect(revisions.snapshot).not.toHaveBeenCalled();
  });

  it('uses the safe strict v3 envelope for guard-stage credential revocation', async () => {
    prisma.humanDeviceCredential.findUnique.mockResolvedValueOnce({
      id: 'cred-1', credentialFamilyId: 'family-1', userId: 'user-1',
      deviceId: 'device-1', vaultId: 'vault-1', status: 'revoked',
      user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
    });
    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(SyncV3ErrorEnvelopeSchema.parse(body).error.code).toBe('DEVICE_CREDENTIAL_REVOKED');
    expect(body).toEqual({
      protocolVersion: '3', error: { code: 'DEVICE_CREDENTIAL_REVOKED', retryable: false },
    });
  });

  it.each([
    ['role removal', 'SPACE_FORBIDDEN'],
    ['deleted Space', 'SPACE_FORBIDDEN'],
    ['corrupt immutable revision', 'REVISION_GONE'],
  ])('keeps %s failures inside the strict v3 envelope', async (_name, code) => {
    revisions.head.mockRejectedValueOnce(new SyncApiException(code as any, 'private detail', {
      path: '/private/file.md', storageKey: 'secret-key',
    }, '3'));
    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    const body = await response.json();
    expect(SyncV3ErrorEnvelopeSchema.parse(body).error.code).toBe(code);
    expect(JSON.stringify(body)).not.toMatch(/private|storageKey|secret-key|message|details/u);
  });

  it('sanitizes unexpected v3 failures at the global HTTP boundary', async () => {
    revisions.head.mockRejectedValueOnce(new Error(
      'database failed for /private/file.md storageKey=secret credential=device-secret',
    ));

    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(SyncV3ErrorEnvelopeSchema.parse(body)).toEqual({
      protocolVersion: '3', error: { code: 'INTERNAL_ERROR', retryable: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/private|storageKey|secret|credential|message|details|path/u);
  });

  it('sanitizes a legacy-versioned sync exception thrown on a v3 route', async () => {
    revisions.head.mockRejectedValueOnce(new SyncApiException(
      'REVISION_GONE',
      'private revision path',
      { path: '/private/file.md', storageKey: 'secret-key' },
    ));

    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(SyncV3ErrorEnvelopeSchema.parse(body)).toEqual({
      protocolVersion: '3', error: { code: 'INTERNAL_ERROR', retryable: true },
    });
    expect(JSON.stringify(body)).not.toMatch(/private|storageKey|secret|message|details|path/u);
  });
});
