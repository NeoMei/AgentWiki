import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  canonicalTreeRevisionManifestV2,
  contentHash as treePageContentHash,
  pathKey,
  treeRevisionContentHashV2,
  validatePortableDirectoryPath,
  validatePortableMarkdownPath,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import { assertJobState, type JobState } from '../protocol/job.js';
import {
  assertFolderIdentityStateV2,
  assertLocalManifest,
  migrateFolderIdentityStateV2,
  type FolderIdentityStateV2,
  type LocalManifest,
} from './manifest.js';
import type { SpaceWorkspacePaths } from './layout.js';

/**
 * Local state persistence for a Space workspace.
 *
 * Everything that the Orchestrator needs to survive between Agent turns and
 * between process restarts lives in .state/. Callers are responsible for
 * file-system permissions; this layer writes JSON atomically by writing to a
 * sibling tmp file and renaming.
 */

export async function ensureWorkspace(paths: SpaceWorkspacePaths): Promise<void> {
  const dirs = [
    paths.root,
    paths.wikiRoot,
    paths.pagesDir,
    paths.memoriesDir,
    paths.stateRoot,
    paths.baseDir,
    paths.draftsDir,
    paths.checkpointsDir,
    paths.runtimeDir,
  ];
  await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })));
}

export async function initManifest(
  paths: SpaceWorkspacePaths,
  spaceId: string,
  now = new Date().toISOString(),
): Promise<LocalManifest> {
  const manifest: LocalManifest = {
    schemaVersion: '1.0',
    spaceId,
    createdAt: now,
    updatedAt: now,
    baseRevision: null,
    pendingRevision: null,
    sources: [],
    checkpoints: [],
  };
  await writeManifest(paths, manifest);
  return manifest;
}

export async function readManifest(paths: SpaceWorkspacePaths): Promise<LocalManifest | null> {
  if (!existsSync(paths.manifestFile)) return null;
  const raw = await readFile(paths.manifestFile, 'utf-8');
  return assertLocalManifest(JSON.parse(raw));
}

export async function writeManifest(paths: SpaceWorkspacePaths, manifest: LocalManifest): Promise<void> {
  await writeJsonAtomic(paths.manifestFile, manifest);
}

export async function readProvenance(paths: SpaceWorkspacePaths): Promise<Record<string, unknown>[]> {
  if (!existsSync(paths.provenanceFile)) return [];
  const raw = await readFile(paths.provenanceFile, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed as Record<string, unknown>[];
}

export async function appendProvenance(
  paths: SpaceWorkspacePaths,
  records: Record<string, unknown>[],
): Promise<void> {
  const existing = await readProvenance(paths);
  await writeJsonAtomic(paths.provenanceFile, [...existing, ...records]);
}

export async function readCheckpoint(paths: SpaceWorkspacePaths, checkpointId: string): Promise<JobState | null> {
  const file = join(paths.checkpointsDir, `${checkpointId}.json`);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf-8');
  return assertJobState(JSON.parse(raw));
}

export async function writeCheckpoint(paths: SpaceWorkspacePaths, state: JobState): Promise<string> {
  const id = `${state.jobId}:${state.phase}:${state.updatedAt}`;
  const file = join(paths.checkpointsDir, `${id}.json`);
  await writeJsonAtomic(file, state);
  return id;
}

export async function listCheckpoints(paths: SpaceWorkspacePaths): Promise<string[]> {
  if (!existsSync(paths.checkpointsDir)) return [];
  const entries = await readSortedNames(paths.checkpointsDir);
  return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
}

export async function deleteCheckpoint(paths: SpaceWorkspacePaths, checkpointId: string): Promise<void> {
  const file = join(paths.checkpointsDir, `${checkpointId}.json`);
  await rm(file, { force: true });
}

export async function writeBase(paths: SpaceWorkspacePaths, revision: string, data: unknown): Promise<void> {
  const file = join(paths.baseDir, `${revision}.json`);
  await writeJsonAtomic(file, data);
}

export async function readBase(paths: SpaceWorkspacePaths, revision: string): Promise<unknown | null> {
  const file = join(paths.baseDir, `${revision}.json`);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf-8');
  return JSON.parse(raw);
}

export async function writeDraft(paths: SpaceWorkspacePaths, draftId: string, data: unknown): Promise<void> {
  const file = join(paths.draftsDir, `${draftId}.json`);
  await writeJsonAtomic(file, data);
}

export async function readDraft(paths: SpaceWorkspacePaths, draftId: string): Promise<unknown | null> {
  const file = join(paths.draftsDir, `${draftId}.json`);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf-8');
  return JSON.parse(raw);
}

export async function listDrafts(paths: SpaceWorkspacePaths): Promise<string[]> {
  if (!existsSync(paths.draftsDir)) return [];
  const entries = await readSortedNames(paths.draftsDir);
  return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
}

export async function deleteDraft(paths: SpaceWorkspacePaths, draftId: string): Promise<void> {
  const file = join(paths.draftsDir, `${draftId}.json`);
  await rm(file, { force: true });
}

export async function writeWikiPage(paths: SpaceWorkspacePaths, pageId: string, content: string): Promise<void> {
  const file = knowledgeFile(paths.pagesDir, pageId, '.md');
  await writeFile(file, content, 'utf-8');
}

export async function readWikiPage(paths: SpaceWorkspacePaths, pageId: string): Promise<string | null> {
  const file = knowledgeFile(paths.pagesDir, pageId, '.md');
  if (!existsSync(file)) return null;
  return readFile(file, 'utf-8');
}

export async function listWikiPages(paths: SpaceWorkspacePaths): Promise<string[]> {
  if (!existsSync(paths.pagesDir)) return [];
  const entries = await readSortedNames(paths.pagesDir);
  return entries.filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -'.md'.length));
}

