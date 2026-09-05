import type { AttachmentConfig } from './attachment.config';
import type { ConfigService } from '@nestjs/config';
import type {
  AttachmentContentLease,
  AttachmentStorage,
  StoredAttachment,
} from './attachment-storage';
import { BusinessException } from '../core/filters/business-error';
import type { SearchService } from '../core/search/search.service';
import type { GraphMaintenance } from '../knowledge-graph/graph-maintenance';
import { AttachmentValidationError, validateUploadedImage } from './attachment-validator';
import { AttachmentService } from './attachment.service';
import { AttachmentRenamePreviewTokenService } from './attachment-rename-preview-token.service';

jest.mock('./attachment-validator', () => ({
  ...jest.requireActual('./attachment-validator'),
  validateUploadedImage: jest.fn(),
}));

const NOW = new Date('2026-08-27T01:02:03.000Z');
const PNG = {
  displayName: 'Photo.png',
  nameKey: 'photo.png',
  contentHash: 'a'.repeat(64),
  mimeType: 'image/png' as const,
  sizeBytes: 40n,
  width: 10,
  height: 20,
  tempPath: '/tmp/photo.png',
};
const TEMP_RESERVATION = Object.freeze({
  path: PNG.tempPath,
  ownerToken: '1'.repeat(64),
});

const config: AttachmentConfig = {
  storagePath: '/var/lib/agentwiki/attachments',
  maxFileBytes: 10n * 1024n * 1024n,
  maxSpaceBytes: 500n * 1024n * 1024n,
  maxDimension: 10_000,
  maxPixels: 40_000_000n,
  minFreeBytes: 1n,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  orphanGraceMs: 24 * 60 * 60 * 1000,
  contentLockTimeoutMs: 5_000,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-1',
    spaceId: 'space-1',
    displayName: 'Photo.png',
    nameKey: 'photo.png',
    contentHash: 'a'.repeat(64),
    storageKey: `sha256/aa/aa/${'a'.repeat(64)}`,
    mimeType: 'image/png',
    sizeBytes: 40n,
    width: 10,
    height: 20,
    status: 'active',
    uploadedByUserId: 'owner-1',
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

function principal(role: 'owner' | 'editor' | 'admin' | 'viewer' = 'owner') {
  return { userId: `${role}-1`, type: 'human' as const, role };
}

function uploadFile(overrides: Record<string, unknown> = {}) {
  return {
    originalname: PNG.displayName,
    path: PNG.tempPath,
    attachmentTempReservation: TEMP_RESERVATION,
    ...overrides,
  } as any;
}

function harness() {
  const attachment = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0n } }),
    create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve(row(data))),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const spaceKnowledgeRevision = { findFirst: jest.fn().mockResolvedValue(null) };
  const syncRevisionAttachmentRow = { findUnique: jest.fn().mockResolvedValue(null) };
  const legacyRevisionSidecar = { findUnique: jest.fn().mockResolvedValue(null) };
  const page = {
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const pageVersion = { create: jest.fn().mockResolvedValue({ id: 'page-version-1' }) };
  const pageSearchDocument = { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) };
  const space = { findUnique: jest.fn().mockResolvedValue({ contentTreeRevision: 7n }) };
  const tx = {
    spaceAttachment: attachment,
    spaceKnowledgeRevision,
    syncRevisionAttachmentRow,
    legacyRevisionSidecar,
    page,
    pageVersion,
    pageSearchDocument,
    space,
  } as any;
  const prisma = {
    spaceAttachment: attachment,
    spaceKnowledgeRevision,
    space,
    page,
    pageVersion,
    pageSearchDocument,
    $transaction: jest.fn(async (work: (db: typeof tx) => unknown) => work(tx)),
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
    lockLiveHumanPrincipal: jest.fn().mockResolvedValue({ id: 'owner-1' }),
    assertLiveHumanSpaceAccess: jest.fn().mockImplementation(
      (_db: unknown, actor: ReturnType<typeof principal>) => Promise.resolve({
        role: actor.role,
        userId: actor.userId,
        spaceId: 'space-1',
      }),
    ),
  } as any;
  let activeLease: AttachmentContentLease | undefined;
  const published: StoredAttachment = {
    contentHash: PNG.contentHash,
    storageKey: row().storageKey,
    sizeBytes: PNG.sizeBytes,
    created: true,
  };
  const storage = {
    createTempPath: jest.fn(),
    createReservedTempPath: jest.fn(),
    releaseTempReservation: jest.fn(),
    cleanupExpiredTempReservations: jest.fn(),
    withContentLock: jest.fn(async (hash, work) => {
      const lease = { contentHash: hash };
      activeLease = lease;
      try {
        return await work(lease);
      } finally {
        activeLease = undefined;
      }
    }),
    publish: jest.fn(async (_path, _hash, _size, lease) => {
      expect(lease).toBe(activeLease);
      return published;
    }),
    open: jest.fn().mockResolvedValue({ pipe: jest.fn() } as any),
    removeIfUnreferenced: jest.fn(async (_key, lease) => {
      expect(lease).toBe(activeLease);
    }),
    probe: jest.fn(),
  } as unknown as jest.Mocked<AttachmentStorage>;
  const revisionWriter = {
    lockSpace: jest.fn(async (db) => db),
    lockContentTreeSpace: jest.fn(async (db) => Object.assign(db, { contentTreeRevision: 7n })),
    advanceLocked: jest.fn().mockResolvedValue({ revisionId: 'revision-new' }),
    advanceReferencedImagesLocked: jest.fn().mockResolvedValue({ revisionId: 'revision-new' }),
  } as any;
  const search = { indexPage: jest.fn().mockResolvedValue({ lexicalIndexed: true }) };
  const graph = { enqueue: jest.fn() };
  const renamePreviewTokens = new AttachmentRenamePreviewTokenService({
    get: (key: string) => key === 'AGENTWIKI_SERVER_PEPPER' ? 'attachment-preview-test-pepper' : undefined,
  } as unknown as ConfigService);
  const service = new AttachmentService(
    prisma,
    authorization,
    revisionWriter,
    storage,
    config,
    search as unknown as SearchService,
    graph as unknown as GraphMaintenance,
    renamePreviewTokens,
  );
  return {
    service, prisma, tx, attachment, authorization, revisionWriter, storage, published,
    spaceKnowledgeRevision, syncRevisionAttachmentRow, legacyRevisionSidecar, page,
    pageVersion, pageSearchDocument, space, search, graph,
  };
}

