import { randomUUID } from 'crypto';
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
import { SpaceRevisionWriterService } from './space-revision-writer.service';
import { SyncV3RevisionWriterService } from './sync-v3-revision-writer.service';

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
    const service = new SyncV3RevisionWriterService(markdownResources as any);

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
    const service = new SyncV3RevisionWriterService(markdownResources as any);
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
});

const syncV3DatabaseUrl = safeSyncV3DatabaseUrl();
const dbIt = syncV3DatabaseUrl ? it : it.skip;

describe('SyncV3RevisionWriterService PostgreSQL integration', () => {
  dbIt('previews without writes, publishes one v3 head, reuses stable versions, and detaches without archiving', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: syncV3DatabaseUrl } } });
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `user_${suffix}`;
    const spaceId = `space_${suffix}`;
    const pageId = `page_${suffix}`;
    const pageRowId = randomUUID();
    const attachmentVersionId = randomUUID();
    const initialBody = '![[assets/photo.png]]\n';
    const principal = { userId };

    try {
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
        contentHash: 'b'.repeat(64), storageKey: `bb/${'b'.repeat(64)}`,
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

      const legacyWriter = new SpaceRevisionWriterService(prisma as any);
      await prisma.$transaction(async (tx) => legacyWriter.advance(tx, spaceId, [{
        operation: 'upsert', pageId, path: page.syncPath, title: page.title, body: page.content,
      }], { origin: 'web_editor', createdByUserId: userId }));

      const markdownResources = new MarkdownResourceService(
        prisma as any,
        new AuthorizationService(prisma as any),
      );
      const v3Writer = new SyncV3RevisionWriterService(markdownResources);
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

      const stagedAttachment = await prisma.spaceAttachment.create({ data: {
        spaceId, displayName: 'staged.png', nameKey: 'staged.png',
        contentHash: 'c'.repeat(64), storageKey: `cc/${'c'.repeat(64)}`,
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
        ['attachmentVersion', 'create'],
        ['pageVersion', 'create'],
        ['syncRevisionAttachmentRow', 'createMany'],
        ['spaceKnowledgeRevision', 'create'],
      ] as const;
      for (const [delegate, method] of checkpoints) {
        await expect(prisma.$transaction(async (tx) => {
          const locked = await legacyWriter.lockSpace(tx, spaceId);
          return v3Writer.advanceV3Locked(
            failDelegate(locked, delegate, method),
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
    }
  }, 30_000);
});

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
