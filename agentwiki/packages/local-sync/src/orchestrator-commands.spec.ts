import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestratorCommands, type OrchestratorCommandDeps } from './orchestrator-commands.js';
import { AgentWikiClient } from './agentwiki-client.js';
import type { LocalSyncConnection } from './config.js';
import { AdapterManager } from './adapter/manager.js';
import type { SourceAdapter } from './protocol/adapter.js';
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

function makeRecipeWithStep(): Recipe {
  return {
    recipeId: 'code-wiki@1',
    version: '1',
    name: 'Code Wiki',
    description: 'Organize code into a wiki.',
    steps: [
      {
        stepId: 'collect-1',
        phase: 'discover',
        description: 'Collect artifacts from the source path',
        requiredArtifactKinds: ['code'],
        retryCount: 0,
      },
    ],
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

function makeMockAdapter(): SourceAdapter {
  return {
    manifest: () => ({
      adapterId: 'mock',
      version: '1.0.0',
      protocolVersion: 'source-adapter@1',
      inputKinds: ['directory'],
      artifactKinds: ['code'],
      supportsIncremental: false,
      permissions: ['read-source-path'],
      runtime: { kind: 'native-binary' },
    }),
    inspect: async () => ({
      adapterId: 'mock',
      sourcePath: '/tmp',
      displayName: 'Mock',
      kind: 'code',
      estimatedArtifacts: 1,
      sourceHash: 'a'.repeat(64),
    }),
    collect: async () => ({
      artifacts: [{
        schemaVersion: 'source-artifact@1',
        artifactId: 'artifact-mock',
        adapterId: 'mock',
        adapterVersion: '1.0.0',
        sourceId: 'source-1',
        logicalKey: 'module/mock',
        contentHash: 'b'.repeat(64),
        updatedAt: '2026-07-31T00:00:00.000Z',
        kind: 'code',
        content: { title: 'Mock Module', body: 'Mock body' },
        evidence: [{ sourcePath: '/tmp', locator: 'mock' }],
        sensitivity: 'shareable',
      }],
      hasMore: false,
    }),
  };
}

function makeDeps(home: string): OrchestratorCommandDeps {
  return {
    home,
    connection: makeConnection(),
    readApiKey: async () => 'agk_test',
    client: new AgentWikiClient(),
    adapters: [makeMockAdapter()],
    recipes: [makeRecipe()],
    now: () => new Date('2026-07-31T00:00:00.000Z'),
  };
}

function makeDepsWithRecipe(home: string, recipe: Recipe): OrchestratorCommandDeps {
  return {
    home,
    connection: makeConnection(),
    readApiKey: async () => 'agk_test',
    client: new AgentWikiClient(),
    adapters: [makeMockAdapter()],
    recipes: [recipe],
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

  it('reads artifacts through the adapter manager', async () => {
    const deps = makeDepsWithRecipe(tempHome, makeRecipeWithStep());
    const manager = new AdapterManager({ managedAdapters: [] });
    const commands = createOrchestratorCommands({ ...deps, adapterManager: manager });
    const state = await commands.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', sourcePaths: ['/tmp'] });
    const item = await commands.next({ jobId: state.jobId });
    expect(item).not.toBeNull();
    const artifacts = await commands.readArtifacts({ jobId: state.jobId, workItemId: item!.workItemId });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ artifactId: 'artifact-mock', kind: 'code' });
  });

  it('builds a preview bundle from submitted artifacts', async () => {
    const deps = makeDepsWithRecipe(tempHome, makeRecipeWithStep());
    const manager = new AdapterManager({ managedAdapters: [] });
    const commands = createOrchestratorCommands({ ...deps, adapterManager: manager });
    const state = await commands.start({ spaceId: 'space-1', recipeId: 'code-wiki@1', sourcePaths: ['/tmp'] });
    const item = await commands.next({ jobId: state.jobId });
    await commands.submitOrganizedItem({ jobId: state.jobId, workItemId: item!.workItemId, item: {
      schemaVersion: 'source-artifact@1',
      artifactId: 'artifact-mock',
      adapterId: 'mock',
      adapterVersion: '1.0.0',
      sourceId: 'source-1',
      logicalKey: 'module/mock',
      contentHash: 'b'.repeat(64),
      updatedAt: '2026-07-31T00:00:00.000Z',
      kind: 'code',
      content: { title: 'Mock Module', body: 'Mock body' },
      evidence: [{ evidenceId: 'ev-1', sourceUri: '/tmp', sourceHash: 'c'.repeat(64) }],
      sensitivity: 'shareable',
    } as Record<string, unknown> });
    const preview = await commands.preview({ jobId: state.jobId });
    expect(preview.bundle.pages).toHaveLength(1);
    expect(preview.bundle.pages[0].title).toBe('Mock Module');
  });
});
