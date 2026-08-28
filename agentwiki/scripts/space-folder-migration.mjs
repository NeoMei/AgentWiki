import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  foldCase,
  pathKey,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
} from '../packages/sync-protocol/dist/esm/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const encoder = new TextEncoder();
const forbiddenFolderCharacter = /[\u0000-\u001f/\\:*?"<>|]/u;
const reservedDeviceName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu;
const pageForbiddenCharacter = /[\p{Cc}<>:"/\\|?*]/u;
const fallbackPageBasename = '未命名文章';
const maximumFolderNameCodePoints = 200;
const maximumFolderNameBytes = 255;
const maximumFoldersPerSpace = 10_000;
const maximumMutationNodes = 10_000;
const maximumFolderDepth = 32;
const maximumCollisionSuffix = 10_000;

const compareBytes = (left, right) => Buffer.compare(
  Buffer.from(left, 'utf8'),
  Buffer.from(right, 'utf8'),
);

const sortById = (left, right) => compareBytes(left.id, right.id);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function truncatePortableSegment(value, maximumBytes, maximumCodePoints) {
  let result = '';
  let bytes = 0;
  let codePoints = 0;
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bytes + characterBytes > maximumBytes || codePoints + 1 > maximumCodePoints) break;
    result += character;
    bytes += characterBytes;
    codePoints += 1;
  }
  return result;
}

function portableFolderNameWithSuffix(base, suffix) {
  const maximumBaseBytes = maximumFolderNameBytes - encoder.encode(suffix).byteLength;
  const maximumBaseCodePoints = maximumFolderNameCodePoints - Array.from(suffix).length;
  const fitted = truncatePortableSegment(base, maximumBaseBytes, maximumBaseCodePoints)
    .replace(/[ .]+$/u, '');
  if (!fitted) return `untitled${suffix}`;
  return `${fitted}${suffix}`;
}

function reservedSafeName(value) {
  const dot = value.indexOf('.');
  const basename = dot < 0 ? value : value.slice(0, dot);
  if (!reservedDeviceName.test(basename)) return value;
  return dot < 0
    ? `${value}-folder`
    : `${basename}-folder${value.slice(dot)}`;
}

export function sanitizeLegacyFolderName(input) {
  const reasons = [];
  const original = String(input ?? '');
  let value = original.normalize('NFC');
  if (value !== original) reasons.push('nfc');
  const trimmed = value.trim();
  if (trimmed !== value) reasons.push('trim');
  value = trimmed;

  let replaced = '';
  let changedForbidden = false;
  let replacingForbiddenRun = false;
  for (const character of value) {
    if (forbiddenFolderCharacter.test(character)) {
      if (!replacingForbiddenRun) replaced += ' ';
      changedForbidden = true;
      replacingForbiddenRun = true;
    } else {
      replaced += character;
      replacingForbiddenRun = false;
    }
  }
  if (changedForbidden) reasons.push('forbidden-characters');
  const collapsed = replaced.replace(/\s+/gu, ' ').trim();
  if (collapsed !== replaced) reasons.push('collapse-whitespace');
  value = collapsed;
  const portableEnding = value.replace(/[ .]+$/u, '');
  if (portableEnding !== value) reasons.push('trailing-dot-or-space');
  value = portableEnding;

  if (!value) {
    value = 'untitled-folder';
    reasons.push('empty-fallback');
  }
  const reservedSafe = reservedSafeName(value);
  if (reservedSafe !== value) {
    value = reservedSafe;
    reasons.push('reserved-name');
  }

  if (
    encoder.encode(value).byteLength > maximumFolderNameBytes
    || Array.from(value).length > maximumFolderNameCodePoints
  ) {
    const suffix = `-${sha256(value).slice(0, 8)}`;
    value = portableFolderNameWithSuffix(value, suffix);
    reasons.push('truncate-with-hash');
  }

  try {
    validatePortableDirectoryPath(`pages/${value}`);
  } catch (error) {
    throw new TypeError(`Legacy Folder title cannot be sanitized portably: ${error.message}`);
  }
  return {
    name: value,
    transformed: reasons.length > 0,
    reasons,
  };
}

function safePageBasename(title) {
  let sanitized = '';
  for (const character of String(title ?? '').normalize('NFC')) {
    sanitized += pageForbiddenCharacter.test(character) ? ' ' : character;
  }
  sanitized = sanitized.replace(/\s+/gu, ' ').trim().replace(/[ .]+$/u, '');
  if (!sanitized || reservedDeviceName.test(sanitized.split('.', 1)[0] ?? '')) {
    sanitized = fallbackPageBasename;
  }
  return truncatePortableSegment(sanitized, 255 - encoder.encode(' (2).md').byteLength, 500);
}

export function legacyFolderId(spaceId, sourcePageId) {
  return `legacy-folder-${sha256(`${spaceId}\0${sourcePageId}`).slice(0, 32)}`;
}

function migrationBatchKey(spaceId) {
  return `space-folders-v1:${spaceId}`;
}

