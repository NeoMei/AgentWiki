import { Readable } from 'node:stream';
import {
  canonicalBytes,
  contentHash,
  treeBatchHashV3,
  treeConfirmationHashV3,
  treeRevisionDeltaV3,
  type CreateTreePushSessionRequestV3,
  type TreePushBatchV3,
  type TreePushChangeV3,
} from '@neomei/agentwiki-sync-protocol';
import { SyncV3PushSessionService } from './sync-v3-push-session.service';

const existingHash = 'a'.repeat(64);
const missingHash = 'b'.repeat(64);
const capabilityHash = 'c'.repeat(64);

function principal() {
  return {
    userId: 'user-1', credentialId: '11111111-1111-4111-8111-111111111111',
    credentialFamilyId: '22222222-2222-4222-8222-222222222222',
    deviceId: '33333333-3333-4333-8333-333333333333',
    vaultId: '44444444-4444-4444-8444-444444444444',
    status: 'active' as const, platformRole: 'user' as const,
  };
}

function request(overrides: Partial<CreateTreePushSessionRequestV3> = {}): CreateTreePushSessionRequestV3 {
  return {
    protocolVersion: '3', baseRevision: 'rev-1',
    idempotencyKey: '55555555-5555-4555-8555-555555555555',
    capabilitiesHash: capabilityHash, confirmationHash: 'd'.repeat(64),
    confirmationByteLength: 1, changeCount: 1, totalBodyBytes: 0,
    attachmentCount: 1, transferBlobBytes: 4,
    blobRequirements: [{
      contentHash: missingHash, sizeBytes: '4', mimeType: 'image/png',
      width: 1, height: 1,
    }],
    ...overrides,
  };
}

