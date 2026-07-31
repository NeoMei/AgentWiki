import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestratorCommands, type OrchestratorCommandDeps } from './orchestrator-commands.js';
import { AgentWikiClient } from './agentwiki-client.js';
import type { LocalSyncConnection } from './config.js';
import type { Recipe } from './protocol/recipe.js';

function makeConnection(): LocalSyncConnection {
  return {
    id: 'conn-1',
    serverUrl: 'http://localhost:3000/api',
    agentId: 'agent-1',
    credentialId: 'cred-1',
    pluginVersion: '0.2.0',
    client: 'codex',
    mcpName: 'agentwiki-local',
  };
}

function makeRecipe(): Recipe {
  return {
    recipeId: 'code-wiki@1',
    version: '1',
    name: 'Code Wiki',
    description: 'Organize code into a wiki.',
    steps: [],
    identityFields: ['pageId'],
    mergeStrategy: 'by-field' as const,
    constraints: {
      maxRepairCycles: 3,
      maxArtifactsPerWorkItem: 10,
      maxConflictFields: 20,
      requireProvenance: false,
      requireEvidence: false,
      sensitivityGate: 'none',
    },
  };
}

function makeDeps(home: string): OrchestratorCommandDeps {
  return {
    home,
    connection: makeConnection(),
    readApiKey: async () => 'agk_test',
    client: new AgentWikiClient(),
    adapters: [],
    recipes: [makeRecipe()],
    now: () => new Date('2026-07-31T00:00:00.000Z'),
  };
}

describe('orchestrator commands', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'agentwiki-orchestrator-test-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('starts a knowledge job and returns a pending state', async () => {
    const commands = createOrchestratorCommands(makeDeps(tempHome));
    const state = await commands.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', sourcePaths: ['/tmp'] });
    expect(state.spaceId).toBe('space-1');
    expect(state.recipeId).toBe('code-wiki@1');
    expect(state.phase).toBe('discover');
  });

  it('returns the next work item for a new job', async () => {
    const commands = createOrchestratorCommands(makeDeps(tempHome));
    const state = await commands.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', sourcePaths: ['/tmp'] });
    const item = await commands.next({ jobId: state.jobId });
    expect(item).toBeNull();
  });

  it('builds a preview bundle without uploading', async () => {
    const commands = createOrchestratorCommands(makeDeps(tempHome));
    const state = await commands.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', sourcePaths: ['/tmp'] });
    const preview = await commands.preview({ jobId: state.jobId });
    expect(preview.bundle.spaceId).toBe('space-1');
    expect(preview.bundle.schemaVersion).toBe('knowledge-bundle@1');
  });
});
