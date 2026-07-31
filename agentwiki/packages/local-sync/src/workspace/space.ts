import { workspacePaths, type SpaceWorkspacePaths } from './layout.js';
import { ensureWorkspace, initManifest, readManifest, writeManifest } from './state.js';
import { stableId } from '../utils/id.js';

export { workspacePaths, type SpaceWorkspacePaths };

export const DEFAULT_AGENTWIKI_HOME = '~/.agentwiki' as const;

export interface SpaceWorkspace {
  paths: SpaceWorkspacePaths;
  spaceId: string;
}

export function resolveAgentWikiHome(raw?: string): string {
  if (raw && raw !== DEFAULT_AGENTWIKI_HOME) return raw;
  const home = process.env.AGENTWIKI_HOME ?? process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error('Cannot resolve ~/.agentwiki: no HOME or AGENTWIKI_HOME set');
  return `${home}/.agentwiki`;
}

export function spaceWorkspacePaths(home: string, spaceId: string): SpaceWorkspacePaths {
  return workspacePaths(resolveAgentWikiHome(home), spaceId);
}

export function stableSpaceId(input: string): string {
  return stableId('agentwiki:space', input);
}

export async function initSpaceWorkspace(home: string, spaceId: string): Promise<SpaceWorkspace> {
  const paths = spaceWorkspacePaths(home, spaceId);
  await ensureWorkspace(paths);
  const existing = await readManifest(paths);
  if (!existing) {
    await initManifest(paths, spaceId);
  }
  return { paths, spaceId };
}

export async function isWorkspaceInitialized(home: string, spaceId: string): Promise<boolean> {
  const paths = spaceWorkspacePaths(home, spaceId);
  const manifest = await readManifest(paths);
  return manifest?.spaceId === spaceId;
}

export async function setBaseRevision(
  home: string,
  spaceId: string,
  revision: string,
  contentHash: string,
): Promise<void> {
  const paths = spaceWorkspacePaths(home, spaceId);
  const manifest = await readManifest(paths);
  if (!manifest) throw new Error(`No manifest for space ${spaceId}`);
  const now = new Date().toISOString();
  manifest.baseRevision = { revision, pulledAt: now, contentHash };
  manifest.updatedAt = now;
  await writeManifest(paths, manifest);
}