function harness(redis: { incrementWithWindow: jest.Mock } = {
  incrementWithWindow: jest.fn().mockResolvedValue(1),
}) {
  const sessions: any[] = [];
  const batches: any[] = [];
  const changes: any[] = [];
  const blobs: any[] = [];
  const head = {
    id: 'rev-1', sequence: 1, createdAt: new Date('2026-09-04T00:00:00.000Z'),
    revisionContentHash: 'e'.repeat(64), pageCount: 0n,
    revisionManifestByteLength: 2n, revisionBodyBytes: 0n,
    attachmentCount: 0n, revisionAttachmentBytes: 0n,
  };
  const credential = {
    id: principal().credentialId, credentialFamilyId: principal().credentialFamilyId,
    userId: principal().userId, deviceId: principal().deviceId, vaultId: principal().vaultId,
    status: 'active', provisionalExpiresAt: null,
    user: { id: principal().userId, type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null },
  };
  let membershipRole = 'owner';
  let currentHead = head;

  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ id: principal().credentialId }]),
    user: { findUnique: jest.fn().mockResolvedValue(credential.user) },
    humanDeviceCredential: { findUnique: jest.fn().mockResolvedValue(credential) },
    spaceMember: { findUnique: jest.fn(async () => membershipRole ? { role: membershipRole } : null) },
    spaceKnowledgeRevision: {
      findFirst: jest.fn(async () => currentHead),
      findUnique: jest.fn(async () => currentHead),
    },
    syncRevisionFolderRow: { count: jest.fn().mockResolvedValue(0) },
    attachmentVersion: {
      findMany: jest.fn(async ({ where }: any) => {
        const hasExisting = where.OR.some((candidate: any) => candidate.contentHash === existingHash);
        return hasExisting ? [{
          contentHash: existingHash, storageKey: `aa/${existingHash}`,
          sizeBytes: 4n, mimeType: 'image/png', width: 1, height: 1,
        }] : [];
      }),
    },
    pushSession: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return sessions.find((row) => row.id === where.id) ?? null;
        return sessions.find((row) => row.credentialFamilyId === where.credentialFamilyId_idempotencyKey.credentialFamilyId
          && row.idempotencyKey === where.credentialFamilyId_idempotencyKey.idempotencyKey) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data, receivedBatchCount: 0, receivedChangeCount: 0,
          receivedBodyBytes: 0n, result: null, publishedChangeSetId: null };
        sessions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = sessions.find((candidate) => candidate.id === where.id)!;
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === 'object' && value && 'increment' in value) row[key] += (value as any).increment;
          else row[key] = value;
        }
        return row;
      }),
    },
    pushSessionBlob: {
      createMany: jest.fn(async ({ data }: any) => { blobs.push(...data); return { count: data.length }; }),
      findMany: jest.fn(async ({ where }: any) => blobs.filter((row) => row.sessionId === where.sessionId)),
    },
    pushSessionBatch: {
      findUnique: jest.fn(async ({ where }: any) => batches.find((row) => row.sessionId === where.sessionId_batchIndex.sessionId
        && row.batchIndex === where.sessionId_batchIndex.batchIndex) ?? null),
      findMany: jest.fn(async ({ where }: any) => batches.filter((row) => row.sessionId === where.sessionId)
        .sort((a, b) => a.batchIndex - b.batchIndex)),
      create: jest.fn(async ({ data }: any) => { const row = { id: `batch-${batches.length}`, ...data }; batches.push(row); return row; }),
    },
    pushSessionV3Change: {
      findMany: jest.fn(async ({ where }: any) => changes.filter((row) => row.sessionId === where.sessionId)
        .sort((a, b) => a.ordinal - b.ordinal)),
      createMany: jest.fn(async ({ data }: any) => { changes.push(...data); return { count: data.length }; }),
    },
    changeSet: {
      create: jest.fn(async () => ({ id: 'change-set-1' })),
      update: jest.fn().mockResolvedValue({}),
    },
    changeItem: { create: jest.fn().mockResolvedValue({}) },
    folder: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    space: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  tx.contentTreeRevision = 0n;
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (callback: any) => callback(tx)),
  } as any;
  const capabilities = {
    capabilitiesV3: jest.fn(() => ({
      maxBatchItems: 100, maxChangeCount: 100, maxBatchBytes: 1_048_576,
      maxConfirmationBytes: 4_194_304, maxClientTotalBodyBytes: 2_097_152,
      maxPageBytes: 1_048_576, maxRevisionAttachments: 1_000,
      maxTransferBlobBytes: 104_857_600, maxAttachmentBytes: 10_485_760,
      allowedMimeTypes: ['image/gif', 'image/jpeg', 'image/png', 'image/webp'],
      maxImageDimension: 10_000, maxDecodedPixels: 40_000_000,
      pushSessionTtlSeconds: 900,
    })),
    hashV3: jest.fn().mockResolvedValue(capabilityHash),
  };
  const writer = {
    inspectCurrentLocked: jest.fn().mockResolvedValue({
      mode: 'native_v3', baseRevision: 'rev-1', blockers: [],
      candidate: { folders: [], pages: [], attachments: [] },
    }),
    advanceV3Locked: jest.fn().mockResolvedValue({
      revisionId: 'rev-2', sequence: 2, revisionContentHash: 'f'.repeat(64),
      pageCount: 0n, attachmentCount: 0n, revisionManifestByteLength: 2n,
      revisionBodyBytes: 0n, revisionAttachmentBytes: 0n,
    }),
  };
  const storage = { openVerified: jest.fn().mockResolvedValue(Readable.from([])) };
  const service = new (SyncV3PushSessionService as any)(
    prisma, {
      batchReceipt: (_id: string, index: number, hash: string) => `receipt:${index}:${hash}`,
      credentialHash: (value: string) => value,
    } as any,
    { lockSyncMutationSpace: jest.fn(async () => tx) } as any,
    { lockLiveHumanPrincipal: jest.fn().mockResolvedValue(credential.user) } as any,
    capabilities as any, writer as any,
    storage as any,
    redis,
    undefined,
    undefined,
  );
  return {
    service, prisma, sessions, batches, changes, blobs, tx, capabilities, writer, storage,
    revokeRole: () => { membershipRole = 'viewer'; },
    revokeCredential: () => { credential.status = 'revoked'; },
    advanceHead: () => { currentHead = { ...head, id: 'rev-web', sequence: 2 }; },
  };
}

async function stageChanges(
  h: ReturnType<typeof harness>,
  changes: TreePushChangeV3[],
  base: { folders: any[]; pages: any[]; attachments: any[] },
) {
  h.writer.inspectCurrentLocked.mockResolvedValue({
    mode: 'native_v3', baseRevision: 'rev-1', blockers: [], candidate: base,
  });
  const manifestChanges = changes.map((change) => change.operation === 'upsert_page'
    ? { operation: 'upsert_page' as const, page: (({ body: _body, ...page }) => page)(change.page) }
    : change);
  const manifest = {
    protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
    capabilitiesHash: capabilityHash, changes: manifestChanges,
  };
  const confirmationHash = await treeConfirmationHashV3(manifest);
  const totalBodyBytes = changes.reduce((sum, change) => sum + (
    change.operation === 'upsert_page' ? Buffer.byteLength(change.page.body) : 0
  ), 0);
  const created = await h.service.create(principal(), 'space-1', request({
    confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength,
    changeCount: changes.length, totalBodyBytes, attachmentCount: 0,
    transferBlobBytes: 0, blobRequirements: [],
  }));
  const batch = { protocolVersion: '3' as const, batchIndex: 0, changes };
  await h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
    ...batch, batchHash: await treeBatchHashV3(batch),
  });
  return { created, finalizeInput: { protocolVersion: '3' as const, confirmationHash, userConfirmed: true as const } };
}

