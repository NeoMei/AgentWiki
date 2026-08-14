import { PrismaClient } from '@prisma/client';
import {
  canonicalBytes,
  contentHash,
  idFileKey,
  normalizeMarkdown,
  normalizeSyncPath,
  pathKey,
  revisionContentHash,
  validatePortablePath,
} from '@neomei/agentwiki-sync-protocol';

const EMPTY_REVISION_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function databaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  return value;
}

async function legacyPageRowsFromSnapshot(snapshot, revisionId) {
  if (!snapshot || snapshot === null) return [];
  const pages = Array.isArray(snapshot.pages) ? snapshot.pages : [];
  return pages.map((page, ordinal) => ({
    revisionId,
    pageId: page.pageId,
    path: page.path,
    title: page.title,
    body: page.body ?? '',
    order: page.order ?? 0,
    metadata: page.metadata ?? null,
    artifactIds: page.artifactIds ?? [],
    legacyBodyHash: page.contentHash ?? '',
    ordinal,
    updatedAt: page.updatedAt ?? new Date(0).toISOString(),
  }));
}

async function deriveSyncPath(pageId, legacyPath, spaceId, occupiedKeys) {
  if (legacyPath && typeof legacyPath === 'string' && legacyPath.endsWith('.md')) {
    try {
      const validated = validatePortablePath(legacyPath).path;
      const key = pathKey(validated);
      if (!occupiedKeys.has(key)) {
        occupiedKeys.add(key);
        return { path: validated, key };
      }
    } catch {
      // fall through to deterministic fallback
    }
  }
  const fallback = `pages/p-${await idFileKey(pageId)}.md`;
  return { path: fallback, key: pathKey(fallback) };
}

async function normalizePageBody(body) {
  if (body.startsWith('\uFEFF')) {
    throw new Error('Page body begins with U+FEFF; refuse to silently strip');
  }
  return normalizeMarkdown(body);
}

async function backfillSpace(prisma, spaceId, batchId) {
  const revisions = await prisma.spaceKnowledgeRevision.findMany({
    where: { spaceId },
    orderBy: { sequence: 'asc' },
  });
  const occupiedKeys = new Set();

  for (const revision of revisions) {
    if (revision.migrationBatchId === batchId && revision.revisionContentHash) {
      continue; // already completed for this batch
    }
    const snapshot = revision.snapshot ?? null;
    const legacyPages = await legacyPageRowsFromSnapshot(snapshot, revision.id);
    const normalizedPages = [];
    for (const page of legacyPages) {
      const rawBody = page.body;
      const body = await normalizePageBody(rawBody);
      const hash = await contentHash(body);
      const { path, key } = await deriveSyncPath(page.pageId, page.path, spaceId, occupiedKeys);
      normalizedPages.push({
        pageId: page.pageId,
        path,
        pathKey: key,
        title: page.title,
        contentHash: hash,
        body,
        rawBody,
        updatedAt: page.updatedAt,
        ordinal: page.ordinal,
        extra: {
          spaceId,
          title: page.title,
          order: page.order,
          metadata: page.metadata,
          artifactIds: page.artifactIds,
          legacyBodyHash: page.legacyBodyHash,
          contentHash: page.legacyBodyHash,
          path: page.path,
          updatedAt: page.updatedAt,
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const page of normalizedPages) {
        await tx.syncPageContentRow.upsert({
          where: { contentHash: page.contentHash },
          create: { contentHash: page.contentHash, body: page.body, byteLength: new TextEncoder().encode(page.body).byteLength },
          update: {},
        });
        await tx.legacyPageBodyRow.upsert({
          where: { contentHash: page.extra.legacyBodyHash },
          create: { contentHash: page.extra.legacyBodyHash, body: page.rawBody },
          update: {},
        });
      }
      if (normalizedPages.length > 0) {
        await tx.syncRevisionPageRow.createMany({
          data: normalizedPages.map((p) => ({
            revisionId: revision.id, pageId: p.pageId, path: p.path, pathKey: p.pathKey,
            title: p.title, contentHash: p.contentHash, updatedAt: new Date(p.updatedAt),
          })),
          skipDuplicates: true,
        });
        await tx.legacyRevisionPageExtra.createMany({
          data: normalizedPages.map((p) => ({
            revisionId: revision.id, pageId: p.pageId, ordinal: p.ordinal,
            extra: p.extra, legacyBodyHash: p.extra.legacyBodyHash,
          })),
          skipDuplicates: true,
        });
        for (const p of normalizedPages) {
          await tx.page.updateMany({
            where: { knowledgeKey: p.pageId, spaceId, syncPath: null },
            data: { syncPath: p.path, syncPathKey: p.pathKey },
          });
        }
      }
      const sidecar = snapshot
        ? {
            schemaVersion: snapshot.schemaVersion,
            recipeVersion: snapshot.recipeVersion,
            baseRevision: snapshot.baseRevision,
            memories: snapshot.memories ?? [],
            relations: snapshot.relations ?? [],
            provenance: snapshot.provenance ?? [],
            deletions: snapshot.deletions ?? [],
          }
        : null;
      if (sidecar) {
        await tx.legacyRevisionSidecar.upsert({
          where: { revisionId: revision.id },
          create: { revisionId: revision.id, sidecar },
          update: { sidecar },
        });
      }
      const manifest = {
        protocolVersion: '1',
        spaceId,
        pages: normalizedPages
          .slice()
          .sort((a, b) => (a.pageId < b.pageId ? -1 : 1))
          .map((p) => ({ pageId: p.pageId, path: p.path, title: p.title, contentHash: p.contentHash })),
      };
      const revisionContentHash = normalizedPages.length === 0
        ? EMPTY_REVISION_HASH
        : await revisionContentHash(manifest);
      const manifestBytes = normalizedPages.length === 0 ? 0 : canonicalBytes(manifest).byteLength;
      const bodyBytes = normalizedPages.reduce((sum, p) => sum + new TextEncoder().encode(p.body).byteLength, 0);
      await tx.spaceKnowledgeRevision.update({
        where: { id: revision.id },
        data: {
          revisionContentHash,
          pageCount: BigInt(normalizedPages.length),
          revisionBodyBytes: BigInt(bodyBytes),
          revisionManifestByteLength: BigInt(manifestBytes),
          migrationBatchId: batchId,
          origin: revision.origin ?? 'migration',
        },
      });
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== '--apply') {
    throw new Error('Unknown argument; only --apply is supported');
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  try {
    const batchId = crypto.randomUUID();
    const spaces = await prisma.space.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const space of spaces) {
      await backfillSpace(prisma, space.id, batchId);
    }
    console.log(`Backfilled ${spaces.length} spaces with batch ${batchId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
