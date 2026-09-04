import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV3,
  contentHash as protocolContentHash,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService } from '../../core/authorization/authorization.service';
import type { AttachmentConfig } from '../../attachments/attachment.config';
import { LocalAttachmentStorage } from '../../attachments/local-attachment.storage';
import type { HumanDevicePrincipal } from './human-device.guard';
import { SyncV3BlobStorage } from './sync-v3-blob.storage';
import { SyncV3BlobService } from './sync-v3-blob.service';
import {
  SyncV3AuthorityError,
  SyncV3ImmutableRevisionService,
} from './sync-v3-immutable-revision.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z3GAAAAAASUVORK5CYII=',
  'base64',
);
const HASH = createHash('sha256').update(PNG).digest('hex');
const roots = new Set<string>();

const principal: HumanDevicePrincipal = {
  userId: 'user-1',
  credentialId: 'credential-1',
  credentialFamilyId: 'family-1',
  deviceId: 'device-1',
  vaultId: 'vault-1',
  status: 'active',
  platformRole: 'user',
};

function attachmentConfig(storagePath: string): AttachmentConfig {
  return {
    storagePath,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * 24 * 60 * 60 * 1000,
    orphanGraceMs: 24 * 60 * 60 * 1000,
    contentLockTimeoutMs: 5_000,
  };
}

function activeCredential(overrides: Record<string, unknown> = {}) {
  return {
    id: principal.credentialId,
    credentialFamilyId: principal.credentialFamilyId,
    userId: principal.userId,
    deviceId: principal.deviceId,
    vaultId: principal.vaultId,
    status: 'active',
    provisionalExpiresAt: null,
    user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-blob-service-'));
  roots.add(root);
  const config = attachmentConfig(root);
  const storage = new LocalAttachmentStorage(config);
  const staging = new SyncV3BlobStorage(root);
  const chunks: any[] = [];
  const blob: any = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    contentHash: HASH,
    sizeBytes: BigInt(PNG.length),
    mimeType: 'image/png',
    width: 1,
    height: 1,
    status: 'uploading',
    storageKey: null,
    verifiedAt: null,
  };
  const session: any = {
    id: blob.sessionId,
    protocolVersion: '3',
    credentialFamilyId: principal.credentialFamilyId,
    credentialId: principal.credentialId,
    userId: principal.userId,
    spaceId: 'space-1',
    status: 'uploading',
    transferBlobBytes: BigInt(PNG.length),
    expiresAt: new Date(Date.now() + 60_000),
    blobs: [blob],
  };
  let credential: any = activeCredential();
  let revisionRow: any = null;
  let member: any = { role: 'viewer' };
  let space: any = { id: 'space-1', deletedAt: null };
  let liveUser: any = {
    id: principal.userId, type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null,
  };
  const prisma: any = {
    humanDeviceCredential: {
      findUnique: jest.fn(async () => credential),
    },
    pushSession: {
      findUnique: jest.fn(async ({ where }: any) => where.id === session.id ? session : null),
    },
    pushSessionBlob: {
      findUnique: jest.fn(async ({ where }: any) => (
        where.sessionId_contentHash?.sessionId === session.id
        && where.sessionId_contentHash?.contentHash === blob.contentHash
      ) ? { ...blob, session, chunks: [...chunks] } : null),
      update: jest.fn(async ({ data }: any) => Object.assign(blob, data)),
    },
    pushSessionBlobChunk: {
      findUnique: jest.fn(async ({ where }: any) => chunks.find((chunk) => (
        chunk.sessionId === where.sessionId_contentHash_chunkIndex.sessionId
        && chunk.contentHash === where.sessionId_contentHash_chunkIndex.contentHash
        && chunk.chunkIndex === where.sessionId_contentHash_chunkIndex.chunkIndex
      )) ?? null),
      findMany: jest.fn(async () => [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex)),
      aggregate: jest.fn(async () => ({
        _sum: { sizeBytes: chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0) },
      })),
      create: jest.fn(async ({ data }: any) => {
        if (chunks.some((chunk) => chunk.chunkIndex === data.chunkIndex)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        chunks.push({ ...data });
        return data;
      }),
    },
    syncRevisionAttachmentRow: {
      findUnique: jest.fn(async () => revisionRow),
    },
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async ({ where }: any) => (
        revisionRow && where.id === revisionRow.revisionId && where.spaceId === revisionRow.spaceId
      ) ? { id: revisionRow.revisionId, spaceId: revisionRow.spaceId } : null),
    },
    space: { findUnique: jest.fn(async () => space) },
    spaceMember: { findUnique: jest.fn(async () => member) },
    $queryRaw: jest.fn(async () => [{ id: 'locked' }]),
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (work: any) => work(prisma)),
  };
  const capabilities: any = { capabilitiesV3: () => ({
    maxAttachmentBytes: 10 * 1024 * 1024,
    maxTransferBlobBytes: 100 * 1024 * 1024,
    blobChunkBytes: 1024 * 1024,
    maxBlobChunks: 10,
    maxImageDimension: 10_000,
    maxDecodedPixels: 40_000_000,
    allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
  }) };
  const authorization: any = {
    lockLiveHumanPrincipal: jest.fn(async () => liveUser),
  };
  const immutableRevisions: any = {
    verify: jest.fn(async (_tx: any, requestedSpace: string, revisionId: string) => {
      if (!revisionRow || revisionRow.revisionId !== revisionId || revisionRow.spaceId !== requestedSpace) {
        throw new SyncV3AuthorityError();
      }
      return {
        revision: revisionId,
        manifest: {
          protocolVersion: '3',
          spaceId: requestedSpace,
          folders: [], pages: [],
          attachments: [{
            attachmentId: revisionRow.attachmentId,
            path: revisionRow.path,
            contentHash: revisionRow.attachmentVersion.contentHash,
            mimeType: revisionRow.attachmentVersion.mimeType ?? 'image/png',
            sizeBytes: String(revisionRow.attachmentVersion.sizeBytes ?? PNG.length),
            width: revisionRow.attachmentVersion.width ?? 1,
            height: revisionRow.attachmentVersion.height ?? 1,
            updatedAt: new Date(0).toISOString(),
          }],
        },
      };
    }),
  };
  const service = new SyncV3BlobService(
    prisma, staging, storage, config, capabilities, authorization, immutableRevisions,
  );
  return {
    root, storage, staging, service, session, blob, chunks, prisma,
    setCredential(value: any) { credential = value; },
    setRevisionRow(value: any) { revisionRow = value; },
    setMember(value: any) { member = value; },
    setSpace(value: any) { space = value; },
    setLiveUser(value: any) { liveUser = value; },
    immutableRevisions,
  };
}

