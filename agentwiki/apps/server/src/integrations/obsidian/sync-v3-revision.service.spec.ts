import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeDeltaItemsV3,
  canonicalTreeRevisionManifestV3,
  contentHash,
  TreeDeltaPageV3Schema,
  TreeRevisionHeadResponseV3Schema,
  TreeSnapshotPageV3Schema,
  treeRevisionContentHashV3,
  treeRevisionDeltaV3,
} from '@neomei/agentwiki-sync-protocol';
import type { AttachmentConfig } from '../../attachments/attachment.config';
import { LocalAttachmentStorage } from '../../attachments/local-attachment.storage';
import { MarkdownResourceService } from '../../markdown-resources/markdown-resource.service';
import { AuthorizationService } from '../../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';
import {
  SyncV3AuthorityError,
  SyncV3ImmutableRevisionService,
} from './sync-v3-immutable-revision.service';

describe('SyncV3RevisionService', () => {
  const principal = {
    userId: 'user-1', credentialId: 'cred-1', credentialFamilyId: 'family-1',
    deviceId: 'device-1', vaultId: 'vault-1', status: 'active' as const, platformRole: 'user' as const,
  };

  async function fixture(options: { maxResponseBytes?: number } = {}) {
    const body = '# Page\n\n![pic](../assets/pic.png)\n';
    const bodyHash = await contentHash(body);
    const manifest = canonicalTreeRevisionManifestV3({
      protocolVersion: '3',
      spaceId: 'space-1',
      folders: [],
      pages: [{
        pageId: 'page-1', folderId: null, path: 'pages/page.md', title: 'Page', body,
        contentHash: bodyHash, updatedAt: '2026-09-04T00:00:00.000Z',
        referencedAttachmentIds: ['attachment-1'],
      }],
      attachments: [{
        attachmentId: 'attachment-1', path: 'assets/pic.png', mimeType: 'image/png',
        sizeBytes: '4', width: 1, height: 1, contentHash: 'b'.repeat(64),
        updatedAt: '2026-09-04T00:00:00.000Z',
      }],
    });
    const revisionHash = await treeRevisionContentHashV3(manifest);
    const delta = treeRevisionDeltaV3(null, manifest);
    const revision: any = {
      id: 'rev-1', spaceId: 'space-1', sequence: 1, parentRevisionId: null,
      schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
      contentHash: revisionHash, revisionContentHash: revisionHash,
      pageCount: 1n, attachmentCount: 1n,
      revisionManifestByteLength: BigInt(canonicalBytes(manifest).byteLength),
      revisionBodyBytes: BigInt(Buffer.byteLength(body, 'utf8')),
      revisionAttachmentBytes: 4n, delta,
      createdAt: new Date('2026-09-04T00:00:00.000Z'),
    };
    const pageRows: any[] = [{
      revisionId: revision.id, pageId: 'page-1', folderId: null,
      path: 'pages/page.md', pathKey: 'pages/page.md', title: 'Page',
      contentHash: bodyHash, updatedAt: new Date('2026-09-04T00:00:00.000Z'),
      content: { contentHash: bodyHash, body, byteLength: Buffer.byteLength(body, 'utf8') },
    }];
    const attachmentRows: any[] = [{
      revisionId: revision.id, attachmentId: 'attachment-1', attachmentVersionId: 'version-1',
      spaceId: 'space-1', path: 'assets/pic.png', pathKey: 'assets/pic.png', ordinal: 0,
      attachment: { id: 'attachment-1', spaceId: 'space-1' },
      attachmentVersion: {
        id: 'version-1', attachmentId: 'attachment-1', contentHash: 'b'.repeat(64),
        storageKey: `sha256/bb/bb/${'b'.repeat(64)}`,
        mimeType: 'image/png', sizeBytes: 4n, width: 1, height: 1,
        createdAt: new Date('2026-09-04T00:00:00.000Z'),
        attachment: { id: 'attachment-1', spaceId: 'space-1' },
      },
    }];
    const sidecar: any = {
      syncV3Revision: {
        protocolVersion: '3', manifestSchema: 'TreeRevisionContentManifestV3',
        revisionContentHash: revisionHash, folderCount: '0', pageCount: '1', attachmentCount: '1',
        revisionManifestByteLength: String(canonicalBytes(manifest).byteLength),
        revisionBodyBytes: String(Buffer.byteLength(body, 'utf8')), revisionAttachmentBytes: '4',
        treeDeltaCount: String(delta.length),
        pageAttachmentIds: [{ pageId: 'page-1', referencedAttachmentIds: ['attachment-1'] }],
        attachmentUpdatedAt: [{ attachmentId: 'attachment-1', updatedAt: '2026-09-04T00:00:00.000Z' }],
      },
    };
    const tx: any = {
      humanDeviceCredential: { findUnique: jest.fn().mockResolvedValue({
        id: 'cred-1', userId: 'user-1', status: 'active', provisionalExpiresAt: null,
        user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'user' },
      }) },
      space: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null }) },
      spaceMember: { findUnique: jest.fn().mockResolvedValue({ role: 'editor' }) },
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(revision),
        findUnique: jest.fn(async ({ where }: any) => where.id === revision.id ? revision : null),
      },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
      syncRevisionPageRow: { findMany: jest.fn().mockImplementation(async ({ where }: any) => (
        where.revisionId === revision.id ? pageRows : []
      )) },
      syncRevisionAttachmentRow: { findMany: jest.fn().mockImplementation(async ({ where }: any) => (
        where.revisionId === revision.id ? attachmentRows : []
      )) },
      legacyRevisionSidecar: { findUnique: jest.fn().mockImplementation(async ({ where }: any) => (
        where.revisionId === revision.id ? { sidecar } : null
      )) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
    };
    const cursors = new SyncCursorService({ get: () => 'test-pepper' } as any);
    const capabilities = {
      capabilitiesV3: jest.fn().mockReturnValue({
        maxDeltaItems: 15_000,
        maxResponseBytes: options.maxResponseBytes ?? 4_194_304,
      }),
    };
    const writer = { inspectCurrentLocked: jest.fn(), inspectCandidate: jest.fn() };
    const service = new SyncV3RevisionService(
      prisma as any, cursors, capabilities as any, writer as any,
      new SyncV3ImmutableRevisionService(),
    );
    return { service, prisma, tx, revision, manifest, pageRows, attachmentRows, sidecar };
  }

  it('batches Space discovery and reports native, bootstrap, and legacy modes without writing', async () => {
    const body = '# Bootstrap\n';
    const tx: any = {
      humanDeviceCredential: { findUnique: jest.fn().mockResolvedValue({
        id: 'cred-1', userId: 'user-1', status: 'active', provisionalExpiresAt: null,
        user: { deletedAt: null, lockedAt: null, type: 'human', platformRole: 'super_admin' },
      }) },
      space: { findMany: jest.fn().mockResolvedValue([
        { id: 'native', name: 'Native', createdAt: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'bootstrap', name: 'Bootstrap', createdAt: new Date('2026-09-02T00:00:00.000Z') },
        { id: 'legacy', name: 'Legacy', createdAt: new Date('2026-09-03T00:00:00.000Z') },
      ]) },
      $queryRaw: jest.fn().mockImplementation(async (query: any) => {
        const sql = query.strings.join('?');
        if (sql.includes('DISTINCT ON')) return [{
          id: 'rev-native', spaceId: 'native', sequence: 3,
          schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
          pageCount: 2n, attachmentCount: 1n, revisionManifestByteLength: 100n,
          revisionBodyBytes: 20n, revisionAttachmentBytes: 4n,
        },
        {
          id: 'rev-legacy', spaceId: 'legacy', sequence: 2,
          schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1',
        }];
        if (sql.includes('GROUP BY')) return [{ spaceId: 'native' }];
        throw new Error(`Unexpected revision summary query: ${sql}`);
      }),
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([
        { revisionId: 'rev-native' },
      ]) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue([]) },
      folder: { findMany: jest.fn().mockResolvedValue([]) },
      page: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const inspections = new Map<string, any>([
      ['bootstrap', {
          mode: 'bootstrap_required', baseRevision: '0', candidate: {
            folders: [],
            pages: [{
              pageId: 'page-1', folderId: null, path: 'pages/bootstrap.md', title: 'Bootstrap',
              body, contentHash: await contentHash(body), updatedAt: '2026-09-04T00:00:00.000Z',
              referencedAttachmentIds: ['attachment-1'],
            }],
            attachments: [{
              attachmentId: 'attachment-1', path: 'assets/pic.png', mimeType: 'image/png',
              sizeBytes: '4', width: 1, height: 1, contentHash: 'b'.repeat(64),
              updatedAt: '2026-09-04T00:00:00.000Z',
            }],
          },
        }],
      ['legacy', {
          mode: 'legacy_v2', baseRevision: 'rev-legacy',
          candidate: { folders: [], pages: [], attachments: [] },
        }],
    ]);
    const writer = {
      inspectCandidates: jest.fn().mockResolvedValue(inspections),
    };
    const immutable = {
      verifyMany: jest.fn().mockResolvedValue(new Map([['native', {
        manifest: { folders: [{}], pages: [{}, {}], attachments: [{}] },
        revisionManifestByteLength: 100, revisionBodyBytes: 20, revisionAttachmentBytes: 4,
      }]])),
    };
    const service = new SyncV3RevisionService(
      { $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(tx)) } as any,
      new SyncCursorService({ get: () => 'test-pepper' } as any),
      { capabilitiesV3: () => ({ maxDeltaItems: 15_000, maxResponseBytes: 4_194_304 }) } as any,
      writer as any,
      immutable as any,
    );

    const response = await service.listSpaces(principal);

    expect(response.spaces.map((space) => [space.spaceId, space.syncMode])).toEqual([
      ['native', 'native_v3'], ['bootstrap', 'bootstrap_required'], ['legacy', 'legacy_v2'],
    ]);
    expect(response.spaces[1]).toEqual(expect.objectContaining({
      pageCount: '1', attachmentCount: '1', revisionAttachmentBytes: '4',
    }));
    expect(tx.syncRevisionFolderRow.findMany).toHaveBeenCalledTimes(1);
    expect(tx.syncRevisionPageRow.findMany).toHaveBeenCalledTimes(1);
    expect(tx.folder.findMany).toHaveBeenCalledTimes(1);
    expect(tx.page.findMany).toHaveBeenCalledTimes(1);
    expect(writer.inspectCandidates).toHaveBeenCalledTimes(1);
    expect(immutable.verifyMany).toHaveBeenCalledTimes(1);
  });

  it('rebuilds an immutable v3 revision and returns strict head/snapshot/delta envelopes', async () => {
    const { service } = await fixture();
    const head = await service.head(principal, 'space-1');
    const snapshot = await service.snapshot(principal, 'space-1', 'rev-1', undefined, 10);
    const delta = await service.delta(principal, 'space-1', '0', undefined, 10);
    expect(TreeRevisionHeadResponseV3Schema.parse(head).attachmentCount).toBe('1');
    expect(TreeSnapshotPageV3Schema.parse(snapshot).attachments).toHaveLength(1);
    expect(TreeDeltaPageV3Schema.parse(delta).items.map((item) => item.operation)).toEqual([
      'upsert_attachment', 'upsert_page',
    ]);
  });

  it.each([
    ['missing parent', { id: 'missing', parent: null }],
    ['cross-Space parent', { id: 'parent-1', parent: {
      id: 'parent-1', spaceId: 'space-2', sequence: 1,
      schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1',
    } }],
    ['future parent schema', { id: 'parent-1', parent: {
      id: 'parent-1', spaceId: 'space-1', sequence: 1,
      schemaVersion: 'content-tree@4', recipeVersion: 'referenced-images-v1',
    } }],
    ['unknown parent recipe', { id: 'parent-1', parent: {
      id: 'parent-1', spaceId: 'space-1', sequence: 1,
      schemaVersion: 'content-tree@2', recipeVersion: 'future-recipe',
    } }],
    ['wrong parent sequence', { id: 'parent-1', parent: {
      id: 'parent-1', spaceId: 'space-1', sequence: 3,
      schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1',
    } }],
    ['non-positive parent sequence', { id: 'parent-1', currentSequence: 1, parent: {
      id: 'parent-1', spaceId: 'space-1', sequence: 0,
      schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
    } }],
  ])('rejects a v3 revision with %s', async (_label, state) => {
    const { tx, revision } = await fixture();
    revision.sequence = 'currentSequence' in state ? state.currentSequence : 2;
    revision.parentRevisionId = state.id;
    tx.spaceKnowledgeRevision.findUnique.mockImplementation(async ({ where }: any) => (
      where.id === revision.id ? revision : state.parent
    ));

    await expect(new SyncV3ImmutableRevisionService().verify(tx, 'space-1', revision))
      .rejects.toBeInstanceOf(SyncV3AuthorityError);
  });

  it.each([
    ['v1', { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none' }],
    ['v2', { schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1' }],
  ])('accepts a legal %s parent immediately before the first v3 revision', async (_label, format) => {
    const { tx, revision } = await fixture();
    revision.sequence = 2;
    revision.parentRevisionId = 'parent-1';
    const parent = { id: 'parent-1', spaceId: 'space-1', sequence: 1, ...format };
    tx.spaceKnowledgeRevision.findUnique.mockImplementation(async ({ where }: any) => (
      where.id === revision.id ? revision : parent
    ));

    await expect(new SyncV3ImmutableRevisionService().verify(tx, 'space-1', revision))
      .resolves.toMatchObject({ revision: revision.id, sequence: 2 });
  });

  it('accepts only sequence one as a parentless v3 genesis', async () => {
    const { tx, revision } = await fixture();
    const verifier = new SyncV3ImmutableRevisionService();
    await expect(verifier.verify(tx, 'space-1', revision))
      .resolves.toMatchObject({ revision: revision.id, sequence: 1 });
    revision.sequence = 2;
    await expect(verifier.verify(tx, 'space-1', revision))
      .rejects.toBeInstanceOf(SyncV3AuthorityError);
  });

  it('fails closed in batched verification when a declared parent row is missing', async () => {
    const { tx, revision, pageRows, attachmentRows, sidecar } = await fixture();
    revision.sequence = 2;
    revision.parentRevisionId = 'missing-parent';
    tx.spaceKnowledgeRevision.findMany = jest.fn().mockResolvedValue([]);
    tx.syncRevisionPageRow.findMany.mockImplementation(async ({ where }: any) => (
      where.revisionId?.in ? pageRows : where.revisionId === revision.id ? pageRows : []
    ));
    tx.syncRevisionAttachmentRow.findMany.mockImplementation(async ({ where }: any) => (
      where.revisionId?.in ? attachmentRows : where.revisionId === revision.id ? attachmentRows : []
    ));
    tx.legacyRevisionSidecar.findMany = jest.fn().mockResolvedValue([
      { revisionId: revision.id, sidecar },
    ]);

    await expect(new SyncV3ImmutableRevisionService().verifyMany(tx, [
      { spaceId: 'space-1', revision },
    ])).rejects.toBeInstanceOf(SyncV3AuthorityError);
  });

  it('pins snapshot and delta cursors to the original fixed endpoint revisions', async () => {
    const { service, tx, revision } = await fixture();
    const firstSnapshot = await service.snapshot(principal, 'space-1', 'current', undefined, 1);
    const firstDelta = await service.delta(principal, 'space-1', '0', undefined, 1);
    expect(firstSnapshot.nextCursor).not.toBeNull();
    expect(firstDelta.nextCursor).not.toBeNull();
    tx.spaceKnowledgeRevision.findFirst.mockResolvedValue({ ...revision, id: 'rev-new', sequence: 2 });
    const nextSnapshot = await service.snapshot(principal, 'space-1', 'current', firstSnapshot.nextCursor!, 1);
    const nextDelta = await service.delta(principal, 'space-1', '0', firstDelta.nextCursor!, 1);
    expect(nextSnapshot.revision).toBe('rev-1');
    expect(nextDelta.toRevision).toBe('rev-1');
  });

  it('rejects malformed, cross-Space, cross-revision, and cross-route cursors', async () => {
    const { service } = await fixture();
    const first = await service.snapshot(principal, 'space-1', 'rev-1', undefined, 1);
    await expect(service.snapshot(principal, 'space-2', 'rev-1', first.nextCursor!, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'CURSOR_INVALID' }));
    await expect(service.snapshot(principal, 'space-1', 'another-revision', first.nextCursor!, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'CURSOR_INVALID' }));
    await expect(service.delta(principal, 'space-1', '0', first.nextCursor!, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'CURSOR_INVALID' }));
    await expect(service.snapshot(principal, 'space-1', 'rev-1', 'invalid.cursor', 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'CURSOR_INVALID' }));
  });

  it('fails clearly when one complete strict response item cannot fit the response limit', async () => {
    const { service } = await fixture({ maxResponseBytes: 128 });
    await expect(service.snapshot(principal, 'space-1', 'rev-1', undefined, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'SPACE_TOO_LARGE' }));
    await expect(service.delta(principal, 'space-1', '0', undefined, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'SPACE_TOO_LARGE' }));
    await expect(service.delta(principal, 'space-1', 'rev-1', undefined, 1))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'SPACE_TOO_LARGE' }));
  });

  it.each([
    ['Page body/hash', (state: Awaited<ReturnType<typeof fixture>>) => { state.pageRows[0].content.body += 'corrupt'; }],
    ['stored manifest hash', (state: Awaited<ReturnType<typeof fixture>>) => { state.revision.revisionContentHash = 'f'.repeat(64); }],
    ['AttachmentVersion ownership', (state: Awaited<ReturnType<typeof fixture>>) => { state.attachmentRows[0].attachmentVersion.attachmentId = 'other'; }],
    ['Attachment row Space ownership', (state: Awaited<ReturnType<typeof fixture>>) => { state.attachmentRows[0].spaceId = 'space-2'; }],
    ['immutable Attachment metadata', (state: Awaited<ReturnType<typeof fixture>>) => { state.attachmentRows[0].attachmentVersion.sizeBytes = 5n; }],
    ['AttachmentVersion storage key', (state: Awaited<ReturnType<typeof fixture>>) => { state.attachmentRows[0].attachmentVersion.storageKey = 'sha256/xx/private'; }],
    ['v3 sidecar', (state: Awaited<ReturnType<typeof fixture>>) => { state.sidecar.syncV3Revision.unexpected = true; }],
  ])('fails the complete revision read without partial data when %s is corrupt', async (_name, mutate) => {
    const state = await fixture();
    mutate(state);
    await expect(state.service.snapshot(principal, 'space-1', 'rev-1', undefined, 10))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'REVISION_GONE' }));
  });

  it('fails closed on unknown future schema or recipe markers', async () => {
    const state = await fixture();
    state.revision.schemaVersion = 'content-tree@4';
    await expect(state.service.head(principal, 'space-1'))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' }));
    state.revision.schemaVersion = 'content-tree@3';
    state.revision.recipeVersion = 'future-recipe';
    await expect(state.service.head(principal, 'space-1'))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' }));
  });

  it('rejects a canonical stored delta whose items do not describe parent to current semantics', async () => {
    const state = await fixture();
    state.revision.delta = canonicalTreeDeltaItemsV3(state.revision.delta.map((item: any) => (
      item.operation === 'upsert_page'
        ? { ...item, page: { ...item.page, title: 'Canonical but false' } }
        : item
    )));
    await expect(state.service.head(principal, 'space-1'))
      .rejects.toEqual(expect.objectContaining({ syncCode: 'REVISION_GONE' }));
  });

  it.each([
    ['credential revoked', (state: Awaited<ReturnType<typeof fixture>>) => state.tx.humanDeviceCredential.findUnique.mockResolvedValue(null), 'DEVICE_CREDENTIAL_REVOKED'],
    ['role removed', (state: Awaited<ReturnType<typeof fixture>>) => state.tx.spaceMember.findUnique.mockResolvedValue(null), 'SPACE_FORBIDDEN'],
    ['Space deleted', (state: Awaited<ReturnType<typeof fixture>>) => state.tx.space.findUnique.mockResolvedValue({ deletedAt: new Date() }), 'SPACE_FORBIDDEN'],
  ])('rechecks %s for every immutable read', async (_name, mutate, code) => {
    const state = await fixture();
    mutate(state);
    await expect(state.service.head(principal, 'space-1'))
      .rejects.toEqual(expect.objectContaining({ syncCode: code }));
  });
});