function normalizeInputHash(snapshot) {
  const fieldsForPage = (page) => ({
    id: page.id,
    knowledgeKey: page.knowledgeKey,
    spaceId: page.spaceId,
    title: page.title,
    slug: page.slug,
    contentHash: sha256(page.content ?? ''),
    format: page.format,
    authorId: page.authorId,
    parentId: page.parentId,
    folderId: page.folderId,
    syncPath: page.syncPath,
    syncPathKey: page.syncPathKey,
    sortOrder: page.sortOrder,
    createdAt: iso(page.createdAt),
    updatedAt: iso(page.updatedAt),
    deletedAt: iso(page.deletedAt),
  });
  const canonical = {
    version: 1,
    spaceId: snapshot.spaceId,
    contentTreeRevision: String(snapshot.contentTreeRevision),
    pages: [...snapshot.pages].sort(sortById).map(fieldsForPage),
    pageVersions: [...snapshot.pageVersions].sort(sortById).map((version) => ({
      id: version.id,
      pageId: version.pageId,
      parentId: version.parentId,
      folderId: version.folderId,
      title: version.title,
      contentHash: sha256(version.content ?? ''),
      authorId: version.authorId,
      createdAt: iso(version.createdAt),
    })),
    folders: [...snapshot.folders].sort(sortById).map((folder) => ({
      id: folder.id,
      spaceId: folder.spaceId,
      parentId: folder.parentId,
      name: folder.name,
      nameKey: folder.nameKey,
      path: folder.path,
      pathKey: folder.pathKey,
      deletedAt: iso(folder.deletedAt),
    })),
  };
  return sha256(JSON.stringify(canonical));
}

export class SpaceFolderMigrationPreflightError extends Error {
  constructor(report) {
    super(`Space Folder migration preflight failed: ${report.rejections.map((entry) => entry.code).join(', ')}`);
    this.name = 'SpaceFolderMigrationPreflightError';
    this.report = report;
  }
}

function reject(rejections, code, message, details = {}) {
  rejections.push({ code, message, ...details });
}

function graphDepth(id, rowsById, parentFor, rejections, codes, visiting = new Set(), memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  if (visiting.has(id)) {
    reject(rejections, codes.cycle, `Cycle detected at ${id}`, { id });
    return Number.POSITIVE_INFINITY;
  }
  const row = rowsById.get(id);
  if (!row) return 0;
  const parentId = parentFor(row);
  if (!parentId) {
    memo.set(id, 1);
    return 1;
  }
  visiting.add(id);
  const depth = graphDepth(parentId, rowsById, parentFor, rejections, codes, visiting, memo) + 1;
  visiting.delete(id);
  memo.set(id, depth);
  return depth;
}

function validateExistingFolders(snapshot, activeFolders, allFoldersById, rejections) {
  const activeById = new Map(activeFolders.map((folder) => [folder.id, folder]));
  const depths = new Map();
  for (const folder of activeFolders) {
    if (folder.spaceId !== snapshot.spaceId) {
      reject(rejections, 'FOLDER_CROSS_SPACE', 'Folder belongs to another Space', { folderId: folder.id });
      continue;
    }
    if (folder.parentId) {
      const parent = allFoldersById.get(folder.parentId);
      if (!parent) {
        reject(rejections, 'FOLDER_ORPHAN', 'Folder parent does not exist', {
          folderId: folder.id, parentId: folder.parentId,
        });
      } else if (parent.spaceId !== snapshot.spaceId) {
        reject(rejections, 'FOLDER_CROSS_SPACE', 'Folder parent belongs to another Space', {
          folderId: folder.id, parentId: folder.parentId,
        });
      } else if (parent.deletedAt !== null) {
        reject(rejections, 'FOLDER_ORPHAN', 'Active Folder parent is deleted', {
          folderId: folder.id, parentId: folder.parentId,
        });
      }
    }
  }
  for (const folder of activeFolders) {
    const depth = graphDepth(
      folder.id,
      activeById,
      (entry) => entry.parentId,
      rejections,
      { cycle: 'FOLDER_CYCLE' },
      new Set(),
      depths,
    );
    if (depth > maximumFolderDepth) {
      reject(rejections, 'FOLDER_DEPTH_LIMIT', 'Existing Folder tree exceeds 32 levels', {
        folderId: folder.id, depth,
      });
    }
    try {
      const portable = validatePortableDirectoryPath(folder.path);
      const expectedPath = folder.parentId
        ? `${activeById.get(folder.parentId)?.path ?? ''}/${folder.name}`
        : `pages/${folder.name}`;
      if (
        portable.path !== expectedPath.normalize('NFC')
        || portable.key !== folder.pathKey
        || foldCase(folder.name.normalize('NFC')) !== folder.nameKey
      ) {
        reject(rejections, 'FOLDER_PATH_INVALID', 'Existing Folder path cache is inconsistent', {
          folderId: folder.id,
        });
      }
    } catch (error) {
      reject(rejections, 'FOLDER_PATH_INVALID', error.message, { folderId: folder.id });
    }
  }
  return { activeById, depths };
}

