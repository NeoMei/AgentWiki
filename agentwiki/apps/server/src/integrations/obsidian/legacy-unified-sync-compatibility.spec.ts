import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  contentHash,
  revisionContentHash,
  treeRevisionContentHashV2,
} from '@neomei/agentwiki-sync-protocol';
import { AuthorizationService } from '../../core/authorization/authorization.service';
import { legacyBundleHash } from '../../core/sync/legacy-serializer';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';
import { SyncV3RevisionWriterService } from '../../core/sync/sync-v3-revision-writer.service';
import type { AttachmentConfig } from '../../attachments/attachment.config';
import { LocalAttachmentStorage } from '../../attachments/local-attachment.storage';
import { MarkdownResourceService } from '../../markdown-resources/markdown-resource.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncV2RevisionService } from './sync-v2-revision.service';
import { SyncV3ImmutableRevisionService } from './sync-v3-immutable-revision.service';
import { SyncV3RevisionService } from './sync-v3-revision.service';

const databaseUrl = safeDatabaseUrl();
const dbIt = databaseUrl ? it : it.skip;

describe('legacy unified-knowledge compatibility', () => {
  dbIt('discovers and upgrades a verified resumed flat migration without weakening unrelated Spaces', async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const storageRoot = await mkdtemp(join(tmpdir(), 'agentwiki-legacy-unified-'));
    const storage = new LocalAttachmentStorage(storageConfig(storageRoot));
    const suffix = randomUUID().replaceAll('-', '');
    const userId = `user_${suffix}`;
    const spaceId = `legacy_${suffix}`;
    const ordinarySpaceId = `ordinary_${suffix}`;
    const credentialFamilyId = randomUUID();
    const credentialId = randomUUID();
    const batchId = randomUUID();
    const earlyBatchId = randomUUID();
    const revisionIds = Array.from({ length: 5 }, (_, index) => `legacy_rev_${index + 1}_${suffix}`);
    const pageIds = Array.from({ length: 3 }, (_, index) => `legacy_page_${index + 1}_${suffix}`);
    const principal = {
      userId,
      credentialId,
      credentialFamilyId,
      deviceId: randomUUID(),
      vaultId: randomUUID(),
      status: 'active' as const,
      platformRole: 'user' as const,
    };

    try {
      await prisma.user.create({ data: { id: userId, email: `${suffix}@legacy-unified.test` } });
      await prisma.space.createMany({ data: [
        { id: spaceId, name: 'Migrated unified knowledge', slug: spaceId },
        { id: ordinarySpaceId, name: 'Ordinary empty Space', slug: ordinarySpaceId },
      ] });
      await prisma.spaceMember.createMany({ data: [
        { userId, spaceId, role: 'owner' },
        { userId, spaceId: ordinarySpaceId, role: 'viewer' },
      ] });
      await prisma.humanDeviceCredentialFamily.create({ data: {
        id: credentialFamilyId,
        userId,
        deviceId: principal.deviceId,
        vaultId: principal.vaultId,
      } });
      await prisma.humanDeviceCredential.create({ data: {
        id: credentialId,
        credentialFamilyId,
        userId,
        deviceId: principal.deviceId,
        vaultId: principal.vaultId,
        deviceName: 'Legacy unified compatibility fixture',
        credentialHash: `hash_${suffix}`,
        status: 'active',
        activatedAt: new Date(),
      } });

      for (const [index, pageId] of pageIds.entries()) {
        const body = `# Page ${index + 1}\n`;
        await prisma.page.create({ data: {
          knowledgeKey: pageId,
          title: `Page ${index + 1}`,
          slug: `page-${index + 1}-${suffix}`,
          content: body,
          spaceId,
          authorId: userId,
          syncPath: `pages/Page ${index + 1}.md`,
          syncPathKey: `pages/page ${index + 1}.md`,
        } });
      }

      for (const [revisionIndex, revisionId] of revisionIds.entries()) {
        const updatedAt = new Date(Date.UTC(2026, 7, 1, 0, revisionIndex));
        const pages = await Promise.all(pageIds.map(async (pageId, pageIndex) => {
          const body = `# Page ${pageIndex + 1}\n\nRevision ${revisionIndex + 1}\n`;
          const bodyHash = await contentHash(body);
          return {
            pageId,
            spaceId,
            path: `pages/Page ${pageIndex + 1}.md`,
            title: `Page ${pageIndex + 1}`,
            body,
            order: pageIndex,
            metadata: null,
            artifactIds: [],
            contentHash: bodyHash,
            updatedAt: updatedAt.toISOString(),
          };
        }));
        const baseRevision = revisionIndex === 0 ? '0' : revisionIds[revisionIndex - 1]!;
        const sidecar = {
          schemaVersion: 'knowledge-bundle@1',
          recipeVersion: 'unified-knowledge@1',
          baseRevision,
          memories: [],
          relations: [],
          provenance: [],
          deletions: [],
        };
        const legacyBundle = {
          ...sidecar,
          spaceId,
          pages,
        };
        const v1Manifest = {
          protocolVersion: '1' as const,
          spaceId,
          pages: pages.map(({ pageId: id, path, title, contentHash: hash }) => ({
            pageId: id,
            path,
            title,
            contentHash: hash,
          })),
        };
        await prisma.syncPageContentRow.createMany({
          data: pages.map((page) => ({
            contentHash: page.contentHash,
            body: page.body,
            byteLength: Buffer.byteLength(page.body, 'utf8'),
          })),
          skipDuplicates: true,
        });
        await prisma.legacyPageBodyRow.createMany({
          data: pages.map((page) => ({ contentHash: page.contentHash, body: page.body })),
          skipDuplicates: true,
        });
        await prisma.spaceKnowledgeRevision.create({ data: {
          id: revisionId,
          spaceId,
          sequence: revisionIndex + 1,
          parentRevisionId: null,
          schemaVersion: 'knowledge-bundle@1',
          recipeVersion: 'unified-knowledge@1',
          contentHash: legacyBundleHash(legacyBundle),
          snapshot: undefined,
          delta: undefined,
          revisionContentHash: await revisionContentHash(v1Manifest),
          pageCount: BigInt(pages.length),
          revisionBodyBytes: BigInt(pages.reduce(
            (total, page) => total + Buffer.byteLength(page.body, 'utf8'),
            0,
          )),
          revisionManifestByteLength: BigInt(canonicalBytes(v1Manifest).byteLength),
          attachmentCount: 0n,
          revisionAttachmentBytes: 0n,
          origin: 'migration',
          migrationBatchId: revisionIndex === 0
            ? earlyBatchId
            : `${batchId}:${revisionId}`,
          createdAt: updatedAt,
        } });
        await prisma.syncRevisionPageRow.createMany({ data: pages.map((page) => ({
          revisionId,
          pageId: page.pageId,
          folderId: null,
          path: page.path,
          pathKey: page.path.toLocaleLowerCase('en-US'),
          title: page.title,
          contentHash: page.contentHash,
          updatedAt,
        })) });
        await prisma.legacyRevisionPageExtra.createMany({ data: pages.map((page) => ({
          revisionId,
          pageId: page.pageId,
          ordinal: page.order,
          legacyBodyHash: page.contentHash,
          extra: {
            spaceId,
            title: page.title,
            order: page.order,
            metadata: null,
            artifactIds: [],
            legacyBodyHash: page.contentHash,
            contentHash: page.contentHash,
            path: page.path,
            updatedAt: page.updatedAt,
          },
        })) });
        await prisma.legacyRevisionSidecar.create({ data: { revisionId, sidecar } });
      }

      const markdown = new MarkdownResourceService(
        prisma as any,
        new AuthorizationService(prisma as any),
      );
      const v3Writer = new SyncV3RevisionWriterService(markdown, storage);
      const legacyWriter = new SpaceRevisionWriterService(prisma as any, v3Writer);
      const cursors = new SyncCursorService({ get: () => 'legacy-unified-test-pepper' } as any);
      const capabilities = new SyncCapabilitiesService(prisma as any, v3Writer);
      const immutableV3 = new SyncV3ImmutableRevisionService();
      const v2Reader = new SyncV2RevisionService(
        prisma as any,
        cursors,
        capabilities,
        v3Writer,
        immutableV3,
      );
      const v3Reader = new SyncV3RevisionService(
        prisma as any,
        cursors,
        capabilities,
        v3Writer,
      );

      const listed = await v3Reader.listSpaces(principal);
      expect(listed.spaces).toEqual(expect.arrayContaining([
        expect.objectContaining({
          spaceId,
          syncMode: 'legacy_v2',
          currentRevision: revisionIds[4],
          pageCount: '3',
        }),
        expect.objectContaining({
          spaceId: ordinarySpaceId,
          syncMode: 'legacy_v2',
          currentRevision: '0',
          pageCount: '0',
        }),
      ]));

      const pinnedBefore = await v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100);
      const pinnedManifest = canonicalTreeRevisionManifestV2({
        protocolVersion: '2',
        spaceId,
        folders: pinnedBefore.folders,
        pages: pinnedBefore.pages,
      });
      expect(pinnedBefore).toMatchObject({
        revision: revisionIds[4],
        sequence: 5,
        revisionContentHash: await treeRevisionContentHashV2(pinnedManifest),
        folderCount: '0',
        pageCount: '3',
      });
      expect(pinnedBefore.revisionManifestByteLength).toBe(
        String(canonicalBytes(pinnedManifest).byteLength),
      );

      const headSidecar = await prisma.legacyRevisionSidecar.findUniqueOrThrow({
        where: { revisionId: revisionIds[4] },
      });
      await prisma.legacyRevisionSidecar.update({
        where: { revisionId: revisionIds[4] },
        data: { sidecar: { ...(headSidecar.sidecar as object), baseRevision: 'wrong-parent' } },
      });
      await expect(v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.legacyRevisionSidecar.update({
        where: { revisionId: revisionIds[4] },
        data: { sidecar: headSidecar.sidecar as any },
      });

      const headRevision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: revisionIds[4] },
      });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: revisionIds[4] },
        data: { revisionContentHash: 'f'.repeat(64) },
      });
      await expect(v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: revisionIds[4] },
        data: { revisionContentHash: headRevision.revisionContentHash },
      });

      const headPage = await prisma.syncRevisionPageRow.findFirstOrThrow({
        where: { revisionId: revisionIds[4] },
        include: { content: true },
      });
      await prisma.syncPageContentRow.update({
        where: { contentHash: headPage.contentHash },
        data: { body: `${headPage.content.body}corrupt` },
      });
      await expect(v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.syncPageContentRow.update({
        where: { contentHash: headPage.contentHash },
        data: { body: headPage.content.body },
      });

      const legacyBody = await prisma.legacyPageBodyRow.findUniqueOrThrow({
        where: { contentHash: headPage.contentHash },
      });
      await prisma.legacyPageBodyRow.update({
        where: { contentHash: headPage.contentHash },
        data: { body: `${String(legacyBody.body)}corrupt` },
      });
      await expect(v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.legacyPageBodyRow.update({
        where: { contentHash: headPage.contentHash },
        data: { body: legacyBody.body as any },
      });

      const ancestor = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: revisionIds[3] },
      });
      for (const corruptBatch of [
        randomUUID(),
        `${randomUUID()}:${revisionIds[3]}`,
      ]) {
        await prisma.spaceKnowledgeRevision.update({
          where: { id: revisionIds[3] },
          data: { migrationBatchId: corruptBatch },
        });
        await expect(v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100))
          .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      }
      await prisma.spaceKnowledgeRevision.update({
        where: { id: revisionIds[3] },
        data: { migrationBatchId: ancestor.migrationBatchId },
      });

      for (const unsupported of [
        { schemaVersion: 'knowledge-bundle@2', recipeVersion: 'unified-knowledge@1' },
        { schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@2' },
      ]) {
        await prisma.spaceKnowledgeRevision.update({
          where: { id: revisionIds[4] },
          data: unsupported,
        });
        await expect(v3Reader.listSpaces(principal))
          .rejects.toMatchObject({ syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED' });
        await prisma.spaceKnowledgeRevision.update({
          where: { id: revisionIds[4] },
          data: {
            schemaVersion: headRevision.schemaVersion,
            recipeVersion: headRevision.recipeVersion,
          },
        });
      }

      const imageBytes = Buffer.from('legacy-unified-first-image');
      const blob = await publishBlob(storage, imageBytes);
      const attachment = await prisma.spaceAttachment.create({ data: {
        spaceId,
        displayName: 'photo.png',
        nameKey: 'photo.png',
        contentHash: blob.contentHash,
        storageKey: blob.storageKey,
        mimeType: 'image/png',
        sizeBytes: BigInt(imageBytes.length),
        width: 1,
        height: 1,
        uploadedByUserId: userId,
      } });
      await prisma.attachmentVersion.create({ data: {
        attachmentId: attachment.id,
        contentHash: attachment.contentHash,
        storageKey: attachment.storageKey,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height,
      } });
      const imageBody = '# First image\n\n![[assets/photo.png]]\n';
      await prisma.page.update({
        where: { knowledgeKey: pageIds[0] },
        data: { content: imageBody },
      });
      const firstV3 = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.advanceCurrentIfRequiredLocked(locked, spaceId, [{
          operation: 'upsert',
          pageId: pageIds[0]!,
          folderId: null,
          path: 'pages/Page 1.md',
          title: 'Page 1',
          body: imageBody,
        }], {
          origin: 'obsidian_sync',
          createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      expect(firstV3).toBeTruthy();
      const firstV3Revision = await prisma.spaceKnowledgeRevision.findUniqueOrThrow({
        where: { id: firstV3!.revisionId },
      });
      expect(firstV3Revision).toMatchObject({
        sequence: 6,
        parentRevisionId: revisionIds[4],
        schemaVersion: 'content-tree@3',
        recipeVersion: 'referenced-images-v1',
      });
      await expect(v3Reader.snapshot(principal, spaceId, firstV3!.revisionId, undefined, 100))
        .resolves.toMatchObject({
          revision: firstV3!.revisionId,
          pages: [expect.objectContaining({
            pageId: pageIds[0],
            referencedAttachmentIds: [attachment.id],
          }), expect.anything(), expect.anything()],
          attachments: [expect.objectContaining({ attachmentId: attachment.id })],
        });
      await expect(immutableV3.verifyMany(prisma as any, [{
        spaceId,
        revision: firstV3Revision,
      }])).resolves.toEqual(new Map([[spaceId, expect.objectContaining({
        revision: firstV3!.revisionId,
      })]]));

      const pinnedAfter = await v2Reader.snapshot(spaceId, revisionIds[4], undefined, 100);
      expect(pinnedAfter).toEqual(pinnedBefore);

      await prisma.spaceKnowledgeRevision.update({
        where: { id: revisionIds[4] },
        data: { recipeVersion: 'unknown-parent-recipe' },
      });
      await expect(v3Reader.snapshot(principal, spaceId, firstV3!.revisionId, undefined, 100))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: revisionIds[4] },
        data: { recipeVersion: headRevision.recipeVersion },
      });

      const secondInspection = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.inspectCurrentLocked(locked, spaceId);
      });
      const secondV3 = await prisma.$transaction(async (tx) => {
        const locked = await legacyWriter.lockSpace(tx, spaceId);
        return v3Writer.advanceV3Locked(locked, spaceId, secondInspection.candidate, {
          origin: 'obsidian_sync',
          createdByUserId: userId,
          humanDeviceCredentialId: credentialId,
        });
      });
      await prisma.spaceKnowledgeRevision.update({
        where: { id: secondV3.revisionId },
        data: {
          schemaVersion: 'knowledge-bundle@1',
          recipeVersion: 'unified-knowledge@1',
        },
      });
      await expect(v3Reader.listSpaces(principal))
        .rejects.toMatchObject({ syncCode: 'REVISION_GONE' });
    } finally {
      await prisma.syncRevisionAttachmentRow.deleteMany({ where: { spaceId } });
      await prisma.attachmentVersion.deleteMany({ where: { attachment: { spaceId } } });
      await prisma.space.deleteMany({ where: { id: { in: [spaceId, ordinarySpaceId] } } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
      await storage.onModuleDestroy();
      await rm(storageRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

function safeDatabaseUrl(): string | undefined {
  const explicit = process.env.SYNC_V3_TEST_DATABASE_URL;
  const runtime = process.env.DATABASE_URL;
  if (!explicit || explicit !== runtime) return undefined;
  try {
    const parsed = new URL(explicit);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && databaseName.toLowerCase().includes('test')
      ? explicit
      : undefined;
  } catch {
    return undefined;
  }
}

function storageConfig(storagePath: string): AttachmentConfig {
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

async function publishBlob(storage: LocalAttachmentStorage, bytes: Buffer) {
  const contentHashValue = createHash('sha256').update(bytes).digest('hex');
  const reservation = await storage.createReservedTempPath(BigInt(bytes.length), 1n);
  await writeFile(reservation.path, bytes, { mode: 0o600 });
  const published = await storage.withContentLock(contentHashValue, (lease) => storage.publish(
    reservation,
    contentHashValue,
    BigInt(bytes.length),
    lease,
  ));
  return { contentHash: contentHashValue, storageKey: published.storageKey };
}
