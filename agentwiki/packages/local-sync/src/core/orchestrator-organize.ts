import type { SourceArtifact } from '../protocol/artifact.js';
import type { KnowledgeBundle, WikiPage, SharedMemory, KnowledgeRelation } from '../protocol/bundle.js';
import type { JobState } from '../protocol/job.js';
import type { ValidationIssue } from '../protocol/validation.js';
import { organizeArtifacts, validateKnowledgeBundle, type OrganizeContext, type ValidationContext } from '../organize/index.js';
import type { OrchestratorContext } from './orchestrator.js';
import { transition, appendWorkItem, completeWorkItem, getNextWorkItem, advanceAfterWorkItem, failWorkItem, transitionOnFailure } from './orchestrator.js';

export interface OrganizeResult {
  bundle: KnowledgeBundle;
  issues: ValidationIssue[];
}

export interface PreviewResult {
  bundle: KnowledgeBundle;
  issues: ValidationIssue[];
  pageCount: number;
  memoryCount: number;
  relationCount: number;
  reviewRequired: Array<{ itemId: string; artifactIds: string[]; reason: string }>;
}

export function recordArtifacts(state: JobState, artifacts: SourceArtifact[]): JobState {
  return completeWorkItem(
    state,
    getNextWorkItem(state)!.workItemId,
    { artifacts: artifacts.map((a) => ({ ...a, content: a.content })) },
  );
}

export function submitOrganizedItems(
  state: JobState,
  workItemId: string,
  items: Array<{ kind: 'page'; value: WikiPage } | { kind: 'memory'; value: SharedMemory } | { kind: 'relation'; value: KnowledgeRelation }>,
): JobState {
  return completeWorkItem(state, workItemId, { items });
}

export function buildOrganizedBundle(
  ctx: OrchestratorContext,
  state: JobState,
  artifacts: SourceArtifact[],
): OrganizeResult {
  const recipe = ctx.recipes.get(state.recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${state.recipeId}`);
  const organizeCtx: OrganizeContext = {
    spaceId: state.spaceId,
    baseRevision: state.baseRevision ?? '0',
    recipe,
    now: ctx.now,
  };
  const { bundle } = organizeArtifacts(artifacts, organizeCtx);
  return { bundle, issues: [] };
}

export function validateOrganizedBundle(
  ctx: OrchestratorContext,
  state: JobState,
  bundle: KnowledgeBundle,
  artifacts: SourceArtifact[],
): ValidationIssue[] {
  const recipe = ctx.recipes.get(state.recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${state.recipeId}`);
  const validationCtx: ValidationContext = {
    expectedBaseRevision: state.baseRevision ?? '0',
    acknowledgedReviewArtifactIds: new Set(),
    trustedRevisionProvenanceIds: new Set(),
  };
  return validateKnowledgeBundle(bundle, artifacts, recipe, validationCtx);
}

export function buildPreview(
  bundle: KnowledgeBundle,
  issues: ValidationIssue[],
): PreviewResult {
  const reviewRequired = bundle.provenance
    .filter((p) => p.sensitivity === 'review-required')
    .map((p) => ({
      itemId: p.itemId,
      artifactIds: p.artifactIds,
      reason: 'Artifact marked as review-required',
    }));

  return {
    bundle,
    issues,
    pageCount: bundle.pages.length,
    memoryCount: bundle.memories.length,
    relationCount: bundle.relations.length,
    reviewRequired,
  };
}

export function planOrganizePhase(state: JobState): JobState {
  if (state.phase !== 'organize') return state;
  const collectItems = state.workItems.filter((wi) => wi.phase === 'collect' && wi.status === 'completed');
  if (collectItems.length === 0) return state;
  const artifacts = collectItems.flatMap((wi) => (wi.result?.artifacts as SourceArtifact[] | undefined) ?? []);
  const batchCount = 1;
  let workState = state;
  for (let i = 0; i < batchCount; i++) {
    workState = appendWorkItem(workState, {
      type: 'organize-page',
      instructions: `Organize ${artifacts.length} artifacts into wiki pages, memories, and relations.`,
      artifactIds: artifacts.map((a) => a.artifactId),
      maxAttempts: 3,
      status: 'pending',
    });
  }
  return workState;
}

export function planValidatePhase(state: JobState): JobState {
  if (state.phase !== 'validate') return state;
  const collectItems = state.workItems.filter((wi) => wi.phase === 'collect' && wi.status === 'completed');
  const artifacts = collectItems.flatMap((wi) => (wi.result?.artifacts as SourceArtifact[] | undefined) ?? []);
  const organizeItems = state.workItems.filter((wi) => wi.phase === 'organize' && wi.status === 'completed');
  const items = organizeItems.flatMap((wi) => (wi.result?.items as Array<{ kind: 'page'; value: WikiPage }> | undefined) ?? []);
  return appendWorkItem(state, {
    type: 'validate-item',
    instructions: `Validate ${items.length} organized items and ${artifacts.length} artifacts.`,
    artifactIds: artifacts.map((a) => a.artifactId),
    maxAttempts: 1,
    status: 'pending',
  });
}

