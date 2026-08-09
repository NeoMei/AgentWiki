import type { JobPhase, JobState, Recipe, SourceAdapter, WorkItem } from '../protocol/index.js';
import { JobStateSchema, WorkItemSchema } from '../protocol/index.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import type { SpaceWorkspacePaths } from '../workspace/index.js';
import { writeCheckpoint, readCheckpoint, listCheckpoints, deleteCheckpoint } from '../workspace/index.js';

/**
 * Deterministic orchestrator state machine for the Local Knowledge Orchestrator.
 *
 * The orchestrator is intentionally stateless in memory; all mutable state is
 * held in a JobState object that callers persist to a local checkpoint after
 * every meaningful transition. Work items are the smallest unit of work that an
 * Agent can execute in a single turn; they carry retry budgets, phase context,
 * and structured results.
 */

export interface OrchestratorContext {
  adapters: Map<string, SourceAdapter>;
  recipes: Map<string, Recipe>;
  now: () => Date;
}

export const PHASE_ORDER: JobPhase[] = [
  'idle',
  'discover',
  'collect',
  'organize',
  'validate',
  'preview',
  'confirm',
  'push',
  'pull',
  'merge',
  'done',
];

export function makeOrchestratorContext(
  adapters: SourceAdapter[],
  recipes: Recipe[],
  now: () => Date = () => new Date(),
): OrchestratorContext {
  return {
    adapters: new Map(adapters.map((a) => [a.manifest().adapterId, a])),
    recipes: new Map(recipes.map((r) => [r.recipeId, r])),
    now,
  };
}