export async function listWikiMemories(paths: SpaceWorkspacePaths): Promise<string[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  const entries = await readSortedNames(paths.memoriesDir);
  return entries.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length));
}

export async function writeWikiMemory(paths: SpaceWorkspacePaths, memoryId: string, data: unknown): Promise<void> {
  const file = knowledgeFile(paths.memoriesDir, memoryId, '.json');
  await writeJsonAtomic(file, data);
}

export async function readWikiMemory(paths: SpaceWorkspacePaths, memoryId: string): Promise<unknown | null> {
  const file = knowledgeFile(paths.memoriesDir, memoryId, '.json');
  if (!existsSync(file)) return null;
  const raw = await readFile(file, 'utf-8');
  return JSON.parse(raw);
}

export async function writeWikiRelations(paths: SpaceWorkspacePaths, relations: unknown[]): Promise<void> {
  await writeJsonAtomic(paths.relationsFile, relations);
}

export async function readWikiRelations(paths: SpaceWorkspacePaths): Promise<unknown[]> {
  if (!existsSync(paths.relationsFile)) return [];
  const raw = await readFile(paths.relationsFile, 'utf-8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  const handle = await open(tmp, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
  try {
    await rename(tmp, filePath);
    await fsyncDirectory(dirname(filePath));
  } finally {
    await rm(tmp, { force: true });
  }
}

function knowledgeFile(directory: string, id: string, suffix: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error('Knowledge identifier is not safe for local storage');
  }
  return join(directory, `${id}${suffix}`);
}

async function readSortedNames(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  return (await readdir(dir)).sort();
}

export async function readFolderIdentityStateV2(paths: SpaceWorkspacePaths): Promise<FolderIdentityStateV2 | null> {
  if (!existsSync(paths.folderIdentityFile)) return null;
  const raw = JSON.parse(await readFile(paths.folderIdentityFile, 'utf8')) as unknown;
  const migrated = migrateFolderIdentityStateV2(raw);
  if ((raw as { schemaVersion?: unknown }).schemaVersion === 1) {
    await writeFolderIdentityStateV2(paths, migrated);
  }
  return migrated;
}

export async function writeFolderIdentityStateV2(
  paths: SpaceWorkspacePaths,
  state: FolderIdentityStateV2,
): Promise<void> {
  await writeJsonAtomic(paths.folderIdentityFile, assertFolderIdentityStateV2(state));
}

type FolderTreeOperationV2 =
  | { kind: 'mkdir'; path: string }
  | { kind: 'link'; from: string; to: string }
  | { kind: 'write'; path: string; before: null; after: string }
  | { kind: 'unlink'; path: string; before: string }
  | { kind: 'rmdir'; path: string };

interface FolderTreeJournalV2 {
  schemaVersion: 2;
  spaceId: string;
  revision: string;
  phase: 'applying' | 'committing' | 'committed' | 'rolling-back';
  nextOperation: number;
  operations: FolderTreeOperationV2[];
  operationStates?: FolderTreeOperationStateV2[];
  rootIdentity?: { dev: string; ino: string };
  finalState: FolderIdentityStateV2;
  finalTree?: TreeRevisionContentManifestV2;
  control?: {
    base: TreeRevisionContentManifestV2;
    manifest: LocalManifest;
    revisionContentHash: string;
  };
}

interface PersistedPathIdentityV2 {
  path: string;
  kind: ManagedPathKind;
  dev?: string;
  ino?: string;
}

interface FolderTreeOperationStateV2 {
  status: 'prepared' | 'ambiguous' | 'applied';
  before: PersistedPathIdentityV2[];
  after?: PersistedPathIdentityV2[];
}

export interface FolderTreeTransactionOptionsV2 {
  revision: string;
  controlBase?: TreeRevisionContentManifestV2;
  revisionContentHash?: string;
  pulledAt?: string;
  onCheckpoint?: (checkpoint: string) => Promise<void> | void;
  afterPathCheck?: (path: string) => Promise<void> | void;
}

interface DirectoryIdentity {
  path: string;
  dev: bigint;
  ino: bigint;
}

type ManagedPathKind = 'missing' | 'file' | 'directory' | 'other';

function missing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

function assertManagedRelativePath(value: string): void {
  if (!value || value.startsWith('/') || value.includes('\\')) {
    throw new TypeError('Managed path must be a non-empty POSIX relative path');
  }
  const resolved = relative(resolve('/managed'), resolve('/managed', value));
  if (resolved !== value || resolved.startsWith('..')) {
    throw new TypeError('Managed path traversal is not allowed');
  }
}

function localRelativePath(protocolPath: string, kind: 'folder' | 'page'): string {
  const portable = kind === 'folder'
    ? validatePortableDirectoryPath(protocolPath)
    : validatePortableMarkdownPath(protocolPath);
  if (portable.path !== protocolPath || !protocolPath.startsWith('pages/')) {
    throw new TypeError('Remote path is not canonical under the managed pages root');
  }
  const value = protocolPath.slice('pages/'.length);
  assertManagedRelativePath(value);
  return value;
}

function localPath(root: string, value: string): string {
  assertManagedRelativePath(value);
  const target = resolve(root, value);
  const inside = relative(resolve(root), target);
  if (inside !== value || inside.startsWith('..')) throw new TypeError('Managed path escaped its root');
  return target;
}