function allocatePagePath(page, directory, occupied) {
  const oldName = String(page.syncPath).slice(String(page.syncPath).lastIndexOf('/') + 1);
  let basename;
  if (oldName.toLowerCase().endsWith('.md')) {
    basename = oldName.slice(0, -3).normalize('NFC');
  } else {
    basename = safePageBasename(page.title);
  }
  for (let suffixNumber = 1; suffixNumber <= maximumCollisionSuffix; suffixNumber += 1) {
    const suffix = suffixNumber === 1 ? '' : ` (${suffixNumber})`;
    const ending = `${suffix}.md`;
    const directoryPrefix = `${directory}/`;
    const fitted = truncatePortableSegment(
      basename,
      Math.min(
        255 - encoder.encode(ending).byteLength,
        1024 - encoder.encode(directoryPrefix).byteLength - encoder.encode(ending).byteLength,
      ),
      500 - Array.from(suffix).length,
    ).replace(/[ .]+$/u, '');
    if (!fitted) break;
    try {
      const portable = validatePortableMarkdownPath(`${directoryPrefix}${fitted}${ending}`);
      if (!occupied.has(portable.key)) {
        occupied.add(portable.key);
        return { syncPath: portable.path, syncPathKey: portable.key };
      }
    } catch (error) {
      if (error instanceof RangeError) break;
      basename = safePageBasename(page.title);
    }
  }
  return null;
}

