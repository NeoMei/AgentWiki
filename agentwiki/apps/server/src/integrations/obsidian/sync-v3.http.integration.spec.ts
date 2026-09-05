import {
  HttpException,
  HttpStatus,
  INestApplication,
  PayloadTooLargeException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  BlobChunkReceiptV3Schema,
  CompletedBlobV3Schema,
  CreateTreePushSessionResponseV3Schema,
  SyncV3ErrorEnvelopeSchema,
  TreeBootstrapPreviewV3Schema,
  TreeCapabilitiesResponseV3Schema,
  TreeDeltaPageV3Schema,
  TreeFinalizePushResponseV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  TreeSyncSpaceListResponseV3Schema,
  TreePushBatchReceiptV3Schema,
  TreePushSessionStatusResponseV3Schema,
  contentHash,
  treeBatchHashV3,
} from '@neomei/agentwiki-sync-protocol';
import { AddressInfo } from 'net';
import { AllExceptionsFilter } from '../../core/filters/all-exceptions.filter';
import { BusinessException } from '../../core/filters/business-error';
import { PrismaService } from '../../database/prisma.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncV3Controller } from './sync-v3.controller';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';
import { SyncApiException } from './sync-error';
import { SyncV3BlobService } from './sync-v3-blob.service';
import { SyncV3PushSessionService } from './sync-v3-push-session.service';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import {
  SyncV3BlobStorage,
  SyncV3BlobStorageError,
} from './sync-v3-blob.storage';