async function checkedPath(
  root: string,
  value: string,
  allowMissingLeaf: boolean,
  options?: FolderTreeTransactionOptionsV2,
): Promise<void> {
  assertManagedRelativePath(value);
  const identities: DirectoryIdentity[] = [];
  let missingLeaf: string | null = null;
  let current = root;
  const parts = value.split('/');
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = join(current, parts[index]!);
    try {
      const entry = await lstat(current, { bigint: true });
      if (entry.isSymbolicLink()) throw new TypeError(`Managed path contains a symbolic link: ${value}`);
      if (index < parts.length - 1 && !entry.isDirectory()) {
        throw new TypeError(`Managed path ancestor is not a directory: ${value}`);
      }
      identities.push({ path: current, dev: entry.dev, ino: entry.ino });
    } catch (error) {
      if (missing(error) && allowMissingLeaf && index === parts.length - 1) {
        missingLeaf = current;
        break;
      }
      throw error;
    }
  }
  await options?.afterPathCheck?.(localPath(root, value));
  for (const identity of identities) {
    const currentIdentity = await lstat(identity.path, { bigint: true });
    if (currentIdentity.isSymbolicLink()
      || currentIdentity.dev !== identity.dev
      || currentIdentity.ino !== identity.ino) {
      throw new TypeError(`Managed path changed device/inode identity before mutation: ${value}`);
    }
  }
  if (missingLeaf !== null) {
    try {
      await lstat(missingLeaf);
      throw new TypeError(`Managed path missing destination appeared before mutation: ${value}`);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}

async function managedPathKind(root: string, value: string): Promise<ManagedPathKind> {
  assertManagedRelativePath(value);
  let current = root;
  const parts = value.split('/');
  for (let index = -1; index < parts.length; index += 1) {
    if (index >= 0) current = join(current, parts[index]!);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new TypeError(`Managed path contains a symbolic link: ${value}`);
      if (index < parts.length - 1 && !entry.isDirectory()) {
        throw new TypeError(`Managed path ancestor is not a directory: ${value}`);
      }
      if (index === parts.length - 1) {
        if (entry.isFile()) return 'file';
        if (entry.isDirectory()) return 'directory';
        return 'other';
      }
    } catch (error) {
      if (missing(error)) return 'missing';
      throw error;
    }
  }
  return 'missing';
}

function operationPaths(operation: FolderTreeOperationV2): string[] {
  return operation.kind === 'link' ? [operation.from, operation.to] : [operation.path];
}

async function capturePathIdentity(root: string, value: string): Promise<PersistedPathIdentityV2> {
  await checkedPath(root, value, true);
  try {
    const entry = await lstat(localPath(root, value), { bigint: true });
    const kind: ManagedPathKind = entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other';
    return { path: value, kind, dev: entry.dev.toString(), ino: entry.ino.toString() };
  } catch (error) {
    if (missing(error)) return { path: value, kind: 'missing' };
    throw error;
  }
}

async function captureOperationIdentity(root: string, operation: FolderTreeOperationV2): Promise<PersistedPathIdentityV2[]> {
  const captured: PersistedPathIdentityV2[] = [];
  for (const value of operationPaths(operation)) captured.push(await capturePathIdentity(root, value));
  return captured;
}

function samePathIdentities(left: PersistedPathIdentityV2[], right: PersistedPathIdentityV2[]): boolean {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entry.path === other.path && entry.kind === other.kind
      && entry.dev === other.dev && entry.ino === other.ino;
  });
}

function assertOperationTransition(
  operation: FolderTreeOperationV2,
  before: PersistedPathIdentityV2[],
  after: PersistedPathIdentityV2[],
): void {
  const invalid = (): never => { throw new TypeError('Folder transaction syscall produced an invalid path transition'); };
  if (operation.kind === 'mkdir') {
    if (before[0]?.kind !== 'missing' || after[0]?.kind !== 'directory') invalid();
    return;
  }
  if (operation.kind === 'link') {
    if (before[0]?.kind !== 'file' || before[1]?.kind !== 'missing'
      || after[0]?.kind !== 'file' || after[1]?.kind !== 'file'
      || before[0].dev !== after[0].dev || before[0].ino !== after[0].ino
      || after[0].dev !== after[1].dev || after[0].ino !== after[1].ino) invalid();
    return;
  }
  if (operation.kind === 'write') {
    if (before[0]?.kind !== 'missing' || after[0]?.kind !== 'file') invalid();
    return;
  }
  if (operation.kind === 'unlink') {
    if (before[0]?.kind !== 'file' || after[0]?.kind !== 'missing') invalid();
    return;
  }
  if (before[0]?.kind !== 'directory' || after[0]?.kind !== 'missing') invalid();
}

async function assertJournalRootIdentity(paths: SpaceWorkspacePaths, journal: FolderTreeJournalV2): Promise<void> {
  if (!journal.rootIdentity) return;
  const current = await lstat(paths.pagesDir, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink()
    || current.dev.toString() !== journal.rootIdentity.dev || current.ino.toString() !== journal.rootIdentity.ino) {
    throw new TypeError('Managed root identity changed while a Folder transaction was active');
  }
}

function depth(path: string): number {
  return path.split('/').length;
}

