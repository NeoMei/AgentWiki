import type { SourceArtifact } from '../protocol/artifact.js';
import type {
  BundleProvenance,
  KnowledgeBundle,
  KnowledgeRelation,
  SharedMemory,
  WikiPage,
} from '../protocol/bundle.js';
import { GeneratedOwnershipSchema } from '../protocol/bundle.js';
import type { Recipe } from '../protocol/recipe.js';
import { pageId, memoryId, relationId } from '../utils/id.js';
import { contentHash } from '../utils/hash.js';

export interface OrganizedKnowledge {
  bundle: KnowledgeBundle;
  provenance: BundleProvenance[];
}

export interface OrganizeContext {
  spaceId: string;
  baseRevision: string;
  recipe: Recipe;
  now: () => Date;
}

export function organizeArtifacts(
  artifacts: SourceArtifact[],
  ctx: OrganizeContext,
): OrganizedKnowledge {
  const filtered = artifacts.filter((a) => a.sensitivity !== 'local-only');
  const timestamp = ctx.now().toISOString();
  const provenance: BundleProvenance[] = [];

  const pages: WikiPage[] = [];
  const memories: SharedMemory[] = [];
  const relations: KnowledgeRelation[] = [];

  for (const artifact of filtered) {
    if (artifact.kind === 'code' || artifact.kind === 'document') {
      const page = artifactToPage(artifact, ctx, timestamp);
      pages.push(page);
      provenance.push({
        itemId: page.pageId,
        artifactIds: [artifact.artifactId],
        sensitivity: artifact.sensitivity,
      });
    } else if (artifact.kind === 'memory') {
      const memory = artifactToMemory(artifact, ctx, timestamp);
      memories.push(memory);
      provenance.push({
        itemId: memory.memoryId,
        artifactIds: [artifact.artifactId],
        sensitivity: artifact.sensitivity,
      });
    } else if (artifact.kind === 'relation') {
      const relation = artifactToRelation(artifact, ctx, timestamp);
      if (relation) {
        relations.push(relation);
        provenance.push({
          itemId: relation.relationId,
          artifactIds: [artifact.artifactId],
          sensitivity: artifact.sensitivity,
        });
      }
    }
  }

  const bundle: KnowledgeBundle = {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: ctx.recipe.recipeId,
    spaceId: ctx.spaceId,
    baseRevision: ctx.baseRevision,
    pages: deduplicatePages(pages),
    memories: deduplicateMemories(memories),
    relations: deduplicateRelations(relations),
    provenance: deduplicateProvenance(provenance),
    deletions: [],
  };

  return { bundle, provenance: bundle.provenance };
}

function artifactToPage(
  artifact: SourceArtifact,
  ctx: OrganizeContext,
  timestamp: string,
): WikiPage {
  const title = artifact.content.title?.trim() || artifact.logicalKey;
  const identityKey = (artifact.content.metadata?.identityKey as string | undefined) || artifact.logicalKey;
  const id = pageId(ctx.spaceId, identityKey);
  const path = pagePathFromArtifact(artifact, identityKey);
  const body = buildPageBody(artifact);
  const bodyRecord = {
    pageId: id,
    spaceId: ctx.spaceId,
    path,
    title,
    body,
    order: (artifact.content.metadata?.order as number | undefined) ?? 0,
    metadata: stripInternalMetadata(artifact.content.metadata),
    artifactIds: [artifact.artifactId],
    updatedAt: timestamp,
  };

  return {
    ...bodyRecord,
    contentHash: contentHash(JSON.stringify(bodyRecord)),
  };
}

function generatedOwnership(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  const candidate = GeneratedOwnershipSchema.safeParse(metadata.ownership);
  return candidate.success ? candidate.data : undefined;
}

function artifactToMemory(
  artifact: SourceArtifact,
  ctx: OrganizeContext,
  timestamp: string,
): SharedMemory {
  const key = artifact.logicalKey;
  const id = memoryId(ctx.spaceId, key);
  const bodyRecord = {
    memoryId: id,
    spaceId: ctx.spaceId,
    key,
    value: artifact.content.body?.trim() || artifact.content.summary?.trim() || '',
    scope: (artifact.content.metadata?.scope as 'space' | 'agent' | 'page' | undefined) ?? 'space',
    pageIds: (artifact.content.metadata?.pageIds as string[] | undefined) ?? [],
    artifactIds: [artifact.artifactId],
    updatedAt: timestamp,
    ...(generatedOwnership(artifact.content.metadata) ? { ownership: generatedOwnership(artifact.content.metadata) } : {}),
  };

  return {
    ...bodyRecord,
    contentHash: contentHash(JSON.stringify(bodyRecord)),
  };
}