describe('sync v3 HTTP contract', () => {
  let app: INestApplication;
  let baseUrl: string;
  let blobRoot: string;
  let blobStaging: SyncV3BlobStorage;
  const hash = 'a'.repeat(64);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3GAAAAAASUVORK5CYII=',
    'base64',
  );

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
  const blobs = {
    putChunk: jest.fn(async (_principal, _spaceId, _sessionId, contentHash, chunkIndex, input) => {
      try {
        const staged = await blobStaging.stageChunk(
          _sessionId,
          contentHash,
          chunkIndex,
          input,
          1024 * 1024,
        );
        await blobStaging.discardStagedChunk(staged);
        return { contentHash, chunkIndex, chunkHash: hash, receipt: 'receipt-1' };
      } catch (error) {
        if (error instanceof SyncV3BlobStorageError) {
          throw new SyncApiException(error.code, 'Blob staging validation failed', undefined, '3');
        }
        throw error;
      }
    }),
    complete: jest.fn().mockResolvedValue({
      contentHash: hash,
      sizeBytes: String(png.length),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      verifiedAt: '2026-09-05T00:00:00.000Z',
    }),
    openRevisionAttachment: jest.fn().mockResolvedValue({
      stream: Readable.from([png]),
      mimeType: 'image/png',
      sizeBytes: png.length,
    }),
  };
  const pushSessions = {
    create: jest.fn(), uploadBatch: jest.fn(), finalize: jest.fn(), get: jest.fn(), abort: jest.fn(),
  };

  beforeAll(async () => {
    blobRoot = await mkdtemp(join(tmpdir(), 'agentwiki-sync-v3-http-blob-'));
    blobStaging = new SyncV3BlobStorage(blobRoot);
    const moduleRef = await Test.createTestingModule({
      controllers: [SyncV3Controller],
      providers: [
        HumanDeviceGuard,
        { provide: ObsidianCryptoService, useValue: { credentialHash: (value: string) => `h:${value}` } },
        { provide: PrismaService, useValue: prisma },
        SyncCapabilitiesService,
        { provide: SyncV3RevisionService, useValue: revisions },
        { provide: SyncV3BootstrapService, useValue: bootstrap },
        { provide: SyncV3BlobService, useValue: blobs },
        { provide: SyncV3PushSessionService, useValue: pushSessions },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    await rm(blobRoot, { recursive: true, force: true });
  });

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

  it('serves strict create, batch, finalize, status, and abort Push routes', async () => {
    const auth = { Authorization: 'Bearer device-secret', 'Content-Type': 'application/json' };
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const capabilitiesResponse = await fetch(`${baseUrl}/sync/v3/capabilities`, { headers: auth });
    const negotiated = TreeCapabilitiesResponseV3Schema.parse(await capabilitiesResponse.json());
    pushSessions.create.mockResolvedValue({
      protocolVersion: '3', sessionId, status: 'uploading',
      expiresAt: '2026-09-05T01:00:00.000Z', missingContentHashes: [],
    });
    const createdResponse = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions`, {
      method: 'POST', headers: auth, body: JSON.stringify({
        protocolVersion: '3', baseRevision: 'rev-1',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        capabilitiesHash: negotiated.capabilitiesHash, confirmationHash: 'd'.repeat(64),
        confirmationByteLength: 1, changeCount: 1, totalBodyBytes: 7,
        attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
      }),
    });
    expect(createdResponse.status).toBe(201);
    expect(CreateTreePushSessionResponseV3Schema.parse(await createdResponse.json()).sessionId).toBe(sessionId);

    const body = '# Page\n';
    const withoutHash = {
      protocolVersion: '3' as const, batchIndex: 0,
      changes: [{ operation: 'upsert_page' as const, page: {
        pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body,
        contentHash: await contentHash(body), updatedAt: '2026-09-05T00:00:00.000Z',
        referencedAttachmentIds: [],
      } }],
    };
    const batchHash = await treeBatchHashV3(withoutHash);
    pushSessions.uploadBatch.mockResolvedValue({
      protocolVersion: '3', sessionId, batchIndex: 0, batchHash,
      receipt: 'receipt-0', receivedBatchCount: 1,
    });
    const batchResponse = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/batches/0`, {
      method: 'PUT', headers: auth, body: JSON.stringify({ ...withoutHash, batchHash }),
    });
    expect(TreePushBatchReceiptV3Schema.parse(await batchResponse.json()).batchIndex).toBe(0);

    const terminal = {
      protocolVersion: '3', status: 'published', revision: 'rev-2', sequence: 2,
      publishedAt: '2026-09-05T00:00:00.000Z', revisionContentHash: hash,
      folderCount: '0', pageCount: '1', attachmentCount: '0',
      revisionManifestByteLength: '100', revisionBodyBytes: '7', revisionAttachmentBytes: '0',
      changeSetId: 'change-set-1',
    };
    pushSessions.finalize.mockResolvedValue(terminal);
    const finalizeResponse = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/finalize`, {
      method: 'POST', headers: auth, body: JSON.stringify({
        protocolVersion: '3', confirmationHash: 'd'.repeat(64), userConfirmed: true,
      }),
    });
    expect(TreeFinalizePushResponseV3Schema.parse(await finalizeResponse.json()).revision).toBe('rev-2');

    pushSessions.get.mockResolvedValue({
      protocolVersion: '3', sessionId, status: 'published',
      expiresAt: '2026-09-05T01:00:00.000Z', missingContentHashes: [],
      completedContentHashes: [], receivedBatchIndexes: [0], result: terminal,
    });
    const statusResponse = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}`, {
      headers: auth,
    });
    expect(TreePushSessionStatusResponseV3Schema.parse(await statusResponse.json()).status).toBe('published');
    const abortResponse = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}`, {
      method: 'DELETE', headers: auth,
    });
    expect(abortResponse.status).toBe(204);
    expect(pushSessions.abort).toHaveBeenCalled();
  });

  it('returns the strict retryable v3 envelope when create, upload, or finalize is rate-limited', async () => {
    const auth = { Authorization: 'Bearer device-secret', 'Content-Type': 'application/json' };
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const pageBody = '# Limited\n';
    const batch = {
      protocolVersion: '3' as const, batchIndex: 0,
      changes: [{ operation: 'upsert_page' as const, page: {
        pageId: 'limited-page', folderId: null, path: 'pages/Limited.md', title: 'Limited',
        body: pageBody, contentHash: await contentHash(pageBody),
        updatedAt: '2026-09-05T00:00:00.000Z', referencedAttachmentIds: [],
      } }],
    };
    const requests = [
      {
        mock: pushSessions.create,
        url: `${baseUrl}/sync/v3/spaces/space-1/push-sessions`, method: 'POST',
        body: {
          protocolVersion: '3', baseRevision: 'rev-1',
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
          capabilitiesHash: hash, confirmationHash: 'd'.repeat(64), confirmationByteLength: 1,
          changeCount: 1, totalBodyBytes: Buffer.byteLength(pageBody), attachmentCount: 0,
          transferBlobBytes: 0, blobRequirements: [],
        },
      },
      {
        mock: pushSessions.uploadBatch,
        url: `${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/batches/0`, method: 'PUT',
        body: { ...batch, batchHash: await treeBatchHashV3(batch) },
      },
      {
        mock: pushSessions.finalize,
        url: `${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/finalize`, method: 'POST',
        body: { protocolVersion: '3', confirmationHash: 'd'.repeat(64), userConfirmed: true },
      },
    ];
    for (const request of requests) {
      request.mock.mockRejectedValueOnce(new SyncApiException(
        'RATE_LIMITED', 'private Redis failure', undefined, '3',
      ));
      const response = await fetch(request.url, {
        method: request.method, headers: auth, body: JSON.stringify(request.body),
      });
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('1');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(SyncV3ErrorEnvelopeSchema.parse(await response.json())).toEqual({
        protocolVersion: '3', error: { code: 'RATE_LIMITED', retryable: true },
      });
    }
  });

  it('preserves a route-safe ATTACHMENT_REFERENCED code and redacts BusinessException details', async () => {
    pushSessions.create.mockRejectedValueOnce(new BusinessException(
      'ATTACHMENT_REFERENCED',
      'private archive message',
      {
        pages: [{ id: 'page-1', title: 'Visible title', body: 'secret markdown' }],
        storageKey: `sha256/aa/aa/${hash}`,
        absolutePath: '/var/lib/agentwiki/attachments/private',
        credential: 'device-secret',
      },
    ));
    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/push-sessions`, {
      method: 'POST',
      headers: { Authorization: 'Bearer device-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocolVersion: '3', baseRevision: 'rev-1',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        capabilitiesHash: hash, confirmationHash: 'd'.repeat(64), confirmationByteLength: 1,
        changeCount: 1, totalBodyBytes: 0, attachmentCount: 0,
        transferBlobBytes: 0, blobRequirements: [],
      }),
    });
    const raw = await response.text();

    expect(response.status).toBe(409);
    expect(SyncV3ErrorEnvelopeSchema.parse(JSON.parse(raw))).toEqual({
      protocolVersion: '3', error: { code: 'ATTACHMENT_REFERENCED', retryable: false },
    });
    expect(raw).not.toMatch(/private|markdown|storage|\/var\/lib|credential|device-secret/iu);
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

  it('streams an octet-stream chunk and returns a strict receipt without JSON/base64 aggregation', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/blobs/${hash}/chunks/0`,
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer device-secret',
          'content-type': 'application/octet-stream',
        },
        body: png,
      },
    );

    expect(response.status).toBe(200);
    expect(BlobChunkReceiptV3Schema.parse(await response.json())).toEqual({
      contentHash: hash, chunkIndex: 0, chunkHash: hash, receipt: 'receipt-1',
    });
    expect(blobs.putChunk).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'cred-1' }),
      'space-1', sessionId, hash, 0, expect.anything(),
    );
  });

  it.each([
    ['application/json', '{}'],
    ['text/plain', 'bytes'],
    ['application/octet-stream; charset=utf-8', 'bytes'],
  ])('rejects chunk content type %s before the Blob service', async (contentType, body) => {
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/0`,
      {
        method: 'PUT',
        headers: { Authorization: 'Bearer device-secret', 'content-type': contentType },
        body,
      },
    );

    expect(response.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code)
      .toBe('PAYLOAD_INVALID');
    expect(blobs.putChunk).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared chunk before reading or recording it', async () => {
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/0`,
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer device-secret',
          'content-type': 'application/octet-stream',
          'content-length': String(1024 * 1024 + 1),
        },
        body: Buffer.alloc(1024 * 1024 + 1),
      },
    );

    expect(response.status).toBe(413);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code)
      .toBe('ATTACHMENT_QUOTA_EXCEEDED');
    expect(blobs.putChunk).not.toHaveBeenCalled();
  });

  it('returns a strict 413 after streaming an oversized chunked body without Content-Length', async () => {
    const url = new URL(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/0`,
    );
    const response = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      const request = httpRequest(url, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer device-secret',
          'content-type': 'application/octet-stream',
          'transfer-encoding': 'chunked',
        },
      }, (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve({
          status: incoming.statusCode ?? 0,
          body: Buffer.concat(chunks),
        }));
      });
      request.on('error', reject);
      for (let index = 0; index < 17; index += 1) request.write(Buffer.alloc(64 * 1024));
      request.end();
    });

    expect(response.status).toBe(413);
    expect(SyncV3ErrorEnvelopeSchema.parse(JSON.parse(response.body.toString('utf8'))).error.code)
      .toBe('ATTACHMENT_QUOTA_EXCEEDED');
  });

  it('strictly validates the complete request and path hash binding', async () => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const auth = { Authorization: 'Bearer device-secret', 'content-type': 'application/json' };
    const valid = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/blobs/${hash}/complete`,
      {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          protocolVersion: '3', contentHash: hash,
          sizeBytes: String(png.length), chunkCount: 1,
        }),
      },
    );
    expect(CompletedBlobV3Schema.parse(await valid.json()).contentHash).toBe(hash);

    const spoofed = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/${sessionId}/blobs/${hash}/complete`,
      {
        method: 'POST', headers: auth,
        body: JSON.stringify({
          protocolVersion: '3', contentHash: 'b'.repeat(64),
          sizeBytes: String(png.length), chunkCount: 1,
        }),
      },
    );
    expect(spoofed.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await spoofed.json()).error.code)
      .toBe('PAYLOAD_INVALID');
  });

  it('streams fixed-revision content with private immutable-response headers', async () => {
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/revisions/revision-1/attachments/attachment-1/content`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(response.headers.get('content-type')).toMatch(/^image\/png/u);
    expect(response.headers.get('content-length')).toBe(String(png.length));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(JSON.stringify([...response.headers])).not.toMatch(/storage|sha256|credential/u);
  });

  it.each([
    ['chunk query spoof', `/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/0?spaceId=space-2`, 'PUT'],
    ['download query spoof', '/sync/v3/spaces/space-1/revisions/revision-1/attachments/attachment-1/content?revision=current', 'GET'],
  ])('rejects %s with a strict v3 error', async (_name, path, method) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer device-secret',
        ...(method === 'PUT' ? { 'content-type': 'application/octet-stream' } : {}),
      },
      ...(method === 'PUT' ? { body: png } : {}),
    });
    expect(response.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code)
      .toBe('PAYLOAD_INVALID');
  });

  it.each([
    ['invalid session', `/sync/v3/spaces/space-1/push-sessions/not-a-session/blobs/${hash}/chunks/0`],
    ['invalid hash', '/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/not-a-hash/chunks/0'],
    ['invalid index', `/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/01`],
  ])('rejects %s path spoofing before the Blob service', async (_name, path) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer device-secret',
        'content-type': 'application/octet-stream',
      },
      body: png,
    });
    expect(response.status).toBe(400);
    expect(SyncV3ErrorEnvelopeSchema.parse(await response.json()).error.code)
      .toBe('PAYLOAD_INVALID');
    expect(blobs.putChunk).not.toHaveBeenCalled();
  });

  it('preserves a post-guard credential revocation as a strict v3 error', async () => {
    blobs.putChunk.mockRejectedValueOnce(new SyncApiException(
      'DEVICE_CREDENTIAL_REVOKED', 'private credential state', { credentialId: 'cred-1' }, '3',
    ));
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-1/push-sessions/11111111-1111-4111-8111-111111111111/blobs/${hash}/chunks/0`,
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer device-secret',
          'content-type': 'application/octet-stream',
        },
        body: png,
      },
    );
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(SyncV3ErrorEnvelopeSchema.parse(body).error.code).toBe('DEVICE_CREDENTIAL_REVOKED');
    expect(JSON.stringify(body)).not.toMatch(/credential|cred-1|message|details/u);
  });

  it('keeps cross-scope Blob service failures inside the strict v3 envelope', async () => {
    blobs.openRevisionAttachment.mockRejectedValueOnce(new SyncApiException(
      'ATTACHMENT_MISSING', 'private storage key', { storageKey: 'sha256/secret' }, '3',
    ));
    const response = await fetch(
      `${baseUrl}/sync/v3/spaces/space-2/revisions/revision-1/attachments/attachment-1/content`,
      { headers: { Authorization: 'Bearer device-secret' } },
    );
    const body = await response.json();
    expect(SyncV3ErrorEnvelopeSchema.parse(body).error.code).toBe('ATTACHMENT_MISSING');
    expect(JSON.stringify(body)).not.toMatch(/storage|secret|message|details/u);
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

  it.each([
    ['oversized request', new PayloadTooLargeException('private body detail'), 413, 'BATCH_TOO_LARGE', false],
    [
      'rate limit',
      new HttpException('private rate detail', HttpStatus.TOO_MANY_REQUESTS),
      429,
      'RATE_LIMITED',
      true,
    ],
  ])('preserves the %s HTTP contract while sanitizing its v3 envelope', async (
    _name,
    error,
    status,
    code,
    retryable,
  ) => {
    revisions.head.mockRejectedValueOnce(error);

    const response = await fetch(`${baseUrl}/sync/v3/spaces/space-1/head`, {
      headers: { Authorization: 'Bearer device-secret' },
    });
    const body = await response.json();

    expect(response.status).toBe(status);
    expect(SyncV3ErrorEnvelopeSchema.parse(body)).toEqual({
      protocolVersion: '3', error: { code, retryable },
    });
    if (status === 429) expect(response.headers.get('retry-after')).toBe('1');
    expect(JSON.stringify(body)).not.toMatch(/private|detail|message|path/u);
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
