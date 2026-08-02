import { randomUUID } from 'node:crypto';
import type { SourceAdapter } from './protocol/adapter.js';
import { assertSourceArtifact, type SourceArtifact } from './protocol/artifact.js';
import type { Recipe } from './protocol/recipe.js';
 import { JobStateSchema, type JobState, type WorkItem } from './protocol/job.js';
import type { KnowledgeBundle } from './protocol/bundle.js';
 import { makeOrchestratorContext, startJob, getNextWorkItem, persistCheckpoint, loadLatestCheckpoint, advanceAfterWorkItem, completeWorkItem, transition, appendWorkItem, planPhaseWorkItems } from './core/orchestrator.js';
import { SyncEngine } from './sync/sync-engine.js';
import { AgentWikiClient } from './agentwiki-client.js';
import type { LocalSyncConnection } from './config.js';
import { workspacePaths } from './workspace/layout.js';
import { stableSpaceId } from './workspace/space.js';
import { ensureWorkspace } from './workspace/state.js';
import { organizeArtifacts, validateKnowledgeBundle } from './organize/index.js';
import { AdapterManager } from './adapter/manager.js';
import type { ValidationContext } from './organize/validator.js';
import type { ValidationIssue } from './protocol/validation.js';

export interface OrchestratorCommandDeps {
  home: string;
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
  adapters: SourceAdapter[];
  recipes: Recipe[];
  now: () => Date;
  adapterManager?: AdapterManager;
}

export interface OrchestratorCommands {
  start(input: { spaceId: string; recipeId: string; sourcePaths: string[] }): Promise<JobState>;
  next(input: { jobId: string }): Promise<WorkItem | null>;
  readArtifacts(input: { jobId: string; workItemId: string }): Promise<unknown[]>;
  submitOrganizedItem(input: { jobId: string; workItemId: string; item: Record<string, unknown> }): Promise<JobState>;
  validate(input: { jobId: string }): Promise<{ state: JobState; issues: ValidationIssue[] }>;
  preview(input: { jobId: string }): Promise<{ previewId: string; bundle: KnowledgeBundle; issues: ValidationIssue[] }>;
  confirmAndPush(input: { jobId: string; confirmed: true }): Promise<unknown>;
  pull(input: { spaceId: string }): Promise<import('./sync/sync-engine.js').PullResult>;
  resolveConflict(input: { jobId: string; conflictId: string; resolved: Record<string, unknown> }): Promise<JobState>;
}

export function createOrchestratorCommands(deps: OrchestratorCommandDeps): OrchestratorCommands {
  const ctx = makeOrchestratorContext(deps.adapters, deps.recipes, deps.now);
  const spaceId = stableSpaceId(deps.connection.serverUrl, deps.connection.agentId);
  const paths = workspacePaths(deps.home, spaceId);
  const adapterManager = deps.adapterManager ?? new AdapterManager();

  async function syncEngine(spaceId: string): Promise<SyncEngine> {
    return new SyncEngine({
      connection: deps.connection,
      apiKey: await deps.readApiKey(),
      client: deps.client,
      home: deps.home,
      spaceId,
    });
  }

  function recipeById(recipeId: string): Recipe {
    const recipe = ctx.recipes.get(recipeId);
    if (!recipe) throw new Error(`Unknown recipe: ${recipeId}`);
    return recipe;
  }

  function getArtifacts(state: JobState): SourceArtifact[] {
    const raw = (state.metadata?.artifacts as unknown[]) ?? [];
    return raw.map((a) => assertSourceArtifact(a));
  }

  return {
   async start(input) {
     await ensureWorkspace(paths);
     const jobId = randomUUID();
     let state = startJob(ctx, jobId, input.spaceId, input.recipeId, input.sourcePaths);
     const recipe = recipeById(input.recipeId);
      for (const item of planPhaseWorkItems(recipe, state.phase, ctx.adapters)) {
        state = appendWorkItem(state, item);
      }
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

      const adapterId = item.artifactIds?.[0];
      const sourcePath = state.sourcePaths[0];
      if (!adapterId || !sourcePath) {
        return item.artifactIds?.map((id) => ({ artifactId: id, summary: 'no source path or adapter configured' })) ?? [];
      }

      try {
        const inlineAdapter = ctx.adapters.get(adapterId);
        const adapter = inlineAdapter ?? await adapterManager.ensure(adapterId);
        const batch = await adapter.collect({ sourcePath, spaceId: state.spaceId, jobId: state.jobId });
        return batch.artifacts.map((artifact: SourceArtifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          logicalKey: artifact.logicalKey,
          sensitivity: artifact.sensitivity,
          summary: artifact.content.title ?? artifact.logicalKey,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [{ error: message, adapterId, sourcePath }];
      }
    },

   async submitOrganizedItem(input) {
     let state = await loadLatestCheckpoint(paths, input.jobId);
     if (!state) throw new Error(`Job ${input.jobId} not found`);
     const artifact = assertSourceArtifact(input.item);
      const artifacts = [...getArtifacts(state), artifact];
      state = completeWorkItem(state, input.workItemId, { artifactId: artifact.artifactId, artifacts: artifacts as unknown[] });
      const advanced = advanceAfterWorkItem(state);
      const withArtifacts: JobState = {
        ...advanced,
        metadata: { ...(advanced.metadata ?? {}), artifacts: artifacts as unknown[] },
      };
      return persistCheckpoint(paths, JobStateSchema.parse(withArtifacts));
   },

    async validate(input) {
      let state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      state = transition(state, 'validate');
      const recipe = recipeById(state.recipeId);
      const artifacts = getArtifacts(state);
      const organized = organizeArtifacts(artifacts, {
        spaceId: state.spaceId,
        baseRevision: state.baseRevision,
        recipe,
        now: deps.now,
      });
      const validationContext: ValidationContext = {
        expectedBaseRevision: state.baseRevision,
        acknowledgedReviewArtifactIds: new Set(),
        trustedRevisionProvenanceIds: new Set(),
      };
      const issues = validateKnowledgeBundle(organized.bundle, artifacts, recipe, validationContext);
      state = { ...state, metadata: { ...(state.metadata ?? {}), previewIssues: issues as unknown[], organizedBundle: organized.bundle as unknown } };
      state = await persistCheckpoint(paths, state);
      return { state, issues };
    },

    async preview(input) {
      const state = await loadLatestCheckpoint(paths, input.jobId);
      if (!state) throw new Error(`Job ${input.jobId} not found`);
      const previewId = randomUUID();
      const recipe = recipeById(state.recipeId);
      const artifacts = getArtifacts(state);
      const organized = organizeArtifacts(artifacts, {
        spaceId: state.spaceId,
        baseRevision: state.baseRevision,
        recipe,
        now: deps.now,
      });
      return { previewId, bundle: organized.bundle, issues: (state.metadata?.previewIssues as ValidationIssue[]) ?? [] };
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
