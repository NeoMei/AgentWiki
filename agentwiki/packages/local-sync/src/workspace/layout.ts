import { join } from 'node:path';

/**
 * Space Local Workspace layout.
 *
 * ~/.agentwiki/spaces/<space-id>/
 *   wiki/          - agent-readable knowledge (pages, memories, relations)
 *   .state/        - orchestrator internal state (manifest, base, drafts, checkpoints)
 */

export interface SpaceWorkspacePaths {
  root: string;
  wikiRoot: string;
  pagesDir: string;
  memoriesDir: string;
  relationsFile: string;
  stateRoot: string;
  manifestFile: string;
  provenanceFile: string;
  baseDir: string;
  draftsDir: string;
  checkpointsDir: string;
  runtimeDir: string;
}

export function workspacePaths(baseDir: string, spaceId: string): SpaceWorkspacePaths {
  const root = join(baseDir, 'spaces', spaceId);
  return {
    root,
    wikiRoot: join(root, 'wiki'),
    pagesDir: join(root, 'wiki', 'pages'),
    memoriesDir: join(root, 'wiki', 'memories'),
    relationsFile: join(root, 'wiki', 'relations.json'),
    stateRoot: join(root, '.state'),
    manifestFile: join(root, '.state', 'manifest.json'),
    provenanceFile: join(root, '.state', 'provenance.json'),
    baseDir: join(root, '.state', 'base'),
    draftsDir: join(root, '.state', 'drafts'),
    checkpointsDir: join(root, '.state', 'checkpoints'),
    runtimeDir: join(root, '.state', 'runtime'),
  };
}