function assertTreeManifestV2(manifest: TreeRevisionContentManifestV2): TreeRevisionContentManifestV2 {
  const canonical = canonicalTreeRevisionManifestV2(manifest);
  if (canonical.spaceId !== manifest.spaceId) throw new TypeError('Tree manifest Space mismatch');
  const folderIds = new Set<string>();
  const folderPaths = new Set<string>();
  for (const folder of canonical.folders) {
    if (folderIds.has(folder.folderId)) throw new TypeError('Tree manifest contains duplicate Folder IDs');
    const key = pathKey(folder.path);
    if (folderPaths.has(key)) throw new TypeError('Tree manifest contains duplicate Folder paths');
    folderIds.add(folder.folderId);
    folderPaths.add(key);
    localRelativePath(folder.path, 'folder');
  }
  const foldersById = new Map(canonical.folders.map((folder) => [folder.folderId, folder]));
  for (const folder of canonical.folders) {
    const expectedParentPath = folder.parentFolderId === null
      ? 'pages'
      : foldersById.get(folder.parentFolderId)?.path;
    if (!expectedParentPath) throw new TypeError('Folder references an unknown parent Folder');
    if (dirname(folder.path) !== expectedParentPath) throw new TypeError('Folder path does not match its parent identity');
    if (basename(folder.path) !== folder.name) throw new TypeError('Folder path does not match its name');
  }
  const pageIds = new Set<string>();
  const pagePaths = new Set<string>();
  for (const page of canonical.pages) {
    if (pageIds.has(page.pageId)) throw new TypeError('Tree manifest contains duplicate Page IDs');
    const key = pathKey(page.path);
    if (pagePaths.has(key)) throw new TypeError('Tree manifest contains duplicate Page paths');
    if (page.folderId !== null && !folderIds.has(page.folderId)) throw new TypeError('Page references an unknown Folder');
    const expectedDirectory = page.folderId === null
      ? 'pages'
      : canonical.folders.find((folder) => folder.folderId === page.folderId)!.path;
    if (dirname(page.path) !== expectedDirectory) throw new TypeError('Page path does not match its Folder identity');
    pageIds.add(page.pageId);
    pagePaths.add(key);
    localRelativePath(page.path, 'page');
  }
  return canonical;
}

function targetIdentityState(
  target: TreeRevisionContentManifestV2,
  revision: string,
): FolderIdentityStateV2 {
  return assertFolderIdentityStateV2({
    schemaVersion: 2,
    spaceId: target.spaceId,
    revision,
    folders: Object.fromEntries(target.folders.map((folder) => [folder.folderId, {
      path: folder.path,
      pathKey: pathKey(folder.path),
      updatedAt: folder.updatedAt,
    }])),
  });
}

function assertIdentityMatchesBase(
  base: TreeRevisionContentManifestV2,
  state: FolderIdentityStateV2,
): void {
  if (state.spaceId !== base.spaceId) throw new TypeError('Folder identity state belongs to another Space');
  for (const folder of base.folders) {
    const entry = state.folders[folder.folderId];
    if (!entry) {
      throw new TypeError('Folder identity state does not match the base tree');
    }
  }
}