export function buildSpaceFolderMigrationPlan(snapshot) {
  const batchKey = migrationBatchKey(snapshot.spaceId);
  if (snapshot.completedBatch) {
    return {
      version: 1,
      status: 'completed',
      spaceId: snapshot.spaceId,
      batchKey,
      revisionId: snapshot.completedBatch.revisionId,
      inputHash: snapshot.completedBatch.inputHash ?? null,
      counts: {
        activePages: 0, deletedPagesSkipped: 0, existingActiveFolders: 0,
        foldersToCreate: 0, pagesMoved: 0, aliasesToCreate: 0,
        pageVersionsToBackfill: 0, affectedNodes: 0,
      },
      transformations: [], collisions: [], rejections: [], folders: [], pages: [],
      aliases: [], pageVersionBackfills: [],
    };
  }

  const rejections = [];
  const transformations = [];
  const collisions = [];
  const targetPages = [...snapshot.pages];
  const activePages = targetPages.filter((page) => page.deletedAt === null).sort(sortById);
  const deletedPages = targetPages.filter((page) => page.deletedAt !== null);
  const targetPageIds = new Set(targetPages.map((page) => page.id));
  const allPagesById = new Map(
    [...targetPages, ...(snapshot.referencedPages ?? [])].map((page) => [page.id, page]),
  );
  const activePagesById = new Map(activePages.map((page) => [page.id, page]));
  const activeFolders = snapshot.folders.filter((folder) => folder.deletedAt === null).sort(sortById);
  const allFoldersById = new Map(
    [...snapshot.folders, ...(snapshot.referencedFolders ?? [])].map((folder) => [folder.id, folder]),
  );
  const { activeById: activeFoldersById, depths: existingFolderDepths } = validateExistingFolders(
    snapshot, activeFolders, allFoldersById, rejections,
  );

  const validateParent = (ownerType, ownerId, parentId) => {
    if (!parentId) return null;
    const parent = allPagesById.get(parentId);
    if (!parent) {
      reject(rejections, 'LEGACY_PAGE_ORPHAN', `${ownerType} parent Page does not exist`, {
        ownerId, parentId,
      });
      return null;
    }
    if (parent.spaceId !== snapshot.spaceId) {
      reject(rejections, 'LEGACY_PAGE_CROSS_SPACE', `${ownerType} parent Page belongs to another Space`, {
        ownerId, parentId,
      });
      return null;
    }
    if (parent.deletedAt !== null) {
      reject(rejections, 'LEGACY_PAGE_ORPHAN', `${ownerType} parent Page is deleted`, {
        ownerId, parentId,
      });
      return null;
    }
    return parent;
  };

  const requiredFolderSourceIds = new Set();
  for (const page of activePages) {
    if (page.parentId) {
      const parent = validateParent('Page', page.id, page.parentId);
      if (parent) requiredFolderSourceIds.add(parent.id);
    }
    if (page.folderId) {
      const folder = allFoldersById.get(page.folderId);
      if (!folder || folder.spaceId !== snapshot.spaceId || folder.deletedAt !== null) {
        reject(rejections, 'PAGE_FOLDER_INVALID', 'Page references a missing, deleted, or cross-Space Folder', {
          pageId: page.id, folderId: page.folderId,
        });
      }
    }
  }
  const versions = snapshot.pageVersions.filter((entry) => targetPageIds.has(entry.pageId)).sort(sortById);
  for (const version of versions) {
    if (!version.parentId) continue;
    const parent = validateParent('PageVersion', version.id, version.parentId);
    if (parent) requiredFolderSourceIds.add(parent.id);
  }

  const currentPageDepths = new Map();
  for (const page of activePages) {
    graphDepth(
      page.id,
      activePagesById,
      (entry) => entry.parentId,
      rejections,
      { cycle: 'LEGACY_PAGE_CYCLE' },
      new Set(),
      currentPageDepths,
    );
  }

  const requiredSources = [...requiredFolderSourceIds]
    .map((id) => activePagesById.get(id))
    .filter(Boolean);
  const sourcePlacementDepth = (page) => {
    if (page.parentId) return currentPageDepths.get(page.id) ?? Number.POSITIVE_INFINITY;
    if (page.folderId) return (existingFolderDepths.get(page.folderId) ?? Number.POSITIVE_INFINITY) + 1;
    return 1;
  };
  requiredSources.sort((left, right) => (
    sourcePlacementDepth(left) - sourcePlacementDepth(right) || sortById(left, right)
  ));

  const occupiedNames = new Map();
  for (const folder of activeFolders) {
    const key = folder.parentId ?? '';
    if (!occupiedNames.has(key)) occupiedNames.set(key, new Set());
    occupiedNames.get(key).add(folder.nameKey);
  }
  const plannedFolders = [];
  const plannedFoldersBySource = new Map();
  for (const sourcePage of requiredSources) {
    const parentId = sourcePage.parentId
      ? legacyFolderId(snapshot.spaceId, sourcePage.parentId)
      : sourcePage.folderId ?? null;
    if (parentId && !activeFoldersById.has(parentId) && !plannedFolders.some((entry) => entry.id === parentId)) {
      reject(rejections, 'LEGACY_FOLDER_PARENT_UNRESOLVED', 'Companion Folder parent cannot be resolved', {
        sourcePageId: sourcePage.id, parentId,
      });
      continue;
    }
    const sanitized = sanitizeLegacyFolderName(sourcePage.title);
    if (sanitized.transformed) {
      transformations.push({
        sourcePageId: sourcePage.id,
        originalTitle: sourcePage.title,
        sanitizedName: sanitized.name,
        reasons: sanitized.reasons,
      });
    }
    const siblingKey = parentId ?? '';
    if (!occupiedNames.has(siblingKey)) occupiedNames.set(siblingKey, new Set());
    const siblingNames = occupiedNames.get(siblingKey);
    let name;
    for (let suffix = 1; suffix <= maximumCollisionSuffix; suffix += 1) {
      const candidate = suffix === 1
        ? sanitized.name
        : portableFolderNameWithSuffix(sanitized.name, ` (${suffix})`);
      if (!siblingNames.has(foldCase(candidate))) {
        name = candidate;
        if (suffix > 1) {
          collisions.push({
            sourcePageId: sourcePage.id,
            parentId,
            requestedName: sanitized.name,
            allocatedName: candidate,
          });
        }
        break;
      }
    }
    if (!name) {
      reject(rejections, 'FOLDER_NAME_CONFLICT', 'No deterministic sibling Folder name remains', {
        sourcePageId: sourcePage.id, parentId,
      });
      continue;
    }
    siblingNames.add(foldCase(name));
    const parentPath = parentId
      ? activeFoldersById.get(parentId)?.path
        ?? plannedFolders.find((entry) => entry.id === parentId)?.path
      : 'pages';
    const candidatePath = `${parentPath}/${name}`;
    let portable;
    try {
      portable = validatePortableDirectoryPath(candidatePath);
    } catch (error) {
      reject(rejections, 'FOLDER_PATH_TOO_LONG', error.message, { sourcePageId: sourcePage.id });
      continue;
    }
    const parentDepth = parentId
      ? existingFolderDepths.get(parentId)
        ?? plannedFolders.find((entry) => entry.id === parentId)?.depth
      : 0;
    const depth = parentDepth + 1;
    if (depth > maximumFolderDepth) {
      reject(rejections, 'FOLDER_DEPTH_LIMIT', 'Legacy translation exceeds 32 Folder levels', {
        sourcePageId: sourcePage.id, depth,
      });
    }
    const id = legacyFolderId(snapshot.spaceId, sourcePage.id);
    if (allFoldersById.has(id)) {
      reject(rejections, 'MIGRATION_FOLDER_ID_CONFLICT', 'Deterministic migration Folder ID already exists without a completed batch', {
        sourcePageId: sourcePage.id, folderId: id,
      });
    }
    const folder = {
      id,
      sourcePageId: sourcePage.id,
      spaceId: snapshot.spaceId,
      parentId,
      name,
      nameKey: foldCase(name),
      path: portable.path,
      pathKey: portable.key,
      sortOrder: sourcePage.sortOrder ?? 0,
      createdByUserId: sourcePage.authorId ?? null,
      createdByAgentId: sourcePage.createdByAgentId ?? null,
      lastModifiedByUserId: sourcePage.lastModifiedByUserId ?? sourcePage.authorId ?? null,
      lastModifiedByAgentId: sourcePage.lastModifiedByAgentId ?? null,
      lastModifiedAt: sourcePage.lastModifiedAt ?? sourcePage.updatedAt,
      createdAt: sourcePage.createdAt,
      updatedAt: sourcePage.updatedAt,
      depth,
    };
    plannedFolders.push(folder);
    plannedFoldersBySource.set(sourcePage.id, folder);
  }

  if (activeFolders.length + plannedFolders.length > maximumFoldersPerSpace) {
    reject(rejections, 'FOLDER_COUNT_LIMIT', 'Migration would exceed 10,000 active Folders', {
      existing: activeFolders.length, planned: plannedFolders.length,
    });
  }

  const movedPageIds = new Set();
  const provisionalPages = activePages.map((page) => {
    try {
      const currentPath = validatePortableMarkdownPath(page.syncPath);
      if (!currentPath.path.startsWith('pages/') || currentPath.key !== page.syncPathKey) {
        reject(rejections, 'PAGE_PATH_INVALID', 'Page path is outside pages/ or its key is inconsistent', {
          pageId: page.id,
        });
      }
    } catch (error) {
      reject(rejections, 'PAGE_PATH_INVALID', error.message, { pageId: page.id });
    }
    const desiredFolderId = page.parentId
      ? plannedFoldersBySource.get(page.parentId)?.id ?? legacyFolderId(snapshot.spaceId, page.parentId)
      : page.folderId ?? null;
    if (page.parentId && page.folderId && page.folderId !== desiredFolderId) {
      reject(rejections, 'PAGE_FOLDER_CONFLICT', 'Legacy Page has a conflicting pre-existing Folder placement', {
        pageId: page.id, folderId: page.folderId, expectedFolderId: desiredFolderId,
      });
    }
    const desiredDirectory = desiredFolderId
      ? plannedFolders.find((folder) => folder.id === desiredFolderId)?.path
        ?? activeFoldersById.get(desiredFolderId)?.path
      : 'pages';
    if (!desiredDirectory) {
      reject(rejections, 'PAGE_FOLDER_INVALID', 'Page destination Folder path is unresolved', {
        pageId: page.id, folderId: desiredFolderId,
      });
    }
    const currentDirectory = String(page.syncPath).slice(0, String(page.syncPath).lastIndexOf('/'));
    const needsMove = page.folderId !== desiredFolderId || currentDirectory !== desiredDirectory;
    if (needsMove) movedPageIds.add(page.id);
    return { page, desiredFolderId, desiredDirectory, needsMove };
  });

  const occupiedPagePathKeys = new Set(
    targetPages.filter((page) => !movedPageIds.has(page.id)).map((page) => page.syncPathKey),
  );
  const plannedPages = [];
  for (const provisional of provisionalPages.sort((left, right) => sortById(left.page, right.page))) {
    const { page, desiredFolderId, desiredDirectory, needsMove } = provisional;
    let allocated = { syncPath: page.syncPath, syncPathKey: page.syncPathKey };
    if (needsMove) {
      allocated = desiredDirectory
        ? allocatePagePath(page, desiredDirectory, occupiedPagePathKeys)
        : null;
      if (!allocated) {
        reject(rejections, 'FOLDER_PATH_TOO_LONG', 'No portable Page path fits the destination Folder', {
          pageId: page.id,
        });
        allocated = { syncPath: page.syncPath, syncPathKey: page.syncPathKey };
      }
    }
    plannedPages.push({
      ...page,
      folderId: desiredFolderId,
      oldFolderId: page.folderId,
      oldSyncPath: page.syncPath,
      oldSyncPathKey: page.syncPathKey,
      syncPath: allocated.syncPath,
      syncPathKey: allocated.syncPathKey,
      needsMove,
    });
  }

  const aliases = plannedPages
    .filter((page) => page.syncPath !== page.oldSyncPath)
    .map((page) => ({
      pageId: page.id,
      spaceId: snapshot.spaceId,
      path: page.oldSyncPath,
      pathKey: pathKey(page.oldSyncPath),
    }));

  const pageVersionBackfills = [];
  for (const version of versions) {
    if (!version.parentId) continue;
    const expectedFolderId = plannedFoldersBySource.get(version.parentId)?.id
      ?? legacyFolderId(snapshot.spaceId, version.parentId);
    if (version.folderId === null || version.folderId === undefined) {
      pageVersionBackfills.push({ versionId: version.id, folderId: expectedFolderId });
    } else if (version.folderId !== expectedFolderId) {
      reject(rejections, 'PAGE_VERSION_FOLDER_CONFLICT', 'Historical PageVersion Folder placement conflicts with legacy parent', {
        versionId: version.id,
        folderId: version.folderId,
        expectedFolderId,
      });
    }
  }

  const pagesMoved = plannedPages.filter((page) => page.needsMove).length;
  const affectedNodes = plannedFolders.length + pagesMoved;
  if (affectedNodes > maximumMutationNodes) {
    reject(rejections, 'FOLDER_MUTATION_LIMIT', 'Migration would affect more than 10,000 Folder/Page nodes', {
      affectedNodes,
    });
  }

  const inputHash = normalizeInputHash(snapshot);
  const report = {
    version: 1,
    status: rejections.length === 0 ? 'ready' : 'rejected',
    spaceId: snapshot.spaceId,
    batchKey,
    revisionId: null,
    inputHash,
    counts: {
      activePages: activePages.length,
      deletedPagesSkipped: deletedPages.length,
      existingActiveFolders: activeFolders.length,
      foldersToCreate: plannedFolders.length,
      pagesMoved,
      aliasesToCreate: aliases.length,
      pageVersionsToBackfill: pageVersionBackfills.length,
      affectedNodes,
    },
    transformations,
    collisions,
    rejections,
    folders: plannedFolders,
    pages: plannedPages,
    aliases,
    pageVersionBackfills,
  };
  if (rejections.length > 0) throw new SpaceFolderMigrationPreflightError(report);
  return report;
}