describe('SyncV3BlobService', () => {
  afterEach(async () => {
    for (const root of roots) {
      await rm(root, { recursive: true, force: true });
      roots.delete(root);
    }
  });

  it('accepts the same chunk twice but rejects different bytes', async () => {
    const state = await fixture();
    const first = await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );
    const retry = await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );

    expect(retry.receipt).toBe(first.receipt);
    expect(state.chunks).toHaveLength(1);
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([Buffer.from('different')]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
  });

  it.each([
    ['non-v3 session', (state: any) => { state.session.protocolVersion = '2'; }],
    ['other Space', (_state: any): void => undefined, 'space-2'],
    ['other credential family', (state: any) => { state.session.credentialFamilyId = 'family-2'; }],
    ['other credential id', (state: any) => { state.session.credentialId = 'credential-2'; }],
    ['other user', (state: any) => { state.session.userId = 'user-2'; }],
    ['non-required hash', (state: any) => { state.blob.contentHash = 'b'.repeat(64); }],
  ] as Array<[string, (state: any) => void, string?]>)(
    'hides a %s binding mismatch', async (_name, mutate, requestedSpace = 'space-1') => {
    const state = await fixture();
    mutate(state);

    await expect(state.service.putChunk(
      principal, requestedSpace, state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_NOT_FOUND' });
    expect(state.chunks).toHaveLength(0);
    },
  );

  it.each([
    ['expired TTL', (state: any) => { state.session.expiresAt = new Date(Date.now() - 1); }, 'PUSH_SESSION_EXPIRED'],
    ['aborted session', (state: any) => { state.session.status = 'aborted'; }, 'PUSH_SESSION_STATE_INVALID'],
    ['finalizing session', (state: any) => { state.session.status = 'finalizing'; }, 'PUSH_SESSION_STATE_INVALID'],
    ['verified Blob', (state: any) => { state.blob.status = 'verified'; }, 'PUSH_SESSION_STATE_INVALID'],
  ])('rejects %s before staging', async (_name, mutate, code) => {
    const state = await fixture();
    mutate(state);

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: code });
    expect(state.chunks).toHaveLength(0);
  });

  it('rechecks a credential revoked after the HTTP guard', async () => {
    const state = await fixture();
    state.setCredential(activeCredential({ status: 'revoked', revokedAt: new Date() }));

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'DEVICE_CREDENTIAL_REVOKED' });
    expect(state.chunks).toHaveLength(0);
  });

  it('rechecks live authority before returning a receipt recovered after a unique race', async () => {
    const state = await fixture();
    state.prisma.pushSessionBlobChunk.create.mockImplementationOnce(async ({ data }: any) => {
      state.chunks.push({ ...data });
      state.setCredential(activeCredential({ status: 'revoked', revokedAt: new Date() }));
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    });

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'DEVICE_CREDENTIAL_REVOKED' });
  });

  it('does not accept a new chunk after the session becomes ready to finalize', async () => {
    const state = await fixture();
    state.session.status = 'ready_to_finalize';

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_STATE_INVALID' });
    expect(state.chunks).toHaveLength(0);
  });

  it('rejects even an existing receipt retry before consuming a body after the session becomes ready', async () => {
    const state = await fixture();
    await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );
    state.session.status = 'ready_to_finalize';
    const input = Readable.from([PNG]);
    const read = jest.spyOn(input, Symbol.asyncIterator);

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, input,
    )).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_STATE_INVALID' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects chunk receipts whose cumulative bytes exceed the required Blob size', async () => {
    const state = await fixture();
    await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG.subarray(0, 60)]),
    );

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 1, Readable.from([PNG.subarray(60), Buffer.alloc(10)]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(state.chunks).toHaveLength(1);
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 1, Readable.from([PNG.subarray(60)]),
    )).resolves.toMatchObject({ chunkIndex: 1 });
  });

  it('rejects a receipt when actual session chunk bytes would exceed the transfer cap', async () => {
    const state = await fixture();
    state.prisma.pushSessionBlobChunk.aggregate.mockResolvedValueOnce({
      _sum: { sizeBytes: 100 * 1024 * 1024 },
    });

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    expect(state.chunks).toHaveLength(0);
  });

  it('does not let an unreceipted filesystem commit poison a correct retry after DB failure', async () => {
    const state = await fixture();
    state.prisma.pushSessionBlobChunk.create.mockRejectedValueOnce(new Error('database offline'));

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([Buffer.from('wrong')]),
    )).rejects.toThrow('database offline');
    expect(state.chunks).toHaveLength(0);
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).resolves.toMatchObject({ chunkIndex: 0, chunkHash: HASH });
  });

  it('discards staged bytes when session state changes while the body is being consumed', async () => {
    const state = await fixture();
    const stage = state.staging.stageChunk.bind(state.staging);
    jest.spyOn(state.staging, 'stageChunk').mockImplementationOnce(async (...args) => {
      const staged = await stage(...args);
      state.session.status = 'ready_to_finalize';
      return staged;
    });

    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([Buffer.from('rejected')]),
    )).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_STATE_INVALID' });
    state.session.status = 'uploading';
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).resolves.toMatchObject({ chunkHash: HASH });
  });

  it('enforces index, chunk, image, and declared transfer limits before a receipt', async () => {
    const state = await fixture();
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 10, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0,
      Readable.from([Buffer.alloc(1024 * 1024), Buffer.from([1])]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    state.blob.sizeBytes = 10n * 1024n * 1024n + 1n;
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    state.blob.sizeBytes = BigInt(PNG.length);
    state.session.transferBlobBytes = 100n * 1024n * 1024n + 1n;
    await expect(state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    expect(state.chunks).toHaveLength(0);
  });

  it('completes a contiguous streamed image, records verified state, and is idempotent', async () => {
    const state = await fixture();
    await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );

    const first = await state.service.complete(
      principal, 'space-1', state.session.id, HASH, { sizeBytes: String(PNG.length), chunkCount: 1 },
    );
    const retry = await state.service.complete(
      principal, 'space-1', state.session.id, HASH, { sizeBytes: String(PNG.length), chunkCount: 1 },
    );

    expect(first).toEqual(expect.objectContaining({
      contentHash: HASH,
      sizeBytes: String(PNG.length),
      mimeType: 'image/png',
      width: 1,
      height: 1,
    }));
    expect(retry).toEqual(first);
    expect(state.blob).toEqual(expect.objectContaining({
      status: 'verified', storageKey: expect.stringMatching(/^sha256\//u), verifiedAt: expect.any(Date),
    }));
  });

  it.each([
    ['wrong chunk count', { sizeBytes: String(PNG.length), chunkCount: 2 }, undefined],
    ['wrong declared size', { sizeBytes: String(PNG.length + 1), chunkCount: 1 }, undefined],
    ['wrong expected MIME', { sizeBytes: String(PNG.length), chunkCount: 1 }, (state: any) => { state.blob.mimeType = 'image/jpeg'; }],
    ['wrong expected dimensions', { sizeBytes: String(PNG.length), chunkCount: 1 }, (state: any) => { state.blob.width = 2; }],
    ['wrong expected content hash', { sizeBytes: String(PNG.length), chunkCount: 1 }, (state: any) => {
      state.blob.contentHash = HASH; state.chunks[0].chunkHash = 'b'.repeat(64);
    }],
  ])('rejects completion with %s and does not write verified state', async (_name, complete, mutate) => {
    const state = await fixture();
    await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );
    mutate?.(state);

    await expect(state.service.complete(
      principal, 'space-1', state.session.id, HASH, complete,
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(state.blob.storageKey).toBeNull();
    expect(state.blob.verifiedAt).toBeNull();
    expect(state.blob.status).toBe('uploading');
  });

  it('releases the physical reservation when combination fails with ENOSPC', async () => {
    const state = await fixture();
    await state.service.putChunk(
      principal, 'space-1', state.session.id, HASH, 0, Readable.from([PNG]),
    );
    jest.spyOn(state.staging, 'combineChunks').mockRejectedValueOnce(
      Object.assign(new Error('disk full'), { code: 'ENOSPC' }),
    );
    const release = jest.spyOn(state.storage, 'releaseTempReservation');

    await expect(state.service.complete(
      principal,
      'space-1',
      state.session.id,
      HASH,
      { sizeBytes: String(PNG.length), chunkCount: 1 },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(state.blob).toEqual(expect.objectContaining({
      status: 'uploading', storageKey: null, verifiedAt: null,
    }));
  });

  it('downloads only an immutable version bound to the requested fixed revision and Space', async () => {
    const state = await fixture();
    const reservation = await state.storage.createReservedTempPath(BigInt(PNG.length), 1n);
    await writeFile(reservation.path, PNG);
    const stored = await state.storage.withContentLock(HASH, (lease) => (
      state.storage.publish(reservation, HASH, BigInt(PNG.length), lease)
    ));
    state.setRevisionRow({
      revisionId: 'revision-1',
      attachmentId: 'attachment-1',
      attachmentVersionId: 'version-1',
      spaceId: 'space-1',
      path: 'assets/photo.png',
      attachment: { id: 'attachment-1', spaceId: 'space-1' },
      attachmentVersion: {
        id: 'version-1', attachmentId: 'attachment-1', contentHash: HASH,
        storageKey: stored.storageKey, mimeType: 'image/png', sizeBytes: BigInt(PNG.length),
        width: 1, height: 1,
      },
    });

    const result = await state.service.openRevisionAttachment(
      principal, 'space-1', 'revision-1', 'attachment-1',
    );
    const received: Buffer[] = [];
    for await (const chunk of result.stream) received.push(Buffer.from(chunk));

    expect(Buffer.concat(received)).toEqual(PNG);
    expect(result).toEqual(expect.objectContaining({ mimeType: 'image/png', sizeBytes: PNG.length }));
  });

  it.each([
    ['current revision', 'space-1', 'current', 'attachment-1'],
    ['cross-Space revision', 'space-2', 'revision-1', 'attachment-1'],
    ['other revision', 'space-1', 'revision-2', 'attachment-1'],
    ['other attachment', 'space-1', 'revision-1', 'attachment-2'],
  ])('fails closed for %s download lookup', async (_name, spaceId, revisionId, attachmentId) => {
    const state = await fixture();
    state.setRevisionRow({
      revisionId: 'revision-1', attachmentId: 'attachment-1', spaceId: 'space-1',
      attachmentVersion: { attachmentId: 'attachment-1', contentHash: HASH, storageKey: 'secret' },
    });

    await expect(state.service.openRevisionAttachment(
      principal, spaceId, revisionId, attachmentId,
    )).rejects.toMatchObject({ syncCode: expect.stringMatching(/PAYLOAD_INVALID|ATTACHMENT_MISSING/u) });
  });

  it('rechecks live membership and immutable storage consistency for downloads', async () => {
    const state = await fixture();
    state.setMember(null);
    await expect(state.service.openRevisionAttachment(
      principal, 'space-1', 'revision-1', 'attachment-1',
    )).rejects.toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });

    state.setMember({ role: 'viewer' });
    state.setRevisionRow({
      revisionId: 'revision-1', attachmentId: 'attachment-1', spaceId: 'space-1',
      attachmentVersionId: 'version-1',
      attachment: { id: 'attachment-1', spaceId: 'space-1' },
      attachmentVersion: {
        id: 'version-1', attachmentId: 'attachment-1', contentHash: HASH,
        storageKey: `sha256/${'b'.repeat(2)}/${'b'.repeat(2)}/${'b'.repeat(64)}`,
        mimeType: 'image/png', sizeBytes: BigInt(PNG.length), width: 1, height: 1,
      },
    });
    await expect(state.service.openRevisionAttachment(
      principal, 'space-1', 'revision-1', 'attachment-1',
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_BLOB_MISSING' });
  });

  it('uses the locked live platform role rather than a stale super-admin principal', async () => {
    const state = await fixture();
    state.setLiveUser({
      id: principal.userId, type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null,
    });
    state.setMember(null);
    await expect(state.service.openRevisionAttachment(
      { ...principal, platformRole: 'super_admin' },
      'space-1',
      'revision-1',
      'attachment-1',
    )).rejects.toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });
  });

  it.each(['legacy', 'future', 'corrupt'])(
    'fails closed when immutable revision authority rejects a %s revision',
    async () => {
      const state = await fixture();
      state.immutableRevisions.verify.mockRejectedValueOnce(new SyncV3AuthorityError());

      await expect(state.service.openRevisionAttachment(
        principal, 'space-1', 'revision-1', 'attachment-1',
      )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_MISSING' });
      expect(state.prisma.syncRevisionAttachmentRow.findUnique).not.toHaveBeenCalled();
    },
  );

  it('rejects an immutable row whose attachment ownership does not match the Space', async () => {
    const state = await fixture();
    state.setRevisionRow({
      revisionId: 'revision-1', attachmentId: 'attachment-1', spaceId: 'space-1',
      attachmentVersionId: 'version-1',
      attachment: { id: 'attachment-1', spaceId: 'space-2' },
      attachmentVersion: {
        id: 'version-1', attachmentId: 'attachment-1', contentHash: HASH,
        storageKey: `sha256/${HASH.slice(0, 2)}/${HASH.slice(2, 4)}/${HASH}`,
        mimeType: 'image/png', sizeBytes: BigInt(PNG.length), width: 1, height: 1,
      },
    });

    await expect(state.service.openRevisionAttachment(
      principal, 'space-1', 'revision-1', 'attachment-1',
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_MISSING' });
  });
});

const syncV3BlobDatabaseUrl = safeSyncV3BlobDatabaseUrl();
const dbIt = syncV3BlobDatabaseUrl ? it : it.skip;

describe('SyncV3BlobService PostgreSQL integration', () => {
  dbIt('binds concurrent receipts and fixed-revision reads without persisting failed verification', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: syncV3BlobDatabaseUrl } } });
    const root = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-blob-db-'));
    const config = attachmentConfig(root);
    const storage = new LocalAttachmentStorage(config);
    const staging = new SyncV3BlobStorage(root);
    const capabilities: any = { capabilitiesV3: () => ({
      maxAttachmentBytes: 10 * 1024 * 1024,
      maxTransferBlobBytes: 100 * 1024 * 1024,
      blobChunkBytes: 1024 * 1024,
      maxBlobChunks: 10,
      maxImageDimension: 10_000,
      maxDecodedPixels: 40_000_000,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
    }) };
    const service = new SyncV3BlobService(
      prisma as any,
      staging,
      storage,
      config,
      capabilities,
      new AuthorizationService(prisma as any),
      new SyncV3ImmutableRevisionService(),
    );
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `blob_user_${suffix}`;
    const spaceId = `blob_space_${suffix}`;
    const otherSpaceId = `blob_other_${suffix}`;
    const sessionId = randomUUID();
    const raceSessionId = randomUUID();
    const credentialFamilyId = randomUUID();
    const credentialId = randomUUID();
    const attachmentId = `blob_attachment_${suffix}`;
    const revisionId = `blob_revision_${suffix}`;
    const dbPrincipal: HumanDevicePrincipal = {
      userId,
      credentialId,
      credentialFamilyId,
      deviceId: randomUUID(),
      vaultId: randomUUID(),
      status: 'active',
      platformRole: 'user',
    };

    try {
      await prisma.user.create({ data: {
        id: userId,
        email: `${suffix}@blob.sync-v3.test`,
      } });
      await prisma.space.createMany({ data: [
        { id: spaceId, name: 'Task 6 Blob Space', slug: spaceId },
        { id: otherSpaceId, name: 'Task 6 Other Space', slug: otherSpaceId },
      ] });
      await prisma.spaceMember.createMany({ data: [
        { userId, spaceId, role: 'owner' },
        { userId, spaceId: otherSpaceId, role: 'owner' },
      ] });
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: credentialFamilyId,
        userId,
        deviceId: dbPrincipal.deviceId,
        vaultId: dbPrincipal.vaultId,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId,
        credentialFamilyId,
        userId,
        deviceId: dbPrincipal.deviceId,
        vaultId: dbPrincipal.vaultId,
        deviceName: 'Task 6 PostgreSQL credential',
        credentialHash: `blob_hash_${suffix}`,
        status: 'active',
        activatedAt: new Date(),
      } });
      await prisma.pushSession.create({ data: {
        id: sessionId,
        protocolVersion: '3',
        credentialFamilyId,
        credentialId,
        userId,
        spaceId,
        baseRevisionId: `blob_base_${suffix}`,
        idempotencyKey: `blob_idempotency_${suffix}`,
        status: 'uploading',
        capabilitiesHash: 'a'.repeat(64),
        confirmationHash: 'b'.repeat(64),
        confirmationByteLength: 2,
        changeCount: 0,
        totalBodyBytes: 0n,
        attachmentCount: 1,
        transferBlobBytes: BigInt(PNG.length),
        expiresAt: new Date(Date.now() + 60_000),
        blobs: { create: {
          contentHash: HASH,
          sizeBytes: BigInt(PNG.length),
          mimeType: 'image/png',
          width: 2,
          height: 1,
          status: 'uploading',
        } },
      } });

      let markRevocationWritten!: () => void;
      let releaseRevocation!: () => void;
      let markStaged!: () => void;
      const revocationWritten = new Promise<void>((resolve) => { markRevocationWritten = resolve; });
      const revocationRelease = new Promise<void>((resolve) => { releaseRevocation = resolve; });
      const staged = new Promise<void>((resolve) => { markStaged = resolve; });
      const originalStage = staging.stageChunk.bind(staging);
      const stageSpy = jest.spyOn(staging, 'stageChunk').mockImplementationOnce(async (...args) => {
        const value = await originalStage(...args);
        markStaged();
        return value;
      });
      const revocation = prisma.$transaction(async (tx) => {
        await tx.humanDeviceCredential.update({
          where: { id: credentialId },
          data: { status: 'revoked', revokedAt: new Date() },
        });
        markRevocationWritten();
        await revocationRelease;
      });
      await revocationWritten;
      const blockedPut = service.putChunk(
        dbPrincipal, spaceId, sessionId, HASH, 0, Readable.from([PNG]),
      );
      await staged;
      releaseRevocation();
      await revocation;
      await expect(blockedPut).rejects.toMatchObject({ syncCode: 'DEVICE_CREDENTIAL_REVOKED' });
      await expect(prisma.pushSessionBlobChunk.count({ where: {
        sessionId, contentHash: HASH, chunkIndex: 0,
      } })).resolves.toBe(0);
      stageSpy.mockRestore();
      await prisma.humanDeviceCredential.update({
        where: { id: credentialId },
        data: { status: 'active', revokedAt: null },
      });

      const [first, second] = await Promise.all([
        service.putChunk(dbPrincipal, spaceId, sessionId, HASH, 0, Readable.from([PNG])),
        service.putChunk(dbPrincipal, spaceId, sessionId, HASH, 0, Readable.from([PNG])),
      ]);
      expect(second.receipt).toBe(first.receipt);
      await expect(prisma.pushSessionBlobChunk.count({ where: {
        sessionId, contentHash: HASH, chunkIndex: 0,
      } })).resolves.toBe(1);
      await prisma.pushSession.create({ data: {
        id: raceSessionId,
        protocolVersion: '3',
        credentialFamilyId,
        credentialId,
        userId,
        spaceId,
        baseRevisionId: `blob_race_base_${suffix}`,
        idempotencyKey: `blob_race_idempotency_${suffix}`,
        status: 'uploading',
        capabilitiesHash: 'a'.repeat(64),
        confirmationHash: 'b'.repeat(64),
        confirmationByteLength: 2,
        changeCount: 0,
        totalBodyBytes: 0n,
        attachmentCount: 1,
        transferBlobBytes: BigInt(PNG.length),
        expiresAt: new Date(Date.now() + 60_000),
        blobs: { create: {
          contentHash: HASH,
          sizeBytes: BigInt(PNG.length),
          mimeType: 'image/png',
          width: 1,
          height: 1,
          status: 'uploading',
        } },
      } });
      const different = Buffer.alloc(PNG.length, 0x5a);
      const raced = await Promise.allSettled([
        service.putChunk(dbPrincipal, spaceId, raceSessionId, HASH, 0, Readable.from([PNG])),
        service.putChunk(dbPrincipal, spaceId, raceSessionId, HASH, 0, Readable.from([different])),
      ]);
      expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(raced.filter((result) => result.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({
          syncCode: 'ATTACHMENT_CONTENT_INVALID',
        }) }),
      ]);
      await expect(prisma.pushSessionBlobChunk.count({ where: {
        sessionId: raceSessionId, contentHash: HASH, chunkIndex: 0,
      } })).resolves.toBe(1);
      await expect(service.putChunk(
        dbPrincipal, otherSpaceId, sessionId, HASH, 0, Readable.from([PNG]),
      )).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_NOT_FOUND' });

      await prisma.humanDeviceCredential.update({
        where: { id: credentialId },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      await expect(service.putChunk(
        dbPrincipal, spaceId, sessionId, HASH, 0, Readable.from([PNG]),
      )).rejects.toMatchObject({ syncCode: 'DEVICE_CREDENTIAL_REVOKED' });
      await prisma.humanDeviceCredential.update({
        where: { id: credentialId },
        data: { status: 'active', revokedAt: null },
      });

      await expect(service.complete(dbPrincipal, spaceId, sessionId, HASH, {
        sizeBytes: String(PNG.length), chunkCount: 1,
      })).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
      await expect(prisma.pushSessionBlob.findUnique({
        where: { sessionId_contentHash: { sessionId, contentHash: HASH } },
      })).resolves.toEqual(expect.objectContaining({
        status: 'uploading', storageKey: null, verifiedAt: null,
      }));

      await prisma.pushSessionBlob.update({
        where: { sessionId_contentHash: { sessionId, contentHash: HASH } },
        data: { width: 1 },
      });
      const completed = await service.complete(dbPrincipal, spaceId, sessionId, HASH, {
        sizeBytes: String(PNG.length), chunkCount: 1,
      });
      await expect(service.complete(dbPrincipal, spaceId, sessionId, HASH, {
        sizeBytes: String(PNG.length), chunkCount: 1,
      })).resolves.toEqual(completed);
      const verified = await prisma.pushSessionBlob.findUniqueOrThrow({
        where: { sessionId_contentHash: { sessionId, contentHash: HASH } },
      });

      const attachment = await prisma.spaceAttachment.create({ data: {
        id: attachmentId,
        spaceId,
        displayName: 'photo.png',
        nameKey: `photo-${suffix}.png`,
        contentHash: HASH,
        storageKey: verified.storageKey!,
        mimeType: 'image/png',
        sizeBytes: BigInt(PNG.length),
        width: 1,
        height: 1,
        uploadedByUserId: userId,
      } });
      const version = await prisma.attachmentVersion.create({ data: {
        attachmentId: attachment.id,
        contentHash: HASH,
        storageKey: verified.storageKey!,
        mimeType: 'image/png',
        sizeBytes: BigInt(PNG.length),
        width: 1,
        height: 1,
      } });
      const attachmentUpdatedAt = version.createdAt.toISOString();
      const revisionPageBody = '# Task 6 image\n';
      const revisionPageHash = await protocolContentHash(revisionPageBody);
      const revisionPageId = `blob_page_${suffix}`;
      const manifest = canonicalTreeRevisionManifestV3({
        protocolVersion: '3',
        spaceId,
        folders: [],
        pages: [{
          pageId: revisionPageId,
          folderId: null,
          path: 'pages/task-6.md',
          title: 'Task 6 image',
          body: revisionPageBody,
          contentHash: revisionPageHash,
          updatedAt: attachmentUpdatedAt,
          referencedAttachmentIds: [attachment.id],
        }],
        attachments: [{
          attachmentId: attachment.id,
          path: 'assets/photo.png',
          mimeType: 'image/png',
          sizeBytes: String(PNG.length),
          width: 1,
          height: 1,
          contentHash: HASH,
          updatedAt: attachmentUpdatedAt,
        }],
      });
      const revisionContentHash = await treeRevisionContentHashV3(manifest);
      const delta = treeRevisionDeltaV3(null, manifest);
      await prisma.spaceKnowledgeRevision.create({ data: {
        id: revisionId,
        spaceId,
        sequence: 1,
        parentRevisionId: null,
        schemaVersion: 'content-tree@3',
        recipeVersion: 'referenced-images-v1',
        contentHash: revisionContentHash,
        revisionContentHash,
        delta: delta as any,
        pageCount: 1n,
        revisionBodyBytes: BigInt(Buffer.byteLength(revisionPageBody, 'utf8')),
        revisionManifestByteLength: BigInt(canonicalBytes(manifest).byteLength),
        attachmentCount: 1n,
        revisionAttachmentBytes: BigInt(PNG.length),
      } });
      await prisma.syncPageContentRow.create({ data: {
        contentHash: revisionPageHash,
        body: revisionPageBody,
        byteLength: Buffer.byteLength(revisionPageBody, 'utf8'),
      } });
      await prisma.syncRevisionPageRow.create({ data: {
        revisionId,
        pageId: revisionPageId,
        folderId: null,
        path: 'pages/task-6.md',
        pathKey: 'pages/task-6.md',
        title: 'Task 6 image',
        contentHash: revisionPageHash,
        updatedAt: new Date(attachmentUpdatedAt),
      } });
      await prisma.syncRevisionAttachmentRow.create({ data: {
        revisionId,
        attachmentId: attachment.id,
        attachmentVersionId: version.id,
        spaceId,
        path: 'assets/photo.png',
        pathKey: 'assets/photo.png',
        ordinal: 0,
      } });
      await prisma.legacyRevisionSidecar.create({ data: {
        revisionId,
        sidecar: {
          syncV3Revision: {
            protocolVersion: '3',
            manifestSchema: 'TreeRevisionContentManifestV3',
            revisionContentHash,
            folderCount: '0',
            pageCount: '1',
            attachmentCount: '1',
            revisionManifestByteLength: String(canonicalBytes(manifest).byteLength),
            revisionBodyBytes: String(Buffer.byteLength(revisionPageBody, 'utf8')),
            revisionAttachmentBytes: String(PNG.length),
            treeDeltaCount: String(delta.length),
            pageAttachmentIds: [{
              pageId: revisionPageId,
              referencedAttachmentIds: [attachment.id],
            }],
            attachmentUpdatedAt: [{
              attachmentId: attachment.id,
              updatedAt: attachmentUpdatedAt,
            }],
          },
        },
      } });

      const download = await service.openRevisionAttachment(
        dbPrincipal, spaceId, revisionId, attachment.id,
      );
      const bytes: Buffer[] = [];
      for await (const chunk of download.stream) bytes.push(Buffer.from(chunk));
      expect(Buffer.concat(bytes)).toEqual(PNG);
      await prisma.spaceMember.delete({ where: { userId_spaceId: { userId, spaceId } } });
      await expect(service.openRevisionAttachment(
        { ...dbPrincipal, platformRole: 'super_admin' }, spaceId, revisionId, attachment.id,
      )).rejects.toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      await expect(service.openRevisionAttachment(
        dbPrincipal, otherSpaceId, revisionId, attachment.id,
      )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_MISSING' });
      await expect(service.openRevisionAttachment(
        dbPrincipal, spaceId, `other_${revisionId}`, attachment.id,
      )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_MISSING' });
    } finally {
      await prisma.legacyRevisionSidecar.deleteMany({ where: { revisionId } });
      const revisionPages = await prisma.syncRevisionPageRow.findMany({
        where: { revisionId }, select: { contentHash: true },
      });
      await prisma.syncRevisionPageRow.deleteMany({ where: { revisionId } });
      await prisma.syncRevisionAttachmentRow.deleteMany({ where: { revisionId } });
      await prisma.attachmentVersion.deleteMany({ where: { attachmentId } });
      await prisma.spaceAttachment.deleteMany({ where: { id: attachmentId } });
      await prisma.spaceKnowledgeRevision.deleteMany({ where: { id: revisionId } });
      await prisma.syncPageContentRow.deleteMany({
        where: { contentHash: { in: revisionPages.map((row) => row.contentHash) } },
      });
      await prisma.pushSession.deleteMany({ where: { id: { in: [sessionId, raceSessionId] } } });
      await prisma.space.deleteMany({ where: { id: { in: [spaceId, otherSpaceId] } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await storage.onModuleDestroy();
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

function safeSyncV3BlobDatabaseUrl(): string | undefined {
  const explicit = process.env.SYNC_V3_TEST_DATABASE_URL;
  const runtime = process.env.DATABASE_URL;
  if (!explicit || explicit !== runtime) return undefined;
  try {
    const parsed = new URL(explicit);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && databaseName.toLowerCase().includes('test')
      ? explicit
      : undefined;
  } catch {
    return undefined;
  }
}
