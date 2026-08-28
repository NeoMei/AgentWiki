import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  canonicalBytes,
  canonicalTreeRevisionManifestV2,
  foldCase,
  pathKey,
  treeRevisionContentHashV2,
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
  const asOf = new Date(snapshot.asOf);
  if (Number.isNaN(asOf.getTime())) throw new TypeError('Migration snapshot asOf is required');
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
    pathAliases: [...(snapshot.pathAliases ?? [])].sort(sortById).map((alias) => ({
      id: alias.id,
      spaceId: alias.spaceId,
      pageId: alias.pageId,
      path: alias.path,
      pathKey: alias.pathKey,
      createdAt: iso(alias.createdAt),
      expiresAt: iso(alias.expiresAt),
      unexpiredAtSnapshot: alias.expiresAt === null || new Date(alias.expiresAt) > asOf,
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

function graphDepth(id, rowsById, parentFor, rejections, codes, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  const chain = [];
  const chainIndex = new Map();
  let cursor = id;
  let baseDepth = 0;
  while (true) {
    if (memo.has(cursor)) {
      baseDepth = memo.get(cursor);
      break;
    }
    if (chainIndex.has(cursor)) {
      reject(rejections, codes.cycle, `Cycle detected at ${cursor}`, { id: cursor });
      baseDepth = Number.POSITIVE_INFINITY;
      break;
    }
    const row = rowsById.get(cursor);
    if (!row) break;
    chainIndex.set(cursor, chain.length);
    chain.push(cursor);
    const parentId = parentFor(row);
    if (!parentId) break;
    cursor = parentId;
  }
  let depth = baseDepth;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    depth = Number.isFinite(depth) ? depth + 1 : depth;
    memo.set(chain[index], depth);
  }
  return memo.get(id) ?? 0;
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

function emptyPlanCounts() {
  return {
    activePages: 0,
    deletedPagesSkipped: 0,
    existingActiveFolders: 0,
    foldersToCreate: 0,
    pagesMoved: 0,
    aliasesToCreate: 0,
    aliasesCreated: 0,
    aliasesReused: 0,
    aliasesRefreshed: 0,
    aliasesPruned: 0,
    pageVersionsToBackfill: 0,
    affectedNodes: 0,
  };
}

function completedMigrationEvidence(completedBatch, batchKey) {
  const sidecar = completedBatch?.sidecar;
  const migration = sidecar && typeof sidecar === 'object' && !Array.isArray(sidecar)
    ? sidecar.spaceFolderMigration
    : null;
  if (
    !completedBatch?.revisionId
    || !migration
    || typeof migration !== 'object'
    || Array.isArray(migration)
    || migration.version !== 1
    || migration.status !== 'completed'
    || migration.batchKey !== batchKey
    || !/^[0-9a-f]{64}$/u.test(migration.inputHash ?? '')
  ) return null;
  return { revisionId: completedBatch.revisionId, inputHash: migration.inputHash };
}

export function buildSpaceFolderMigrationPlan(snapshot) {
  const batchKey = migrationBatchKey(snapshot.spaceId);
  if (snapshot.completedBatch) {
    const evidence = completedMigrationEvidence(snapshot.completedBatch, batchKey);
    if (!evidence) {
      const report = {
        version: 1,
        status: 'rejected',
        spaceId: snapshot.spaceId,
        batchKey,
        revisionId: snapshot.completedBatch.revisionId ?? null,
        inputHash: null,
        counts: emptyPlanCounts(),
        transformations: [], collisions: [],
        rejections: [{
          code: 'MIGRATION_BATCH_EVIDENCE_INVALID',
          message: 'Completed migration revision evidence is missing or malformed',
        }],
        folders: [], pages: [], aliases: [], pageVersionBackfills: [],
        aliasRetention: [], aliasResolutions: [],
      };
      throw new SpaceFolderMigrationPreflightError(report);
    }
    return {
      version: 1,
      status: 'completed',
      spaceId: snapshot.spaceId,
      batchKey,
      revisionId: evidence.revisionId,
      inputHash: evidence.inputHash,
      counts: emptyPlanCounts(),
      transformations: [], collisions: [], rejections: [], folders: [], pages: [],
      aliases: [], pageVersionBackfills: [], aliasRetention: [], aliasResolutions: [],
    };
  }

  const asOf = new Date(snapshot.asOf);
  if (Number.isNaN(asOf.getTime())) throw new TypeError('Migration snapshot asOf is required');

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
      currentPageDepths,
    );
  }
  const overDepthPage = activePages.find((page) => (
    (currentPageDepths.get(page.id) ?? 0) > maximumFolderDepth + 1
    && !rejections.some((entry) => entry.code === 'LEGACY_PAGE_CYCLE')
  ));
  if (overDepthPage) {
    reject(rejections, 'FOLDER_DEPTH_LIMIT', 'Legacy translation exceeds 32 Folder levels', {
      pageId: overDepthPage.id, depth: `>${maximumFolderDepth}`,
    });
  }
  if (rejections.some((entry) => entry.code === 'LEGACY_PAGE_CYCLE' || entry.code === 'FOLDER_DEPTH_LIMIT')) {
    const inputHash = normalizeInputHash(snapshot);
    const report = {
      version: 1,
      status: 'rejected',
      spaceId: snapshot.spaceId,
      batchKey,
      revisionId: null,
      inputHash,
      asOf: asOf.toISOString(),
      counts: {
        ...emptyPlanCounts(),
        activePages: activePages.length,
        deletedPagesSkipped: deletedPages.length,
        existingActiveFolders: activeFolders.length,
      },
      transformations,
      collisions,
      rejections,
      folders: [],
      pages: activePages.map((page) => ({
        ...page,
        oldFolderId: page.folderId,
        oldSyncPath: page.syncPath,
        oldSyncPathKey: page.syncPathKey,
        needsMove: false,
      })),
      aliases: [],
      pageVersionBackfills: [],
      aliasRetention: [],
      aliasResolutions: [],
    };
    throw new SpaceFolderMigrationPreflightError(report);
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

  const existingAliases = [...(snapshot.pathAliases ?? [])].sort(sortById);
  for (const alias of existingAliases) {
    const owner = allPagesById.get(alias.pageId);
    if (!owner || alias.spaceId !== snapshot.spaceId || owner.spaceId !== snapshot.spaceId) {
      reject(rejections, 'PAGE_ALIAS_INVALID', 'Page path alias has a missing or cross-Space owner', {
        aliasId: alias.id, pageId: alias.pageId,
      });
      continue;
    }
    try {
      const portable = validatePortableMarkdownPath(alias.path);
      if (portable.key !== alias.pathKey) {
        reject(rejections, 'PAGE_ALIAS_INVALID', 'Page path alias key is inconsistent', { aliasId: alias.id });
      }
    } catch (error) {
      reject(rejections, 'PAGE_ALIAS_INVALID', error.message, { aliasId: alias.id });
    }
  }
  const aliases = plannedPages
    .filter((page) => page.syncPath !== page.oldSyncPath)
    .map((page) => ({
      pageId: page.id,
      spaceId: snapshot.spaceId,
      path: page.oldSyncPath,
      pathKey: pathKey(page.oldSyncPath),
    }))
    .map((alias) => {
      const existing = existingAliases.find((entry) => (
        entry.pageId === alias.pageId && entry.pathKey === alias.pathKey
      ));
      return {
        ...alias,
        action: !existing
          ? 'created'
          : existing.expiresAt === null && existing.path === alias.path
            ? 'reused'
            : 'refreshed',
        existingAliasId: existing?.id ?? null,
      };
    });

  const effectiveAliasesByPage = new Map();
  for (const alias of existingAliases) {
    if (!effectiveAliasesByPage.has(alias.pageId)) effectiveAliasesByPage.set(alias.pageId, []);
    effectiveAliasesByPage.get(alias.pageId).push({ ...alias, planned: false });
  }
  for (const alias of aliases) {
    if (!effectiveAliasesByPage.has(alias.pageId)) effectiveAliasesByPage.set(alias.pageId, []);
    const entries = effectiveAliasesByPage.get(alias.pageId);
    const existingIndex = entries.findIndex((entry) => entry.pathKey === alias.pathKey);
    const effective = {
      id: alias.existingAliasId ?? `planned:${alias.pageId}:${alias.pathKey}`,
      spaceId: alias.spaceId,
      pageId: alias.pageId,
      path: alias.path,
      pathKey: alias.pathKey,
      createdAt: null,
      expiresAt: null,
      planned: true,
    };
    if (existingIndex >= 0) entries.splice(existingIndex, 1, effective);
    else entries.push(effective);
  }
  const plannedAliasPageIds = new Set(aliases.map((alias) => alias.pageId));
  const aliasRetention = [];
  const retainedAliases = [];
  for (const [pageId, entries] of [...effectiveAliasesByPage].sort(([left], [right]) => compareBytes(left, right))) {
    const sorted = [...entries].sort((left, right) => (
      Number(right.planned) - Number(left.planned)
      || (iso(right.createdAt) ?? '').localeCompare(iso(left.createdAt) ?? '')
      || compareBytes(right.id, left.id)
    ));
    const retainedCount = plannedAliasPageIds.has(pageId) ? 20 : sorted.length;
    retainedAliases.push(...sorted.slice(0, retainedCount));
    const prunedAliasIds = sorted.slice(retainedCount)
      .filter((entry) => !entry.planned)
      .map((entry) => entry.id)
      .sort(compareBytes);
    if (prunedAliasIds.length > 0) aliasRetention.push({ pageId, prunedAliasIds });
  }
  const currentPagesByPath = new Map();
  for (const page of plannedPages) {
    if (!currentPagesByPath.has(page.syncPathKey)) currentPagesByPath.set(page.syncPathKey, []);
    currentPagesByPath.get(page.syncPathKey).push(page.id);
  }
  const aliasesByPath = new Map();
  for (const alias of retainedAliases.filter((entry) => (
    (entry.expiresAt === null || new Date(entry.expiresAt) > asOf)
    && activePagesById.has(entry.pageId)
  ))) {
    if (!aliasesByPath.has(alias.pathKey)) aliasesByPath.set(alias.pathKey, []);
    aliasesByPath.get(alias.pathKey).push(alias);
  }
  const aliasResolutions = [];
  for (const [aliasPathKey, entries] of aliasesByPath) {
    const currentPageIds = [...(currentPagesByPath.get(aliasPathKey) ?? [])].sort(compareBytes);
    const aliasPageIds = [...new Set(entries.map((entry) => entry.pageId))].sort(compareBytes);
    if (currentPageIds.length === 0 && aliasPageIds.length < 2) continue;
    aliasResolutions.push({
      path: [...entries].sort((left, right) => compareBytes(left.path, right.path))[0].path,
      pathKey: aliasPathKey,
      currentPageIds,
      aliasPageIds,
      resolution: currentPageIds.length > 0 ? 'current-page' : 'ambiguous-alias',
    });
  }
  aliasResolutions.sort((left, right) => compareBytes(left.pathKey, right.pathKey));

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
  const aliasesCreated = aliases.filter((alias) => alias.action === 'created').length;
  const aliasesReused = aliases.filter((alias) => alias.action === 'reused').length;
  const aliasesRefreshed = aliases.filter((alias) => alias.action === 'refreshed').length;
  const aliasesPruned = aliasRetention.reduce((sum, entry) => sum + entry.prunedAliasIds.length, 0);
  const report = {
    version: 1,
    status: rejections.length === 0 ? 'ready' : 'rejected',
    spaceId: snapshot.spaceId,
    batchKey,
    revisionId: null,
    inputHash,
    asOf: asOf.toISOString(),
    counts: {
      activePages: activePages.length,
      deletedPagesSkipped: deletedPages.length,
      existingActiveFolders: activeFolders.length,
      foldersToCreate: plannedFolders.length,
      pagesMoved,
      aliasesToCreate: aliasesCreated,
      aliasesCreated,
      aliasesReused,
      aliasesRefreshed,
      aliasesPruned,
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
    aliasRetention,
    aliasResolutions,
  };
  if (rejections.length > 0) throw new SpaceFolderMigrationPreflightError(report);
  return report;
}

async function findCompletedBatch(tx, spaceId) {
  const batchKey = migrationBatchKey(spaceId);
  const revision = await tx.spaceKnowledgeRevision.findUnique({
    where: { spaceId_migrationBatchId: { spaceId, migrationBatchId: batchKey } },
    select: { id: true },
  });
  if (!revision) return null;
  const sidecar = await tx.legacyRevisionSidecar.findUnique({ where: { revisionId: revision.id } });
  return { revisionId: revision.id, sidecar: sidecar?.sidecar ?? null };
}

async function loadSpaceSnapshot(tx, spaceId, knownContentTreeRevision) {
  const completedBatch = await findCompletedBatch(tx, spaceId);
  if (completedBatch) {
    return {
      spaceId,
      contentTreeRevision: knownContentTreeRevision ?? 0n,
      pages: [], pageVersions: [], folders: [], pathAliases: [], referencedPages: [], referencedFolders: [],
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
  const [{ asOf }] = await tx.$queryRawUnsafe(
    'SELECT statement_timestamp() AS "asOf"',
  );
  const [pages, folders, pathAliases] = await Promise.all([
    tx.page.findMany({ where: { spaceId }, orderBy: { id: 'asc' } }),
    tx.folder.findMany({ where: { spaceId }, orderBy: { id: 'asc' } }),
    tx.pagePathAlias.findMany({ where: { spaceId }, orderBy: { id: 'asc' } }),
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
    asOf,
    contentTreeRevision: space.contentTreeRevision,
    pages,
    pageVersions,
    folders,
    pathAliases,
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
    aliasesCreated: overrides.aliasesCreated ?? plan.counts.aliasesCreated,
    aliasesReused: overrides.aliasesReused ?? plan.counts.aliasesReused,
    aliasesRefreshed: overrides.aliasesRefreshed ?? plan.counts.aliasesRefreshed,
    aliasesPruned: overrides.aliasesPruned ?? plan.counts.aliasesPruned,
    pageVersionsBackfilled: overrides.pageVersionsBackfilled ?? plan.counts.pageVersionsToBackfill,
    affectedNodes: overrides.affectedNodes ?? plan.counts.affectedNodes,
  };
}

async function persistInitialTreeRevisionV2(tx, spaceId, revisionId, plan) {
  const activePageIds = plan.pages.map((page) => page.knowledgeKey);
  await tx.syncRevisionPageRow.deleteMany({
    where: {
      revisionId,
      ...(activePageIds.length > 0 ? { pageId: { notIn: activePageIds } } : {}),
    },
  });
  if (plan.pages.length > 0) {
    await tx.$executeRawUnsafe(`
      UPDATE "SyncRevisionPageRow" row
      SET "folderId" = input."folderId",
          "path" = input."path",
          "pathKey" = input."pathKey",
          "title" = input."title",
          "updatedAt" = input."updatedAt"
      FROM jsonb_to_recordset($1::jsonb) AS input(
        "pageId" text, "folderId" text, "path" text, "pathKey" text,
        "title" text, "updatedAt" timestamptz
      )
      WHERE row."revisionId" = $2 AND row."pageId" = input."pageId"
    `, JSON.stringify(plan.pages.map((page) => ({
      pageId: page.knowledgeKey,
      folderId: page.folderId,
      path: page.syncPath,
      pathKey: page.syncPathKey,
      title: page.title,
      updatedAt: iso(page.updatedAt),
    }))), revisionId);
  }

  const folders = await tx.folder.findMany({
    where: { spaceId, deletedAt: null },
    orderBy: { id: 'asc' },
  });
  if (folders.length > 0) {
    await tx.syncRevisionFolderRow.createMany({ data: folders.map((folder) => ({
      revisionId,
      folderId: folder.id,
      parentFolderId: folder.parentId,
      name: folder.name,
      path: folder.path,
      pathKey: folder.pathKey,
      sortOrder: folder.sortOrder,
      updatedAt: folder.updatedAt,
    })) });
  }
  const pageRows = await tx.syncRevisionPageRow.findMany({
    where: { revisionId },
    include: { content: true },
  });
  const manifest = canonicalTreeRevisionManifestV2({
    protocolVersion: '2',
    spaceId,
    folders: folders.map((folder) => ({
      folderId: folder.id,
      parentFolderId: folder.parentId,
      name: folder.name,
      path: folder.path,
      sortOrder: folder.sortOrder,
      updatedAt: folder.updatedAt.toISOString(),
    })),
    pages: pageRows.map((page) => ({
      pageId: page.pageId,
      folderId: page.folderId,
      path: page.path,
      title: page.title,
      body: page.content.body,
      contentHash: page.contentHash,
      updatedAt: page.updatedAt.toISOString(),
    })),
  });
  const revisionContentHash = await treeRevisionContentHashV2(manifest);
  const revisionManifestByteLength = canonicalBytes(manifest).byteLength;
  const revisionBodyBytes = manifest.pages.reduce(
    (sum, page) => sum + encoder.encode(page.body).byteLength,
    0,
  );
  const deltaRows = [
    ...manifest.folders.map((folder) => ({
      operation: 'upsert_folder',
      folderId: folder.folderId,
      pageId: null,
      previousPath: null,
      contentHash: null,
    })),
    ...manifest.pages.map((page) => ({
      operation: 'upsert_page',
      folderId: null,
      pageId: page.pageId,
      previousPath: null,
      contentHash: page.contentHash,
    })),
  ];
  if (deltaRows.length > 0) {
    await tx.syncRevisionTreeDeltaRow.createMany({
      data: deltaRows.map((row, ordinal) => ({ revisionId, ordinal, ...row })),
    });
  }
  await tx.spaceKnowledgeRevision.update({
    where: { id: revisionId },
    data: {
      schemaVersion: 'content-tree@2',
      recipeVersion: 'space-folders-v1',
      revisionContentHash,
      pageCount: BigInt(manifest.pages.length),
      revisionBodyBytes: BigInt(revisionBodyBytes),
      revisionManifestByteLength: BigInt(revisionManifestByteLength),
    },
  });
  const sidecarRow = await tx.legacyRevisionSidecar.findUnique({ where: { revisionId } });
  const sidecar = sidecarRow?.sidecar
    && typeof sidecarRow.sidecar === 'object'
    && !Array.isArray(sidecarRow.sidecar)
    ? sidecarRow.sidecar
    : {};
  const migration = sidecar.spaceFolderMigration
    && typeof sidecar.spaceFolderMigration === 'object'
    && !Array.isArray(sidecar.spaceFolderMigration)
    ? sidecar.spaceFolderMigration
    : {};
  await tx.legacyRevisionSidecar.upsert({
    where: { revisionId },
    create: {
      revisionId,
      sidecar: {
        ...sidecar,
        spaceFolderMigration: {
          ...migration,
          v2Revision: {
            protocolVersion: '2',
            manifestSchema: 'TreeRevisionContentManifestV2',
            folderCount: String(manifest.folders.length),
            pageCount: String(manifest.pages.length),
            revisionContentHash,
            revisionManifestByteLength: String(revisionManifestByteLength),
            revisionBodyBytes: String(revisionBodyBytes),
            treeDeltaCount: String(deltaRows.length),
          },
        },
      },
    },
    update: {
      sidecar: {
        ...sidecar,
        spaceFolderMigration: {
          ...migration,
          v2Revision: {
            protocolVersion: '2',
            manifestSchema: 'TreeRevisionContentManifestV2',
            folderCount: String(manifest.folders.length),
            pageCount: String(manifest.pages.length),
            revisionContentHash,
            revisionManifestByteLength: String(revisionManifestByteLength),
            revisionBodyBytes: String(revisionBodyBytes),
            treeDeltaCount: String(deltaRows.length),
          },
        },
      },
    },
  });
}

export async function migrateSpaceFolders(prisma, spaceId, options = {}) {
  if (!spaceId) throw new TypeError('spaceId is required');
  if (options.expectedInputHash === undefined) throw new TypeError('expectedInputHash is required');
  if (!/^[0-9a-f]{64}$/u.test(options.expectedInputHash)) {
    throw new TypeError('expectedInputHash must be a lowercase SHA-256 digest');
  }
  const SpaceRevisionWriterService = await loadRevisionWriter();
  const writer = new SpaceRevisionWriterService(prisma);
  let stableReport = null;
  try {
    return await prisma.$transaction(async (tx) => {
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
    stableReport = operatorReport(plan);
    if (options.expectedInputHash !== plan.inputHash) {
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
    if (plan.status === 'completed') {
      const result = {
        ...operatorReport(plan),
        version: 1,
        status: 'completed',
        spaceId,
        batchKey: plan.batchKey,
        inputHash: plan.inputHash,
        revisionId: plan.revisionId,
        treeRevision: lockedTx.contentTreeRevision.toString(),
        counts: {
          activePages: 0, deletedPagesSkipped: 0, existingActiveFolders: 0,
          foldersCreated: 0, pagesMoved: 0, aliasesCreated: 0, aliasesReused: 0,
          aliasesRefreshed: 0, aliasesPruned: 0,
          pageVersionsBackfilled: 0, affectedNodes: 0,
        },
      };
      if (options.persistReport) await options.persistReport(result);
      return result;
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
      const aliasChangedAt = new Date();
      await lockedTx.$executeRawUnsafe(`
        INSERT INTO "PagePathAlias" ("id", "spaceId", "pageId", "path", "pathKey", "createdAt", "expiresAt")
        SELECT input."id", input."spaceId", input."pageId", input."path", input."pathKey", input."createdAt", NULL
        FROM jsonb_to_recordset($1::jsonb) AS input(
          "id" text, "spaceId" text, "pageId" text, "path" text, "pathKey" text, "createdAt" timestamptz
        )
        ON CONFLICT ("spaceId", "pathKey", "pageId") DO UPDATE SET
          "path" = EXCLUDED."path",
          "createdAt" = EXCLUDED."createdAt",
          "expiresAt" = NULL
      `, JSON.stringify(plan.aliases.map((alias) => ({
        id: randomUUID(),
        spaceId: alias.spaceId,
        pageId: alias.pageId,
        path: alias.path,
        pathKey: alias.pathKey,
        createdAt: aliasChangedAt.toISOString(),
      }))));
      const aliasPageIds = [...new Set(plan.aliases.map((alias) => alias.pageId))].sort(compareBytes);
      await lockedTx.$executeRawUnsafe(`
        DELETE FROM "PagePathAlias" alias
        USING (
          SELECT ranked."id"
          FROM (
            SELECT candidate."id",
                   ROW_NUMBER() OVER (
                     PARTITION BY candidate."pageId"
                     ORDER BY candidate."createdAt" DESC, candidate."id" DESC
                   ) AS ordinal
            FROM "PagePathAlias" candidate
            WHERE candidate."spaceId" = $1
              AND candidate."pageId" IN (
                SELECT value FROM jsonb_array_elements_text($2::jsonb)
              )
          ) ranked
          WHERE ranked.ordinal > 20
        ) excess
        WHERE alias."id" = excess."id"
      `, spaceId, JSON.stringify(aliasPageIds));
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
    const revisionPages = plan.pages;
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
            status: 'completed',
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
    await persistInitialTreeRevisionV2(lockedTx, spaceId, revision.revisionId, plan);
    const newTreeRevision = await writer.advanceContentTreeRevision(
      lockedTx,
      spaceId,
      lockedTx.contentTreeRevision,
    );
    const result = {
      ...operatorReport(plan),
      version: 1,
      status: 'applied',
      spaceId,
      batchKey: plan.batchKey,
      inputHash: plan.inputHash,
      revisionId: revision.revisionId,
      treeRevision: newTreeRevision.toString(),
      counts: appliedCounts(plan),
    };
    if (options.persistReport) await options.persistReport(result);
    return result;
    }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 30 * 60_000 });
  } catch (error) {
    if (error instanceof SpaceFolderMigrationPreflightError || !stableReport) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new SpaceFolderMigrationPreflightError({
      ...stableReport,
      status: 'rejected',
      rejections: [
        ...(stableReport.rejections ?? []),
        { code: 'MIGRATION_EXECUTION_FAILED', message },
      ],
    });
    wrapped.message = `${wrapped.message}: ${message}`;
    wrapped.cause = error;
    throw wrapped;
  }
}

export function operatorReport(plan) {
  if (plan?.reportType === 'space-folder-migration-operator@1') return plan;
  const pathChanges = [...(plan.pages ?? [])].sort(sortById).map((page) => ({
    pageId: page.id,
    oldFolderId: Object.hasOwn(page, 'oldFolderId') ? page.oldFolderId : page.folderId ?? null,
    newFolderId: page.folderId ?? null,
    oldPath: page.oldSyncPath ?? page.syncPath,
    newPath: page.syncPath,
    changed: Boolean(page.needsMove || (page.oldSyncPath ?? page.syncPath) !== page.syncPath),
  }));
  const plannedFolders = [...(plan.folders ?? [])].sort((left, right) => (
    left.depth - right.depth || sortById(left, right)
  )).map((folder) => ({
    folderId: folder.id,
    sourcePageId: folder.sourcePageId,
    parentFolderId: folder.parentId,
    name: folder.name,
    path: folder.path,
    sortOrder: folder.sortOrder,
  }));
  const plannedAliases = [...(plan.aliases ?? [])].sort((left, right) => (
    compareBytes(left.pageId, right.pageId) || compareBytes(left.pathKey, right.pathKey)
  )).map((alias) => ({
    pageId: alias.pageId,
    path: alias.path,
    pathKey: alias.pathKey,
    action: alias.action,
    existingAliasId: alias.existingAliasId,
  }));
  const aliasResolutions = plan.aliasResolutions ?? [];
  return {
    reportType: 'space-folder-migration-operator@1',
    version: plan.version,
    status: plan.status,
    spaceId: plan.spaceId,
    batchKey: plan.batchKey,
    inputHash: plan.inputHash,
    snapshotAsOf: plan.asOf ?? plan.snapshotAsOf ?? null,
    revisionId: plan.revisionId ?? null,
    treeRevision: plan.treeRevision ?? null,
    counts: plan.counts,
    transformations: plan.transformations,
    collisions: plan.collisions,
    pathChanges,
    plannedFolders,
    plannedAliases,
    aliasRetention: plan.aliasRetention ?? [],
    aliasResolutions,
    conversionSummary: {
      transformedFolderNames: plan.transformations?.length ?? 0,
      folderNameCollisions: plan.collisions?.length ?? 0,
      aliasAmbiguities: aliasResolutions.filter((entry) => entry.resolution === 'ambiguous-alias').length,
      aliasCurrentPathShadows: aliasResolutions.filter((entry) => entry.resolution === 'current-page').length,
    },
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

export function parseArguments(argv) {
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
  if (args.mode === 'apply' && !args.reportPath) {
    throw new Error('--report <new-path> is required for apply');
  }
  if (args.mode === 'dry-run' && args.expectedInputHash) {
    throw new Error('--expected-input-hash is only valid with --apply');
  }
  return args;
}

export async function reserveReportTarget(reportPath, operations = {}) {
  const target = resolve(reportPath);
  const parent = dirname(target);
  const openFile = operations.open ?? open;
  const parentStat = await lstat(parent, { bigint: true });
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Report parent must be an existing, non-symlink directory');
  }
  const identity = (stat) => ({ device: stat.dev, inode: stat.ino });
  const sameIdentity = (left, right) => (
    left.device === right.device && left.inode === right.inode
  );
  const parentIdentity = identity(parentStat);
  let parentHandle;
  let reportHandle;
  let reportIdentity;
  let closed = false;

  const assertPathIdentity = async () => {
    const currentParent = await lstat(parent, { bigint: true }).catch(() => null);
    const currentTarget = await lstat(target, { bigint: true }).catch(() => null);
    if (
      !currentParent
      || !currentParent.isDirectory()
      || currentParent.isSymbolicLink()
      || !sameIdentity(identity(currentParent), parentIdentity)
      || !currentTarget
      || currentTarget.isSymbolicLink()
      || !sameIdentity(identity(currentTarget), reportIdentity)
    ) throw new Error('Reserved report target or parent identity changed');
  };

  const writeHandle = async (handle, report) => {
    const content = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await handle.truncate(0);
    let offset = 0;
    while (offset < content.length) {
      const { bytesWritten } = await handle.write(
        content,
        offset,
        content.length - offset,
        offset,
      );
      if (bytesWritten === 0) throw new Error('Report reservation write made no progress');
      offset += bytesWritten;
    }
    await handle.sync();
  };

  const writeThroughReservation = async (report) => {
    if (closed) throw new Error('Report reservation is closed');
    await writeHandle(reportHandle, report);
    await assertPathIdentity();
  };

  try {
    parentHandle = await openFile(parent, (
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    ));
    const openedParent = await parentHandle.stat({ bigint: true });
    if (!sameIdentity(identity(openedParent), parentIdentity)) {
      throw new Error('Report parent identity changed before reservation');
    }
    reportHandle = await openFile(target, (
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW
    ), 0o600);
    await reportHandle.chmod(0o600);
    const openedReport = await reportHandle.stat({ bigint: true });
    if (!openedReport.isFile()) throw new Error('Report reservation is not a regular file');
    reportIdentity = identity(openedReport);
    await writeThroughReservation({
      version: 1,
      status: 'reserved',
      reportPath: target,
    });
    await parentHandle.sync();
  } catch (error) {
    if (reportHandle) {
      try {
        await writeHandle(reportHandle, {
          version: 1,
          status: 'rejected',
          reportPath: target,
          rejections: [{
            code: 'REPORT_RESERVATION_INITIALIZATION_FAILED',
            message: error instanceof Error ? error.message : String(error),
          }],
        });
      } catch {
        // The original descriptor itself is not writable. Preserve the
        // O_EXCL placeholder and never fall back to pathname mutation.
      }
    }
    await reportHandle?.close().catch(() => {});
    await parentHandle?.close().catch(() => {});
    throw error;
  }
  return {
    path: target,
    write: writeThroughReservation,
    async close() {
      if (closed) return;
      closed = true;
      try {
        await reportHandle.close();
      } finally {
        await parentHandle.close();
      }
    },
  };
}

function executionFailureReport(args, error) {
  if (error instanceof SpaceFolderMigrationPreflightError) return operatorReport(error.report);
  return operatorReport({
    version: 1,
    status: 'rejected',
    spaceId: args?.spaceId ?? null,
    batchKey: args?.spaceId ? migrationBatchKey(args.spaceId) : null,
    inputHash: args?.expectedInputHash ?? null,
    revisionId: null,
    treeRevision: null,
    counts: emptyPlanCounts(),
    transformations: [], collisions: [], pages: [], folders: [], aliases: [],
    aliasRetention: [], aliasResolutions: [],
    rejections: [{
      code: 'MIGRATION_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    }],
  });
}

export async function runSpaceFolderMigrationMode(args, prisma, reportTarget) {
  try {
    const report = args.mode === 'dry-run'
      ? operatorReport(await preflightSpaceFolderMigration(prisma, args.spaceId))
      : await migrateSpaceFolders(prisma, args.spaceId, {
        expectedInputHash: args.expectedInputHash,
        persistReport: (value) => reportTarget.write(value),
      });
    if (args.mode === 'dry-run' && reportTarget) await reportTarget.write(report);
    return { ok: true, report, error: null, reportPersistenceError: null };
  } catch (error) {
    const report = executionFailureReport(args, error);
    let reportPersistenceError = null;
    if (reportTarget) {
      try {
        await reportTarget.write(report);
      } catch (writeError) {
        reportPersistenceError = writeError;
      }
    }
    return { ok: false, report, error, reportPersistenceError };
  }
}

async function main() {
  let args;
  let reportTarget;
  let prisma;
  try {
    args = parseArguments(process.argv.slice(2));
    reportTarget = args.reportPath ? await reserveReportTarget(args.reportPath) : null;
    const requireFromServer = createRequire(resolve(root, 'apps/server/package.json'));
    const { PrismaClient } = requireFromServer('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
    const outcome = await runSpaceFolderMigrationMode(args, prisma, reportTarget);
    if (!outcome.ok) {
      console.error(JSON.stringify({
        ...outcome.report,
        ...(outcome.reportPersistenceError ? {
          reportPersistenceError: outcome.reportPersistenceError instanceof Error
            ? outcome.reportPersistenceError.message
            : String(outcome.reportPersistenceError),
        } : {}),
      }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(outcome.report, null, 2));
  } catch (error) {
    const report = executionFailureReport(args, error);
    if (reportTarget) {
      try {
        await reportTarget.write(report);
      } catch (reportError) {
        console.error(JSON.stringify({
          ...report,
          reportPersistenceError: reportError instanceof Error
            ? reportError.message
            : String(reportError),
        }, null, 2));
        process.exitCode = 1;
        return;
      }
    }
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  } finally {
    await prisma?.$disconnect().catch((error) => {
      console.error(`Prisma disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
    await reportTarget?.close().catch((error) => {
      console.error(`Report reservation close failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