export function startJob(
  ctx: OrchestratorContext,
  jobId: string,
  spaceId: string,
  recipeId: string,
  sourcePaths: string[],
  baseRevision = '0',
): JobState {
  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${recipeId}`);
  const adapterIds = Array.from(ctx.adapters.keys()).filter((id) =>
    recipe.requiredArtifactKinds?.some((kind) =>
      ctx.adapters.get(id)!.manifest().artifactKinds.includes(kind),
    ) ?? true,
  );
  const now = ctx.now().toISOString();
  return JobStateSchema.parse({
    jobId,
    spaceId,
    recipeId,
    recipeVersion: recipe.recipeId,
    baseRevision,
    phase: 'discover',
    adapterIds,
    sourcePaths,
    createdAt: now,
    updatedAt: now,
    workItems: [],
  });
}

/**
 * Move a job to a new phase. Backward movement is forbidden except for a
 * transition to 'failed', which is allowed from any phase.
 */
export function transition(state: JobState, phase: JobPhase): JobState {
  const currentIndex = PHASE_ORDER.indexOf(state.phase);
  const nextIndex = PHASE_ORDER.indexOf(phase);
  if (nextIndex < currentIndex && phase !== 'failed') {
    throw new Error(`Cannot transition from ${state.phase} back to ${phase}`);
  }
  return JobStateSchema.parse({
    ...state,
    phase,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Create a new work item in the current phase. Work items are appended in
 * order; the next pending item is retrieved via getNextWorkItem.
 */
export function appendWorkItem(
  state: JobState,
  item: Omit<WorkItem, 'workItemId' | 'jobId' | 'phase' | 'attempts'>,
): JobState {
  const workItemId = `${state.jobId}:wi:${state.workItems.length}`;
  const workItem = WorkItemSchema.parse({
    ...item,
    workItemId,
    jobId: state.jobId,
    phase: state.phase,
    attempts: 0,
  });
  return JobStateSchema.parse({
    ...state,
    updatedAt: new Date().toISOString(),
    workItems: [...state.workItems, workItem],
  });
}

export function getNextWorkItem(state: JobState): WorkItem | null {
  const pending = state.workItems.find(
    (wi) => wi.phase === state.phase && wi.status === 'pending' && wi.attempts < wi.maxAttempts,
  );
  return pending ?? null;
}

export function completeWorkItem(state: JobState, workItemId: string, result: Record<string, unknown>): JobState {
  const workItems = state.workItems.map((wi) =>
    wi.workItemId === workItemId
      ? { ...wi, status: 'completed', attempts: wi.attempts + 1, result }
      : wi,
  );
  return JobStateSchema.parse({ ...state, workItems, updatedAt: new Date().toISOString() });
}

export function failWorkItem(state: JobState, workItemId: string, error: string): JobState {
  const workItems = state.workItems.map((wi) =>
    wi.workItemId === workItemId
      ? { ...wi, status: 'failed', attempts: wi.attempts + 1, error }
      : wi,
  );
  return JobStateSchema.parse({ ...state, workItems, updatedAt: new Date().toISOString() });
}

export function checkpointId(state: JobState): string {
  return `${state.jobId}:${state.phase}:${state.updatedAt}`;
}

export function checkpoint(state: JobState): JobState {
  return JobStateSchema.parse({
    ...state,
    checkpoint: checkpointId(state),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Persist the current state to the workspace and return the state with its
 * checkpoint id set.
 */
export async function persistCheckpoint(paths: SpaceWorkspacePaths, state: JobState): Promise<JobState> {
  const cp = checkpoint(state);
  await writeCheckpoint(paths, cp);
  return cp;
}

export async function loadLatestCheckpoint(paths: SpaceWorkspacePaths, jobId: string): Promise<JobState | null> {
  const ids = await listCheckpoints(paths);
  const jobIds = ids.filter((id) => id.startsWith(`${jobId}:`));
  const latest = jobIds.sort((a, b) => a.split(':').pop()!.localeCompare(b.split(':').pop()!)).pop();
  if (!latest) return null;
  return readCheckpoint(paths, latest);
}

export async function resumeFromCheckpoint(paths: SpaceWorkspacePaths, jobId: string): Promise<JobState | null> {
  return loadLatestCheckpoint(paths, jobId);
}

export async function pruneCheckpoints(paths: SpaceWorkspacePaths, keepCount = 10): Promise<void> {
  const ids = await listCheckpoints(paths);
  // Lexicographic sort on ISO timestamps works as long as checkpoint ids contain
  // them in the same position; ids are jobId:phase:timestamp.
  ids.sort();
  while (ids.length > keepCount) {
    const id = ids.shift();
    if (id) await deleteCheckpoint(paths, id);
  }
}

export function advanceAfterWorkItem(
  state: JobState,
  phaseOrder: JobPhase[] = PHASE_ORDER,
): JobState {
  const nextWorkItem = getNextWorkItem(state);
  if (nextWorkItem) return state;
  const currentIndex = phaseOrder.indexOf(state.phase);
  if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) return state;
  const nextPhase = phaseOrder[currentIndex + 1];
  return transition(state, nextPhase);
}

export function isPhaseComplete(state: JobState): boolean {
  return !getNextWorkItem(state);
}

export function hasFailedWorkItem(state: JobState): boolean {
  return state.workItems.some((wi) => wi.status === 'failed' && wi.attempts >= wi.maxAttempts);
}

export function transitionOnFailure(state: JobState): JobState {
  return hasFailedWorkItem(state) ? transition(state, 'failed') : state;
}

export interface PhasePlan {
  phase: JobPhase;
  workItems: WorkItem[];
}

export function planPhaseWorkItems(
  recipe: Recipe,
  phase: JobPhase,
  adapters?: Map<string, SourceAdapter>,
): Omit<WorkItem, 'workItemId' | 'jobId' | 'phase' | 'attempts'>[] {
  const steps = recipe.steps.filter((s) => s.phase === phase);
  return steps.map((step) => {
    const artifactIds = step.requiredArtifactKinds
      ? resolveAdapterIds(step.requiredArtifactKinds, adapters)
      : undefined;
    return {
      type: stepTypeFromPhase(phase),
      instructions: step.description,
      maxAttempts: step.retryCount + 1,
      status: 'pending' as const,
      artifactIds,
      itemIds: step.dependsOn,
    };
  });
}

function resolveAdapterIds(
  requiredArtifactKinds: SourceArtifact['kind'][],
  adapters?: Map<string, SourceAdapter>,
): string[] {
  if (!adapters || adapters.size === 0) {
    const managedAdapterByKind: Partial<Record<SourceArtifact['kind'], string>> = {
      code: 'codebase-memory',
      document: 'markitdown',
      memory: 'agent-memory',
    };
    return requiredArtifactKinds.map((kind) => managedAdapterByKind[kind] ?? kind);
  }
  const ids: string[] = [];
  for (const kind of requiredArtifactKinds) {
    for (const [adapterId, adapter] of adapters.entries()) {
      if (adapter.manifest().artifactKinds.includes(kind)) {
        ids.push(adapterId);
        break;
      }
    }
  }
  return ids.length > 0 ? ids : (requiredArtifactKinds as string[]);
}

function stepTypeFromPhase(phase: JobPhase): WorkItem['type'] {
  switch (phase) {
    case 'discover':
      return 'inspect-adapter';
    case 'collect':
      return 'collect-artifacts';
    case 'organize':
      return 'organize-page';
    case 'validate':
      return 'validate-item';
    case 'preview':
      return 'confirm-push';
    case 'confirm':
      return 'confirm-push';
    case 'push':
      return 'confirm-push';
    case 'pull':
      return 'materialize-pull';
    case 'merge':
      return 'resolve-conflict';
    default:
      return 'validate-item';
  }
}