const syncV3ReadDatabaseUrl = safeSyncV3ReadDatabaseUrl();
const dbIt = syncV3ReadDatabaseUrl ? it : it.skip;

describe('SyncV3RevisionService PostgreSQL integration', () => {
  dbIt('rebuilds and pages immutable v3 revisions without head drift or integrity leaks', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: syncV3ReadDatabaseUrl } } });
    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-v3-read-test-'));
    const storage = new LocalAttachmentStorage(syncV3ReadStorageConfig(storageRoot));
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `user_${suffix}`;
    const spaceId = `space_${suffix}`;
    const otherSpaceId = `other_${suffix}`;
    const legacySpaceId = `legacy_${suffix}`;
    const credentialFamilyId = randomUUID();
    const credentialId = randomUUID();
    const pageId = `page_${suffix}`;
    const folderId = `folder_${suffix}`;
    const principal = {
      userId, credentialId, credentialFamilyId,
      deviceId: randomUUID(), vaultId: randomUUID(), status: 'active' as const,
      platformRole: 'user' as const,
    };

    try {
      const blob = await publishSyncV3ReadBlob(storage, Buffer.alloc(4, 0xb));
      await prisma.user.create({ data: { id: userId, email: `${suffix}@reader.sync-v3.test` } });
      await prisma.space.createMany({ data: [
        { id: spaceId, name: 'Sync v3 reader', slug: spaceId },
        { id: otherSpaceId, name: 'Other reader', slug: otherSpaceId },
        { id: legacySpaceId, name: 'Deep legacy reader', slug: legacySpaceId },
      ] });
      await prisma.spaceMember.createMany({ data: [
        { userId, spaceId, role: 'owner' },
        { userId, spaceId: otherSpaceId, role: 'owner' },
        { userId, spaceId: legacySpaceId, role: 'admin' },
      ] });
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: credentialFamilyId, userId, deviceId: principal.deviceId, vaultId: principal.vaultId,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId, credentialFamilyId, userId,
        deviceId: principal.deviceId, vaultId: principal.vaultId,
        deviceName: 'Task 5 DB reader', credentialHash: `hash_${suffix}`,
        status: 'active', activatedAt: new Date(),
      } });
      await prisma.folder.create({ data: {
        id: folderId, spaceId, parentId: null, name: 'Docs', nameKey: 'docs',
        path: 'pages/Docs', pathKey: 'pages/docs', sortOrder: 0,
        createdByUserId: userId, lastModifiedByUserId: userId,
      } });
      const initialBody = '# Initial\n\n![[assets/photo.png]]\n';
      await prisma.page.create({ data: {
        knowledgeKey: pageId, title: 'Initial', slug: `page-${suffix}`,
        content: initialBody, spaceId, authorId: userId, folderId,
        syncPath: 'pages/Docs/Initial.md', syncPathKey: 'pages/docs/initial.md',
        lastModifiedByUserId: userId,
      } });
      const attachment = await prisma.spaceAttachment.create({ data: {
        spaceId, displayName: 'photo.png', nameKey: 'photo.png',
        contentHash: blob.contentHash, storageKey: blob.storageKey,
        mimeType: 'image/png', sizeBytes: 4n, width: 1, height: 1,
        uploadedByUserId: userId,
      } });
      await prisma.attachmentVersion.create({ data: {
        attachmentId: attachment.id, contentHash: attachment.contentHash,
        storageKey: attachment.storageKey, mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes, width: attachment.width, height: attachment.height,
      } });

      const markdown = new MarkdownResourceService(
        prisma as any,
        new AuthorizationService(prisma as any),
      );
      const v3Writer = new SyncV3RevisionWriterService(markdown, storage);
      const legacyWriter = new SpaceRevisionWriterService(prisma as any, v3Writer);
      const publishCurrent = () => prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        const inspection = await v3Writer.inspectCurrentLocked(locked, spaceId);
        expect(inspection.blockers).toEqual([]);
        return v3Writer.advanceV3Locked(locked, spaceId, inspection.candidate, {
          origin: 'obsidian_sync', createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      const first = await publishCurrent();

      const changedBody = '# Changed\n\n![[assets/photo.png]]\n';
      await prisma.$transaction(async (tx) => {
        await tx.folder.update({ where: { id: folderId }, data: {
          name: 'Guides', nameKey: 'guides', path: 'pages/Guides', pathKey: 'pages/guides',
          lastModifiedByUserId: userId,
        } });
        await tx.page.update({ where: { knowledgeKey: pageId }, data: {
          title: 'Changed', content: changedBody,
          syncPath: 'pages/Guides/Changed.md', syncPathKey: 'pages/guides/changed.md',
          lastModifiedByUserId: userId,
        } });
      });
      const second = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.advanceCurrentIfRequiredLocked(locked, spaceId, [{
          operation: 'upsert', pageId, folderId,
          path: 'pages/Guides/Changed.md', title: 'Changed', body: changedBody,
        }], {
          origin: 'obsidian_sync', createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      if (!second) throw new Error('Expected second v3 revision');

      const cursors = new SyncCursorService({ get: () => 'task5-db-cursor-pepper' } as any);
      const capabilities = new SyncCapabilitiesService(prisma as any, v3Writer);
      const reader = new SyncV3RevisionService(
        prisma as any, cursors, capabilities, v3Writer, new SyncV3ImmutableRevisionService(),
      );

      const legacyRevision = (sequence: number) => ({
        spaceId: legacySpaceId, sequence,
        schemaVersion: 'content-tree@2', recipeVersion: 'space-folders-v1',
        contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        revisionContentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        pageCount: 0n, attachmentCount: 0n, revisionBodyBytes: 0n,
        revisionManifestByteLength: 0n, revisionAttachmentBytes: 0n,
        delta: [],
      });
      await prisma.spaceKnowledgeRevision.create({ data: legacyRevision(1) });
      await prisma.spaceKnowledgeRevision.createMany({ data: [
        {
          ...legacyRevision(1), spaceId: otherSpaceId,
          schemaVersion: 'content-tree@3', recipeVersion: 'future-recipe',
        },
        { ...legacyRevision(2), spaceId: otherSpaceId },
      ] });
      const countedPrisma = new PrismaClient({
        datasources: { db: { url: syncV3ReadDatabaseUrl } },
        log: [{ emit: 'event', level: 'query' }],
      });
      let queryCount = 0;
      const revisionSummarySql: string[] = [];
      countedPrisma.$on('query', (event) => {
        queryCount += 1;
        if (event.query.includes('SpaceKnowledgeRevision')) revisionSummarySql.push(event.query);
      });
      const revisionSummaryRowCounts: number[] = [];
      const measuredPrisma = new Proxy(countedPrisma as any, {
        get(target, property) {
          if (property !== '$transaction') return Reflect.get(target, property, target);
          return (callback: (tx: unknown) => Promise<unknown>, options: unknown) => target.$transaction(
            (tx: any) => callback(new Proxy(tx, {
              get(transaction, transactionProperty) {
                if (transactionProperty !== '$queryRaw') {
                  return Reflect.get(transaction, transactionProperty, transaction);
                }
                return async (...args: unknown[]) => {
                  const rows = await transaction.$queryRaw(...args);
                  revisionSummaryRowCounts.push(rows.length);
                  return rows;
                };
              },
            })),
            options,
          );
        },
      });
      const countedMarkdown = new MarkdownResourceService(
        countedPrisma as any, new AuthorizationService(countedPrisma as any),
      );
      const countedWriter = new SyncV3RevisionWriterService(countedMarkdown, storage);
      const countedReader = new SyncV3RevisionService(
        measuredPrisma,
        cursors,
        new SyncCapabilitiesService(countedPrisma as any, countedWriter),
        countedWriter,
        new SyncV3ImmutableRevisionService(),
      );
      queryCount = 0;
      revisionSummaryRowCounts.length = 0;
      revisionSummarySql.length = 0;
      const shallowSpaces = await countedReader.listSpaces(principal);
      expect(shallowSpaces.spaces.find((space) => space.spaceId === legacySpaceId))
        .toMatchObject({ syncMode: 'legacy_v2', canPublish: true });
      expect(revisionSummaryRowCounts).toHaveLength(2);
      expect([...revisionSummaryRowCounts].sort((left, right) => left - right)).toEqual([1, 3]);
      expect(revisionSummaryRowCounts.every((count) => count <= shallowSpaces.spaces.length)).toBe(true);
      expect(revisionSummarySql.some((sql) => sql.includes('DISTINCT ON'))).toBe(true);
      expect(revisionSummarySql.some((sql) => sql.includes('GROUP BY'))).toBe(true);
      queryCount = 0;
      await countedReader.listSpaces(principal);
      const shallowQueryCount = queryCount;
      await prisma.spaceKnowledgeRevision.createMany({
        data: Array.from({ length: 49 }, (_, index) => legacyRevision(index + 2)),
      });
      queryCount = 0;
      revisionSummaryRowCounts.length = 0;
      await countedReader.listSpaces(principal);
      expect(Math.abs(queryCount - shallowQueryCount)).toBeLessThanOrEqual(1);
      expect(revisionSummaryRowCounts).toHaveLength(2);
      expect([...revisionSummaryRowCounts].sort((left, right) => left - right)).toEqual([1, 3]);
      expect(revisionSummaryRowCounts.every((count) => count <= shallowSpaces.spaces.length)).toBe(true);
      await countedPrisma.$disconnect();

      const legacyToV3 = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, legacySpaceId);
        return v3Writer.advanceV3Locked(locked, legacySpaceId, {
          folders: [], pages: [], attachments: [],
        }, {
          origin: 'obsidian_sync', createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      const legacyV3Revision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: legacyToV3.revisionId },
      });
      if (!legacyV3Revision.parentRevisionId) throw new Error('Expected a legacy parent');
      const legacyParent = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: legacyV3Revision.parentRevisionId },
      });
      await expect(reader.snapshot(principal, legacySpaceId, legacyV3Revision.id, undefined, 10))
        .resolves.toMatchObject({ revision: legacyV3Revision.id, pages: [], attachments: [] });
      await expect(reader.snapshot(principal, spaceId, first.revisionId, undefined, 10))
        .resolves.toMatchObject({ revision: first.revisionId });

      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { parentRevisionId: 'missing-parent' },
      });
      await expect(reader.snapshot(principal, legacySpaceId, legacyV3Revision.id, undefined, 10))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await expect(reader.listSpaces(principal))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { parentRevisionId: legacyParent.id },
      });

      const crossSpaceParent = await prisma.spaceKnowledgeRevision.create({ data: {
        ...legacyRevision(50), spaceId: otherSpaceId,
      } });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { parentRevisionId: crossSpaceParent.id },
      });
      await expect(reader.snapshot(principal, legacySpaceId, legacyV3Revision.id, undefined, 10))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { parentRevisionId: legacyParent.id },
      });

      for (const parentFormat of [
        { schemaVersion: 'content-tree@4', recipeVersion: 'referenced-images-v1' },
        { schemaVersion: 'content-tree@2', recipeVersion: 'future-recipe' },
      ]) {
        await prisma.spaceKnowledgeRevision.update({
          where: { id: legacyParent.id }, data: parentFormat,
        });
        await expect(reader.snapshot(principal, legacySpaceId, legacyV3Revision.id, undefined, 10))
          .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
        await prisma.spaceKnowledgeRevision.update({
          where: { id: legacyParent.id }, data: {
            schemaVersion: legacyParent.schemaVersion,
            recipeVersion: legacyParent.recipeVersion,
          },
        });
      }

      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { sequence: legacyV3Revision.sequence + 1 },
      });
      await expect(reader.snapshot(principal, legacySpaceId, legacyV3Revision.id, undefined, 10))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: legacyV3Revision.id }, data: { sequence: legacyV3Revision.sequence },
      });

      await prisma.spaceKnowledgeRevision.update({
        where: { id: first.revisionId }, data: { sequence: 0 },
      });
      await expect(reader.snapshot(principal, spaceId, first.revisionId, undefined, 10))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: first.revisionId }, data: { sequence: 1 },
      });

      const fixed = await reader.snapshot(principal, spaceId, second.revisionId, undefined, 10);
      expect(TreeSnapshotPageV3Schema.parse(fixed)).toMatchObject({
        revision: second.revisionId,
        folders: [expect.objectContaining({ folderId, path: 'pages/Guides' })],
        pages: [expect.objectContaining({ pageId, referencedAttachmentIds: [attachment.id] })],
        attachments: [expect.objectContaining({ attachmentId: attachment.id, sizeBytes: '4' })],
      });

      const firstSnapshotPage = await reader.snapshot(principal, spaceId, 'current', undefined, 1);
      const firstDeltaPage = await reader.delta(principal, spaceId, first.revisionId, undefined, 1);
      expect(firstSnapshotPage.nextCursor).not.toBeNull();
      expect(firstDeltaPage.nextCursor).not.toBeNull();

      const thirdBody = '# Third\n\n![[assets/photo.png]]\n';
      await prisma.page.update({ where: { knowledgeKey: pageId }, data: {
        content: thirdBody, lastModifiedByUserId: userId,
      } });
      const third = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.advanceCurrentIfRequiredLocked(locked, spaceId, [{
          operation: 'upsert', pageId, folderId,
          path: 'pages/Guides/Changed.md', title: 'Changed', body: thirdBody,
        }], {
          origin: 'obsidian_sync', createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      if (!third) throw new Error('Expected third v3 revision');
      expect(third.revisionId).not.toBe(second.revisionId);

      const snapshotPages = [firstSnapshotPage];
      while (snapshotPages[snapshotPages.length - 1]!.nextCursor) {
        snapshotPages.push(await reader.snapshot(
          principal,
          spaceId,
          'current',
          snapshotPages[snapshotPages.length - 1]!.nextCursor!,
          1,
        ));
      }
      expect(snapshotPages.every((page) => page.revision === second.revisionId)).toBe(true);
      const snapshotKeys = snapshotPages.flatMap((page) => [
        ...page.folders.map((item) => `folder:${item.folderId}`),
        ...page.pages.map((item) => `page:${item.pageId}`),
        ...page.attachments.map((item) => `attachment:${item.attachmentId}`),
      ]);
      expect(snapshotKeys).toHaveLength(3);
      expect(new Set(snapshotKeys).size).toBe(snapshotKeys.length);

      const deltaPages = [firstDeltaPage];
      while (deltaPages[deltaPages.length - 1]!.nextCursor) {
        deltaPages.push(await reader.delta(
          principal,
          spaceId,
          first.revisionId,
          deltaPages[deltaPages.length - 1]!.nextCursor!,
          1,
        ));
      }
      expect(deltaPages.every((page) => page.toRevision === second.revisionId)).toBe(true);
      const deltaItems = deltaPages.flatMap((page) => page.items);
      expect(deltaItems).toHaveLength(2);
      expect(deltaItems.map((item) => item.operation)).toEqual(['upsert_folder', 'upsert_page']);

      await expect(reader.snapshot(principal, otherSpaceId, second.revisionId, undefined, 10))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });

      const revision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: second.revisionId },
      });
      const pageRow = await prisma.syncRevisionPageRow.findFirstOrThrow({
        where: { revisionId: second.revisionId }, include: { content: true },
      });
      const attachmentRow = await prisma.syncRevisionAttachmentRow.findFirstOrThrow({
        where: { revisionId: second.revisionId }, include: { attachmentVersion: true },
      });
      const corruptions: Array<{
        apply: () => Promise<unknown>;
        restore: () => Promise<unknown>;
      }> = [
        {
          apply: () => {
            const wrong = canonicalTreeDeltaItemsV3((revision.delta as any[]).map((item: any) => (
              item.operation === 'upsert_page'
                ? { ...item, page: { ...item.page, title: 'Canonical but false' } }
                : item
            )));
            return prisma.spaceKnowledgeRevision.update({
              where: { id: second.revisionId }, data: { delta: wrong as any },
            });
          },
          restore: () => prisma.spaceKnowledgeRevision.update({
            where: { id: second.revisionId }, data: { delta: revision.delta as any },
          }),
        },
        {
          apply: () => prisma.syncPageContentRow.update({
            where: { contentHash: pageRow.contentHash }, data: { body: `${pageRow.content.body}corrupt` },
          }),
          restore: () => prisma.syncPageContentRow.update({
            where: { contentHash: pageRow.contentHash }, data: { body: pageRow.content.body },
          }),
        },
        {
          apply: () => prisma.spaceKnowledgeRevision.update({
            where: { id: second.revisionId }, data: { revisionContentHash: 'f'.repeat(64) },
          }),
          restore: () => prisma.spaceKnowledgeRevision.update({
            where: { id: second.revisionId }, data: { revisionContentHash: revision.revisionContentHash },
          }),
        },
        {
          apply: () => prisma.attachmentVersion.update({
            where: { id: attachmentRow.attachmentVersionId }, data: { width: 2 },
          }),
          restore: () => prisma.attachmentVersion.update({
            where: { id: attachmentRow.attachmentVersionId }, data: { width: attachmentRow.attachmentVersion.width },
          }),
        },
      ];
      for (const corruption of corruptions) {
        await corruption.apply();
        await expect(reader.snapshot(principal, spaceId, second.revisionId, undefined, 10))
          .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
        await corruption.restore();
      }
      await expect(reader.snapshot(principal, spaceId, second.revisionId, undefined, 10))
        .resolves.toMatchObject({ revision: second.revisionId });
    } finally {
      await prisma.syncRevisionAttachmentRow.deleteMany({ where: { spaceId } });
      await prisma.attachmentVersion.deleteMany({ where: { attachment: { spaceId } } });
      await prisma.space.deleteMany({ where: { id: { in: [spaceId, otherSpaceId, legacySpaceId] } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await storage.onModuleDestroy();
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

function safeSyncV3ReadDatabaseUrl(): string | undefined {
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

function syncV3ReadStorageConfig(storagePath: string): AttachmentConfig {
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

async function publishSyncV3ReadBlob(storage: LocalAttachmentStorage, bytes: Buffer) {
  const contentHashValue = createHash('sha256').update(bytes).digest('hex');
  const reservation = await storage.createReservedTempPath(BigInt(bytes.length), 1n);
  await writeFile(reservation.path, bytes, { mode: 0o600 });
  return storage.withContentLock(contentHashValue, (lease) => storage.publish(
    reservation,
    contentHashValue,
    BigInt(bytes.length),
    lease,
  ));
}