describe('AttachmentService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.mocked(validateUploadedImage).mockResolvedValue({ ...PNG });
  });

  it('authorizes readable humans and Agents, paginates, and serializes bigint sizes', async () => {
    const h = harness();
    h.attachment.findMany.mockResolvedValue([row(), row({ id: 'attachment-2', sizeBytes: 9007199254740993n })]);
    h.attachment.count.mockResolvedValue(2);
    const agent = { userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1' };

    await expect(h.service.list('space-1', {
      q: 'Photo', status: 'all', skip: 2, take: 25,
    }, agent)).resolves.toMatchObject({
      total: 2,
      items: [
        { id: 'attachment-1', sizeBytes: '40' },
        { id: 'attachment-2', sizeBytes: '9007199254740993' },
      ],
    });

    expect(h.authorization.assertSpaceAccess).toHaveBeenCalledWith(
      agent, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    expect(h.attachment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 2,
      take: 25,
      where: expect.objectContaining({
        spaceId: 'space-1',
        displayName: { contains: 'Photo', mode: 'insensitive' },
      }),
    }));
    expect(JSON.stringify(await h.service.list('space-1', {
      status: 'active', skip: 0, take: 100,
    }, principal('viewer')))).not.toContain('storageKey');
  });

  it('lists legacy unsafe active rows as visible but non-referenceable', async () => {
    const h = harness();
    h.attachment.findMany.mockResolvedValue([
      row(),
      ...['bad|name.png', 'bad]]name.png', 'a%20b.png', 'bad:name.png', 'bad#name.png']
        .map((displayName, index) => row({
          id: `legacy-${index}`,
          displayName,
          nameKey: displayName.toLocaleLowerCase('und'),
        })),
    ]);
    h.attachment.count.mockResolvedValue(6);

    const result = await h.service.list('space-1', {
      status: 'active', skip: 0, take: 100,
    }, principal('viewer'));

    expect(result.items[0]).toMatchObject({
      displayName: 'Photo.png', referenceable: true, canonicalPath: 'assets/Photo.png',
    });
    const unsafeItems = result.items.slice(1) as Array<typeof result.items[number] & {
      referenceable: boolean;
      canonicalPath: string | null;
    }>;
    expect(unsafeItems.map(({ displayName, referenceable, canonicalPath }) => ({
      displayName, referenceable, canonicalPath,
    }))).toEqual([
      { displayName: 'bad|name.png', referenceable: false, canonicalPath: null },
      { displayName: 'bad]]name.png', referenceable: false, canonicalPath: null },
      { displayName: 'a%20b.png', referenceable: false, canonicalPath: null },
      { displayName: 'bad:name.png', referenceable: false, canonicalPath: null },
      { displayName: 'bad#name.png', referenceable: false, canonicalPath: null },
    ]);
  });

  it('repairs an unreferenced legacy unsafe attachment through preview and confirm', async () => {
    const h = harness();
    const unsafe = row({ displayName: 'bad|name.png', nameKey: 'bad|name.png' });
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? unsafe : null
    ));
    h.attachment.findMany.mockResolvedValue([unsafe]);
    h.page.findMany.mockResolvedValue([]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'repaired.png', nameKey: 'repaired.png', updatedAt: new Date(NOW.getTime() + 1),
    }));

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'repaired.png',
    }, principal('editor'));
    const tokenPayload = JSON.parse(Buffer.from(preview.previewToken.split('.')[0], 'base64url').toString('utf8'));
    expect(tokenPayload).toMatchObject({ sourceIdentityHash: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(tokenPayload).not.toHaveProperty('sourcePath');
    expect(JSON.stringify(tokenPayload)).not.toContain('bad|name.png');
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).resolves.toMatchObject({
      displayName: 'repaired.png', referenceable: true, canonicalPath: 'assets/repaired.png',
    });
    expect(h.attachment.updateMany).toHaveBeenCalledTimes(1);
    expect(h.revisionWriter.advanceReferencedImagesLocked).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe source identity change after preview even when updatedAt is unchanged', async () => {
    const h = harness();
    let live = row({ displayName: 'bad|name.png', nameKey: 'bad|name.png' });
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? live : null
    ));
    h.attachment.findMany.mockImplementation(async () => [live]);
    h.page.findMany.mockResolvedValue([]);

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'repaired.png',
    }, principal('editor'));
    live = row({ displayName: 'other#name.png', nameKey: 'other#name.png' });

    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
    expect(h.revisionWriter.advanceReferencedImagesLocked).not.toHaveBeenCalled();
  });

  it('rejects repair when a legacy Page contains an unsafe raw marker and publishes nothing', async () => {
    const h = harness();
    const unsafe = row({ displayName: 'bad|name.png', nameKey: 'bad|name.png' });
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? unsafe : null
    ));
    h.attachment.findMany.mockResolvedValue([unsafe]);
    h.page.findMany.mockResolvedValue([{
      id: 'legacy-page', knowledgeKey: 'legacy-key', title: 'Legacy Page',
      content: '![[bad|name.png]]', authorId: 'owner-1', slug: 'legacy-page', format: 'markdown',
      parentId: null, folderId: null, syncPath: 'pages/legacy.md', syncPathKey: 'pages/legacy.md',
      updatedAt: NOW,
    }]);

    let rejection: BusinessException | undefined;
    try {
      await h.service.previewRename('space-1', 'attachment-1', {
        displayName: 'repaired.png',
      }, principal('editor'));
    } catch (error) {
      rejection = error as BusinessException;
    }
    expect(rejection?.getResponse()).toEqual(expect.objectContaining({
      code: 'ATTACHMENT_REFERENCE_INVALID',
      details: { pages: [{ id: 'legacy-page', title: 'Legacy Page' }] },
    }));
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
    expect(h.revisionWriter.advanceReferencedImagesLocked).not.toHaveBeenCalled();
  });

  it.each([
    ['fenced code', 'before\n```md\n![[bad|name.png]]\n```\nafter'],
    ['inline code', 'before `![[bad|name.png]]` after'],
  ])('repairs an unsafe unreferenced attachment when its old marker appears only in %s', async (_label, content) => {
    const h = harness();
    const unsafe = row({ displayName: 'bad|name.png', nameKey: 'bad|name.png' });
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? unsafe : null
    ));
    h.attachment.findMany.mockResolvedValue([unsafe]);
    h.page.findMany.mockResolvedValue([{
      id: 'example-page', knowledgeKey: 'example-key', title: 'Examples',
      content, authorId: 'owner-1', slug: 'examples', format: 'markdown',
      parentId: null, folderId: null, syncPath: 'pages/examples.md', syncPathKey: 'pages/examples.md',
      updatedAt: NOW,
    }]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'repaired.png', nameKey: 'repaired.png', updatedAt: new Date(NOW.getTime() + 1),
    }));

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'repaired.png',
    }, principal('editor'));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).resolves.toMatchObject({ displayName: 'repaired.png' });
    expect(h.attachment.updateMany).toHaveBeenCalledTimes(1);
    expect(h.revisionWriter.advanceReferencedImagesLocked).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'editor'] as const)('allows a live human %s to upload', async (role) => {
    const h = harness();
    await expect(h.service.upload('space-1', uploadFile(), principal(role)))
      .resolves.toMatchObject({ displayName: 'Photo.png', sizeBytes: '40' });
    expect(h.revisionWriter.lockSpace).toHaveBeenCalledWith(h.tx, 'space-1');
    expect(h.authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
  });

  it('normalizes and trims the incoming name before real image validation', async () => {
    const h = harness();
    const file = uploadFile({ originalname: ' Cafe\u0301.PNG ' });

    await h.service.upload('space-1', file, principal());

    expect(validateUploadedImage).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'Café.PNG' }),
      config,
    );
  });

  it('maps only recognizable client image validation failures to HTTP 400', async () => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockRejectedValue(
      new AttachmentValidationError('Attachment MIME is invalid'),
    );

    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toMatchObject({
      status: 400,
      message: 'Attachment MIME is invalid',
    });
    expect(h.storage.publish).not.toHaveBeenCalled();
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
  });

  it('rethrows validator I/O failures instead of misclassifying them as client input', async () => {
    const h = harness();
    const ioFailure = Object.assign(new Error('attachment disk read failed'), { code: 'EIO' });
    jest.mocked(validateUploadedImage).mockRejectedValue(ioFailure);

    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toBe(ioFailure);
    expect(h.storage.publish).not.toHaveBeenCalled();
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
  });

  it.each(['admin', 'viewer'] as const)('denies a live human %s before publishing', async (role) => {
    const h = harness();
    await expect(h.service.upload('space-1', uploadFile(), principal(role)))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.storage.publish).not.toHaveBeenCalled();
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
  });

  it('denies an Agent mutation before validation or publishing', async () => {
    const h = harness();
    const agent = { userId: 'owner-1', agentId: 'agent-1' };
    h.authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );
    await expect(h.service.upload('space-1', uploadFile(), agent))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(validateUploadedImage).not.toHaveBeenCalled();
    expect(h.storage.publish).not.toHaveBeenCalled();
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
  });

  it('keeps the content lease through publish, Space lock, live revalidation, and metadata commit', async () => {
    const h = harness();
    const order: string[] = [];
    let finishCreate!: () => void;
    const createCanFinish = new Promise<void>((resolve) => { finishCreate = resolve; });
    h.storage.withContentLock.mockImplementation(async (hash, work) => {
      order.push(`lease:${hash}`);
      const result = await work({ contentHash: hash });
      order.push('lease-release');
      return result;
    });
    h.storage.publish.mockImplementation(async () => {
      order.push('publish');
      return h.published;
    });
    h.revisionWriter.lockSpace.mockImplementation(async (db: unknown) => {
      order.push('space-lock');
      return db;
    });
    h.authorization.assertLiveHumanSpaceAccess.mockImplementation(async () => {
      order.push('live-auth');
      return { role: 'owner', userId: 'owner-1', spaceId: 'space-1' };
    });
    h.attachment.create.mockImplementation(async ({ data }: any) => {
      order.push('metadata-create');
      await createCanFinish;
      order.push('metadata-commit');
      return row(data);
    });

    const pending = h.service.upload('space-1', uploadFile(), principal());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(order).toEqual([
      'live-auth', `lease:${PNG.contentHash}`, 'publish', 'space-lock', 'live-auth',
      'metadata-create',
    ]);
    expect(order).not.toContain('lease-release');
    finishCreate();
    await pending;
    expect(order.slice(-2)).toEqual(['metadata-commit', 'lease-release']);
  });

  it('reuses identical same-name content without adding logical quota or metadata', async () => {
    const h = harness();
    h.attachment.findFirst.mockResolvedValue(row());

    await expect(h.service.upload('space-1', uploadFile(), principal()))
      .resolves.toMatchObject({ id: 'attachment-1', displayName: 'Photo.png' });

    expect(h.attachment.aggregate).not.toHaveBeenCalled();
    expect(h.attachment.create).not.toHaveBeenCalled();
  });

  it('suffixes same-name different content against NFC, trim, case-insensitive archived reservations', async () => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      displayName: ' Cafe\u0301.PNG ',
      nameKey: ' cafe\u0301.png ',
      contentHash: 'b'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue([
      row({ displayName: 'CAFÉ.png', nameKey: 'café.png', status: 'archived' }),
      row({ displayName: 'café (2).PNG', nameKey: 'café (2).png', status: 'active' }),
    ]);

    await expect(h.service.upload('space-1', uploadFile(), principal()))
      .resolves.toMatchObject({ displayName: 'Café (3).PNG' });
    expect(h.attachment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ displayName: 'Café (3).PNG', nameKey: 'café (3).png' }),
    }));
  });

  it('reuses an active same-content suffix created by an earlier name conflict', async () => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      contentHash: 'b'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue([
      row({ contentHash: 'a'.repeat(64) }),
      row({
        id: 'attachment-2',
        displayName: 'Photo (2).png',
        nameKey: 'photo (2).png',
        contentHash: 'b'.repeat(64),
      }),
    ]);

    await expect(h.service.upload('space-1', uploadFile(), principal())).resolves.toMatchObject({
      id: 'attachment-2',
      displayName: 'Photo (2).png',
    });
    expect(h.attachment.aggregate).not.toHaveBeenCalled();
    expect(h.attachment.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a gap before suffix 3',
      [
        row({ contentHash: 'a'.repeat(64) }),
        row({ id: 'attachment-3', displayName: 'Photo (3).png', nameKey: 'photo (3).png', contentHash: 'c'.repeat(64) }),
      ],
      'attachment-3',
    ],
    [
      'multiple gaps before suffix 5',
      [
        row({ contentHash: 'a'.repeat(64) }),
        row({ id: 'attachment-2', displayName: 'Photo (2).png', nameKey: 'photo (2).png', contentHash: 'b'.repeat(64) }),
        row({ id: 'attachment-5', displayName: 'Photo (5).png', nameKey: 'photo (5).png', contentHash: 'c'.repeat(64) }),
      ],
      'attachment-5',
    ],
  ])('scans the complete reserved suffix family and reuses same content across %s', async (
    _label,
    reserved,
    expectedId,
  ) => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      contentHash: 'c'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue(reserved);

    await expect(h.service.upload('space-1', uploadFile(), principal())).resolves.toMatchObject({
      id: expectedId,
    });
    expect(h.attachment.aggregate).not.toHaveBeenCalled();
    expect(h.attachment.create).not.toHaveBeenCalled();
  });

  it('reserves but does not reuse an archived same-content family suffix', async () => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      contentHash: 'c'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue([
      row({ contentHash: 'a'.repeat(64) }),
      row({
        id: 'attachment-3',
        displayName: 'Photo (3).png',
        nameKey: 'photo (3).png',
        contentHash: 'c'.repeat(64),
        status: 'archived',
        archivedAt: NOW,
      }),
    ]);

    await expect(h.service.upload('space-1', uploadFile(), principal())).resolves.toMatchObject({
      displayName: 'Photo (2).png',
    });
    expect(h.attachment.create).toHaveBeenCalledTimes(1);
  });

  it('does not treat unrelated or malformed numeric-looking names as suffix-family matches', async () => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      contentHash: 'c'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue([
      row({ contentHash: 'a'.repeat(64) }),
      row({ id: 'copy-3', displayName: 'Photo copy (3).png', nameKey: 'photo copy (3).png', contentHash: 'c'.repeat(64) }),
      row({ id: 'leading-zero', displayName: 'Photo (03).png', nameKey: 'photo (03).png', contentHash: 'c'.repeat(64) }),
      row({ id: 'malformed', displayName: 'Photo (3x).png', nameKey: 'photo (3x).png', contentHash: 'c'.repeat(64) }),
    ]);

    await expect(h.service.upload('space-1', uploadFile(), principal())).resolves.toMatchObject({
      displayName: 'Photo (2).png',
    });
    expect(h.attachment.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [`${'a'.repeat(196)}.png`, `${'a'.repeat(192)} (2).png`],
    [`${'界'.repeat(169)}.png`, `${'界'.repeat(168)} (2).png`],
  ])('keeps a generated conflict name within code-point and UTF-8 limits for %s', async (
    displayName,
    expectedName,
  ) => {
    const h = harness();
    jest.mocked(validateUploadedImage).mockResolvedValue({
      ...PNG,
      displayName,
      nameKey: displayName.toLocaleLowerCase('und'),
      contentHash: 'b'.repeat(64),
    });
    h.attachment.findMany.mockResolvedValue([
      row({ displayName, nameKey: displayName.toLocaleLowerCase('und') }),
    ]);

    const result = await h.service.upload('space-1', uploadFile(), principal());

    expect(result.displayName).toBe(expectedName);
    expect([...result.displayName].length).toBeLessThanOrEqual(200);
    expect(Buffer.byteLength(result.displayName, 'utf8')).toBeLessThanOrEqual(512);
  });

  it('counts logical active metadata bytes even when the content hash is deduped', async () => {
    const h = harness();
    h.published.created = false;
    h.attachment.aggregate.mockResolvedValue({
      _sum: { sizeBytes: config.maxSpaceBytes - PNG.sizeBytes + 1n },
    });

    await expect(h.service.upload('space-1', uploadFile(), principal()))
      .rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(h.attachment.aggregate).toHaveBeenCalledWith({
      where: { spaceId: 'space-1', status: 'active' },
      _sum: { sizeBytes: true },
    });
    expect(h.attachment.create).not.toHaveBeenCalled();
    expect(h.storage.removeIfUnreferenced).not.toHaveBeenCalled();
  });

  it('serializes different-content same-name uploads under the Space lock', async () => {
    const h = harness();
    const records: any[] = [];
    let releaseSpaceLock: (() => void) | undefined;
    let held = false;
    h.revisionWriter.lockSpace.mockImplementation(async (db: any) => {
      if (held) {
        await new Promise<void>((resolve) => { releaseSpaceLock = resolve; });
      }
      held = true;
      db.release = () => {
        held = false;
        releaseSpaceLock?.();
        releaseSpaceLock = undefined;
      };
      return db;
    });
    h.prisma.$transaction.mockImplementation(async (work: (db: any) => Promise<any>) => {
      try { return await work(h.tx); } finally { h.tx.release?.(); }
    });
    h.attachment.findMany.mockImplementation(async () => [...records]);
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => records.find(
      (item) => item.nameKey === where.nameKey && item.contentHash === where.contentHash,
    ) ?? null);
    let releaseFirstCreate!: () => void;
    const firstCreateCanFinish = new Promise<void>((resolve) => { releaseFirstCreate = resolve; });
    h.attachment.create.mockImplementation(async ({ data }: any) => {
      if (records.length === 0) await firstCreateCanFinish;
      const created = row({ ...data, id: `attachment-${records.length + 1}` });
      records.push(created);
      return created;
    });
    jest.mocked(validateUploadedImage)
      .mockResolvedValueOnce({ ...PNG, contentHash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ ...PNG, contentHash: 'b'.repeat(64) });
    h.storage.publish
      .mockResolvedValueOnce({ ...h.published, contentHash: 'a'.repeat(64), created: true })
      .mockResolvedValueOnce({ ...h.published, contentHash: 'b'.repeat(64), storageKey: `sha256/bb/bb/${'b'.repeat(64)}`, created: true });

    const first = h.service.upload('space-1', uploadFile(), principal());
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = h.service.upload('space-1', uploadFile(), principal('editor'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.attachment.create).toHaveBeenCalledTimes(1);
    releaseFirstCreate();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ displayName: 'Photo.png' }),
      expect.objectContaining({ displayName: 'Photo (2).png' }),
    ]);
  });

  it('compensates a newly-created unreferenced blob under the same lease after rollback', async () => {
    const h = harness();
    const failure = new Error('metadata transaction failed');
    h.prisma.$transaction.mockRejectedValue(failure);
    h.attachment.count.mockResolvedValue(0);

    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toBe(failure);

    expect(h.attachment.count).toHaveBeenCalledWith({ where: { storageKey: h.published.storageKey } });
    expect(h.storage.removeIfUnreferenced).toHaveBeenCalledWith(
      h.published.storageKey,
      expect.objectContaining({ contentHash: PNG.contentHash }),
    );
    expect(h.storage.releaseTempReservation).toHaveBeenCalledWith(TEMP_RESERVATION);
    expect(h.storage.withContentLock.mock.invocationCallOrder[0]).toBeLessThan(
      h.storage.removeIfUnreferenced.mock.invocationCallOrder[0],
    );
  });

  it('never removes a pre-existing deduped blob after rollback', async () => {
    const h = harness();
    h.published.created = false;
    h.prisma.$transaction.mockRejectedValue(new Error('metadata transaction failed'));
    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toThrow();
    expect(h.attachment.count).not.toHaveBeenCalled();
    expect(h.storage.removeIfUnreferenced).not.toHaveBeenCalled();
  });

  it.each([
    ['archive', 'active', 'archived', expect.any(Date)],
    ['restore', 'archived', 'active', null],
  ] as const)('%s uses an exact updatedAt compare-and-set', async (method, from, to, archivedAt) => {
    const h = harness();
    h.attachment.findUnique.mockResolvedValue(row({
      status: to,
      archivedAt: to === 'archived' ? NOW : null,
    }));
    const body = { expectedUpdatedAt: NOW.toISOString() };

    await expect(h.service[method]('space-1', 'attachment-1', body, principal('editor')))
      .resolves.toMatchObject({ status: to, sizeBytes: '40' });
    expect(h.attachment.updateMany).toHaveBeenCalledWith({
      where: { id: 'attachment-1', spaceId: 'space-1', status: from, updatedAt: NOW },
      data: { status: to, archivedAt },
    });
  });

  it('returns stable RESOURCE_CONFLICT for a stale archive or restore', async () => {
    const h = harness();
    h.attachment.updateMany.mockResolvedValue({ count: 0 });
    for (const method of ['archive', 'restore'] as const) {
      await expect(h.service[method]('space-1', 'attachment-1', {
        expectedUpdatedAt: NOW.toISOString(),
      }, principal())).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    }
  });

  it('rejects archive of a current v3 referenced attachment with deduplicated redacted Pages', async () => {
    const h = harness();
    h.spaceKnowledgeRevision.findFirst.mockResolvedValue({
      id: 'revision-3', schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
    });
    h.syncRevisionAttachmentRow.findUnique.mockResolvedValue({ attachmentId: 'attachment-1' });
    h.legacyRevisionSidecar.findUnique.mockResolvedValue({
      sidecar: {
        syncV3Revision: {
          protocolVersion: '3',
          pageAttachmentIds: [
            { pageId: 'page-key-1', referencedAttachmentIds: ['attachment-1'] },
            { pageId: 'page-key-2', referencedAttachmentIds: ['attachment-1'] },
            { pageId: 'page-key-1', referencedAttachmentIds: ['attachment-1'] },
          ],
        },
      },
    });
    h.page.findMany.mockResolvedValue([
      { id: 'page-2', knowledgeKey: 'page-key-2', title: 'Second', content: 'secret markdown' },
      { id: 'page-1', knowledgeKey: 'page-key-1', title: 'First', content: 'secret markdown' },
    ]);

    let rejected: BusinessException | undefined;
    try {
      await h.service.archive('space-1', 'attachment-1', {
        expectedUpdatedAt: NOW.toISOString(),
      }, principal('editor'));
    } catch (error) {
      rejected = error as BusinessException;
    }

    expect(rejected).toMatchObject({ businessCode: 'ATTACHMENT_REFERENCED', statusCode: 409 });
    expect(rejected?.getResponse()).toEqual(expect.objectContaining({
      code: 'ATTACHMENT_REFERENCED',
      details: { pages: [{ id: 'page-1', title: 'First' }, { id: 'page-2', title: 'Second' }] },
    }));
    expect(JSON.stringify(rejected?.getResponse())).not.toMatch(
      /secret markdown|storageKey|\/var\/lib|credential|sha256/iu,
    );
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
  });

  it('previews and atomically renames one attachment across exact Page A/B source ranges', async () => {
    const h = harness();
    const pageA = {
      id: 'page-a', knowledgeKey: 'key-a', title: 'Page A',
      content: 'before Photo.png\r\n![[  assets/Photo.png  | cover | 320x200  ]]\r\n![root](<../assets/Photo.png> "root title")\r\nafter Photo.png',
      authorId: 'owner-1', slug: 'page-a', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/a.md', syncPathKey: 'pages/a.md', updatedAt: NOW,
    };
    const pageB = {
      ...pageA, id: 'page-b', knowledgeKey: 'key-b', title: 'Page B', slug: 'page-b',
      content: 'prefix ![alt](<../../assets/Photo.png> "title") suffix',
      syncPath: 'pages/topic/b.md', syncPathKey: 'pages/topic/b.md',
    };
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.page.findMany.mockResolvedValue([pageA, pageB]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'Renamed.png', nameKey: 'renamed.png', updatedAt: new Date(NOW.getTime() + 1),
    }));

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    expect(preview).toEqual({
      attachmentId: 'attachment-1', displayName: 'Renamed.png', path: 'assets/Renamed.png',
      previewToken: expect.any(String),
      impactedPages: [{ id: 'page-a', title: 'Page A' }, { id: 'page-b', title: 'Page B' }],
    });

    const result = await h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'));
    expect(result.path).toBe('assets/Renamed.png');
    expect(result.impactedPages.map((page: { id: string }) => page.id)).toEqual(['page-a', 'page-b']);
    expect(h.attachment.updateMany).toHaveBeenCalledWith({
      where: { id: 'attachment-1', spaceId: 'space-1', status: 'active', updatedAt: NOW },
      data: { displayName: 'Renamed.png', nameKey: 'renamed.png' },
    });
    expect(h.pageVersion.create.mock.calls.map(([call]) => call.data)).toEqual([
      expect.objectContaining({ pageId: 'page-a', content: pageA.content, title: 'Page A' }),
      expect.objectContaining({ pageId: 'page-b', content: pageB.content, title: 'Page B' }),
    ]);
    const rewrittenA = 'before Photo.png\r\n![[  assets/Renamed.png  | cover | 320x200  ]]\r\n![root](<../assets/Renamed.png> "root title")\r\nafter Photo.png';
    const rewrittenB = 'prefix ![alt](<../../assets/Renamed.png> "title") suffix';
    expect(h.page.updateMany.mock.calls.map(([call]) => call.data.content)).toEqual([
      rewrittenA,
      rewrittenB,
    ]);
    expect(h.page.updateMany.mock.calls.every(([call]) => call.data.lastChangeSetId === null)).toBe(true);
    expect(h.revisionWriter.advanceReferencedImagesLocked).toHaveBeenCalledTimes(1);
    expect(h.revisionWriter.advanceReferencedImagesLocked).toHaveBeenCalledWith(
      h.tx,
      'space-1',
      [
        { operation: 'upsert', pageId: 'key-a', path: 'pages/a.md', title: 'Page A', body: rewrittenA },
        { operation: 'upsert', pageId: 'key-b', path: 'pages/topic/b.md', title: 'Page B', body: rewrittenB },
      ],
      { origin: 'web_editor', createdByUserId: 'editor-1' },
    );
    expect(h.search.indexPage.mock.calls.map(([pageId]: [string]) => pageId)).toEqual(['page-a', 'page-b']);
    expect(h.graph.enqueue).toHaveBeenCalledTimes(1);
    expect(h.graph.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('binds confirmation to the exact target that was previewed', async () => {
    const h = harness();
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'Previewed.png', nameKey: 'previewed.png', updatedAt: new Date(NOW.getTime() + 1),
    }));

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Previewed.png',
    }, principal('editor'));

    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).resolves.toMatchObject({ displayName: 'Previewed.png' });
    expect(h.attachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { displayName: 'Previewed.png', nameKey: 'previewed.png' },
    }));
  });

  it('rejects an old preview after a non-structural Page edit advances the latest head', async () => {
    const h = harness();
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.spaceKnowledgeRevision.findFirst
      .mockResolvedValueOnce({ id: 'revision-before', revisionContentHash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'revision-after', revisionContentHash: 'b'.repeat(64) });

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));

    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'CONTENT_TREE_CONFLICT' });
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
    expect(h.pageVersion.create).not.toHaveBeenCalled();
    expect(h.revisionWriter.advanceLocked).not.toHaveBeenCalled();
  });

  it('keeps a committed rename successful and attempts every post-commit refresh when indexing fails', async () => {
    const h = harness();
    const basePage = {
      knowledgeKey: 'key', title: 'Page', content: '![[assets/Photo.png]]',
      authorId: 'owner-1', slug: 'page', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/page.md', syncPathKey: 'pages/page.md', updatedAt: NOW,
    };
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.page.findMany.mockResolvedValue([
      { ...basePage, id: 'page-a', knowledgeKey: 'key-a' },
      { ...basePage, id: 'page-b', knowledgeKey: 'key-b' },
    ]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'Renamed.png', nameKey: 'renamed.png', updatedAt: new Date(NOW.getTime() + 1),
    }));
    h.search.indexPage.mockRejectedValueOnce(new Error('embedding offline'));
    h.graph.enqueue.mockImplementationOnce(() => { throw new Error('graph queue offline'); });

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).resolves.toEqual(expect.objectContaining({ displayName: 'Renamed.png' }));
    expect(h.search.indexPage.mock.calls.map(([pageId]: [string]) => pageId)).toEqual(['page-a', 'page-b']);
    expect(h.graph.enqueue).toHaveBeenCalledTimes(1);
    expect(h.graph.enqueue).toHaveBeenCalledWith('space-1');
  });

  it('clears stale ChangeSet provenance in the same atomic Page rename update', async () => {
    const h = harness();
    h.attachment.findFirst.mockImplementation(async ({ where }: { where: { id?: string } }) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.page.findMany.mockResolvedValue([{
      id: 'page-a', knowledgeKey: 'key-a', title: 'Page A', content: '![[assets/Photo.png]]',
      authorId: 'owner-1', slug: 'page-a', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/a.md', syncPathKey: 'pages/a.md', updatedAt: NOW,
      lastChangeSetId: 'published-agent-change-set',
    }]);
    h.attachment.findUnique.mockResolvedValue(row({
      displayName: 'Renamed.png', nameKey: 'renamed.png', updatedAt: new Date(NOW.getTime() + 1),
    }));

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    await h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'));

    expect(h.page.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        lastChangeSetId: null,
        lastModifiedByUserId: 'editor-1',
        lastModifiedByAgentId: null,
      }),
    }));
  });

  it('rolls back the attachment name and every Page when Page B rewrite persistence fails', async () => {
    const h = harness();
    const injected = new Error('forced Page B failure');
    const basePage = {
      knowledgeKey: 'key', title: 'Page', content: '![[assets/Photo.png]]',
      authorId: 'owner-1', slug: 'page', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/page.md', syncPathKey: 'pages/page.md', updatedAt: NOW,
    };
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.page.findMany.mockResolvedValue([
      { ...basePage, id: 'page-a', title: 'Page A' },
      { ...basePage, id: 'page-b', title: 'Page B' },
    ]);
    h.page.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(injected);

    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).rejects.toBe(injected);
    expect(h.revisionWriter.advanceReferencedImagesLocked).not.toHaveBeenCalled();
  });

  it('rejects stale tree and attachment tokens before any rename writes', async () => {
    const h = harness();
    h.attachment.findFirst
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ updatedAt: new Date(NOW.getTime() + 1) }));
    h.attachment.findMany.mockResolvedValue([row()]);
    const treePreview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    h.revisionWriter.lockContentTreeSpace.mockImplementationOnce(async (db: object) => (
      Object.assign(db, { contentTreeRevision: 8n })
    ));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: treePreview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'CONTENT_TREE_CONFLICT' });

    const attachmentPreview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: attachmentPreview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
    expect(h.page.updateMany).not.toHaveBeenCalled();
    expect(h.revisionWriter.advanceLocked).not.toHaveBeenCalled();
  });

  it('rejects live or archived target-name conflicts and never exposes conflicting metadata', async () => {
    for (const status of ['active', 'archived'] as const) {
      const h = harness();
      h.attachment.findFirst
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(row({ id: `conflict-${status}`, displayName: 'Renamed.png', nameKey: 'renamed.png', status }));
      await expect(h.service.previewRename('space-1', 'attachment-1', {
        displayName: 'Renamed.png',
      }, principal('editor'))).rejects.toMatchObject({ businessCode: 'ATTACHMENT_NAME_CONFLICT' });
      expect(h.page.findMany).not.toHaveBeenCalled();
    }
  });

  it.each(['admin', 'viewer'] as const)('denies %s rename before resolving Page bodies', async (role) => {
    const h = harness();
    await expect(h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal(role))).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.attachment.findFirst).not.toHaveBeenCalled();
    expect(h.page.findMany).not.toHaveBeenCalled();
  });

  it('route-safely rejects a cross-Space attachment id as not found', async () => {
    const h = harness();
    h.attachment.findFirst.mockResolvedValue(null);
    await expect(h.service.previewRename('space-1', 'attachment-from-other-space', {
      displayName: 'Renamed.png',
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
  });

  it.each([
    ['missing', []],
    ['ambiguous', [row(), row({ id: 'attachment-duplicate' })]],
  ] as const)('fails closed on %s managed references before rename writes', async (_name, candidates) => {
    const h = harness();
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue(candidates);
    h.page.findMany.mockResolvedValue([{
      id: 'page-a', knowledgeKey: 'key-a', title: 'Page A', content: '![[assets/Photo.png]]',
      authorId: 'owner-1', slug: 'page-a', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/a.md', syncPathKey: 'pages/a.md', updatedAt: NOW,
    }]);
    h.attachment.findMany.mockResolvedValue([row()]);
    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    h.attachment.findMany.mockResolvedValue(candidates);
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({
      businessCode: _name === 'missing' ? 'ATTACHMENT_MISSING' : 'ATTACHMENT_REFERENCE_INVALID',
    });
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
    expect(h.revisionWriter.advanceReferencedImagesLocked).not.toHaveBeenCalled();
  });

  it('treats a Page body compare-and-set miss as range drift and publishes no revision', async () => {
    const h = harness();
    h.attachment.findFirst.mockImplementation(async ({ where }: any) => (
      where.id === 'attachment-1' ? row() : null
    ));
    h.attachment.findMany.mockResolvedValue([row()]);
    h.page.findMany.mockResolvedValue([{
      id: 'page-a', knowledgeKey: 'key-a', title: 'Page A', content: '![[assets/Photo.png]]',
      authorId: 'owner-1', slug: 'page-a', format: 'markdown', parentId: null, folderId: null,
      syncPath: 'pages/a.md', syncPathKey: 'pages/a.md', updatedAt: NOW,
    }]);
    h.page.updateMany.mockResolvedValue({ count: 0 });
    const preview = await h.service.previewRename('space-1', 'attachment-1', {
      displayName: 'Renamed.png',
    }, principal('editor'));
    await expect(h.service.rename('space-1', 'attachment-1', {
      previewToken: preview.previewToken,
    }, principal('editor'))).rejects.toMatchObject({ businessCode: 'ATTACHMENT_REFERENCE_INVALID' });
    expect(h.revisionWriter.advanceReferencedImagesLocked).not.toHaveBeenCalled();
  });

  it.each(['admin', 'viewer'] as const)('denies %s archive and restore mutations', async (role) => {
    const h = harness();
    for (const method of ['archive', 'restore'] as const) {
      await expect(h.service[method]('space-1', 'attachment-1', {
        expectedUpdatedAt: NOW.toISOString(),
      }, principal(role))).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    }
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
  });

  it('denies Agent archive and restore mutations before metadata changes', async () => {
    const h = harness();
    const agent = { userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1' };
    for (const method of ['archive', 'restore'] as const) {
      await expect(h.service[method]('space-1', 'attachment-1', {
        expectedUpdatedAt: NOW.toISOString(),
      }, agent)).rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    }
    expect(h.attachment.updateMany).not.toHaveBeenCalled();
  });

  it('authorizes content before opening and returns no storageKey', async () => {
    const h = harness();
    h.attachment.findUnique.mockResolvedValue(row({ status: 'archived', archivedAt: NOW }));
    const viewer = principal('viewer');

    const result = await h.service.content('attachment-1', viewer);

    expect(h.authorization.assertSpaceAccess).toHaveBeenCalledWith(
      viewer, 'space-1', ['owner', 'admin', 'editor', 'viewer'], 'pages:read',
    );
    expect(h.authorization.assertSpaceAccess.mock.invocationCallOrder[0]).toBeLessThan(
      h.storage.open.mock.invocationCallOrder[0],
    );
    expect(result).toMatchObject({ mimeType: 'image/png', sizeBytes: 40n, displayName: 'Photo.png' });
    expect(result).not.toHaveProperty('storageKey');
  });

  it('does not open content for a denied Agent', async () => {
    const h = harness();
    h.attachment.findUnique.mockResolvedValue(row());
    h.authorization.assertSpaceAccess.mockRejectedValue(
      new BusinessException('SPACE_ACCESS_DENIED'),
    );
    await expect(h.service.content('attachment-1', {
      userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1',
    })).rejects.toMatchObject({ businessCode: 'RESOURCE_NOT_FOUND' });
    expect(h.storage.open).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', { userId: 'owner-1', type: 'human' }],
    ['admin', { userId: 'admin-1', type: 'human' }],
    ['editor', { userId: 'editor-1', type: 'human' }],
    ['viewer', { userId: 'viewer-1', type: 'human' }],
    ['Agent', { userId: 'owner-1', agentId: 'agent-1', authorizationId: 'grant-1' }],
  ])('serves retained content to an authorized %s principal', async (_label, actor) => {
    const h = harness();
    h.attachment.findUnique.mockResolvedValue(row({ status: 'archived', archivedAt: NOW }));

    await expect(h.service.content('attachment-1', actor as any)).resolves.toMatchObject({
      displayName: 'Photo.png',
      sizeBytes: 40n,
    });
    expect(h.storage.open).toHaveBeenCalledTimes(1);
  });
});
