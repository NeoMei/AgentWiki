import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertJobState, type JobState } from '../protocol/job.js';
import { assertLocalManifest, type LocalManifest } from './manifest.js';
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
  const tmp = `${filePath}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  await rm(tmp, { force: true });
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
