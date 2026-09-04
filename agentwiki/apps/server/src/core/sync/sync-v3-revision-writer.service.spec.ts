import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  TreeFinalizePushResponseV3Schema,
  contentHash,
  normalizeMarkdown,
  type SyncPageV3,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService } from '../authorization/authorization.service';
import { MarkdownResourceService } from '../../markdown-resources/markdown-resource.service';
import { SyncV3BootstrapService } from '../../integrations/obsidian/sync-v3-bootstrap.service';
import type { AttachmentConfig } from '../../attachments/attachment.config';
import { LocalAttachmentStorage } from '../../attachments/local-attachment.storage';
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { PageService } from '../page/page.service';
import { ReadableSyncPathService } from './readable-sync-path.service';
import { ContentTreeService } from '../../content-tree/content-tree.service';
import {
  SyncV3RevisionWriterService,
  assertSyncV3CandidateHardLimits,
} from './sync-v3-revision-writer.service';

describe('SyncV3RevisionWriterService', () => {
  const attachmentId = '11111111-1111-4111-8111-111111111111';

  it('rejects a Page whose declared attachment IDs differ from authoritative Markdown parsing', async () => {
    const body = '![[assets/photo.png]]\n';
    const page: SyncPageV3 = {
      pageId: 'page-1',
      folderId: null,
      path: 'pages/Page.md',
      title: 'Page',
      body,
      contentHash: await contentHash(body),
      updatedAt: '2026-09-04T00:00:00.000Z',
      referencedAttachmentIds: [],
    };
    const markdownResources = {
      resolveReferencedAttachments: jest.fn().mockResolvedValue({
        attachmentIds: [attachmentId],
        references: [],
        errors: [],
      }),
    };
    const service = new SyncV3RevisionWriterService(markdownResources as any, {} as any);

    await expect(service.advanceV3Locked({} as any, 'space-1', {
      folders: [],
      pages: [page],
      attachments: [{
        attachmentId,
        path: 'assets/photo.png',
        mimeType: 'image/png',
        sizeBytes: '4',
        width: 1,
        height: 1,
        contentHash: 'b'.repeat(64),
        updatedAt: '2026-09-04T00:00:00.000Z',
      }],
    }, { origin: 'obsidian_sync' })).rejects.toEqual(expect.objectContaining({
      syncCode: 'ATTACHMENT_REFERENCE_INVALID',
    }));
  });

  it('rejects a Page body whose declared content hash is stale before resolving references', async () => {
    const markdownResources = { resolveReferencedAttachments: jest.fn() };
    const service = new SyncV3RevisionWriterService(markdownResources as any, {} as any);
    const page: SyncPageV3 = {
      pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page',
      body: 'changed\n', contentHash: 'a'.repeat(64),
      updatedAt: '2026-09-04T00:00:00.000Z', referencedAttachmentIds: [],
    };

    await expect(service.advanceV3Locked({} as any, 'space-1', {
      folders: [], pages: [page], attachments: [],
    }, { origin: 'web_editor' })).rejects.toEqual(expect.objectContaining({
      syncCode: 'ATTACHMENT_CONTENT_INVALID',
    }));
    expect(markdownResources.resolveReferencedAttachments).not.toHaveBeenCalled();
  });

  it.each([
    ['body update', {
      operation: 'upsert' as const, pageId: 'page-1', path: 'pages/Page.md',
      title: 'Page', body: '# changed\n',
    }, { folderId: null, path: 'pages/Page.md', title: 'Page', body: '# changed\n' }],
    ['rename', {
      operation: 'upsert' as const, pageId: 'page-1', path: 'pages/Renamed.md',
      title: 'Renamed', body: '# body\n',
    }, { folderId: null, path: 'pages/Renamed.md', title: 'Renamed', body: '# body\n' }],
    ['structural move', {
      operation: 'upsert' as const, pageId: 'page-1', folderId: 'folder-2',
      path: 'pages/Folder/Page.md', title: 'Page', body: '# body\n',
    }, { folderId: 'folder-2', path: 'pages/Folder/Page.md', title: 'Page', body: '# body\n' }],
  ])('accepts a %s only when the live candidate already contains it', async (_label, change, live) => {
    const service = new SyncV3RevisionWriterService({} as any, {} as any);
    const candidate = {
      folders: [], attachments: [], pages: [{
        pageId: 'page-1', ...live, contentHash: await contentHash(live.body),
        updatedAt: '2026-09-04T00:00:00.000Z', referencedAttachmentIds: [],
      }],
    };
    jest.spyOn(service as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'native_v3', blockers: [], candidate,
    });
    jest.spyOn(service, 'advanceV3Locked').mockResolvedValue({
      revisionId: 'rev-2', sequence: 2, revisionContentHash: 'a'.repeat(64),
      pageCount: 1n, revisionManifestByteLength: 1n, revisionBodyBytes: 1n,
      attachmentCount: 0n, revisionAttachmentBytes: 0n, publishedAt: new Date(),
    });

    await expect(service.advanceCurrentIfRequiredLocked(
      {} as any, 'space-1', [change], { origin: 'web_editor' },
    )).resolves.toMatchObject({ revisionId: 'rev-2' });
  });

  it('accepts archive only when the live candidate no longer contains the Page', async () => {
    const service = new SyncV3RevisionWriterService({} as any, {} as any);
    jest.spyOn(service as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'native_v3', blockers: [], candidate: { folders: [], pages: [], attachments: [] },
    });
    jest.spyOn(service, 'advanceV3Locked').mockResolvedValue({
      revisionId: 'rev-2', sequence: 2, revisionContentHash: 'a'.repeat(64),
      pageCount: 0n, revisionManifestByteLength: 1n, revisionBodyBytes: 0n,
      attachmentCount: 0n, revisionAttachmentBytes: 0n, publishedAt: new Date(),
    });

    await expect(service.advanceCurrentIfRequiredLocked(
      {} as any,
      'space-1',
      [{ operation: 'archive', pageId: 'page-1', previousPath: 'pages/Page.md' }],
      { origin: 'web_editor' },
    )).resolves.toMatchObject({ revisionId: 'rev-2' });
  });

  it('fails before publication when a declared change was not applied to live rows', async () => {
    const service = new SyncV3RevisionWriterService({} as any, {} as any);
    const candidate = {
      folders: [], attachments: [], pages: [{
        pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Old', body: '# old\n',
        contentHash: await contentHash('# old\n'), updatedAt: '2026-09-04T00:00:00.000Z',
        referencedAttachmentIds: [],
      }],
    };
    jest.spyOn(service as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'native_v3', blockers: [], candidate,
    });
    const publish = jest.spyOn(service, 'advanceV3Locked');

    await expect(service.advanceCurrentIfRequiredLocked(
      {} as any,
      'space-1',
      [{
        operation: 'upsert', pageId: 'page-1', path: 'pages/Renamed.md',
        title: 'Renamed', body: '# changed\n',
      }],
      { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes an applied structural rename directly when managed images first require v3', async () => {
    const body = '![[assets/photo.png]]\n';
    const candidate = {
      folders: [],
      pages: [{
        pageId: 'page-1', folderId: 'folder-2', path: 'pages/Renamed.md', title: 'Renamed', body,
        contentHash: await contentHash(body), updatedAt: '2026-09-04T00:00:00.000Z',
        referencedAttachmentIds: [attachmentId],
      }],
      attachments: [{
        attachmentId, path: 'assets/photo.png', mimeType: 'image/png' as const,
        sizeBytes: '4', width: 1, height: 1, contentHash: 'b'.repeat(64),
        updatedAt: '2026-09-04T00:00:00.000Z',
      }],
    };
    const v3Writer = new SyncV3RevisionWriterService({} as any, {} as any);
    jest.spyOn(v3Writer as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'bootstrap_required', blockers: [], candidate,
    });
    const publish = jest.spyOn(v3Writer, 'advanceV3Locked').mockResolvedValue({
      revisionId: 'rev-v3', sequence: 2, revisionContentHash: 'a'.repeat(64),
      pageCount: 1n, revisionManifestByteLength: 1n, revisionBodyBytes: 1n,
      attachmentCount: 1n, revisionAttachmentBytes: 4n, publishedAt: new Date(),
    });
    const writer = new SpaceRevisionWriterService({} as any, v3Writer);
    const tx = { $executeRaw: jest.fn(), spaceKnowledgeRevision: { create: jest.fn() } };
    const change = {
      operation: 'upsert' as const,
      pageId: 'page-1',
      folderId: 'folder-2',
      path: 'pages/Renamed.md',
      title: 'Renamed',
      body,
    };

    await expect(writer.advanceStructuralPagesLocked(
      tx as any,
      'space-1',
      [change],
      { origin: 'web_editor' },
    )).resolves.toMatchObject({ revisionId: 'rev-v3' });
    expect(publish).toHaveBeenCalledWith(tx, 'space-1', candidate, { origin: 'web_editor' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.spaceKnowledgeRevision.create).not.toHaveBeenCalled();
  });

  it('blocks a first managed-image save before the Space writer can create a legacy revision', async () => {
    const body = '![[assets/missing.png]]\n';
    const candidate = {
      folders: [],
      pages: [{
        pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body,
        contentHash: await contentHash(body), updatedAt: '2026-09-04T00:00:00.000Z',
        referencedAttachmentIds: [],
      }],
      attachments: [],
    };
    const v3Writer = new SyncV3RevisionWriterService({} as any, {} as any);
    jest.spyOn(v3Writer as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'bootstrap_required',
      blockers: [{ pageId: 'page-1', code: 'ATTACHMENT_MISSING' }],
      candidate,
    });
    const writer = new SpaceRevisionWriterService({} as any, v3Writer);
    const create = jest.fn();
    const tx = {
      $executeRaw: jest.fn(),
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };

    await expect(writer.advanceLocked(
      tx as any,
      'space-1',
      [{ operation: 'upsert', pageId: 'page-1', path: 'pages/Page.md', title: 'Page', body }],
      { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_MISSING' });
    expect(create).not.toHaveBeenCalled();
  });

  it('fails closed instead of silently bootstrapping a managed-image Space for empty changes', async () => {
    const v3Writer = new SyncV3RevisionWriterService({} as any, {} as any);
    const publish = jest.spyOn(v3Writer, 'advanceV3Locked');
    jest.spyOn(v3Writer as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'bootstrap_required', blockers: [],
      candidate: { folders: [], pages: [], attachments: [] },
    });

    await expect(v3Writer.advanceCurrentIfRequiredLocked(
      {} as any,
      'space-1',
      [],
      { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps publishing an established native v3 Space when changes are empty', async () => {
    const candidate = { folders: [], pages: [], attachments: [] };
    const v3Writer = new SyncV3RevisionWriterService({} as any, {} as any);
    jest.spyOn(v3Writer as any, 'inspectLiveCurrentLocked').mockResolvedValue({
      mode: 'native_v3', blockers: [], candidate,
    });
    const publish = jest.spyOn(v3Writer, 'advanceV3Locked').mockResolvedValue({
      revisionId: 'rev-v3', sequence: 2, revisionContentHash: 'a'.repeat(64),
      pageCount: 0n, revisionManifestByteLength: 1n, revisionBodyBytes: 0n,
      attachmentCount: 0n, revisionAttachmentBytes: 0n, publishedAt: new Date(),
    });

    await expect(v3Writer.advanceCurrentIfRequiredLocked(
      {} as any,
      'space-1',
      [],
      { origin: 'web_editor' },
    )).resolves.toMatchObject({ revisionId: 'rev-v3' });
    expect(publish).toHaveBeenCalledWith({}, 'space-1', candidate, { origin: 'web_editor' });
  });

  it.each([
    ['future schema', 'content-tree@4', 'referenced-images-v1'],
    ['future recipe', 'content-tree@3', 'referenced-images-v2'],
    ['unknown legacy recipe', 'knowledge-bundle@1', 'referenced-images-v1'],
  ])('fails closed on a latest %s before creating a revision', async (_label, schemaVersion, recipeVersion) => {
    const create = jest.fn();
    const open = jest.fn();
    const body = '![[assets/photo.png]]\n';
    const tx = {
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'future-head', sequence: 9, schemaVersion, recipeVersion,
        }),
        create,
      },
      page: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new SyncV3RevisionWriterService({} as any, { open } as any);

    await expect(service.advanceV3Locked(
      tx as any,
      'space-1',
      {
        folders: [],
        pages: [{
          pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body,
          contentHash: await contentHash(body), updatedAt: '2026-09-04T00:00:00.000Z',
          referencedAttachmentIds: [attachmentId],
        }],
        attachments: [{
          attachmentId, path: 'assets/photo.png', mimeType: 'image/png', sizeBytes: '4',
          width: 1, height: 1, contentHash: 'b'.repeat(64),
          updatedAt: '2026-09-04T00:00:00.000Z',
        }],
      },
      { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('inspects multiple immutable Pages through one batch attachment resolution', async () => {
    const batch = jest.fn().mockResolvedValue([
      { attachmentIds: [], references: [], errors: [] },
      { attachmentIds: [], references: [], errors: [] },
    ]);
    const service = new SyncV3RevisionWriterService({
      resolveReferencedAttachmentsBatch: batch,
    } as any, {} as any);
    const tx = {
      spaceKnowledgeRevision: { findFirst: jest.fn()
        .mockResolvedValueOnce({
          id: 'rev-1', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'none',
        })
        .mockResolvedValueOnce(null) },
      syncRevisionFolderRow: { findMany: jest.fn().mockResolvedValue([]) },
      syncRevisionPageRow: { findMany: jest.fn().mockResolvedValue([
        { pageId: 'page-a', folderId: null, path: 'pages/A.md', pathKey: 'pages/a.md', title: 'A', contentHash: 'a'.repeat(64), updatedAt: new Date('2026-09-04T00:00:00Z'), content: { body: '# A\n' } },
        { pageId: 'page-b', folderId: null, path: 'pages/B.md', pathKey: 'pages/b.md', title: 'B', contentHash: 'b'.repeat(64), updatedAt: new Date('2026-09-04T00:00:00Z'), content: { body: '# B\n' } },
      ]) },
    };

    await expect(service.inspectCurrentLocked(tx as any, 'space-1'))
      .resolves.toMatchObject({ mode: 'legacy_v2' });
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('rejects an immutable version whose storage authority differs from the active Attachment', async () => {
    const { candidate, active, version, pageRow } = await attachmentAuthorityFixture();
    const storage = { open: jest.fn() };
    const create = jest.fn();
    const tx = {
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null), create },
      spaceAttachment: { findMany: jest.fn().mockResolvedValue([active]) },
      attachmentVersion: { findMany: jest.fn().mockResolvedValue([{
        ...version, storageKey: 'private/mismatched-key',
      }]) },
      page: { findMany: jest.fn().mockResolvedValue([pageRow]) },
    };
    const service = new SyncV3RevisionWriterService({} as any, storage as any);

    await expect(service.advanceV3Locked(
      tx as any, 'space-1', candidate, { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(storage.open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('maps an unreadable or deleted blob to a path-safe blocker before publication', async () => {
    const { candidate, active, version, pageRow } = await attachmentAuthorityFixture();
    const privateStorageKey = 'private/do-not-leak/content-key';
    const storageError = Object.assign(new Error(`ENOENT ${privateStorageKey}`), { code: 'ENOENT' });
    const storage = { open: jest.fn().mockRejectedValue(storageError) };
    const create = jest.fn();
    const tx = {
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null), create },
      spaceAttachment: { findMany: jest.fn().mockResolvedValue([{ ...active, storageKey: privateStorageKey }]) },
      attachmentVersion: { findMany: jest.fn().mockResolvedValue([{ ...version, storageKey: privateStorageKey }]) },
      page: { findMany: jest.fn().mockResolvedValue([pageRow]) },
    };
    const service = new SyncV3RevisionWriterService({} as any, storage as any);

    let caught: any;
    try {
      await service.advanceV3Locked(tx as any, 'space-1', candidate, { origin: 'web_editor' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ syncCode: 'ATTACHMENT_BLOB_MISSING' });
    expect(JSON.stringify(caught.getResponse())).not.toContain(privateStorageKey);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects active Attachment metadata drift before reading storage or publishing', async () => {
    const { candidate, active, version, pageRow } = await attachmentAuthorityFixture();
    const storage = { open: jest.fn() };
    const create = jest.fn();
    const tx = {
      spaceKnowledgeRevision: { findFirst: jest.fn().mockResolvedValue(null), create },
      spaceAttachment: { findMany: jest.fn().mockResolvedValue([{ ...active, width: 2 }]) },
      attachmentVersion: { findMany: jest.fn().mockResolvedValue([version]) },
      page: { findMany: jest.fn().mockResolvedValue([pageRow]) },
    };
    const service = new SyncV3RevisionWriterService({} as any, storage as any);

    await expect(service.advanceV3Locked(
      tx as any, 'space-1', candidate, { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_CONTENT_INVALID' });
    expect(storage.open).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('loads immutable attachment authority in one batch and never rewrites live rows', async () => {
    const body = '![[assets/a.png]]\n![[assets/b.png]]\n';
    const updatedAt = new Date('2026-09-04T00:00:00.000Z');
    const attachment = (suffix: string, hash: string) => ({
      attachmentId: `attachment-${suffix}`,
      path: `assets/${suffix}.png`,
      mimeType: 'image/png' as const,
      sizeBytes: '4',
      width: 1,
      height: 1,
      contentHash: hash,
      updatedAt: updatedAt.toISOString(),
    });
    const candidate = {
      folders: [],
      pages: [{
        pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body,
        contentHash: await contentHash(body), updatedAt: updatedAt.toISOString(),
        referencedAttachmentIds: ['attachment-a', 'attachment-b'],
      }],
      attachments: [attachment('a', 'a'.repeat(64)), attachment('b', 'b'.repeat(64))],
    };
    const active = candidate.attachments.map((item) => ({
      id: item.attachmentId,
      spaceId: 'space-1',
      displayName: item.path.slice('assets/'.length),
      nameKey: item.path.slice('assets/'.length),
      contentHash: item.contentHash,
      storageKey: `${item.attachmentId}/blob`,
      mimeType: item.mimeType,
      sizeBytes: BigInt(item.sizeBytes),
      width: item.width,
      height: item.height,
      status: 'active',
      updatedAt,
    }));
    const versions = active.map((item, index) => ({
      id: `version-${index}`,
      attachmentId: item.id,
      contentHash: item.contentHash,
      storageKey: item.storageKey,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      width: item.width,
      height: item.height,
    }));
    const findVersions = jest.fn().mockResolvedValue(versions);
    const findVersion = jest.fn(() => { throw new Error('N+1 version lookup'); });
    const createVersions = jest.fn();
    const updateAttachment = jest.fn(() => { throw new Error('live Attachment rewrite'); });
    const findPages = jest.fn(() => { throw new Error('live Page rewrite'); });
    const createAttachmentRows = jest.fn().mockResolvedValue({ count: 2 });
    const tx = {
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'revision-1', sequence: 1, createdAt: new Date('2026-09-04T01:00:00.000Z'),
        }),
      },
      spaceAttachment: { findMany: jest.fn().mockResolvedValue(active), update: updateAttachment },
      attachmentVersion: {
        findMany: findVersions,
        findUnique: findVersion,
        createMany: createVersions,
      },
      page: { findMany: findPages },
      syncPageContentRow: { createMany: jest.fn() },
      legacyPageBodyRow: { createMany: jest.fn() },
      syncRevisionPageRow: { createMany: jest.fn() },
      legacyRevisionPageExtra: { createMany: jest.fn() },
      syncRevisionAttachmentRow: { createMany: createAttachmentRows },
      syncRevisionTreeDeltaRow: { createMany: jest.fn() },
      legacyRevisionSidecar: { create: jest.fn() },
    };
    const storage = { open: jest.fn().mockResolvedValue({ destroy: jest.fn() }) };
    const service = new SyncV3RevisionWriterService({} as any, storage as any);

    await expect(service.advanceV3Locked(
      tx as any, 'space-1', candidate, { origin: 'web_editor' },
    )).resolves.toMatchObject({ attachmentCount: 2n });
    expect(findVersions).toHaveBeenCalledTimes(1);
    expect(findVersion).not.toHaveBeenCalled();
    expect(createVersions).not.toHaveBeenCalled();
    expect(updateAttachment).not.toHaveBeenCalled();
    expect(findPages).not.toHaveBeenCalled();
    expect(createAttachmentRows).toHaveBeenCalledTimes(1);
    expect(createAttachmentRows.mock.calls[0]?.[0].data).toHaveLength(2);
  });

  it('writes a large Page snapshot through bounded createMany batches', async () => {
    const pages = await Promise.all(Array.from({ length: 501 }, async (_, index) => {
      const body = `# Page ${index}\n`;
      return {
        pageId: `page-${index}`,
        folderId: null,
        path: `pages/Page-${index}.md`,
        title: `Page ${index}`,
        body,
        contentHash: await contentHash(body),
        updatedAt: '2026-09-04T00:00:00.000Z',
        referencedAttachmentIds: [],
      };
    }));
    const createContent = jest.fn();
    const createPageRows = jest.fn();
    const createExtras = jest.fn();
    const createDelta = jest.fn();
    const tx = {
      spaceKnowledgeRevision: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'revision-1', sequence: 1, createdAt: new Date('2026-09-04T01:00:00.000Z'),
        }),
      },
      syncPageContentRow: { createMany: createContent },
      legacyPageBodyRow: { createMany: jest.fn() },
      syncRevisionPageRow: { createMany: createPageRows },
      legacyRevisionPageExtra: { createMany: createExtras },
      syncRevisionTreeDeltaRow: { createMany: createDelta },
      legacyRevisionSidecar: { create: jest.fn() },
    };
    const service = new SyncV3RevisionWriterService({} as any, {} as any);

    await service.advanceV3Locked(
      tx as any,
      'space-1',
      { folders: [], pages, attachments: [] },
      { origin: 'web_editor' },
    );

    for (const writer of [createContent, createPageRows, createExtras, createDelta]) {
      expect(writer).toHaveBeenCalledTimes(2);
      expect(writer.mock.calls.every((call) => call[0].data.length <= 500)).toBe(true);
    }
  });
});

async function attachmentAuthorityFixture() {
  const body = '![[assets/photo.png]]\n';
  const hash = 'b'.repeat(64);
  const updatedAt = new Date('2026-09-04T00:00:00.000Z');
  const candidate = {
    folders: [],
    pages: [{
      pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body,
      contentHash: await contentHash(body), updatedAt: updatedAt.toISOString(),
      referencedAttachmentIds: ['attachment-1'],
    }],
    attachments: [{
      attachmentId: 'attachment-1', path: 'assets/photo.png', mimeType: 'image/png' as const,
      sizeBytes: '4', width: 1, height: 1, contentHash: hash,
      updatedAt: updatedAt.toISOString(),
    }],
  };
  const active = {
    id: 'attachment-1', spaceId: 'space-1', displayName: 'photo.png', nameKey: 'photo.png',
    contentHash: hash, storageKey: 'bb/content-key', mimeType: 'image/png', sizeBytes: 4n,
    width: 1, height: 1, status: 'active', updatedAt,
  };
  const version = {
    id: 'version-1', attachmentId: active.id, contentHash: hash,
    storageKey: active.storageKey, mimeType: active.mimeType, sizeBytes: active.sizeBytes,
    width: active.width, height: active.height,
  };
  const pageRow = {
    id: 'row-1', knowledgeKey: 'page-1', spaceId: 'space-1', title: 'Page', slug: 'page',
    content: body, format: 'markdown', parentId: null, folderId: null,
    syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md', authorId: 'user-1',
  };
  return { candidate, active, version, pageRow };
}

describe('Sync v3 candidate hard limits', () => {
  const attachment = {
    attachmentId: 'attachment-1', path: 'assets/image.png', mimeType: 'image/png' as const,
    sizeBytes: '1', width: 1, height: 1, contentHash: 'a'.repeat(64),
    updatedAt: '2026-09-04T00:00:00.000Z',
  };
  const page = {
    pageId: 'page-1', folderId: null, path: 'pages/Page.md', title: 'Page', body: '',
    contentHash: 'a'.repeat(64), updatedAt: '2026-09-04T00:00:00.000Z',
    referencedAttachmentIds: [],
  };

  it('accepts exactly 1,000 attachments and rejects 1,001 before iteration', () => {
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: [], attachments: Array(1_000).fill(attachment),
    })).not.toThrow();
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: [], attachments: Array(1_001).fill(attachment),
    })).toThrow(expect.objectContaining({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' }));
  });

  it('rejects an over-limit candidate before DB or Blob access', async () => {
    const findFirst = jest.fn();
    const open = jest.fn();
    const service = new SyncV3RevisionWriterService({} as any, { open } as any);

    await expect(service.advanceV3Locked(
      { spaceKnowledgeRevision: { findFirst } } as any,
      'space-1',
      { folders: [], pages: [], attachments: Array(1_001).fill(attachment) },
      { origin: 'web_editor' },
    )).rejects.toMatchObject({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' });
    expect(findFirst).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('accepts exactly 100 MiB of attachments and rejects one extra byte', () => {
    const tenMiB = { ...attachment, sizeBytes: String(10 * 1024 * 1024) };
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: [], attachments: Array(10).fill(tenMiB),
    })).not.toThrow();
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: [], attachments: [...Array(10).fill(tenMiB), attachment],
    })).toThrow(expect.objectContaining({ syncCode: 'ATTACHMENT_QUOTA_EXCEEDED' }));
  });

  it('bounds Page/Folder object count and total Page body bytes before per-Page work', () => {
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: Array(15_000).fill(page), attachments: [],
    })).not.toThrow();
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: Array(15_001).fill(page), attachments: [],
    })).toThrow(expect.objectContaining({ syncCode: 'ATTACHMENT_CONTENT_INVALID' }));
    expect(() => assertSyncV3CandidateHardLimits({
      folders: [], pages: [{ ...page, body: 'x'.repeat(2 * 1024 * 1024 + 1) }], attachments: [],
    })).toThrow(expect.objectContaining({ syncCode: 'ATTACHMENT_CONTENT_INVALID' }));
  });
});

