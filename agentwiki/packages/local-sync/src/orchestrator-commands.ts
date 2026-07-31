import { randomUUID } from 'node:crypto';
import type { SourceAdapter } from './protocol/adapter.js';
import type { Recipe } from './protocol/recipe.js';
import type { JobState, WorkItem } from './protocol/job.js';
import type { KnowledgeBundle } from './protocol/bundle.js';
import { makeOrchestratorContext, startJob, getNextWorkItem, persistCheckpoint, loadLatestCheckpoint, advanceAfterWorkItem, completeWorkItem, transition } from './core/orchestrator.js';
import { SyncEngine } from './sync/sync-engine.js';
import { AgentWikiClient } from './agentwiki-client.js';
import type { LocalSyncConnection } from './config.js';
import { workspacePaths } from './workspace/layout.js';
import { stableSpaceId } from './workspace/space.js';
import { ensureWorkspace } from './workspace/state.js';

export interface OrchestratorCommandDeps {
  home: string;
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
  adapters: SourceAdapter[];
  recipes: Recipe[];
  now: () => Date;
}

export interface OrchestratorCommands {
  start(input: { spaceId: string; recipeId: string; sourcePaths: string[] }): Promise<JobState>;
  next(input: { jobId: string }): Promise<WorkItem | null>;
  readArtifacts(input: { jobId: string; workItemId: string }): Promise<unknown[]>;
  submitOrganizedItem(input: { jobId: string; workItemId: string; item: Record<string, unknown> }): Promise<JobState>;
  validate(input: { jobId: string }): Promise<JobState>;
  preview(input: { jobId: string }): Promise<{ previewId: string; bundle: KnowledgeBundle; issues: unknown[] }>;
  confirmAndPush(input: { jobId: string; confirmed: true }): Promise<unknown>;
  pull(input: { spaceId: string }): Promise<import('./sync/sync-engine.js').PullResult>;
  resolveConflict(input: { jobId: string; conflictId: string; resolved: Record<string, unknown> }): Promise<JobState>;
}

export function createOrchestratorCommands(deps: OrchestratorCommandDeps): OrchestratorCommands {
  const ctx = makeOrchestratorContext(deps.adapters, deps.recipes, deps.now);
  const spaceId = stableSpaceId(deps.connection.serverUrl, deps.connection.agentId);
  const paths = workspacePaths(deps.home, spaceId);

  async function syncEngine(spaceId: string): Promise<SyncEngine> {
    return new SyncEngine({
      connection: deps.connection,
      apiKey: await deps.readApiKey(),
      client: deps.client,
      home: deps.home,
      spaceId,
    });
  }

  return {
    async start(input) {
      await ensureWorkspace(paths);
      const jobId = randomUUID();
      const state = startJob(ctx, jobId, input.spaceId, input.recipeId, input.sourcePaths);
      return persistCheckpoint(paths, state);
    },

    async next(input) {
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      return getNextWorkItem(state);
    },

    async readArtifacts(input) {
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      const item = state.workItems.find((wi) => wi.workItemId === input.workItemId);
      if (!item) throw new Error(`Work item ${input.workItemId} not found`);
      return item.artifactIds?.map((id) => ({ artifactId: id, summary: 'artifact available when adapter is wired' })) ?? [];
    },

    async submitOrganizedItem(input) {
      let state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      state = completeWorkItem(state, input.workItemId, { item: input.item });
      state = advanceAfterWorkItem(state);
      return persistCheckpoint(paths, state);
    },

    async validate(input) {
      let state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      state = transition(state, 'validate');
      return persistCheckpoint(paths, state);
    },

    async preview(input) {
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      const previewId = randomUUID();
      const bundle: KnowledgeBundle = {
        schemaVersion: 'knowledge-bundle@1',
        recipeVersion: state.recipeId,
        spaceId: state.spaceId,
        baseRevision: state.baseRevision,
        pages: [],
        memories: [],
        relations: [],
        provenance: [],
        deletions: [],
      };
      return { previewId, bundle, issues: [] };
    },

    async confirmAndPush(input) {
      if (!input.confirmed) throw new Error('Explicit confirmation is required');
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      const preview = await this.preview({ jobId: input.jobId });
      return (await syncEngine(state.spaceId)).push(preview.bundle);
    },

    async pull(input) {
      return (await syncEngine(input.spaceId)).pull();
    },

    async resolveConflict(input) {
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      return state;
    },
  };
}
