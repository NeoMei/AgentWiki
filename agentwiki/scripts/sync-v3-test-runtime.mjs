import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { SpaceRevisionWriterService } = requireFromServer('./dist/core/sync/space-revision-writer.service.js');
const { SyncV3RevisionWriterService } = requireFromServer('./dist/core/sync/sync-v3-revision-writer.service.js');
const { LocalAttachmentStorage } = requireFromServer('./dist/attachments/local-attachment.storage.js');
const { MarkdownResourceService } = requireFromServer('./dist/markdown-resources/markdown-resource.service.js');
const { SyncCapabilitiesService } = requireFromServer('./dist/integrations/obsidian/sync-capabilities.service.js');
const { SyncV2RevisionService } = requireFromServer('./dist/integrations/obsidian/sync-v2-revision.service.js');
const { SyncV3ImmutableRevisionService } = requireFromServer('./dist/integrations/obsidian/sync-v3-immutable-revision.service.js');

const DAY_MS = 24 * 60 * 60 * 1_000;

const defaultCursorCodec = {
  encode: (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
  decode: (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
};

export async function createSyncV3TestRuntime(prisma, label = 'database-gate') {
  const safeLabel = label.replace(/[^a-z0-9-]/giu, '-').slice(0, 48) || 'database-gate';
  const storageRoot = await mkdtemp(join(tmpdir(), `agentwiki-${safeLabel}-`));
  const storage = new LocalAttachmentStorage({
    storagePath: storageRoot,
    maxFileBytes: 10n * 1024n * 1024n,
    maxSpaceBytes: 500n * 1024n * 1024n,
    maxDimension: 10_000,
    maxPixels: 40_000_000n,
    minFreeBytes: 1n,
    retentionMs: 30 * DAY_MS,
    orphanGraceMs: DAY_MS,
    contentLockTimeoutMs: 5_000,
  });
  const authorization = new AuthorizationService(prisma);
  const markdown = new MarkdownResourceService(prisma, authorization);
  const v3Writer = new SyncV3RevisionWriterService(markdown, storage);
  const writer = new SpaceRevisionWriterService(prisma, v3Writer);
  const syncCapabilities = new SyncCapabilitiesService(prisma, v3Writer);
  const immutableV3 = new SyncV3ImmutableRevisionService();
  let disposed = false;

  return {
    storageRoot,
    storage,
    authorization,
    markdown,
    v3Writer,
    writer,
    syncCapabilities,
    immutableV3,
    createV2Reader(database = prisma, cursorCodec = defaultCursorCodec, capabilityProvider = undefined) {
      return new SyncV2RevisionService(
        database,
        cursorCodec,
        capabilityProvider ?? { capabilitiesV2: () => ({ maxResponseBytes: 4 * 1024 * 1024 }) },
        v3Writer,
        immutableV3,
      );
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await storage.onModuleDestroy?.();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