export function planPreviewPhase(state: JobState): JobState {
  if (state.phase !== 'preview') return state;
  return appendWorkItem(state, {
    type: 'confirm-push',
    instructions: 'Preview the organized KnowledgeBundle and wait for user confirmation.',
    maxAttempts: 1,
    status: 'pending',
  });
}

export function completeOrganizeWorkItem(
  ctx: OrchestratorContext,
  state: JobState,
  workItemId: string,
  items: Array<{ kind: 'page'; value: WikiPage } | { kind: 'memory'; value: SharedMemory } | { kind: 'relation'; value: KnowledgeRelation }>,
): JobState {
  return completeWorkItem(state, workItemId, { items });
}

export function completeValidateWorkItem(
  ctx: OrchestratorContext,
  state: JobState,
  workItemId: string,
  artifacts: SourceArtifact[],
): { state: JobState; issues: ValidationIssue[] } {
  const recipe = ctx.recipes.get(state.recipeId);
  if (!recipe) throw new Error(`Unknown recipe: ${state.recipeId}`);
  const organizedItems = state.workItems
    .filter((wi) => wi.phase === 'organize' && wi.status === 'completed')
    .flatMap((wi) => (wi.result?.items as Array<{ kind: 'page'; value: WikiPage } | { kind: 'memory'; value: SharedMemory } | { kind: 'relation'; value: KnowledgeRelation }> | undefined) ?? []);

  const pages = organizedItems.filter((i): i is { kind: 'page'; value: WikiPage } => i.kind === 'page').map((i) => i.value);
  const memories = organizedItems.filter((i): i is { kind: 'memory'; value: SharedMemory } => i.kind === 'memory').map((i) => i.value);
  const relations = organizedItems.filter((i): i is { kind: 'relation'; value: KnowledgeRelation } => i.kind === 'relation').map((i) => i.value);

  const bundle = assembleBundle(state, pages, memories, relations, artifacts);
  const issues = validateOrganizedBundle(ctx, state, bundle, artifacts);
  const nextState = completeWorkItem(state, workItemId, { issues, bundle: { schemaVersion: bundle.schemaVersion } });
  return { state: nextState, issues };
}

export function completePreviewWorkItem(
  ctx: OrchestratorContext,
  state: JobState,
  workItemId: string,
  bundle: KnowledgeBundle,
  issues: ValidationIssue[],
): PreviewResult {
  const result = buildPreview(bundle, issues);
  return result;
}

export function advanceOrganizePhase(state: JobState): JobState {
  return advanceAfterWorkItem(state);
}

export function advanceValidatePhase(state: JobState, issues: ValidationIssue[]): JobState {
  if (issues.length > 0) {
    const errors = issues.filter((i) => i.rule !== 'sensitivity.review-required');
    if (errors.length > 0) {
      return transition(state, 'failed');
    }
  }
  return advanceAfterWorkItem(state);
}

function assembleBundle(
  state: JobState,
  pages: WikiPage[],
  memories: SharedMemory[],
  relations: KnowledgeRelation[],
  artifacts: SourceArtifact[],
): KnowledgeBundle {
  const provenance = buildProvenanceFromItems(pages, memories, relations, artifacts);
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: state.recipeVersion,
    spaceId: state.spaceId,
    baseRevision: state.baseRevision ?? '0',
    pages,
    memories,
    relations,
    provenance,
    deletions: [],
  };
}

function buildProvenanceFromItems(
  pages: WikiPage[],
  memories: SharedMemory[],
  relations: KnowledgeRelation[],
  artifacts: SourceArtifact[],
): Array<{ itemId: string; artifactIds: string[]; sensitivity: 'shareable' | 'review-required' | 'local-only' }> {
  const artifactSensitivity = new Map(artifacts.map((a) => [a.artifactId, a.sensitivity]));
  const records: Array<{ itemId: string; artifactIds: string[]; sensitivity: 'shareable' | 'review-required' | 'local-only' }> = [];
  for (const page of pages) {
    const sensitivity = pickHighest(page.artifactIds.map((id) => artifactSensitivity.get(id) ?? 'shareable'));
    records.push({ itemId: page.pageId, artifactIds: page.artifactIds, sensitivity });
  }
  for (const memory of memories) {
    const sensitivity = pickHighest(memory.artifactIds.map((id) => artifactSensitivity.get(id) ?? 'shareable'));
    records.push({ itemId: memory.memoryId, artifactIds: memory.artifactIds, sensitivity });
  }
  for (const relation of relations) {
    const sensitivity = pickHighest(relation.artifactIds.map((id) => artifactSensitivity.get(id) ?? 'shareable'));
    records.push({ itemId: relation.relationId, artifactIds: relation.artifactIds, sensitivity });
  }
  return records;
}

function pickHighest(sensitivities: Array<'shareable' | 'review-required' | 'local-only'>): 'shareable' | 'review-required' | 'local-only' {
  if (sensitivities.includes('local-only')) return 'local-only';
  if (sensitivities.includes('review-required')) return 'review-required';
  return 'shareable';
}

export { transition, appendWorkItem, completeWorkItem, getNextWorkItem, advanceAfterWorkItem, failWorkItem, transitionOnFailure };
