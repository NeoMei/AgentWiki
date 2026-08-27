import type { AttachmentConfig } from './attachment.config';
import type {
  AttachmentContentLease,
  AttachmentStorage,
  StoredAttachment,
} from './attachment-storage';
import { BusinessException } from '../core/filters/business-error';
import * as validator from './attachment-validator';
import { AttachmentService } from './attachment.service';

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
  return { originalname: PNG.displayName, path: PNG.tempPath, ...overrides } as any;
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
  const tx = { spaceAttachment: attachment } as any;
  const prisma = {
    spaceAttachment: attachment,
    $transaction: jest.fn(async (work: (db: typeof tx) => unknown) => work(tx)),
  } as any;
  const authorization = {
    assertSpaceAccess: jest.fn().mockResolvedValue({ role: 'owner' }),
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
  } as any;
  const service = new AttachmentService(
    prisma,
    authorization,
    revisionWriter,
    storage,
    config,
  );
  return { service, prisma, tx, attachment, authorization, revisionWriter, storage, published };
}

describe('AttachmentService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(validator, 'validateUploadedImage').mockResolvedValue({ ...PNG });
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

  it.each(['owner', 'editor'] as const)('allows a live human %s to upload', async (role) => {
    const h = harness();
    await expect(h.service.upload('space-1', uploadFile(), principal(role)))
      .resolves.toMatchObject({ displayName: 'Photo.png', sizeBytes: '40' });
    expect(h.revisionWriter.lockSpace).toHaveBeenCalledWith(h.tx, 'space-1');
    expect(h.authorization.assertLiveHumanSpaceAccess).toHaveBeenCalledTimes(2);
  });

  it('normalizes and trims the incoming name before real image validation', async () => {
    const h = harness();
    const file = uploadFile({ originalname: ' Cafe\u0301.PNG ' });

    await h.service.upload('space-1', file, principal());

    expect(validator.validateUploadedImage).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'Café.PNG' }),
      config,
    );
  });

  it('maps only recognizable client image validation failures to HTTP 400', async () => {
    const h = harness();
    jest.mocked(validator.validateUploadedImage).mockRejectedValue(
      new validator.AttachmentValidationError('Attachment MIME is invalid'),
    );

    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toMatchObject({
      status: 400,
      message: 'Attachment MIME is invalid',
    });
    expect(h.storage.publish).not.toHaveBeenCalled();
  });

  it('rethrows validator I/O failures instead of misclassifying them as client input', async () => {
    const h = harness();
    const ioFailure = Object.assign(new Error('attachment disk read failed'), { code: 'EIO' });
    jest.mocked(validator.validateUploadedImage).mockRejectedValue(ioFailure);

    await expect(h.service.upload('space-1', uploadFile(), principal())).rejects.toBe(ioFailure);
    expect(h.storage.publish).not.toHaveBeenCalled();
  });

  it.each(['admin', 'viewer'] as const)('denies a live human %s before publishing', async (role) => {
    const h = harness();
    await expect(h.service.upload('space-1', uploadFile(), principal(role)))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(h.storage.publish).not.toHaveBeenCalled();
  });

  it('denies an Agent mutation before validation or publishing', async () => {
    const h = harness();
    const agent = { userId: 'owner-1', agentId: 'agent-1' };
    h.authorization.assertLiveHumanSpaceAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { businessCode: 'SPACE_ACCESS_DENIED' }),
    );
    await expect(h.service.upload('space-1', uploadFile(), agent))
      .rejects.toMatchObject({ businessCode: 'SPACE_ACCESS_DENIED' });
    expect(validator.validateUploadedImage).not.toHaveBeenCalled();
    expect(h.storage.publish).not.toHaveBeenCalled();
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage).mockResolvedValue({
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
    jest.mocked(validator.validateUploadedImage)
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
