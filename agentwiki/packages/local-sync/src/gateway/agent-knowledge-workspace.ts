import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeBundleSchema } from '../protocol/bundle.js';
import { workspacePaths } from '../workspace/layout.js';
import { readBase, readManifest } from '../workspace/state.js';

export const LEGACY_TREE_WORKSPACE_WARNING = 'Existing device/tree workspace and unsynced edits were preserved. Agent knowledge uses a separate Space workspace; device edits are not automatically submitted.';

/**
 * Old gateways stored human device tree state at the same Space path as Agent
 * knowledge. Never reinterpret or rewrite that state as a KnowledgeBundle.
 * Keep it intact and select a separate, deterministic Agent workspace instead.
 */
export async function agentKnowledgeWorkspace(home: string, spaceId: string): Promise<{ home: string; isolated: boolean }> {
  const isolatedHome = join(home, '.agentwiki', 'agent-knowledge');
  // Once created, keep using the isolated workspace even if the old one moves.
  if (await exists(workspacePaths(isolatedHome, spaceId).root)) return { home: isolatedHome, isolated: true };
  const previous = workspacePaths(home, spaceId);
  if (await exists(previous.folderIdentityFile) || await exists(previous.folderTransactionJournalFile)) return { home: isolatedHome, isolated: true };
  const manifest = await readManifest(previous);
  if (manifest?.baseRevision) {
    const base = await readBase(previous, manifest.baseRevision.revision);
    if (base && typeof base === 'object' && 'protocolVersion' in base && base.protocolVersion === '2') return { home: isolatedHome, isolated: true };
    if (base === null) {
      throw Object.assign(new Error('Confirmed local base is missing. Existing workspace files and unsynced edits were preserved; restore the missing base before retrying.'), { code: 'AGENT_KNOWLEDGE_BASE_MISSING' });
    }
    if (!KnowledgeBundleSchema.safeParse(base).success) {
      throw new Error('Agent knowledge workspace has an unrecognized base. Existing files were preserved; repair the workspace before retrying.');
    }
  }
  return { home, isolated: false };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