function completedInputHash(sidecar) {
  const value = sidecar?.sidecar;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const migration = value.spaceFolderMigration;
  return migration && typeof migration === 'object' && !Array.isArray(migration)
    ? migration.inputHash ?? null
    : null;
}

async function findCompletedBatch(tx, spaceId) {
  const batchKey = migrationBatchKey(spaceId);
  const revision = await tx.spaceKnowledgeRevision.findUnique({
    where: { spaceId_migrationBatchId: { spaceId, migrationBatchId: batchKey } },
    select: { id: true },
  });
  if (!revision) return null;
  const sidecar = await tx.legacyRevisionSidecar.findUnique({ where: { revisionId: revision.id } });
  return { revisionId: revision.id, inputHash: completedInputHash(sidecar) };
}

async function loadSpaceSnapshot(tx, spaceId, knownContentTreeRevision) {
  const completedBatch = await findCompletedBatch(tx, spaceId);
  if (completedBatch) {
    return {
      spaceId,
      contentTreeRevision: knownContentTreeRevision ?? 0n,
      pages: [], pageVersions: [], folders: [], referencedPages: [], referencedFolders: [],
      completedBatch,
    };
  }
  const space = knownContentTreeRevision === undefined
    ? await tx.space.findUnique({
      where: { id: spaceId, deletedAt: null }, select: { contentTreeRevision: true },
    })
    : { contentTreeRevision: knownContentTreeRevision };
  if (!space) {
    throw new SpaceFolderMigrationPreflightError({
      version: 1,
      status: 'rejected',
      spaceId,
      batchKey: migrationBatchKey(spaceId),
      inputHash: null,
      counts: {}, transformations: [], collisions: [],
      rejections: [{ code: 'SPACE_NOT_FOUND', message: 'Space does not exist or is deleted' }],
    });
  }
  const [pages, folders] = await Promise.all([
    tx.page.findMany({ where: { spaceId }, orderBy: { id: 'asc' } }),
    tx.folder.findMany({ where: { spaceId }, orderBy: { id: 'asc' } }),
  ]);
  const pageVersions = pages.length === 0 ? [] : await tx.pageVersion.findMany({
    where: { pageId: { in: pages.map((page) => page.id) } },
    orderBy: { id: 'asc' },
  });
  const pageIds = new Set(pages.map((page) => page.id));
  const referencedPageIds = new Set([
    ...pages.map((page) => page.parentId),
    ...pageVersions.map((version) => version.parentId),
  ].filter((id) => id && !pageIds.has(id)));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const referencedFolderIds = new Set([
    ...folders.map((folder) => folder.parentId),
    ...pages.map((page) => page.folderId),
  ].filter((id) => id && !folderIds.has(id)));
  const [referencedPages, referencedFolders] = await Promise.all([
    referencedPageIds.size === 0 ? [] : tx.page.findMany({
      where: { id: { in: [...referencedPageIds] } }, orderBy: { id: 'asc' },
    }),
    referencedFolderIds.size === 0 ? [] : tx.folder.findMany({
      where: { id: { in: [...referencedFolderIds] } }, orderBy: { id: 'asc' },
    }),
  ]);
  return {
    spaceId,
    contentTreeRevision: space.contentTreeRevision,
    pages,
    pageVersions,
    folders,
    referencedPages,
    referencedFolders,
    completedBatch: null,
  };
}

