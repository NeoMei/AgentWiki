import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
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
import { ensureWorkspace, readManifest } from './workspace/state.js';
import { organizeArtifacts, validateKnowledgeBundle } from './organize/index.js';
import { AdapterManager } from './adapter/manager.js';
import type { ValidationContext } from './organize/validator.js';
import type { ValidationIssue } from './protocol/validation.js';

export interface OrchestratorCommandDeps {
  home: string;
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  readSyncDeviceCredential?: () => Promise<string | undefined>;
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
  const adapterManager = deps.adapterManager ?? new AdapterManager();

  async function jobContext(jobId: string): Promise<{ paths: ReturnType<typeof workspacePaths>; state: JobState }> {
    const spacesRoot = join(deps.home, 'spaces');
    const entries = await readdir(spacesRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const paths = workspacePaths(deps.home, entry.name);
      const state = await loadLatestCheckpoint(paths, jobId);
      if (state) return { paths, state };
    }
    throw new Error(`Job ${jobId} not found`);
  }

  async function syncEngine(spaceId: string): Promise<SyncEngine> {
    return new SyncEngine({
      connection: deps.connection,
      apiKey: await deps.readApiKey(),
      syncDeviceCredential: await deps.readSyncDeviceCredential?.(),
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
     const paths = workspacePaths(deps.home, input.spaceId);
     await ensureWorkspace(paths);
     const manifest = await readManifest(paths);
     const jobId = randomUUID();
     let state = startJob(
       ctx, jobId, input.spaceId, input.recipeId, input.sourcePaths, manifest?.baseRevision?.revision ?? '0',
     );
     const recipe = recipeById(input.recipeId);
      for (const item of planPhaseWorkItems(recipe, state.phase, ctx.adapters)) {
        state = appendWorkItem(state, item);
      }
     return persistCheckpoint(paths, state);
   },

    async next(input) {
      const { state } = await jobContext(input.jobId);
      return getNextWorkItem(state);
    },

    async readArtifacts(input) {
      const { state } = await jobContext(input.jobId);
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
     const context = await jobContext(input.jobId);
     const { paths } = context;
     let state = context.state;
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
      const context = await jobContext(input.jobId);
      const { paths } = context;
      let state = context.state;
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
      const { state } = await jobContext(input.jobId);
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
      const { state } = await jobContext(input.jobId);
      const preview = await this.preview({ jobId: input.jobId });
      return (await syncEngine(state.spaceId)).push(preview.bundle);
    },

    async pull(input) {
      return (await syncEngine(input.spaceId)).pull();
    },

    async resolveConflict(input) {
      const { state } = await jobContext(input.jobId);
      return state;
    },
  };
}