const syncV3DatabaseUrl = safeSyncV3DatabaseUrl();
const dbIt = syncV3DatabaseUrl ? it : it.skip;

describe('SyncV3RevisionWriterService PostgreSQL integration', () => {
  dbIt('previews without writes, publishes one v3 head, reuses stable versions, and detaches without archiving', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: syncV3DatabaseUrl } } });
    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
    const storage = new LocalAttachmentStorage(syncV3StorageConfig(storageRoot));
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `user_${suffix}`;
    const spaceId = `space_${suffix}`;
    const pageId = `page_${suffix}`;
    const pageRowId = randomUUID();
    const attachmentVersionId = randomUUID();
    const initialBody = '![[assets/photo.png]]\n';
    const principal = { userId };

    try {
      const photoBlob = await publishSyncV3Blob(storage, Buffer.alloc(4, 0xb));
      await prisma.user.create({ data: { id: userId, email: `${suffix}@writer.sync-v3.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Sync v3 writer', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      const page = await prisma.page.create({ data: {
        id: pageRowId, knowledgeKey: pageId, title: 'Page', slug: `page-${suffix}`,
        content: initialBody, spaceId, authorId: userId,
        syncPath: 'pages/Page.md', syncPathKey: 'pages/page.md',
      } });
      const attachment = await prisma.spaceAttachment.create({ data: {
        spaceId, displayName: 'photo.png', nameKey: 'photo.png',
        contentHash: photoBlob.contentHash, storageKey: photoBlob.storageKey,
        mimeType: 'image/png', sizeBytes: 4n, width: 1, height: 1,
        uploadedByUserId: userId,
      } });
      const attachmentId = attachment.id;
      expect(attachmentId).toMatch(/^c/u);
      await prisma.attachmentVersion.create({ data: {
        id: attachmentVersionId, attachmentId, contentHash: attachment.contentHash,
        storageKey: attachment.storageKey, mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes, width: attachment.width, height: attachment.height,
      } });

      const legacyWriter = new SpaceRevisionWriterService(prisma as any, {
        advanceCurrentIfRequiredLocked: jest.fn().mockResolvedValue(null),
      } as any);
      await prisma.$transaction(async (tx) => legacyWriter.advance(tx, spaceId, [{
        operation: 'upsert', pageId, path: page.syncPath, title: page.title, body: page.content,
      }], { origin: 'web_editor', createdByUserId: userId }));

      const markdownResources = new MarkdownResourceService(
        prisma as any,
        new AuthorizationService(prisma as any),
      );
      const v3Writer = new SyncV3RevisionWriterService(markdownResources, storage);
      const bootstrap = new SyncV3BootstrapService(
        prisma as any,
        new AuthorizationService(prisma as any),
        legacyWriter,
        v3Writer,
      );
      const before = await prisma.spaceKnowledgeRevision.count({ where: { spaceId } });
      const preview = await bootstrap.previewBootstrap(spaceId, principal);
      expect(preview).toMatchObject({
        protocolVersion: '3', mode: 'bootstrap_required', baseRevision: expect.any(String),
        attachmentCount: '1', transferBytes: '4', blockers: [],
      });
      expect(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } })).toBe(before);

      const published = await bootstrap.bootstrapConfirmed(spaceId, principal, {
        baseRevision: preview.baseRevision,
        confirmationHash: preview.candidateHash,
      });
      expect(published).toMatchObject({ protocolVersion: '3', sequence: 2, attachmentCount: '1' });
      expect(() => TreeFinalizePushResponseV3Schema.parse(published)).not.toThrow();
      expect(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } })).toBe(before + 1);
      const publishedRevision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: published.revision },
        include: { attachmentRows: true },
      });
      expect(publishedRevision).toMatchObject({
        schemaVersion: 'content-tree@3', recipeVersion: 'referenced-images-v1',
        attachmentCount: 1n, revisionAttachmentBytes: 4n,
        origin: 'obsidian_sync', createdByUserId: userId,
      });
      expect(publishedRevision.attachmentRows).toEqual([
        expect.objectContaining({ attachmentId, attachmentVersionId }),
      ]);
      expect(await prisma.attachmentVersion.count({ where: { attachmentId } })).toBe(1);
      expect(await prisma.legacyRevisionSidecar.findUniqueOrThrow({
        where: { revisionId: published.revision }, select: { sidecar: true },
      })).toEqual({
        sidecar: expect.objectContaining({
          syncV3Revision: expect.objectContaining({
            protocolVersion: '3',
            manifestSchema: 'TreeRevisionContentManifestV3',
            pageAttachmentIds: [{ pageId, referencedAttachmentIds: [attachmentId] }],
          }),
        }),
      });

      const detachedAt = new Date('2026-09-04T01:00:00.000Z');
      const detachedBody = normalizeMarkdown('# Text only');
      const detachedCandidate = {
        folders: [],
        pages: [{
          pageId, folderId: null, path: page.syncPath, title: page.title,
          body: detachedBody, contentHash: await contentHash(detachedBody),
          updatedAt: detachedAt.toISOString(), referencedAttachmentIds: [],
        }],
        attachments: [],
      };
      const detached = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        const current = await tx.page.findUniqueOrThrow({ where: { id: pageRowId } });
        await tx.pageVersion.create({ data: {
          pageId: current.id,
          title: current.title,
          content: current.content,
          authorId: current.authorId,
          slug: current.slug,
          format: current.format,
          parentId: current.parentId,
          folderId: current.folderId,
          syncPath: current.syncPath,
          syncPathKey: current.syncPathKey,
        } });
        await tx.page.update({
          where: { id: pageRowId },
          data: {
            content: detachedBody,
            updatedAt: detachedAt,
            lastModifiedAt: detachedAt,
            lastModifiedByUserId: userId,
          },
        });
        return v3Writer.advanceV3Locked(
          locked,
          spaceId,
          detachedCandidate,
          { origin: 'web_editor', createdByUserId: userId },
        );
      });
      expect(detached.attachmentCount).toBe(0n);
      expect(await prisma.spaceAttachment.findUnique({
        where: { id: attachmentId }, select: { status: true, archivedAt: true },
      })).toEqual({ status: 'active', archivedAt: null });
      const detachedRevision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: detached.revisionId },
      });
      expect(detachedRevision.schemaVersion).toBe('content-tree@3');
      expect(detachedRevision.delta).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'detach_attachment', attachmentId }),
      ]));
      const nativeInspection = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.inspectCurrentLocked(locked, spaceId);
      });
      expect(nativeInspection.mode).toBe('native_v3');

      const stagedBlob = await publishSyncV3Blob(storage, Buffer.alloc(8, 0xc));
      const stagedAttachment = await prisma.spaceAttachment.create({ data: {
        spaceId, displayName: 'staged.png', nameKey: 'staged.png',
        contentHash: stagedBlob.contentHash, storageKey: stagedBlob.storageKey,
        mimeType: 'image/png', sizeBytes: 8n, width: 2, height: 1,
        uploadedByUserId: userId,
      } });
      const stagedBody = normalizeMarkdown('![[assets/staged.png]]');
      const stagedCandidate = {
        folders: [],
        pages: [{
          pageId, folderId: null, path: page.syncPath, title: 'Changed title',
          body: stagedBody, contentHash: await contentHash(stagedBody),
          updatedAt: '2026-09-04T02:00:00.000Z',
          referencedAttachmentIds: [stagedAttachment.id],
        }],
        attachments: [{
          attachmentId: stagedAttachment.id,
          path: 'assets/staged.png',
          mimeType: 'image/png' as const,
          sizeBytes: '8', width: 2, height: 1,
          contentHash: stagedAttachment.contentHash,
          updatedAt: stagedAttachment.updatedAt.toISOString(),
        }],
      };
      const stableHead = detached.revisionId;
      const stableRevisionCount = await prisma.spaceKnowledgeRevision.count({ where: { spaceId } });
      const stablePage = await prisma.page.findUniqueOrThrow({ where: { id: pageRowId } });
      const checkpoints = [
        ['attachmentVersion', 'createMany'],
        ['pageVersion', 'create'],
        ['syncRevisionAttachmentRow', 'createMany'],
        ['spaceKnowledgeRevision', 'create'],
      ] as const;
      for (const [delegate, method] of checkpoints) {
        await expect(prisma.$transaction(async (tx) => {
          const locked = await legacyWriter.lockSpace(tx, spaceId);
          const failing = failDelegate(locked, delegate, method);
          const current = await failing.page.findUniqueOrThrow({ where: { id: pageRowId } });
          await failing.pageVersion.create({ data: {
            pageId: current.id,
            title: current.title,
            content: current.content,
            authorId: current.authorId,
            slug: current.slug,
            format: current.format,
            parentId: current.parentId,
            folderId: current.folderId,
            syncPath: current.syncPath,
            syncPathKey: current.syncPathKey,
          } });
          await failing.page.update({
            where: { id: pageRowId },
            data: {
              title: 'Changed title',
              content: stagedBody,
              updatedAt: new Date('2026-09-04T02:00:00.000Z'),
              lastModifiedAt: new Date('2026-09-04T02:00:00.000Z'),
              lastModifiedByUserId: userId,
            },
          });
          return v3Writer.advanceV3Locked(
            failing,
            spaceId,
            stagedCandidate,
            { origin: 'obsidian_sync', createdByUserId: userId },
          );
        })).rejects.toThrow(`injected:${delegate}.${method}`);
        expect(await prisma.spaceKnowledgeRevision.count({ where: { spaceId } }))
          .toBe(stableRevisionCount);
        expect((await prisma.spaceKnowledgeRevision.findFirstOrThrow({
          where: { spaceId }, orderBy: { sequence: 'desc' }, select: { id: true },
        })).id).toBe(stableHead);
        expect(await prisma.page.findUniqueOrThrow({ where: { id: pageRowId } }))
          .toMatchObject({
            title: stablePage.title,
            content: stablePage.content,
            syncPath: stablePage.syncPath,
          });
        expect(await prisma.attachmentVersion.count({
          where: { attachmentId: stagedAttachment.id },
        })).toBe(0);
        expect(await prisma.syncRevisionAttachmentRow.count({
          where: { spaceId, attachmentId: stagedAttachment.id },
        })).toBe(0);
        expect(await prisma.spaceAttachment.findUniqueOrThrow({
          where: { id: stagedAttachment.id }, select: { status: true, archivedAt: true },
        })).toEqual({ status: 'active', archivedAt: null });
      }
    } finally {
      await prisma.syncRevisionAttachmentRow.deleteMany({ where: { spaceId } });
      await prisma.attachmentVersion.deleteMany({ where: { attachment: { spaceId } } });
      await prisma.space.deleteMany({ where: { id: spaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await storage.onModuleDestroy();
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 30_000);

  dbIt('PageService save creates exactly one first v3 head from the updated live Page', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: syncV3DatabaseUrl } } });
    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-attachment-test-'));
    const storage = new LocalAttachmentStorage(syncV3StorageConfig(storageRoot));
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `user_${suffix}`;
    const spaceId = `space_${suffix}`;
    const pageId = `page_${suffix}`;

    try {
      const blob = await publishSyncV3Blob(storage, Buffer.from('first-v3-image'));
      await prisma.user.create({ data: { id: userId, email: `${suffix}@page-save.sync-v3.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'First Page v3', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
      const page = await prisma.page.create({ data: {
        knowledgeKey: pageId,
        title: 'Page',
        slug: `page-${suffix}`,
        content: '# Before\n',
        spaceId,
        authorId: userId,
        syncPath: 'pages/Page.md',
        syncPathKey: 'pages/page.md',
      } });
      const attachment = await prisma.spaceAttachment.create({ data: {
        spaceId,
        displayName: 'photo.png',
        nameKey: 'photo.png',
        contentHash: blob.contentHash,
        storageKey: blob.storageKey,
        mimeType: 'image/png',
        sizeBytes: BigInt(Buffer.byteLength('first-v3-image')),
        width: 1,
        height: 1,
        uploadedByUserId: userId,
      } });
      const version = await prisma.attachmentVersion.create({ data: {
        attachmentId: attachment.id,
        contentHash: attachment.contentHash,
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
      } });
      const markdownResources = new MarkdownResourceService(
        prisma as any,
        new AuthorizationService(prisma as any),
      );
      const v3Writer = new SyncV3RevisionWriterService(markdownResources, storage);
      const writer = new SpaceRevisionWriterService(prisma as any, v3Writer);
      await prisma.$transaction((tx) => writer.advance(tx, spaceId, [{
        operation: 'upsert',
        pageId,
        path: page.syncPath,
        title: page.title,
        body: page.content,
      }], { origin: 'web_editor', createdByUserId: userId }));
      const legacyHead = await prisma.spaceKnowledgeRevision.findFirstOrThrow({
        where: { spaceId },
        orderBy: { sequence: 'desc' },
      });
      expect(legacyHead).toMatchObject({
        schemaVersion: 'knowledge-bundle@1',
        recipeVersion: 'none',
        parentRevisionId: null,
      });
      const beforeCount = await prisma.spaceKnowledgeRevision.count({ where: { spaceId } });
      expect(beforeCount).toBe(1);
      const search = { indexPage: jest.fn().mockResolvedValue(undefined) };
      const graph = { enqueue: jest.fn() };
      const syncPaths = new ReadableSyncPathService();
      const authorization = new AuthorizationService(prisma as any);
      const contentTree = new ContentTreeService(prisma as any, writer, syncPaths);
      const pages = new PageService(
        prisma as any,
        search as any,
        writer,
        syncPaths,
        graph as any,
        {} as any,
        authorization,
        contentTree,
      );
      const body = '# After\n\n![[assets/photo.png]]\n';

      await pages.update(page.id, {
        expectedUpdatedAt: page.updatedAt.toISOString(),
        content: body,
      }, { userId });

      const revisions = await prisma.spaceKnowledgeRevision.findMany({
        where: { spaceId },
        orderBy: { sequence: 'asc' },
      });
      expect(revisions).toHaveLength(beforeCount + 1);
      const head = revisions[revisions.length - 1]!;
      expect(head).toMatchObject({
        sequence: legacyHead.sequence + 1,
        parentRevisionId: legacyHead.id,
        schemaVersion: 'content-tree@3',
        recipeVersion: 'referenced-images-v1',
      });
      expect(head.delta).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'upsert_page', page: expect.objectContaining({ pageId }) }),
        expect.objectContaining({ operation: 'upsert_attachment', attachment: expect.objectContaining({ attachmentId: attachment.id }) }),
      ]));
      expect(await prisma.syncRevisionAttachmentRow.findMany({
        where: { revisionId: head.id },
      })).toEqual([
        expect.objectContaining({
          attachmentId: attachment.id,
          attachmentVersionId: version.id,
        }),
      ]);
      expect(search.indexPage).toHaveBeenCalledWith(page.id);
      expect(graph.enqueue).toHaveBeenCalledWith(spaceId);
    } finally {
      await prisma.syncRevisionAttachmentRow.deleteMany({ where: { spaceId } });
      await prisma.attachmentVersion.deleteMany({ where: { attachment: { spaceId } } });
      await prisma.space.deleteMany({ where: { id: spaceId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await storage.onModuleDestroy();
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

function syncV3StorageConfig(storagePath: string): AttachmentConfig {
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

async function publishSyncV3Blob(storage: LocalAttachmentStorage, bytes: Buffer) {
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

function safeSyncV3DatabaseUrl(): string | undefined {
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

function failDelegate<T extends object>(
  tx: T,
  delegateName: string,
  methodName: string,
): T {
  return new Proxy(tx, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== delegateName || !value || typeof value !== 'object') return value;
      return new Proxy(value, {
        get(delegate, method, delegateReceiver) {
          if (method === methodName) {
            return async () => { throw new Error(`injected:${delegateName}.${methodName}`); };
          }
          const member = Reflect.get(delegate, method, delegateReceiver);
          return typeof member === 'function' ? member.bind(delegate) : member;
        },
      });
    },
  });
}