export async function preflightSpaceFolderMigration(prisma, spaceId) {
  if (!spaceId) throw new TypeError('spaceId is required');
  return buildSpaceFolderMigrationPlan(await loadSpaceSnapshot(prisma, spaceId));
}

async function loadRevisionWriter() {
  const module = await import(pathToFileURL(resolve(
    root,
    'apps/server/dist/core/sync/space-revision-writer.service.js',
  )).href);
  if (!module.SpaceRevisionWriterService) {
    throw new Error('Compiled SpaceRevisionWriterService is unavailable; build @agentwiki/server first');
  }
  return module.SpaceRevisionWriterService;
}

function appliedCounts(plan, overrides = {}) {
  return {
    activePages: plan.counts.activePages,
    deletedPagesSkipped: plan.counts.deletedPagesSkipped,
    existingActiveFolders: plan.counts.existingActiveFolders,
    foldersCreated: overrides.foldersCreated ?? plan.counts.foldersToCreate,
    pagesMoved: overrides.pagesMoved ?? plan.counts.pagesMoved,
    aliasesCreated: overrides.aliasesCreated ?? plan.counts.aliasesToCreate,
    pageVersionsBackfilled: overrides.pageVersionsBackfilled ?? plan.counts.pageVersionsToBackfill,
    affectedNodes: overrides.affectedNodes ?? plan.counts.affectedNodes,
  };
}