async function existingText(root: string, path: string): Promise<string | null> {
  await checkedPath(root, path, true);
  try {
    const entry = await lstat(localPath(root, path));
    if (entry.isSymbolicLink() || !entry.isFile()) throw new TypeError(`Managed Page destination is unsafe: ${path}`);
    return readFile(localPath(root, path), 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

async function buildFolderTreeOperationsV2(
  paths: SpaceWorkspacePaths,
  base: TreeRevisionContentManifestV2,
  target: TreeRevisionContentManifestV2,
): Promise<FolderTreeOperationV2[]> {
  const operations: FolderTreeOperationV2[] = [];
  const baseFolders = new Map(base.folders.map((folder) => [folder.folderId, folder]));
  const targetFolders = new Map(target.folders.map((folder) => [folder.folderId, folder]));
  const basePages = new Map(base.pages.map((page) => [page.pageId, page]));
  const targetPages = new Map(target.pages.map((page) => [page.pageId, page]));
  const foldersToRemove = base.folders.filter((folder) => {
    const after = targetFolders.get(folder.folderId);
    return !after || after.path !== folder.path;
  }).sort((left, right) => depth(right.path) - depth(left.path) || right.path.localeCompare(left.path));
  const foldersToCreate = target.folders.filter((folder) => {
    const before = baseFolders.get(folder.folderId);
    return !before || before.path !== folder.path;
  }).sort((left, right) => depth(left.path) - depth(right.path) || left.path.localeCompare(right.path));
  const removableFolderPathKeys = new Set(foldersToRemove.map((folder) => pathKey(folder.path)));

  for (const folder of foldersToRemove) {
    const source = localRelativePath(folder.path, 'folder');
    if (await managedPathKind(paths.pagesDir, source) !== 'directory') {
      throw new TypeError(`Managed Folder source disappeared or changed identity: ${folder.path}`);
    }
  }
  for (const folder of foldersToCreate) {
    const destination = localRelativePath(folder.path, 'folder');
    const occupied = await managedPathKind(paths.pagesDir, destination);
    if (occupied !== 'missing' && !(occupied === 'directory' && removableFolderPathKeys.has(pathKey(folder.path)))) {
      throw new TypeError(`Unknown Folder already occupies destination: ${folder.path}`);
    }
  }

  const stagedPages = new Map<string, { path: string; body: string }>();
  const pagesNeedingStage: Array<{ pageId: string; path: string; body: string }> = [];
  for (const page of [...base.pages].sort((left, right) => left.path.localeCompare(right.path))) {
    const after = targetPages.get(page.pageId);
    const source = localRelativePath(page.path, 'page');
    const body = await existingText(paths.pagesDir, source);
    if (body === null) throw new TypeError(`Managed Page source disappeared: ${page.path}`);
    if (!after || after.path !== page.path || after.body !== body) {
      pagesNeedingStage.push({ pageId: page.pageId, path: source, body });
    }
  }

  const stagedSourcePathKeys = new Set(pagesNeedingStage.map((page) => pathKey(`pages/${page.path}`)));
  for (const page of target.pages) {
    const before = basePages.get(page.pageId);
    const destination = localRelativePath(page.path, 'page');
    const occupied = await managedPathKind(paths.pagesDir, destination);
    const sameUnchangedPage = before?.path === page.path && !pagesNeedingStage.some((candidate) => candidate.pageId === page.pageId);
    if (occupied !== 'missing' && !sameUnchangedPage && !stagedSourcePathKeys.has(pathKey(page.path))) {
      throw new TypeError(`Unknown Page already occupies destination: ${page.path}`);
    }
  }

  const needsStagingContainer = pagesNeedingStage.length > 0 || foldersToRemove.length > 0 || foldersToCreate.length > 0;
  const stagingDirectory = `AgentWiki Rename ${randomUUID().slice(0, 8)}`;
  if (needsStagingContainer) {
    if (await managedPathKind(paths.pagesDir, stagingDirectory) !== 'missing') {
      throw new TypeError('Folder transaction staging destination already exists');
    }
    operations.push({ kind: 'mkdir', path: stagingDirectory });
  }

  for (const page of pagesNeedingStage) {
    const stagedPath = `${stagingDirectory}/Page ${randomUUID().slice(0, 8)}.md`;
    stagedPages.set(page.pageId, { path: stagedPath, body: page.body });
    operations.push({ kind: 'link', from: page.path, to: stagedPath });
    operations.push({ kind: 'unlink', path: page.path, before: page.body });
  }

  for (const folder of foldersToRemove) {
    operations.push({ kind: 'rmdir', path: localRelativePath(folder.path, 'folder') });
  }
  for (const folder of foldersToCreate) {
    operations.push({ kind: 'mkdir', path: localRelativePath(folder.path, 'folder') });
  }

  for (const page of target.pages) {
    const before = basePages.get(page.pageId);
    const destination = localRelativePath(page.path, 'page');
    const staged = stagedPages.get(page.pageId);
    if (staged) {
      if (staged.body === page.body) operations.push({ kind: 'link', from: staged.path, to: destination });
      else operations.push({ kind: 'write', path: destination, before: null, after: page.body });
      operations.push({ kind: 'unlink', path: staged.path, before: staged.body });
    } else if (!before) {
      operations.push({ kind: 'write', path: destination, before: null, after: page.body });
    }
  }
  for (const page of pagesNeedingStage) {
    if (!targetPages.has(page.pageId)) {
      const staged = stagedPages.get(page.pageId)!;
      operations.push({ kind: 'unlink', path: staged.path, before: staged.body });
    }
  }
  if (needsStagingContainer) operations.push({ kind: 'rmdir', path: stagingDirectory });
  return operations;
}

async function executeOperation(
  root: string,
  operation: FolderTreeOperationV2,
  options?: FolderTreeTransactionOptionsV2,
  expectedBefore?: PersistedPathIdentityV2[],
): Promise<void> {
  for (const value of operationPaths(operation)) await checkedPath(root, value, true, options);
  if (expectedBefore) {
    const current = await captureOperationIdentity(root, operation);
    if (!samePathIdentities(current, expectedBefore)) {
      throw new TypeError('Managed path identity changed before the transaction syscall');
    }
  }
  if (operation.kind === 'mkdir') {
    await checkedPath(root, operation.path, true, options);
    await mkdir(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  if (operation.kind === 'link') {
    await checkedPath(root, operation.from, false, options);
    await checkedPath(root, operation.to, true, options);
    const source = await lstat(localPath(root, operation.from), { bigint: true });
    if (!source.isFile() || source.isSymbolicLink()) throw new TypeError('Managed Page link source is unsafe');
    await link(localPath(root, operation.from), localPath(root, operation.to));
    await fsyncDirectory(dirname(localPath(root, operation.to)));
    return;
  }
  if (operation.kind === 'write') {
    const current = await existingText(root, operation.path);
    if (current !== null) throw new TypeError('Managed Page destination appeared after transaction planning');
    const destination = localPath(root, operation.path);
    await checkedPath(root, operation.path, true, options);
    const handle = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(operation.after, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsyncDirectory(dirname(destination));
    return;
  }
  if (operation.kind === 'unlink') {
    const current = await existingText(root, operation.path);
    if (current !== operation.before) throw new TypeError('Page changed after transaction planning');
    await checkedPath(root, operation.path, false, options);
    await unlink(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  await checkedPath(root, operation.path, false, options);
  await rmdir(localPath(root, operation.path));
  await fsyncDirectory(dirname(localPath(root, operation.path)));
}

async function reverseOperation(root: string, operation: FolderTreeOperationV2): Promise<void> {
  if (operation.kind === 'mkdir') {
    await checkedPath(root, operation.path, false);
    await rmdir(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  if (operation.kind === 'link') {
    await checkedPath(root, operation.to, false);
    await unlink(localPath(root, operation.to));
    await fsyncDirectory(dirname(localPath(root, operation.to)));
    return;
  }
  if (operation.kind === 'write') {
    await checkedPath(root, operation.path, false);
    await unlink(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  if (operation.kind === 'unlink') {
    await checkedPath(root, operation.path, true);
    const destination = localPath(root, operation.path);
    const handle = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(operation.before, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsyncDirectory(dirname(destination));
    return;
  }
  await checkedPath(root, operation.path, true);
  await mkdir(localPath(root, operation.path), { recursive: false });
  await fsyncDirectory(dirname(localPath(root, operation.path)));
}

function parseFolderTreeJournalV2(value: unknown): FolderTreeJournalV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Folder transaction journal is invalid');
  const journal = value as FolderTreeJournalV2;
  if (Object.keys(journal as unknown as Record<string, unknown>).some((key) => ![
    'schemaVersion', 'spaceId', 'revision', 'phase', 'nextOperation', 'operations', 'operationStates', 'rootIdentity', 'finalState', 'finalTree', 'control',
  ].includes(key))
    || (journal as { schemaVersion?: unknown }).schemaVersion !== 2
    || typeof journal.spaceId !== 'string' || typeof journal.revision !== 'string'
    || !['applying', 'committing', 'committed', 'rolling-back'].includes(journal.phase)
    || !Number.isSafeInteger(journal.nextOperation) || journal.nextOperation < 0
    || !Array.isArray(journal.operations) || journal.operations.length > 20_000
    || journal.nextOperation > journal.operations.length) {
    throw new TypeError('Folder transaction journal version or shape is invalid');
  }
  for (const raw of journal.operations as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Folder transaction journal operation is invalid');
    const operation = raw as Record<string, unknown>;
    if (operation.kind === 'link') {
      if (Object.keys(operation).some((key) => !['kind', 'from', 'to'].includes(key))
        || typeof operation.from !== 'string' || typeof operation.to !== 'string') {
        throw new TypeError('Folder transaction journal link is invalid');
      }
      assertManagedRelativePath(operation.from);
      assertManagedRelativePath(operation.to);
    } else if (operation.kind === 'write') {
      if (Object.keys(operation).some((key) => !['kind', 'path', 'before', 'after'].includes(key))
        || typeof operation.path !== 'string' || operation.before !== null
        || typeof operation.after !== 'string') throw new TypeError('Folder transaction journal write is invalid');
      assertManagedRelativePath(operation.path);
    } else if (operation.kind === 'unlink') {
      if (Object.keys(operation).some((key) => !['kind', 'path', 'before'].includes(key))
        || typeof operation.path !== 'string' || typeof operation.before !== 'string') {
        throw new TypeError('Folder transaction journal unlink is invalid');
      }
      assertManagedRelativePath(operation.path);
    } else if (operation.kind === 'mkdir' || operation.kind === 'rmdir') {
      if (Object.keys(operation).some((key) => !['kind', 'path'].includes(key)) || typeof operation.path !== 'string') {
        throw new TypeError('Folder transaction journal directory operation is invalid');
      }
      assertManagedRelativePath(operation.path);
    } else throw new TypeError('Folder transaction journal operation kind is invalid');
  }
  journal.finalState = assertFolderIdentityStateV2(journal.finalState);
  if (journal.finalState.spaceId !== journal.spaceId || journal.finalState.revision !== journal.revision) {
    throw new TypeError('Folder transaction journal state binding is invalid');
  }
  if (journal.finalTree !== undefined) {
    journal.finalTree = assertTreeManifestV2(journal.finalTree);
    if (journal.finalTree.spaceId !== journal.spaceId) throw new TypeError('Folder transaction final tree binding is invalid');
  }
  if (journal.control !== undefined) {
    if (!journal.control || typeof journal.control !== 'object' || Array.isArray(journal.control)
      || Object.keys(journal.control).some((key) => !['base', 'manifest', 'revisionContentHash'].includes(key))
      || typeof journal.control.revisionContentHash !== 'string'
      || !/^[0-9a-f]{64}$/u.test(journal.control.revisionContentHash)
      || journal.finalTree === undefined) {
      throw new TypeError('Folder transaction control commit is invalid');
    }
    journal.control.base = assertTreeManifestV2(journal.control.base);
    journal.control.manifest = assertLocalManifest(journal.control.manifest);
    if (journal.control.base.spaceId !== journal.spaceId || journal.control.manifest.spaceId !== journal.spaceId
      || journal.control.manifest.baseRevision?.revision !== journal.revision
      || journal.control.manifest.baseRevision.contentHash !== journal.control.revisionContentHash) {
      throw new TypeError('Folder transaction control commit binding is invalid');
    }
  } else if (journal.phase === 'committed') {
    throw new TypeError('Folder transaction committed phase is missing its control commit');
  }
  if (!journal.rootIdentity || !/^\d+$/u.test(journal.rootIdentity.dev) || !/^\d+$/u.test(journal.rootIdentity.ino)) {
    throw new TypeError('Folder transaction journal root identity is invalid');
  }
  if (!Array.isArray(journal.operationStates) || journal.operationStates.length !== journal.operations.length) {
    throw new TypeError('Folder transaction journal operation states are invalid');
  }
  for (let index = 0; index < journal.operationStates.length; index += 1) {
    const state = journal.operationStates[index]!;
    if (!state || !['prepared', 'ambiguous', 'applied'].includes(state.status)
      || !Array.isArray(state.before) || (state.after !== undefined && !Array.isArray(state.after))) {
      throw new TypeError('Folder transaction journal operation state is invalid');
    }
    const expectedPaths = operationPaths(journal.operations[index]!);
    const validateIdentities = (identities: PersistedPathIdentityV2[], allowEmpty: boolean): void => {
      if (!(allowEmpty && identities.length === 0)
        && (identities.length !== expectedPaths.length || identities.some((identity, identityIndex) => identity.path !== expectedPaths[identityIndex]))) {
        throw new TypeError('Folder transaction journal path identities do not bind to their operation');
      }
      for (const identity of identities) {
        if (!identity || Object.keys(identity).some((key) => !['path', 'kind', 'dev', 'ino'].includes(key))
          || typeof identity.path !== 'string' || !['missing', 'file', 'directory', 'other'].includes(identity.kind)) {
          throw new TypeError('Folder transaction journal path identity is invalid');
        }
        assertManagedRelativePath(identity.path);
        if (identity.kind === 'missing') {
          if (identity.dev !== undefined || identity.ino !== undefined) throw new TypeError('Missing journal identity has inode data');
        } else if (typeof identity.dev !== 'string' || typeof identity.ino !== 'string'
          || !/^\d+$/u.test(identity.dev) || !/^\d+$/u.test(identity.ino)) {
          throw new TypeError('Folder transaction journal inode identity is invalid');
        }
      }
    };
    validateIdentities(state.before, state.status === 'prepared');
    if (state.status === 'applied') {
      if (!state.after) throw new TypeError('Applied Folder transaction journal state is missing its post-state');
      validateIdentities(state.after, false);
    } else if (state.after !== undefined) {
      throw new TypeError('Unapplied Folder transaction journal state has a post-state');
    }
  }
  return journal;
}

async function readFolderTreeJournalV2(paths: SpaceWorkspacePaths): Promise<FolderTreeJournalV2 | null> {
  if (!existsSync(paths.folderTransactionJournalFile)) return null;
  return parseFolderTreeJournalV2(JSON.parse(await readFile(paths.folderTransactionJournalFile, 'utf8')));
}

async function clearFolderTreeJournalV2(paths: SpaceWorkspacePaths): Promise<void> {
  try { await unlink(paths.folderTransactionJournalFile); } catch (error) { if (!missing(error)) throw error; }
  await fsyncDirectory(dirname(paths.folderTransactionJournalFile));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function assertFolderTreeControlCommitV2(
  paths: SpaceWorkspacePaths,
  journal: FolderTreeJournalV2,
): Promise<void> {
  if (!journal.control || !journal.finalTree) throw new TypeError('Folder transaction control commit is incomplete');
  await assertJournalRootIdentity(paths, journal);
  const storedBase = await readBase(paths, journal.revision);
  let canonicalBase: TreeRevisionContentManifestV2;
  try { canonicalBase = assertTreeManifestV2(storedBase as TreeRevisionContentManifestV2); }
  catch { throw new TypeError('Folder transaction base commit is missing or invalid'); }
  if (!sameJson(canonicalBase, journal.control.base)
    || await treeRevisionContentHashV2(canonicalBase) !== journal.control.revisionContentHash) {
    throw new TypeError('Folder transaction base commit does not match its revision hash');
  }
  const storedState = await readFolderIdentityStateV2(paths);
  if (!sameJson(storedState, journal.finalState)) throw new TypeError('Folder transaction identity commit is incomplete');
  const storedManifest = await readManifest(paths);
  if (!sameJson(storedManifest, journal.control.manifest)) throw new TypeError('Folder transaction manifest commit is incomplete');
  for (const folder of journal.finalTree.folders) {
    const relativePath = localRelativePath(folder.path, 'folder');
    await checkedPath(paths.pagesDir, relativePath, false);
    const entry = await lstat(localPath(paths.pagesDir, relativePath));
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new TypeError('Folder transaction final Folder is missing or unsafe');
  }
  for (const page of journal.finalTree.pages) {
    const relativePath = localRelativePath(page.path, 'page');
    await checkedPath(paths.pagesDir, relativePath, false);
    const entry = await lstat(localPath(paths.pagesDir, relativePath));
    if (entry.isSymbolicLink() || !entry.isFile()) throw new TypeError('Folder transaction final Page is missing or unsafe');
    const body = await readFile(localPath(paths.pagesDir, relativePath), 'utf8');
    if (body !== page.body || await treePageContentHash(body) !== page.contentHash) {
      throw new TypeError('Folder transaction final Page content does not match its durable tree');
    }
  }
}

async function commitFolderTreeControlV2(
  paths: SpaceWorkspacePaths,
  journal: FolderTreeJournalV2,
  options?: FolderTreeTransactionOptionsV2,
): Promise<void> {
  if (!journal.control) throw new TypeError('Folder transaction control commit is missing');
  await writeBase(paths, journal.revision, journal.control.base);
  await options?.onCheckpoint?.('control:base');
  await writeFolderIdentityStateV2(paths, journal.finalState);
  await options?.onCheckpoint?.('control:identity');
  await writeManifest(paths, journal.control.manifest);
  await options?.onCheckpoint?.('control:manifest');
  await assertFolderTreeControlCommitV2(paths, journal);
  journal.phase = 'committed';
  await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
  await options?.onCheckpoint?.('control:committed');
  await clearFolderTreeJournalV2(paths);
}

async function replayFolderTreeJournalV2(
  paths: SpaceWorkspacePaths,
  journal: FolderTreeJournalV2,
  options?: FolderTreeTransactionOptionsV2,
): Promise<void> {
  if (journal.phase === 'rolling-back') throw new TypeError('Folder transaction rollback must be completed before replay');
  await assertJournalRootIdentity(paths, journal);
  if (journal.phase === 'applying') for (let index = journal.nextOperation; index < journal.operations.length; index += 1) {
    const operation = journal.operations[index]!;
    const state = journal.operationStates![index]!;
    if (state.status === 'applied') {
      const current = await captureOperationIdentity(paths.pagesDir, operation);
      if (!state.after || !samePathIdentities(current, state.after)) {
        throw new TypeError('Folder transaction applied path state was replaced; journal was preserved');
      }
      journal.nextOperation = index + 1;
      await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
      await options?.onCheckpoint?.(`operation:${index}:committed`);
      continue;
    }
    if (state.status === 'ambiguous') {
      const current = await captureOperationIdentity(paths.pagesDir, operation);
      if (!samePathIdentities(current, state.before)) {
        throw new TypeError('Folder transaction is ambiguous; refusing to mutate an unproven path state');
      }
      state.status = 'prepared';
      await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    }
    if (state.before.length === 0) {
      state.before = await captureOperationIdentity(paths.pagesDir, operation);
      await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    } else {
      const current = await captureOperationIdentity(paths.pagesDir, operation);
      if (!samePathIdentities(current, state.before)) {
        throw new TypeError('Folder transaction prepared path state was replaced; journal was preserved');
      }
    }
    state.after = undefined;
    state.status = 'prepared';
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    await options?.onCheckpoint?.(`operation:${index}:prepared`);
    state.status = 'ambiguous';
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    await executeOperation(paths.pagesDir, operation, options, state?.before);
    await options?.onCheckpoint?.(`operation:${index}:syscall`);
    state.after = await captureOperationIdentity(paths.pagesDir, operation);
    assertOperationTransition(operation, state.before, state.after);
    state.status = 'applied';
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    await options?.onCheckpoint?.(`operation:${index}:fsync`);
    await options?.onCheckpoint?.(`operation:${index}:applied`);
    journal.nextOperation = index + 1;
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    await options?.onCheckpoint?.(`operation:${index}:committed`);
  }
  if (journal.control) {
    if (journal.phase === 'applying') {
      journal.phase = 'committing';
      await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
      await options?.onCheckpoint?.('control:prepared');
    }
    await commitFolderTreeControlV2(paths, journal, options);
    return;
  }
  if (journal.phase === 'applying') {
    journal.phase = 'committing';
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
  }
  await writeFolderIdentityStateV2(paths, journal.finalState);
  await options?.onCheckpoint?.('state:committed');
  await clearFolderTreeJournalV2(paths);
}

export async function applyFolderTreeTransactionV2(
  paths: SpaceWorkspacePaths,
  baseInput: TreeRevisionContentManifestV2,
  targetInput: TreeRevisionContentManifestV2,
  currentStateInput: FolderIdentityStateV2,
  options: FolderTreeTransactionOptionsV2,
): Promise<void> {
  if (await readFolderTreeJournalV2(paths)) throw new TypeError('A Folder transaction requires recovery before a new apply');
  const base = assertTreeManifestV2(baseInput);
  const target = assertTreeManifestV2(targetInput);
  const currentState = assertFolderIdentityStateV2(currentStateInput);
  if (base.spaceId !== target.spaceId || target.spaceId !== currentState.spaceId) throw new TypeError('Folder transaction Space mismatch');
  assertIdentityMatchesBase(base, currentState);
  await checkedPath(paths.pagesDir, 'transaction-root-check', true, options);
  for (const page of target.pages) {
    if (await treePageContentHash(page.body) !== page.contentHash) {
      throw new TypeError(`Page ${page.pageId} content hash is invalid`);
    }
  }
  let control: FolderTreeJournalV2['control'];
  if (options.controlBase) {
    const controlBase = assertTreeManifestV2(options.controlBase);
    if (controlBase.spaceId !== target.spaceId) throw new TypeError('Folder transaction control base Space mismatch');
    const computedRevisionContentHash = await treeRevisionContentHashV2(controlBase);
    if (options.revisionContentHash && options.revisionContentHash !== computedRevisionContentHash) {
      throw new TypeError('Folder transaction control base hash mismatch');
    }
    const localManifest = await readManifest(paths);
    if (!localManifest || localManifest.spaceId !== target.spaceId) {
      throw new TypeError('Folder transaction control manifest is missing or belongs to another Space');
    }
    const pulledAt = options.pulledAt ?? new Date().toISOString();
    control = {
      base: controlBase,
      revisionContentHash: computedRevisionContentHash,
      manifest: assertLocalManifest({
        ...localManifest,
        baseRevision: { revision: options.revision, pulledAt, contentHash: computedRevisionContentHash },
        updatedAt: pulledAt,
      }),
    };
  } else if (options.revisionContentHash !== undefined || options.pulledAt !== undefined) {
    throw new TypeError('Folder transaction control metadata requires a control base');
  }
  const journal: FolderTreeJournalV2 = {
    schemaVersion: 2,
    spaceId: target.spaceId,
    revision: options.revision,
    phase: 'applying',
    nextOperation: 0,
    operations: await buildFolderTreeOperationsV2(paths, base, target),
    operationStates: [],
    rootIdentity: undefined,
    finalState: targetIdentityState(target, options.revision),
    ...(control ? { finalTree: target, control } : {}),
  };
  const rootIdentity = await lstat(paths.pagesDir, { bigint: true });
  if (!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink()) throw new TypeError('Managed pages root is unsafe');
  journal.rootIdentity = { dev: rootIdentity.dev.toString(), ino: rootIdentity.ino.toString() };
  journal.operationStates = journal.operations.map(() => ({ status: 'prepared', before: [] }));
  await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
  await options.onCheckpoint?.('journal:committed');
  await replayFolderTreeJournalV2(paths, journal, options);
}

export async function recoverFolderTreeTransactionV2(
  paths: SpaceWorkspacePaths,
  mode: 'replay' | 'rollback',
): Promise<void> {
  const journal = await readFolderTreeJournalV2(paths);
  if (!journal) return;
  if (mode === 'replay') {
    await replayFolderTreeJournalV2(paths, journal);
    return;
  }
  await assertJournalRootIdentity(paths, journal);
  if (journal.phase === 'committing' || journal.phase === 'committed') {
    await replayFolderTreeJournalV2(paths, journal);
    return;
  }
  if (journal.phase === 'applying') {
    journal.phase = 'rolling-back';
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
  }
  if (journal.operationStates) {
    for (let index = journal.operations.length - 1; index >= 0; index -= 1) {
      const state = journal.operationStates[index]!;
      if (state.status === 'prepared') continue;
      const current = await captureOperationIdentity(paths.pagesDir, journal.operations[index]!);
      if (state.status === 'ambiguous') {
        if (samePathIdentities(current, state.before)) continue;
        if (!state.after || !samePathIdentities(current, state.after)) {
          throw new TypeError('Folder transaction rollback is ambiguous; journal was preserved');
        }
      } else if (!state.after || !samePathIdentities(current, state.after)) {
        throw new TypeError('Folder transaction post-state was replaced; journal was preserved');
      }
      await reverseOperation(paths.pagesDir, journal.operations[index]!);
      state.status = 'prepared';
      state.before = await captureOperationIdentity(paths.pagesDir, journal.operations[index]!);
      state.after = undefined;
      await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    }
    await fsyncDirectory(paths.pagesDir);
    await clearFolderTreeJournalV2(paths);
    return;
  }
  // The cursor is persisted only after the mutation and its fsync checkpoint.
  // Therefore the operation at nextOperation may have taken effect before a crash.
  for (let index = Math.min(journal.nextOperation - 1, journal.operations.length - 1); index >= 0; index -= 1) {
    await reverseOperation(paths.pagesDir, journal.operations[index]!);
  }
  await fsyncDirectory(paths.pagesDir);
  await clearFolderTreeJournalV2(paths);
}