describe('SyncV3PushSessionService', () => {
  it('returns only missing content hashes in canonical order and replays the exact create binding', async () => {
    const h = harness();
    const input = request({
      attachmentCount: 2, transferBlobBytes: 8,
      blobRequirements: [
        { contentHash: existingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1 },
        { contentHash: missingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1 },
      ],
      changeCount: 2,
    });
    const first = await h.service.create(principal(), 'space-1', input);
    const retry = await h.service.create(principal(), 'space-1', input);
    expect(first.missingContentHashes).toEqual([missingHash]);
    expect(retry).toEqual(first);
    expect(h.sessions).toHaveLength(1);
    expect(h.blobs.find((blob) => blob.contentHash === existingHash)).toMatchObject({ status: 'verified' });
  });

  it('rejects a reused idempotency key when any requirement binding differs', async () => {
    const h = harness();
    await h.service.create(principal(), 'space-1', request());
    await expect(h.service.create(principal(), 'space-1', request({
      transferBlobBytes: 5,
      blobRequirements: [{ contentHash: missingHash, sizeBytes: '5', mimeType: 'image/png', width: 1, height: 1 }],
    }))).rejects.toMatchObject({ syncCode: 'IDEMPOTENCY_MISMATCH' });
  });

  it('reacquires live locks and validates the full binding after a create uniqueness race', async () => {
    const h = harness();
    h.tx.pushSession.create.mockImplementationOnce(async ({ data }: any) => {
      h.sessions.push({ ...data, receivedBatchCount: 0, receivedChangeCount: 0,
        receivedBodyBytes: 0n, status: 'published', result: null, publishedChangeSetId: null });
      h.blobs.push({ sessionId: data.id, ...request().blobRequirements[0],
        sizeBytes: 4n, status: 'uploading', storageKey: null, verifiedAt: null });
      h.advanceHead();
      throw Object.assign(new Error('raced'), { code: 'P2002' });
    });
    const result = await h.service.create(principal(), 'space-1', request());
    expect(result.sessionId).toBe(h.sessions[0].id);
    expect(result.status).toBe('published');
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('rejects zero-byte requirements through the public strict request schema', async () => {
    const h = harness();
    await expect(h.service.create(principal(), 'space-1', {
      ...request(), transferBlobBytes: 0,
      blobRequirements: [{ contentHash: missingHash, sizeBytes: '0', mimeType: 'image/png', width: 1, height: 1 }],
    } as any)).rejects.toMatchObject({ syncCode: 'PAYLOAD_INVALID' });
  });

  it('accepts canonical batches, returns the persisted receipt on replay, and rejects a different replay', async () => {
    const h = harness();
    const attachment = {
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '4', width: 1, height: 1, contentHash: missingHash,
      updatedAt: '2026-09-04T00:00:00.000Z',
    };
    const manifest = {
      protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash,
      changes: [{ operation: 'upsert_attachment' as const, attachment }],
    };
    const confirmationHash = await treeConfirmationHashV3(manifest);
    const input = request({ confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength });
    const created = await h.service.create(principal(), 'space-1', input);
    h.blobs[0].status = 'verified';
    h.blobs[0].storageKey = `bb/${missingHash}`;
    h.blobs[0].verifiedAt = new Date();
    const withoutHash = { protocolVersion: '3' as const, batchIndex: 0, changes: manifest.changes };
    const batch: TreePushBatchV3 = { ...withoutHash, batchHash: await treeBatchHashV3(withoutHash) };
    const first = await h.service.uploadBatch(principal(), 'space-1', created.sessionId, batch);
    const retry = await h.service.uploadBatch(principal(), 'space-1', created.sessionId, batch);
    expect(retry).toEqual(first);
    expect(h.sessions[0].status).toBe('ready_to_finalize');
    await expect(h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...batch, batchHash: 'f'.repeat(64),
    })).rejects.toMatchObject({ syncCode: 'BATCH_MISMATCH' });
  });

  it('rejects non-canonical change order, duplicate entities, and requirement metadata drift', async () => {
    const h = harness();
    const created = await h.service.create(principal(), 'space-1', request({ changeCount: 2, attachmentCount: 1 }));
    const page = {
      pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body: '# Page\n',
      contentHash: await contentHash('# Page\n'), updatedAt: '2026-09-04T00:00:00.000Z', referencedAttachmentIds: [],
    };
    const attachment = {
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '5', width: 1, height: 1, contentHash: missingHash,
      updatedAt: '2026-09-04T00:00:00.000Z',
    };
    const unordered = { protocolVersion: '3' as const, batchIndex: 0, changes: [
      { operation: 'upsert_page' as const, page },
      { operation: 'upsert_attachment' as const, attachment },
    ] };
    await expect(h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...unordered, batchHash: await treeBatchHashV3(unordered),
    })).rejects.toMatchObject({ syncCode: 'PAYLOAD_INVALID' });
  });

  it('rejects missing and extra Blob requirements against the completed attachment upsert set', async () => {
    const attachment = {
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '4', width: 1, height: 1, contentHash: missingHash,
      updatedAt: '2026-09-04T00:00:00.000Z',
    };
    const missing = harness();
    const missingSession = await missing.service.create(principal(), 'space-1', request({
      changeCount: 2, attachmentCount: 2,
    }));
    const missingAttachment = { ...attachment, attachmentId: 'attachment-2',
      path: 'assets/missing.png', contentHash: 'f'.repeat(64) };
    const missingBatch = { protocolVersion: '3' as const, batchIndex: 0,
      changes: [
        { operation: 'upsert_attachment' as const, attachment: missingAttachment },
        { operation: 'upsert_attachment' as const, attachment },
      ] };
    await expect(missing.service.uploadBatch(principal(), 'space-1', missingSession.sessionId, {
      ...missingBatch, batchHash: await treeBatchHashV3(missingBatch),
    })).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });

    const extra = harness();
    const duplicateAttachment = { ...attachment, attachmentId: 'attachment-2', path: 'assets/copy.png' };
    const extraSession = await extra.service.create(principal(), 'space-1', request({
      changeCount: 2, attachmentCount: 2, transferBlobBytes: 8,
      blobRequirements: [
        { contentHash: existingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1 },
        { contentHash: missingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1 },
      ],
    }));
    const extraBatch = { protocolVersion: '3' as const, batchIndex: 0, changes: [
      { operation: 'upsert_attachment' as const, attachment: duplicateAttachment },
      { operation: 'upsert_attachment' as const, attachment },
    ] };
    await expect(extra.service.uploadBatch(principal(), 'space-1', extraSession.sessionId, {
      ...extraBatch, batchHash: await treeBatchHashV3(extraBatch),
    })).rejects.toMatchObject({ syncCode: 'CONFIRMATION_MISMATCH' });
  });

  it('rejects duplicate entities and path collisions across batch boundaries', async () => {
    const h = harness();
    const created = await h.service.create(principal(), 'space-1', request({
      changeCount: 2, attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
    }));
    const folder = (folderId: string, path: string) => ({
      operation: 'upsert_folder' as const,
      folder: { folderId, parentFolderId: null, path, name: path.slice('pages/'.length),
        sortOrder: 0, updatedAt: '2026-09-04T00:00:00.000Z' },
    });
    const first = { protocolVersion: '3' as const, batchIndex: 0, changes: [folder('folder-a', 'pages/A')] };
    await h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...first, batchHash: await treeBatchHashV3(first),
    });
    const duplicate = { protocolVersion: '3' as const, batchIndex: 1, changes: [folder('folder-a', 'pages/B')] };
    await expect(h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...duplicate, batchHash: await treeBatchHashV3(duplicate),
    })).rejects.toMatchObject({ syncCode: 'PAYLOAD_INVALID' });
    const collision = { protocolVersion: '3' as const, batchIndex: 1, changes: [folder('folder-b', 'pages/A')] };
    await expect(h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...collision, batchHash: await treeBatchHashV3(collision),
    })).rejects.toMatchObject({ syncCode: 'PATH_COLLISION' });
  });

  it('keeps a session incomplete for a missing Blob and rechecks resident Blob readability at finalize', async () => {
    const h = harness();
    const attachment = {
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '4', width: 1, height: 1, contentHash: existingHash,
      updatedAt: '2026-09-04T00:00:00.000Z',
    };
    const pageBody = `![photo](../assets/photo.png)\n`;
    const page = {
      pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body: pageBody,
      contentHash: await contentHash(pageBody), updatedAt: '2026-09-04T00:00:00.000Z',
      referencedAttachmentIds: ['attachment-1'],
    };
    const manifest = { protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [
        { operation: 'upsert_attachment' as const, attachment },
        { operation: 'upsert_page' as const, page: (({ body: _body, ...rest }) => rest)(page) },
      ] };
    const confirmationHash = await treeConfirmationHashV3(manifest);
    const created = await h.service.create(principal(), 'space-1', request({
      confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength,
      changeCount: 2, totalBodyBytes: Buffer.byteLength(pageBody),
      blobRequirements: [{ contentHash: existingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1 }],
    }));
    const withoutHash = { protocolVersion: '3' as const, batchIndex: 0, changes: [
      { operation: 'upsert_attachment' as const, attachment },
      { operation: 'upsert_page' as const, page },
    ] };
    await h.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...withoutHash, batchHash: await treeBatchHashV3(withoutHash),
    });
    h.storage.openVerified.mockRejectedValue(new Error('object disappeared'));
    await expect(h.service.finalize(principal(), 'space-1', created.sessionId, {
      protocolVersion: '3', confirmationHash, userConfirmed: true,
    })).rejects.toMatchObject({ syncCode: 'ATTACHMENT_BLOB_MISSING' });
    expect(h.writer.advanceV3Locked).not.toHaveBeenCalled();
  });

  it('persists terminal noop results for lost-response replay and rejects abort after finalizing', async () => {
    const h = harness();
    const manifest = {
      protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [],
    };
    const confirmationHash = await treeConfirmationHashV3(manifest);
    const created = await h.service.create(principal(), 'space-1', request({
      confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength,
      changeCount: 0, totalBodyBytes: 0, attachmentCount: 0,
      transferBlobBytes: 0, blobRequirements: [],
    }));
    const finalizeInput = { protocolVersion: '3' as const, confirmationHash, userConfirmed: true as const };
    h.prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      await callback(h.tx);
      throw new Error('connection lost after commit');
    });
    await expect(h.service.finalize(principal(), 'space-1', created.sessionId, finalizeInput))
      .rejects.toThrow('connection lost after commit');
    const retry = await h.service.finalize(principal(), 'space-1', created.sessionId, finalizeInput);
    expect(retry).toMatchObject({ protocolVersion: '3', status: 'noop', revision: 'rev-1' });
    expect(h.sessions[0].status).toBe('published');

    h.sessions[0].status = 'finalizing';
    await expect(h.service.abort(principal(), 'space-1', created.sessionId))
      .rejects.toMatchObject({ syncCode: 'PUSH_SESSION_STATE_INVALID' });
  });

  it.each([
    ['permission removal', (h: ReturnType<typeof harness>) => h.revokeRole(), 'SPACE_READ_ONLY'],
    ['base head race', (h: ReturnType<typeof harness>) => h.advanceHead(), 'BASE_STALE'],
    ['capability drift', (h: ReturnType<typeof harness>) => h.capabilities.hashV3.mockResolvedValue('f'.repeat(64)), 'CAPABILITIES_CHANGED'],
    ['credential revocation', (h: ReturnType<typeof harness>) => h.revokeCredential(), 'DEVICE_CREDENTIAL_REVOKED'],
  ])('fails closed on %s before publishing', async (_name, mutate, code) => {
    const h = harness();
    const manifest = {
      protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [],
    };
    const confirmationHash = await treeConfirmationHashV3(manifest);
    const created = await h.service.create(principal(), 'space-1', request({
      confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength,
      changeCount: 0, attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
    }));
    mutate(h);
    await expect(h.service.finalize(principal(), 'space-1', created.sessionId, {
      protocolVersion: '3', confirmationHash, userConfirmed: true,
    })).rejects.toMatchObject({ syncCode: code });
    expect(h.writer.advanceV3Locked).not.toHaveBeenCalled();
  });

  it('commits the expired terminal state before upload, finalize, and abort report expiry', async () => {
    const folder = {
      operation: 'upsert_folder' as const,
      folder: { folderId: 'folder-1', parentFolderId: null, path: 'pages/Folder', name: 'Folder',
        sortOrder: 0, updatedAt: '2026-09-04T00:00:00.000Z' },
    };
    const upload = harness();
    const uploadSession = await upload.service.create(principal(), 'space-1', request({
      attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
    }));
    upload.sessions[0].expiresAt = new Date(0);
    const batch = { protocolVersion: '3' as const, batchIndex: 0, changes: [folder] };
    await expect(upload.service.uploadBatch(principal(), 'space-1', uploadSession.sessionId, {
      ...batch, batchHash: await treeBatchHashV3(batch),
    })).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_EXPIRED' });
    expect(upload.sessions[0].status).toBe('expired');

    const emptyManifest = { protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [] };
    const confirmationHash = await treeConfirmationHashV3(emptyManifest);
    for (const operation of ['finalize', 'abort'] as const) {
      const h = harness();
      const created = await h.service.create(principal(), 'space-1', request({
        confirmationHash, confirmationByteLength: canonicalBytes(emptyManifest).byteLength,
        changeCount: 0, attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
      }));
      h.sessions[0].expiresAt = new Date(0);
      const promise = operation === 'finalize'
        ? h.service.finalize(principal(), 'space-1', created.sessionId, {
          protocolVersion: '3', confirmationHash, userConfirmed: true,
        })
        : h.service.abort(principal(), 'space-1', created.sessionId);
      await expect(promise).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_EXPIRED' });
      expect(h.sessions[0].status).toBe('expired');
    }
  });

  it('replays a published terminal result through a rotated active credential in the same family', async () => {
    const h = harness();
    const manifest = {
      protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [],
    };
    const confirmationHash = await treeConfirmationHashV3(manifest);
    const created = await h.service.create(principal(), 'space-1', request({
      confirmationHash, confirmationByteLength: canonicalBytes(manifest).byteLength,
      changeCount: 0, totalBodyBytes: 0, attachmentCount: 0,
      transferBlobBytes: 0, blobRequirements: [],
    }));
    const finalizeInput = { protocolVersion: '3' as const, confirmationHash, userConfirmed: true as const };
    const published = await h.service.finalize(principal(), 'space-1', created.sessionId, finalizeInput);
    h.revokeCredential();
    const rotated = { ...principal(), credentialId: '66666666-6666-4666-8666-666666666666' };
    h.tx.$queryRaw.mockResolvedValue([{ id: rotated.credentialId }]);
    h.tx.humanDeviceCredential.findUnique.mockImplementation(async ({ where }: any) => ({
      id: where.id, credentialFamilyId: rotated.credentialFamilyId,
      userId: rotated.userId, deviceId: rotated.deviceId, vaultId: rotated.vaultId,
      status: 'active', provisionalExpiresAt: null,
      user: { id: rotated.userId, type: 'human', platformRole: 'user', deletedAt: null, lockedAt: null },
    }));

    await expect(h.service.finalize(rotated, 'space-1', created.sessionId, finalizeInput))
      .resolves.toEqual(published);
  });

  it('keeps an unpublished session exactly bound to its creating credential', async () => {
    const h = harness();
    const created = await h.service.create(principal(), 'space-1', request());
    const rotated = { ...principal(), credentialId: '66666666-6666-4666-8666-666666666666' };
    await expect(h.service.finalize(rotated, 'space-1', created.sessionId, {
      protocolVersion: '3', confirmationHash: request().confirmationHash, userConfirmed: true,
    })).rejects.toMatchObject({ syncCode: 'PUSH_SESSION_NOT_FOUND' });
  });

  it('applies every canonical nested archive exactly once and records every delta item', async () => {
    const h = harness();
    const timestamp = '2026-09-04T00:00:00.000Z';
    const base = {
      protocolVersion: '3' as const, spaceId: 'space-1',
      folders: [
        { folderId: 'parent', parentFolderId: null, name: 'Parent', path: 'pages/Parent', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'child', parentFolderId: 'parent', name: 'Child', path: 'pages/Parent/Child', sortOrder: 0, updatedAt: timestamp },
        { folderId: 'grandchild', parentFolderId: 'child', name: 'Grandchild', path: 'pages/Parent/Child/Grandchild', sortOrder: 0, updatedAt: timestamp },
      ],
      pages: [{ pageId: 'page-1', folderId: 'grandchild', path: 'pages/Parent/Child/Grandchild/Page.md',
        title: 'Page', body: '# Page\n', contentHash: await contentHash('# Page\n'), updatedAt: timestamp,
        referencedAttachmentIds: [] }],
      attachments: [],
    };
    const changes = treeRevisionDeltaV3(base, {
      protocolVersion: '3', spaceId: 'space-1', folders: [], pages: [], attachments: [],
    });
    const folders: any[] = base.folders.map((folder) => ({ ...folder, id: folder.folderId, spaceId: 'space-1', deletedAt: null }));
    const pages: any[] = base.pages.map((page) => ({ ...page, id: 'db-page-1', knowledgeKey: page.pageId,
      spaceId: 'space-1', authorId: 'user-1', slug: 'page', format: 'markdown', parentId: null,
      syncPath: page.path, syncPathKey: page.path.toLowerCase(), deletedAt: null }));
    const items: any[] = [];
    const tx: any = {
      contentTreeRevision: 0n,
      folder: {
        findUnique: jest.fn(async ({ where }: any) => folders.find((folder) => folder.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(
          folders.find((folder) => folder.id === where.id), data,
        )),
      },
      page: {
        findUnique: jest.fn(async ({ where }: any) => pages.find((page) => page.knowledgeKey === where.knowledgeKey) ?? null),
        findMany: jest.fn(async ({ where }: any) => pages.filter((page) => !page.deletedAt && where.folderId.in.includes(page.folderId))),
        update: jest.fn(async ({ where, data }: any) => Object.assign(pages.find((page) => page.id === where.id), data)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          for (const page of pages) if (where.id.in.includes(page.id)) Object.assign(page, data);
          return { count: where.id.in.length };
        }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      changeItem: { create: jest.fn(async ({ data }: any) => { items.push(data); return data; }) },
      space: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    await expect((h.service as any).applyLiveChanges(tx, principal(), 'space-1', changes, [], 'change-set-1'))
      .resolves.toBeUndefined();
    expect(items.map((item) => [item.type, item.publishedResourceId])).toEqual([
      ['archive_page', 'db-page-1'],
      ['archive_folder', 'parent'],
      ['archive_folder', 'child'],
      ['archive_folder', 'grandchild'],
    ]);
    expect(folders.every((folder) => folder.deletedAt instanceof Date)).toBe(true);
    expect(pages[0].deletedAt).toBeInstanceOf(Date);
  });

  it('does not cascade a single archive_folder live mutation ahead of its canonical descendants', async () => {
    const h = harness();
    const folders: any[] = [
      { id: 'parent', spaceId: 'space-1', parentId: null, path: 'pages/Parent', deletedAt: null },
      { id: 'child', spaceId: 'space-1', parentId: 'parent', path: 'pages/Parent/Child', deletedAt: null },
    ];
    const pages: any[] = [
      { id: 'db-page-1', knowledgeKey: 'page-1', spaceId: 'space-1', folderId: 'child',
        title: 'Page', content: '# Page\n', authorId: 'user-1', slug: 'page', format: 'markdown',
        parentId: null, syncPath: 'pages/Parent/Child/Page.md', syncPathKey: 'pages/parent/child/page.md',
        deletedAt: null },
    ];
    const tx: any = {
      contentTreeRevision: 0n,
      folder: {
        findUnique: jest.fn(async ({ where }: any) => folders.find((folder) => folder.id === where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(
          folders.find((folder) => folder.id === where.id), data,
        )),
      },
      page: {
        findMany: jest.fn(async () => pages.filter((page) => !page.deletedAt)),
        updateMany: jest.fn(async ({ data }: any) => {
          for (const page of pages) Object.assign(page, data);
          return { count: pages.length };
        }),
      },
      pageVersion: { create: jest.fn().mockResolvedValue({}) },
      pageSearchDocument: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      changeItem: { create: jest.fn().mockResolvedValue({}) },
      space: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    await (h.service as any).applyLiveChanges(tx, principal(), 'space-1', [{
      operation: 'archive_folder', folderId: 'parent', previousPath: 'pages/Parent',
    }], [], 'change-set-1');
    expect(folders[0].deletedAt).toBeInstanceOf(Date);
    expect(folders[1].deletedAt).toBeNull();
    expect(pages[0].deletedAt).toBeNull();
  });

  it('rejects staged changes that are not the exact canonical base-to-candidate delta', async () => {
    const timestamp = '2026-09-04T00:00:00.000Z';
    const folder = { folderId: 'folder-1', parentFolderId: null, name: 'Folder',
      path: 'pages/Folder', sortOrder: 0, updatedAt: timestamp };
    const cases: Array<{ name: string; base: any; change: TreePushChangeV3 }> = [
      { name: 'redundant upsert', base: { folders: [folder], pages: [], attachments: [] },
        change: { operation: 'upsert_folder', folder } },
      { name: 'nonexistent archive', base: { folders: [], pages: [], attachments: [] },
        change: { operation: 'archive_folder', folderId: 'missing', previousPath: 'pages/Missing' } },
      { name: 'wrong previousPath', base: { folders: [folder], pages: [], attachments: [] },
        change: { operation: 'archive_folder', folderId: folder.folderId, previousPath: 'pages/Wrong' } },
      { name: 'redundant detach', base: { folders: [], pages: [], attachments: [] },
        change: { operation: 'detach_attachment', attachmentId: 'missing', previousPath: 'assets/missing.png' } },
    ];
    for (const example of cases) {
      const h = harness();
      const staged = await stageChanges(h, [example.change], example.base);
      await expect(h.service.finalize(principal(), 'space-1', staged.created.sessionId, staged.finalizeInput))
        .rejects.toMatchObject({ syncCode: 'CONFIRMATION_MISMATCH' });
      expect(h.writer.advanceV3Locked).not.toHaveBeenCalled();
    }
  });

  it('rejects a candidate with an orphan Folder before creating live rows or a revision', async () => {
    const h = harness();
    const staged = await stageChanges(h, [{ operation: 'upsert_folder', folder: {
      folderId: 'orphan', parentFolderId: 'missing', name: 'Orphan',
      path: 'pages/Missing/Orphan', sortOrder: 0, updatedAt: '2026-09-04T00:00:00.000Z',
    } }], { folders: [], pages: [], attachments: [] });
    await expect(h.service.finalize(principal(), 'space-1', staged.created.sessionId, staged.finalizeInput))
      .rejects.toMatchObject({ syncCode: 'ATTACHMENT_REFERENCE_INVALID' });
    expect(h.tx.changeSet.create).not.toHaveBeenCalled();
    expect(h.writer.advanceV3Locked).not.toHaveBeenCalled();
  });

  it('maps archived attachment/page and active folder unique-key conflicts to stable sync errors', async () => {
    const timestamp = '2026-09-04T00:00:00.000Z';
    const cases: Array<{ change: TreePushChangeV3; syncCode: string; requirements?: any[] }> = [
      {
        change: { operation: 'upsert_attachment', attachment: {
          attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png',
          sizeBytes: '4', width: 1, height: 1, contentHash: missingHash, updatedAt: timestamp,
        } },
        syncCode: 'ATTACHMENT_NAME_CONFLICT',
        requirements: [{ contentHash: missingHash, storageKey: `bb/${missingHash}` }],
      },
      {
        change: { operation: 'upsert_folder', folder: {
          folderId: 'folder-1', parentFolderId: null, name: 'Folder', path: 'pages/Folder',
          sortOrder: 0, updatedAt: timestamp,
        } },
        syncCode: 'PATH_COLLISION',
      },
      {
        change: { operation: 'upsert_page', page: {
          pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body: '# Page\n',
          contentHash: await contentHash('# Page\n'), updatedAt: timestamp, referencedAttachmentIds: [],
        } },
        syncCode: 'PATH_COLLISION',
      },
    ];
    for (const example of cases) {
      const h = harness();
      const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
      const tx: any = {
        contentTreeRevision: 0n,
        spaceAttachment: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn(async ({ where }: any) => where.status ? null : { id: 'archived-attachment' }),
          create: jest.fn().mockRejectedValue(p2002),
        },
        folder: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue({ id: 'archived-folder' }),
          create: jest.fn().mockRejectedValue(p2002),
        },
        page: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue({ id: 'archived-page' }),
          create: jest.fn().mockRejectedValue(p2002),
        },
        changeItem: { create: jest.fn().mockResolvedValue({}) },
        space: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      await expect((h.service as any).applyLiveChanges(
        tx, principal(), 'space-1', [example.change], example.requirements ?? [], 'change-set-1',
      )).rejects.toMatchObject({ syncCode: example.syncCode });
    }
  });

  it('fails closed when Redis rejects create, upload, or finalize rate-limit accounting', async () => {
    const unavailable = { incrementWithWindow: jest.fn().mockResolvedValue(null) };
    await expect(harness(unavailable).service.create(principal(), 'space-1', request()))
      .rejects.toMatchObject({ syncCode: 'RATE_LIMITED' });
    expect(unavailable.incrementWithWindow).toHaveBeenCalledWith(
      expect.stringMatching(/^sync:session-create:\d+:/u), 61,
    );
    const failed = { incrementWithWindow: jest.fn().mockRejectedValue(new Error('Redis unavailable')) };
    await expect(harness(failed).service.create(principal(), 'space-1', request()))
      .rejects.toMatchObject({ syncCode: 'RATE_LIMITED' });

    const uploadRedis = { incrementWithWindow: jest.fn().mockResolvedValueOnce(1).mockResolvedValue(121) };
    const upload = harness(uploadRedis);
    const created = await upload.service.create(principal(), 'space-1', request());
    const attachment = {
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '4', width: 1, height: 1, contentHash: missingHash,
      updatedAt: '2026-09-04T00:00:00.000Z',
    };
    const batch = { protocolVersion: '3' as const, batchIndex: 0,
      changes: [{ operation: 'upsert_attachment' as const, attachment }] };
    await expect(upload.service.uploadBatch(principal(), 'space-1', created.sessionId, {
      ...batch, batchHash: await treeBatchHashV3(batch),
    })).rejects.toMatchObject({ syncCode: 'RATE_LIMITED' });
    expect(uploadRedis.incrementWithWindow).toHaveBeenLastCalledWith(
      expect.stringMatching(/^sync:batch-upload:\d+:/u), 61,
    );

    const finalizeRedis = { incrementWithWindow: jest.fn().mockResolvedValueOnce(1).mockResolvedValue(11) };
    const finalize = harness(finalizeRedis);
    const emptyManifest = { protocolVersion: '3' as const, spaceId: 'space-1', baseRevision: 'rev-1',
      capabilitiesHash: capabilityHash, changes: [] };
    const confirmationHash = await treeConfirmationHashV3(emptyManifest);
    const ready = await finalize.service.create(principal(), 'space-1', request({
      confirmationHash, confirmationByteLength: canonicalBytes(emptyManifest).byteLength,
      changeCount: 0, attachmentCount: 0, transferBlobBytes: 0, blobRequirements: [],
    }));
    await expect(finalize.service.finalize(principal(), 'space-1', ready.sessionId, {
      protocolVersion: '3', confirmationHash, userConfirmed: true,
    })).rejects.toMatchObject({ syncCode: 'RATE_LIMITED' });
    expect(finalizeRedis.incrementWithWindow).toHaveBeenLastCalledWith(
      expect.stringMatching(/^sync:finalize:\d+:/u), 61,
    );
  });

  it('retries P2034 after slow resident storage verification with a 120-second transaction budget', async () => {
    const h = harness();
    h.storage.openVerified.mockImplementation(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return Readable.from([]);
    });
    h.prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      await callback(h.tx);
      h.sessions.splice(0);
      h.blobs.splice(0);
      throw Object.assign(new Error('serialization'), { code: 'P2034' });
    });
    await expect(h.service.create(principal(), 'space-1', request({
      blobRequirements: [{
        contentHash: existingHash, sizeBytes: '4', mimeType: 'image/png', width: 1, height: 1,
      }],
    }))).resolves.toMatchObject({
      protocolVersion: '3', status: 'uploading',
    });
    expect(h.storage.openVerified).toHaveBeenCalledTimes(2);
    expect(h.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({
      isolationLevel: 'Serializable', timeout: 120_000,
    }));
  });
});
