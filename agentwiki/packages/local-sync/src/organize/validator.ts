import type { SourceArtifact } from '../protocol/artifact.js';
import type { KnowledgeBundle, WikiPage, SharedMemory, BundleProvenance } from '../protocol/bundle.js';
// KnowledgeRelation is intentionally imported for future relation-specific rules.
import type { Recipe } from '../protocol/recipe.js';
import type { ValidationIssue } from '../protocol/validation.js';
import { KnowledgeBundleSchema } from '../protocol/bundle.js';
import { redactSecrets } from '../utils/redact.js';

export interface ValidationContext {
  expectedBaseRevision: string;
  acknowledgedReviewArtifactIds: Set<string>;
  trustedRevisionProvenanceIds: Set<string>;
  /** Exact item IDs carried unchanged from the confirmed base revision. */
  retainedProvenanceIds?: Set<string>;
}

export interface ValidatorOptions {
  maxBundleBytes?: number;
}

export function validateKnowledgeBundle(
  input: unknown,
  artifacts: SourceArtifact[],
  recipe: Recipe,
  context: ValidationContext,
  options: ValidatorOptions = {},
): ValidationIssue[] {
  const parseResult = KnowledgeBundleSchema.safeParse(input);
  if (!parseResult.success) {
    return parseResult.error.issues.map((issue) => issueToValidationIssue(issue.path.join('.') || 'bundle', 'schema.valid', [], false, issue.message));
  }

  const bundle = parseResult.data;
  const issues: ValidationIssue[] = [];
  const artifactMap = new Map(artifacts.map((a) => [a.artifactId, a]));
  const provenanceMap = new Map(bundle.provenance.map((p) => [p.itemId, p]));
  const pageById = new Map(bundle.pages.map((p) => [p.pageId, p]));
  const memoryById = new Map(bundle.memories.map((m) => [m.memoryId, m]));

  validateBaseRevision(bundle, context, issues);
  validateSchemaVersion(bundle, recipe, issues);
  validateProvenanceCoverage(bundle, provenanceMap, issues);
  validateArtifactReferences(bundle, artifactMap, context.retainedProvenanceIds ?? new Set(), issues);
  validateLocalOnlyLeak(bundle, issues);
  validateUnacknowledgedReview(bundle, context, issues);
  validateDuplicateIds(bundle, issues);
  validateDuplicatePaths(bundle, issues);
  validateDanglingRelations(bundle, pageById, memoryById, issues);
  validateCycles(bundle, issues);
  validateSecrets(bundle, issues);
  validateBundleSize(bundle, options.maxBundleBytes ?? recipe.constraints.maxBundleBytes ?? 10 * 1024 * 1024, issues);
  validateRecipeCompatibility(bundle, recipe, issues);

  return issues.sort((a, b) => (a.itemId === b.itemId ? a.rule.localeCompare(b.rule) : a.itemId.localeCompare(b.itemId)));
}

function issue(
  itemId: string,
  rule: string,
  artifactIds: string[],
  repairable: boolean,
  message: string,
  severity: 'error' | 'warning' = 'error',
): ValidationIssue {
  return { itemId, rule, artifactIds, repairable, message, severity };
}

function issueToValidationIssue(
  itemId: string,
  rule: string,
  artifactIds: string[],
  repairable: boolean,
  message: string,
): ValidationIssue {
  return issue(itemId, rule, artifactIds, repairable, message);
}

function validateBaseRevision(bundle: KnowledgeBundle, context: ValidationContext, issues: ValidationIssue[]) {
  if (bundle.baseRevision !== context.expectedBaseRevision) {
    issues.push(issue('bundle', 'base.revision', [], false, `Expected base revision ${context.expectedBaseRevision}, got ${bundle.baseRevision}`));
  }
}

function validateSchemaVersion(bundle: KnowledgeBundle, recipe: Recipe, issues: ValidationIssue[]) {
  if (bundle.schemaVersion !== 'knowledge-bundle@1') {
    issues.push(issue('bundle', 'schema.version', [], false, `Unsupported schema version ${bundle.schemaVersion}`));
  }
  if (bundle.recipeVersion !== recipe.recipeId) {
    issues.push(issue('bundle', 'recipe.version', [], false, `Recipe mismatch: bundle ${bundle.recipeVersion} vs ${recipe.recipeId}`));
  }
}

function validateProvenanceCoverage(bundle: KnowledgeBundle, provenanceMap: Map<string, BundleProvenance>, issues: ValidationIssue[]) {
  for (const page of bundle.pages) {
    if (!provenanceMap.has(page.pageId)) {
      issues.push(issue(page.pageId, 'provenance.required', page.artifactIds, true, 'Page has no provenance record'));
    }
  }
  for (const memory of bundle.memories) {
    if (!provenanceMap.has(memory.memoryId)) {
      issues.push(issue(memory.memoryId, 'provenance.required', memory.artifactIds, true, 'Memory has no provenance record'));
    }
  }
  for (const relation of bundle.relations) {
    if (!provenanceMap.has(relation.relationId)) {
      issues.push(issue(relation.relationId, 'provenance.required', relation.artifactIds, true, 'Relation has no provenance record'));
    }
  }
}

function validateArtifactReferences(bundle: KnowledgeBundle, artifactMap: Map<string, SourceArtifact>, retainedIds: Set<string>, issues: ValidationIssue[]) {
  for (const provenance of bundle.provenance) {
    if (retainedIds.has(provenance.itemId)) continue;
    for (const artifactId of provenance.artifactIds) {
      if (!artifactMap.has(artifactId)) {
        issues.push(issue(provenance.itemId, 'provenance.artifact.missing', [artifactId], false, `Provenance references unknown artifact ${artifactId}`));
      }
    }
  }
}