export async function migrateSpaceFolders(prisma, spaceId, options = {}) {
  if (!spaceId) throw new TypeError('spaceId is required');
  if (
    options.expectedInputHash !== undefined
    && !/^[0-9a-f]{64}$/u.test(options.expectedInputHash)
  ) {
    throw new TypeError('expectedInputHash must be a lowercase SHA-256 digest');
  }
  const SpaceRevisionWriterService = await loadRevisionWriter();
  const writer = new SpaceRevisionWriterService(prisma);
  return prisma.$transaction(async (tx) => {
    const lockedTx = await writer.lockContentTreeSpace(tx, spaceId);
    if (!lockedTx) {
      throw new SpaceFolderMigrationPreflightError({
        version: 1,
        status: 'rejected',
        spaceId,
        batchKey: migrationBatchKey(spaceId),
        counts: {}, transformations: [], collisions: [],
        rejections: [{ code: 'SPACE_NOT_FOUND', message: 'Space does not exist or is deleted' }],
      });
    }
    const plan = buildSpaceFolderMigrationPlan(await loadSpaceSnapshot(
      lockedTx,
      spaceId,
      lockedTx.contentTreeRevision,
    ));
    if (plan.status === 'completed') {
      return {
        version: 1,
        status: 'completed',
        spaceId,
        batchKey: plan.batchKey,
        inputHash: plan.inputHash,
        revisionId: plan.revisionId,
        treeRevision: lockedTx.contentTreeRevision.toString(),
        counts: {
          activePages: 0, deletedPagesSkipped: 0, existingActiveFolders: 0,
          foldersCreated: 0, pagesMoved: 0, aliasesCreated: 0,
          pageVersionsBackfilled: 0, affectedNodes: 0,
        },
        transformations: [], collisions: [],
      };
    }
    if (options.expectedInputHash && options.expectedInputHash !== plan.inputHash) {
      throw new SpaceFolderMigrationPreflightError({
        ...operatorReport(plan),
        status: 'rejected',
        rejections: [{
          code: 'MIGRATION_INPUT_CHANGED',
          message: 'Locked migration input no longer matches the reviewed dry-run hash',
          expectedInputHash: options.expectedInputHash,
          actualInputHash: plan.inputHash,
        }],
      });
    }

    if (plan.folders.length > 0) {
      await lockedTx.folder.createMany({
        data: plan.folders.map((folder) => ({
          id: folder.id,
          spaceId: folder.spaceId,
          parentId: folder.parentId,
          name: folder.name,
          nameKey: folder.nameKey,
          path: folder.path,
          pathKey: folder.pathKey,
          sortOrder: folder.sortOrder,
          createdByUserId: folder.createdByUserId,
          createdByAgentId: folder.createdByAgentId,
          lastModifiedByUserId: folder.lastModifiedByUserId,
          lastModifiedByAgentId: folder.lastModifiedByAgentId,
          lastModifiedAt: folder.lastModifiedAt,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
        })),
      });
    }

    if (plan.aliases.length > 0) {
      await lockedTx.$executeRawUnsafe(`
        INSERT INTO "PagePathAlias" ("id", "spaceId", "pageId", "path", "pathKey", "createdAt", "expiresAt")
        SELECT input."id", input."spaceId", input."pageId", input."path", input."pathKey", CURRENT_TIMESTAMP, NULL
        FROM jsonb_to_recordset($1::jsonb) AS input(
          "id" text, "spaceId" text, "pageId" text, "path" text, "pathKey" text
        )
        ON CONFLICT ("spaceId", "pathKey", "pageId") DO UPDATE SET "expiresAt" = NULL
      `, JSON.stringify(plan.aliases.map((alias) => ({ id: randomUUID(), ...alias }))));
    }

    const pageUpdates = plan.pages.filter((page) => page.needsMove);
    if (pageUpdates.length > 0) {
      await lockedTx.$executeRawUnsafe(`
        UPDATE "Page" page
        SET "folderId" = input."folderId",
            "syncPath" = input."syncPath",
            "syncPathKey" = input."syncPathKey",
            "updatedAt" = input."updatedAt"
        FROM jsonb_to_recordset($1::jsonb) AS input(
          "id" text, "folderId" text, "syncPath" text, "syncPathKey" text, "updatedAt" timestamp
        )
        WHERE page."id" = input."id" AND page."spaceId" = $2
      `, JSON.stringify(pageUpdates.map((page) => ({
        id: page.id,
        folderId: page.folderId,
        syncPath: page.syncPath,
        syncPathKey: page.syncPathKey,
        updatedAt: iso(page.updatedAt),
      }))), spaceId);
    }

    if (plan.pageVersionBackfills.length > 0) {
      const updated = await lockedTx.$executeRawUnsafe(`
        UPDATE "PageVersion" version
        SET "folderId" = input."folderId"
        FROM jsonb_to_recordset($1::jsonb) AS input("id" text, "folderId" text)
        WHERE version."id" = input."id" AND version."folderId" IS NULL
      `, JSON.stringify(plan.pageVersionBackfills.map((entry) => ({
        id: entry.versionId, folderId: entry.folderId,
      }))));
      if (updated !== plan.pageVersionBackfills.length) {
        throw new Error('Historical PageVersion rows changed after migration preflight');
      }
    }

    const latestRevision = await lockedTx.spaceKnowledgeRevision.findFirst({
      where: { spaceId }, orderBy: { sequence: 'desc' }, select: { id: true },
    });
    const latestSidecar = latestRevision
      ? await lockedTx.legacyRevisionSidecar.findUnique({
        where: { revisionId: latestRevision.id },
      })
      : null;
    const latestSidecarValue = latestSidecar?.sidecar
      && typeof latestSidecar.sidecar === 'object'
      && !Array.isArray(latestSidecar.sidecar)
      ? latestSidecar.sidecar
      : {};
    const revisionPages = latestRevision ? pageUpdates : plan.pages;
    const revision = await writer.advanceStructuralPagesLocked(
      lockedTx,
      spaceId,
      revisionPages.map((page) => ({
        operation: 'upsert',
        pageId: page.knowledgeKey,
        folderId: page.folderId,
        path: page.syncPath,
        title: page.title,
        body: page.content,
      })),
      {
        origin: 'migration',
        migrationBatchId: plan.batchKey,
        legacySidecarOverride: {
          ...latestSidecarValue,
          spaceFolderMigration: {
            version: 1,
            batchKey: plan.batchKey,
            inputHash: plan.inputHash,
            foldersCreated: plan.counts.foldersToCreate,
            pagesMoved: plan.counts.pagesMoved,
            aliasesCreated: plan.counts.aliasesToCreate,
            pageVersionsBackfilled: plan.counts.pageVersionsToBackfill,
          },
        },
      },
    );
    const newTreeRevision = await writer.advanceContentTreeRevision(
      lockedTx,
      spaceId,
      lockedTx.contentTreeRevision,
    );
    return {
      version: 1,
      status: 'applied',
      spaceId,
      batchKey: plan.batchKey,
      inputHash: plan.inputHash,
      revisionId: revision.revisionId,
      treeRevision: newTreeRevision.toString(),
      counts: appliedCounts(plan),
      transformations: plan.transformations,
      collisions: plan.collisions,
    };
  }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 30 * 60_000 });
}