function artifactToRelation(
  artifact: SourceArtifact,
  ctx: OrganizeContext,
  _timestamp: string,
): KnowledgeRelation | null {
  void _timestamp;
  const sourceId = artifact.content.metadata?.sourceId as string | undefined;
  const targetId = artifact.content.metadata?.targetId as string | undefined;
  const relationType =
    (artifact.content.metadata?.relationType as string | undefined)
    || artifact.content.title?.trim()
    || 'relates-to';

  if (!sourceId || !targetId) return null;

  const relationIdValue = relationId(ctx.spaceId, sourceId, targetId, relationType);
  return {
    relationId: relationIdValue,
    spaceId: ctx.spaceId,
    sourceId,
    targetId,
    relationType,
    artifactIds: [artifact.artifactId],
    metadata: stripInternalMetadata(artifact.content.metadata),
  };
}

function buildPageBody(artifact: SourceArtifact): string {
  const parts: string[] = [];
  if (artifact.content.summary) parts.push(artifact.content.summary.trim());
  if (artifact.content.body) parts.push(artifact.content.body.trim());
  if (artifact.content.fields) {
    for (const [k, v] of Object.entries(artifact.content.fields)) {
      parts.push(`**${k}**: ${v}`);
    }
  }
  if (artifact.content.tags && artifact.content.tags.length > 0) {
    parts.push(`Tags: ${artifact.content.tags.join(', ')}`);
  }
  return parts.join('\n\n');
}

function pagePathFromArtifact(artifact: SourceArtifact, identityKey: string): string {
  const kindPrefix = artifact.kind === 'code' ? 'code' : 'docs';
  const sanitized = identityKey
    .replace(/\\/g, '/')
    .replace(/\.\./g, '__')
    .replace(/[^a-zA-Z0-9/_-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!sanitized) return `${kindPrefix}/untitled.md`;
  const withExtension = sanitized.endsWith('.md') ? sanitized : `${sanitized}.md`;
  return `${kindPrefix}/${withExtension}`;
}

function stripInternalMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const {
    identityKey: _unusedIdentityKey,
    order: _unusedOrder,
    sourceId: _unusedSourceId,
    targetId: _unusedTargetId,
    relationType: _unusedRelationType,
    scope: _unusedScope,
    pageIds: _unusedPageIds,
    ...rest
  } = metadata;
  void _unusedIdentityKey;
  void _unusedOrder;
  void _unusedSourceId;
  void _unusedTargetId;
  void _unusedRelationType;
  void _unusedScope;
  void _unusedPageIds;
  if (Object.keys(rest).length === 0) return undefined;
  return rest;
}

function deduplicatePages(pages: WikiPage[]): WikiPage[] {
  const seen = new Map<string, WikiPage>();
  for (const page of pages) {
    const existing = seen.get(page.pageId);
    if (!existing) {
      seen.set(page.pageId, page);
      continue;
    }
    if (page.artifactIds[0] && !existing.artifactIds.includes(page.artifactIds[0])) {
      seen.set(page.pageId, {
        ...existing,
        artifactIds: [...existing.artifactIds, page.artifactIds[0]],
        body: existing.body + '\n\n---\n\n' + page.body,
      });
    }
  }
  return Array.from(seen.values());
}

function deduplicateMemories(memories: SharedMemory[]): SharedMemory[] {
  const seen = new Map<string, SharedMemory>();
  for (const memory of memories) {
    const existing = seen.get(memory.memoryId);
    if (!existing || memory.updatedAt > existing.updatedAt) {
      seen.set(memory.memoryId, memory);
    }
  }
  return Array.from(seen.values());
}

function deduplicateRelations(relations: KnowledgeRelation[]): KnowledgeRelation[] {
  const seen = new Map<string, KnowledgeRelation>();
  for (const relation of relations) {
    seen.set(relation.relationId, relation);
  }
  return Array.from(seen.values());
}

function deduplicateProvenance(provenance: BundleProvenance[]): BundleProvenance[] {
  const grouped = new Map<string, BundleProvenance>();
  for (const record of provenance) {
    const existing = grouped.get(record.itemId);
    if (!existing) {
      grouped.set(record.itemId, record);
      continue;
    }
    const mergedArtifacts = [...new Set([...existing.artifactIds, ...record.artifactIds])];
    const sensitivity = pickHigherSensitivity(existing.sensitivity, record.sensitivity);
    grouped.set(record.itemId, { ...existing, artifactIds: mergedArtifacts, sensitivity });
  }
  return Array.from(grouped.values());
}

function pickHigherSensitivity(
  a: 'shareable' | 'review-required' | 'local-only',
  b: 'shareable' | 'review-required' | 'local-only',
): 'shareable' | 'review-required' | 'local-only' {
  const order = ['shareable', 'review-required', 'local-only'] as const;
  const rankA = order.indexOf(a);
  const rankB = order.indexOf(b);
  return rankA >= rankB ? a : b;
}