function validateLocalOnlyLeak(bundle: KnowledgeBundle, issues: ValidationIssue[]) {
  for (const provenance of bundle.provenance) {
    if (provenance.sensitivity === 'local-only') {
      issues.push(issue(provenance.itemId, 'sensitivity.local-only', provenance.artifactIds, false, 'local-only item cannot be uploaded'));
    }
  }
}

function validateUnacknowledgedReview(bundle: KnowledgeBundle, context: ValidationContext, issues: ValidationIssue[]) {
  for (const provenance of bundle.provenance) {
    if (context.retainedProvenanceIds?.has(provenance.itemId)) continue;
    if (provenance.sensitivity !== 'review-required') continue;
    const allAcknowledged = provenance.artifactIds.every((id) => context.acknowledgedReviewArtifactIds.has(id));
    if (!allAcknowledged) {
      issues.push(issue(provenance.itemId, 'sensitivity.review-required', provenance.artifactIds, true, 'Review-required artifact not acknowledged'));
    }
  }
}

function validateDuplicateIds(bundle: KnowledgeBundle, issues: ValidationIssue[]) {
  const ids = new Set<string>();
  for (const page of bundle.pages) {
    if (ids.has(page.pageId)) {
      issues.push(issue(page.pageId, 'id.duplicate', page.artifactIds, true, 'Duplicate page id'));
    } else {
      ids.add(page.pageId);
    }
  }
  for (const memory of bundle.memories) {
    if (ids.has(memory.memoryId)) {
      issues.push(issue(memory.memoryId, 'id.duplicate', memory.artifactIds, true, 'Duplicate memory id'));
    } else {
      ids.add(memory.memoryId);
    }
  }
  for (const relation of bundle.relations) {
    if (ids.has(relation.relationId)) {
      issues.push(issue(relation.relationId, 'id.duplicate', relation.artifactIds, true, 'Duplicate relation id'));
    } else {
      ids.add(relation.relationId);
    }
  }
}

function validateDuplicatePaths(bundle: KnowledgeBundle, issues: ValidationIssue[]) {
  const paths = new Set<string>();
  for (const page of bundle.pages) {
    const normalized = page.path.toLowerCase();
    if (paths.has(normalized)) {
      issues.push(issue(page.pageId, 'path.duplicate', page.artifactIds, true, `Duplicate normalized path ${page.path}`));
    } else {
      paths.add(normalized);
    }
  }
}

function validateDanglingRelations(
  bundle: KnowledgeBundle,
  pageById: Map<string, WikiPage>,
  memoryById: Map<string, SharedMemory>,
  issues: ValidationIssue[],
) {
  for (const relation of bundle.relations) {
    const sourceExists = pageById.has(relation.sourceId) || memoryById.has(relation.sourceId) || relation.sourceId === relation.targetId;
    const targetExists = pageById.has(relation.targetId) || memoryById.has(relation.targetId);
    if (!sourceExists) {
      issues.push(issue(relation.relationId, 'relation.dangling.source', relation.artifactIds, true, `Relation source ${relation.sourceId} not found`));
    }
    if (!targetExists) {
      issues.push(issue(relation.relationId, 'relation.dangling.target', relation.artifactIds, true, `Relation target ${relation.targetId} not found`));
    }
    if (relation.sourceId === relation.targetId) {
      issues.push(issue(relation.relationId, 'relation.self-loop', relation.artifactIds, true, 'Relation connects an item to itself'));
    }
  }
}

function validateCycles(bundle: KnowledgeBundle, issues: ValidationIssue[]) {
  const childToParent = new Map<string, string>();
  for (const page of bundle.pages) {
    if (page.metadata?.parentId && typeof page.metadata.parentId === 'string') {
      childToParent.set(page.pageId, page.metadata.parentId);
    }
  }
  for (const [child, parent] of childToParent.entries()) {
    const visited = new Set<string>();
    let current: string | undefined = parent;
    while (current) {
      if (current === child) {
        const page = bundle.pages.find((p) => p.pageId === child);
        issues.push(issue(child, 'page.cycle', page?.artifactIds ?? [], true, 'Page parent cycle detected'));
        break;
      }
      if (visited.has(current)) break;
      visited.add(current);
      current = childToParent.get(current);
    }
  }
}

function validateSecrets(bundle: KnowledgeBundle, issues: ValidationIssue[]) {
  const targets = [
    ...bundle.pages.map((p) => ({ itemId: p.pageId, text: p.body, artifactIds: p.artifactIds })),
    ...bundle.memories.map((m) => ({ itemId: m.memoryId, text: m.value, artifactIds: m.artifactIds })),
  ];
  for (const target of targets) {
    const { findings } = redactSecrets(target.text);
    if (findings.length > 0) {
      issues.push(issue(target.itemId, 'sensitive.secret', target.artifactIds, true, `Potential secret detected: ${findings.map((f) => f.name).join(', ')}`));
    }
  }
}

function validateBundleSize(bundle: KnowledgeBundle, maxBytes: number, issues: ValidationIssue[]) {
  const bytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
  if (bytes > maxBytes) {
    issues.push(issue('bundle', 'bundle.size', [], false, `Bundle size ${bytes} exceeds maximum ${maxBytes}`));
  }
}

function validateRecipeCompatibility(_bundle: KnowledgeBundle, _recipe: Recipe, _issues: ValidationIssue[]) {
  void _bundle; void _recipe; void _issues;
  // Reserved hook for future recipe-specific required fields and artifact kind checks.
}