function operatorReport(plan) {
  return {
    version: plan.version,
    status: plan.status,
    spaceId: plan.spaceId,
    batchKey: plan.batchKey,
    inputHash: plan.inputHash,
    revisionId: plan.revisionId ?? null,
    treeRevision: plan.treeRevision ?? null,
    counts: plan.counts,
    transformations: plan.transformations,
    collisions: plan.collisions,
    rejections: plan.rejections ?? [],
  };
}

function databaseUrl(env = process.env) {
  const value = env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  return value;
}

function parseArguments(argv) {
  const args = {
    mode: null, spaceId: null, reportPath: null, expectedInputHash: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--apply') {
      if (args.mode) throw new Error('Choose exactly one of --dry-run or --apply');
      args.mode = argument.slice(2);
    } else if (argument === '--space') {
      args.spaceId = argv[++index];
    } else if (argument === '--report') {
      args.reportPath = argv[++index];
    } else if (argument === '--expected-input-hash') {
      args.expectedInputHash = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!args.mode) throw new Error('Choose exactly one of --dry-run or --apply');
  if (!args.spaceId) throw new Error('--space <spaceId> is required; migration is intentionally per-Space');
  if (args.mode === 'apply' && !/^[0-9a-f]{64}$/u.test(args.expectedInputHash ?? '')) {
    throw new Error('--expected-input-hash <sha256> is required for apply');
  }
  if (args.mode === 'dry-run' && args.expectedInputHash) {
    throw new Error('--expected-input-hash is only valid with --apply');
  }
  return args;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const requireFromServer = createRequire(resolve(root, 'apps/server/package.json'));
  const { PrismaClient } = requireFromServer('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  let report;
  try {
    report = operatorReport(args.mode === 'dry-run'
      ? await preflightSpaceFolderMigration(prisma, args.spaceId)
      : await migrateSpaceFolders(prisma, args.spaceId, {
        expectedInputHash: args.expectedInputHash,
      }));
  } catch (error) {
    if (!(error instanceof SpaceFolderMigrationPreflightError)) throw error;
    report = operatorReport(error.report);
    if (args.reportPath) {
      await writeFile(resolve(args.reportPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    }
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  } finally {
    await prisma.$disconnect();
  }
  if (args.reportPath) {
    await writeFile(resolve(args.reportPath), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
