import { randomUUID } from 'node:crypto';
import { constants, existsSync } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  canonicalTreeRevisionManifestV2,
  contentHash as treePageContentHash,
  pathKey,
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
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'write'; path: string; before: string | null; after: string }
  | { kind: 'unlink'; path: string; before: string }
  | { kind: 'rmdir'; path: string };

interface FolderTreeJournalV2 {
  schemaVersion: 2;
  spaceId: string;
  revision: string;
  nextOperation: number;
  operations: FolderTreeOperationV2[];
  finalState: FolderIdentityStateV2;
}

export interface FolderTreeTransactionOptionsV2 {
  revision: string;
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
      if (missing(error) && allowMissingLeaf && index === parts.length - 1) break;
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

function depth(path: string): number {
  return path.split('/').length;
}

function remapPath(path: string, remaps: ReadonlyMap<string, string>): string {
  const candidate = [...remaps.entries()]
    .filter(([oldPath]) => path === oldPath || path.startsWith(`${oldPath}/`))
    .sort(([left], [right]) => right.length - left.length)[0];
  if (!candidate) return path;
  return `${candidate[1]}${path.slice(candidate[0].length)}`;
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
  const baseById = new Map(base.folders.map((folder) => [folder.folderId, folder]));
  if (Object.keys(state.folders).length !== baseById.size) throw new TypeError('Folder identity state does not match the base tree');
  for (const [folderId, entry] of Object.entries(state.folders)) {
    const folder = baseById.get(folderId);
    if (!folder || folder.path !== entry.path || pathKey(folder.path) !== entry.pathKey) {
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
  const remaps = new Map<string, string>();

  for (const folder of target.folders.filter((value) => !baseFolders.has(value.folderId)).sort((a, b) => depth(a.path) - depth(b.path))) {
    const destination = localRelativePath(folder.path, 'folder');
    if (await managedPathKind(paths.pagesDir, destination) !== 'missing') {
      throw new TypeError(`Unknown Folder already occupies destination: ${folder.path}`);
    }
    operations.push({ kind: 'mkdir', path: destination });
  }

  for (const folder of target.folders.filter((value) => {
    const before = baseFolders.get(value.folderId);
    return before !== undefined && before.path !== value.path;
  }).sort((a, b) => depth(a.path) - depth(b.path))) {
    const before = baseFolders.get(folder.folderId)!;
    const currentProtocolPath = remapPath(before.path, remaps);
    if (currentProtocolPath !== folder.path) {
      const current = localRelativePath(currentProtocolPath, 'folder');
      const destination = localRelativePath(folder.path, 'folder');
      if (pathKey(currentProtocolPath) === pathKey(folder.path)) {
        const temporary = join(dirname(current), `AgentWiki Rename ${randomUUID().slice(0, 8)}`).replaceAll('\\', '/');
        operations.push({ kind: 'rename', from: current, to: temporary });
        operations.push({ kind: 'rename', from: temporary, to: destination });
      } else {
        operations.push({ kind: 'rename', from: current, to: destination });
      }
    }
    remaps.set(before.path, folder.path);
  }

  for (const page of target.pages) {
    const before = basePages.get(page.pageId);
    const destination = localRelativePath(page.path, 'page');
    let beforeText: string | null;
    if (before) {
      const currentProtocolPath = remapPath(before.path, remaps);
      const current = localRelativePath(currentProtocolPath, 'page');
      beforeText = await existingText(paths.pagesDir, localRelativePath(before.path, 'page'));
      if (beforeText === null) throw new TypeError(`Managed Page source disappeared: ${before.path}`);
      if (current !== destination) {
        if (pathKey(currentProtocolPath) !== pathKey(page.path)
          && await managedPathKind(paths.pagesDir, destination) !== 'missing') {
          throw new TypeError(`Unknown Page already occupies destination: ${page.path}`);
        }
        if (pathKey(currentProtocolPath) === pathKey(page.path)) {
          const temporary = join(dirname(current), `AgentWiki Rename ${randomUUID().slice(0, 8)}.md`).replaceAll('\\', '/');
          operations.push({ kind: 'rename', from: current, to: temporary });
          operations.push({ kind: 'rename', from: temporary, to: destination });
        } else {
          operations.push({ kind: 'rename', from: current, to: destination });
        }
      }
    } else {
      if (await managedPathKind(paths.pagesDir, destination) !== 'missing') {
        throw new TypeError(`Unknown Page already occupies destination: ${page.path}`);
      }
      beforeText = null;
    }
    if (beforeText !== page.body) operations.push({ kind: 'write', path: destination, before: beforeText, after: page.body });
  }

  for (const page of base.pages.filter((value) => !targetPages.has(value.pageId))) {
    const current = localRelativePath(remapPath(page.path, remaps), 'page');
    const before = await existingText(paths.pagesDir, current);
    if (before !== null) operations.push({ kind: 'unlink', path: current, before });
  }

  for (const folder of base.folders.filter((value) => !targetFolders.has(value.folderId)).sort((a, b) => depth(b.path) - depth(a.path))) {
    operations.push({ kind: 'rmdir', path: localRelativePath(remapPath(folder.path, remaps), 'folder') });
  }
  return operations;
}

async function executeOperation(
  root: string,
  operation: FolderTreeOperationV2,
  options?: FolderTreeTransactionOptionsV2,
): Promise<void> {
  if (operation.kind === 'mkdir') {
    await checkedPath(root, operation.path, true, options);
    try {
      const existing = await lstat(localPath(root, operation.path));
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new TypeError('Folder destination is unsafe');
      return;
    } catch (error) { if (!missing(error)) throw error; }
    await mkdir(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  if (operation.kind === 'rename') {
    await checkedPath(root, operation.from, true, options);
    await checkedPath(root, operation.to, true, options);
    const sourceExists = existsSync(localPath(root, operation.from));
    const destinationExists = existsSync(localPath(root, operation.to));
    if (!sourceExists && destinationExists) return;
    if (!sourceExists) throw new TypeError('Rename source disappeared');
    if (destinationExists) throw new TypeError('Rename destination already exists');
    await rename(localPath(root, operation.from), localPath(root, operation.to));
    await fsyncDirectory(dirname(localPath(root, operation.from)));
    if (dirname(operation.from) !== dirname(operation.to)) await fsyncDirectory(dirname(localPath(root, operation.to)));
    return;
  }
  if (operation.kind === 'write') {
    await checkedPath(root, operation.path, true, options);
    const current = await existingText(root, operation.path);
    if (current === operation.after) return;
    if (current !== operation.before) throw new TypeError('Page changed after transaction planning');
    const destination = localPath(root, operation.path);
    const temporary = join(dirname(destination), `AgentWiki Write ${randomUUID().slice(0, 8)}.tmp`);
    await writeFile(temporary, operation.after, { encoding: 'utf8', flag: 'wx' });
    const handle = await open(temporary, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, destination);
    await fsyncDirectory(dirname(destination));
    return;
  }
  if (operation.kind === 'unlink') {
    await checkedPath(root, operation.path, true, options);
    const current = await existingText(root, operation.path);
    if (current === null) return;
    if (current !== operation.before) throw new TypeError('Page changed after transaction planning');
    await unlink(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
    return;
  }
  await checkedPath(root, operation.path, true, options);
  try {
    await rmdir(localPath(root, operation.path));
    await fsyncDirectory(dirname(localPath(root, operation.path)));
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

async function reverseOperation(root: string, operation: FolderTreeOperationV2): Promise<void> {
  if (operation.kind === 'mkdir') {
    try { await rmdir(localPath(root, operation.path)); } catch (error) { if (!missing(error)) throw error; }
    return;
  }
  if (operation.kind === 'rename') {
    const source = localPath(root, operation.from);
    const destination = localPath(root, operation.to);
    if (!existsSync(source) && existsSync(destination)) await rename(destination, source);
    return;
  }
  if (operation.kind === 'write') {
    const destination = localPath(root, operation.path);
    if (operation.before === null) {
      try { await unlink(destination); } catch (error) { if (!missing(error)) throw error; }
    } else {
      await writeFile(destination, operation.before, 'utf8');
    }
    return;
  }
  if (operation.kind === 'unlink') {
    await mkdir(dirname(localPath(root, operation.path)), { recursive: true });
    await writeFile(localPath(root, operation.path), operation.before, 'utf8');
    return;
  }
  try { await mkdir(localPath(root, operation.path), { recursive: false }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
}

function parseFolderTreeJournalV2(value: unknown): FolderTreeJournalV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Folder transaction journal is invalid');
  const journal = value as FolderTreeJournalV2;
  if ((journal as { schemaVersion?: unknown }).schemaVersion !== 2
    || typeof journal.spaceId !== 'string' || typeof journal.revision !== 'string'
    || !Number.isSafeInteger(journal.nextOperation) || journal.nextOperation < 0
    || !Array.isArray(journal.operations) || journal.operations.length > 20_000
    || journal.nextOperation > journal.operations.length) {
    throw new TypeError('Folder transaction journal version or shape is invalid');
  }
  for (const raw of journal.operations as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Folder transaction journal operation is invalid');
    const operation = raw as Record<string, unknown>;
    if (operation.kind === 'rename') {
      if (Object.keys(operation).some((key) => !['kind', 'from', 'to'].includes(key))
        || typeof operation.from !== 'string' || typeof operation.to !== 'string') {
        throw new TypeError('Folder transaction journal rename is invalid');
      }
      assertManagedRelativePath(operation.from);
      assertManagedRelativePath(operation.to);
    } else if (operation.kind === 'write') {
      if (Object.keys(operation).some((key) => !['kind', 'path', 'before', 'after'].includes(key))
        || typeof operation.path !== 'string' || !(operation.before === null || typeof operation.before === 'string')
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

async function replayFolderTreeJournalV2(
  paths: SpaceWorkspacePaths,
  journal: FolderTreeJournalV2,
  options?: FolderTreeTransactionOptionsV2,
): Promise<void> {
  for (let index = journal.nextOperation; index < journal.operations.length; index += 1) {
    await executeOperation(paths.pagesDir, journal.operations[index]!, options);
    await options?.onCheckpoint?.(`operation:${index}:fsync`);
    journal.nextOperation = index + 1;
    await writeJsonAtomic(paths.folderTransactionJournalFile, journal);
    await options?.onCheckpoint?.(`operation:${index}:committed`);
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
  const journal: FolderTreeJournalV2 = {
    schemaVersion: 2,
    spaceId: target.spaceId,
    revision: options.revision,
    nextOperation: 0,
    operations: await buildFolderTreeOperationsV2(paths, base, target),
    finalState: targetIdentityState(target, options.revision),
  };
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
  // The cursor is persisted only after the mutation and its fsync checkpoint.
  // Therefore the operation at nextOperation may have taken effect before a crash.
  for (let index = Math.min(journal.nextOperation, journal.operations.length - 1); index >= 0; index -= 1) {
    await reverseOperation(paths.pagesDir, journal.operations[index]!);
  }
  await fsyncDirectory(paths.pagesDir);
  await clearFolderTreeJournalV2(paths);
}
