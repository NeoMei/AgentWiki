import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SourceAdapter } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { KnowledgeBundleSchema, type KnowledgeBundle } from '../protocol/bundle.js';
import { TreeRevisionContentManifestV2Schema } from '@neomei/agentwiki-sync-protocol';
import { MarkitdownAdapter } from '../adapter/markitdown.js';
import type { Recipe } from '../protocol/recipe.js';
import { organizeArtifacts, reconcileAnalysisLayers, validateKnowledgeBundle } from '../organize/index.js';
import { workspacePaths } from '../workspace/layout.js';
import { readBase, readManifest } from '../workspace/state.js';
import { OnboardingError } from '../onboarding/errors.js';
import { CodeGraphPipeline } from '../codegraph/pipeline.js';
import { createCodeGraphProvider } from '../codegraph/provider.js';
import {
  KnowledgeWorkflows,
  type PreviewStore,
  type RemoteSync,
} from './knowledge-workflows.js';

export interface AdapterResolver {
  ensure(adapterId: string): Promise<SourceAdapter>;
}

export interface WorkflowRuntimeOptions {
  home: string;
  adapters: AdapterResolver;
  scanSources?: Pick<CodeGraphPipeline, 'plan' | 'collect'>;
  sync: RemoteSync;
  now?: () => Date;
}

const UNIFIED_RECIPE: Recipe = {
  recipeId: 'unified-knowledge@1',
  version: '1',
  name: 'Unified Knowledge',
  description: 'Organize code and documents into one deterministic knowledge bundle.',
  steps: [],
  constraints: {
    maxRepairCycles: 3,
    maxArtifactsPerWorkItem: 500,
    maxConflictFields: 20,
    requireProvenance: true,
    requireEvidence: true,
    sensitivityGate: 'review-required-allowed',
  },
  requiredArtifactKinds: ['code', 'document'],
  identityFields: ['pageId'],
  mergeStrategy: 'by-field',
};

export function createKnowledgeWorkflowRuntime(options: WorkflowRuntimeOptions): KnowledgeWorkflows {
  const now = options.now ?? (() => new Date());
  const scanSources = options.scanSources ?? new CodeGraphPipeline({
    home: options.home,
    provider: createCodeGraphProvider({ home: options.home }),
  });
  return new KnowledgeWorkflows({
    previews: createFilePreviewStore(options.home),
    remote: options.sync,
    prepare: async (input) => {
      const artifacts: SourceArtifact[] = [];
      const skippedFiles: unknown[] = [];
      const sourceType = input.sourceType ?? 'auto';
      const analysisMode = input.analysisMode ?? 'standard';
      if (analysisMode !== 'standard') {
        throw new OnboardingError({
          code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED',
          message: 'deep CodeGraph analysis is not available in this stage',
          retryable: false,
          nextAction: 'deep analysis is not installed yet',
        });
      }

      // An auto plan is also bounded filename-only discovery. A null result is
      // the only document-only case; every non-null plan is code-bearing.
      const plan = sourceType === 'documents'
        ? null
        : await scanSources.plan({ sourcePaths: input.sourcePaths, sourceType, analysisMode: 'standard' });
      if (sourceType === 'code' && plan === null) {
        throw new OnboardingError({
          code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED',
          message: 'CodeGraph did not produce a scan plan for the requested code source',
          retryable: false,
        });
      }
      const codeBearing = plan !== null;
      const warnings: string[] = [];
      let codeSourceKeys: string[] = [];
      let codeProcessedFiles = 0;
      if (codeBearing) {
        if (input.confirmedLocalScan !== true || typeof input.localScanPlanHash !== 'string') {
          throw new OnboardingError({ code: 'CONFIRMATION_REQUIRED', message: 'code knowledge preparation requires explicit local scan confirmation', retryable: false });
        }
        const collected = await scanSources.collect({
          spaceId: input.spaceId,
          sourcePaths: input.sourcePaths,
          sourceType,
          analysisMode: 'standard',
          localScanPlanHash: input.localScanPlanHash,
          confirmedLocalScan: true,
        });
        artifacts.push(...collected.artifacts);
        warnings.push(...collected.warnings);
        codeSourceKeys = collected.sourceKeys;
        codeProcessedFiles = collected.processedFiles;
      }

      if (sourceType !== 'code') {
        for (const sourcePath of input.sourcePaths) {
          const probe = new MarkitdownAdapter('');
          const descriptor = await probe.inspect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
          if (descriptor.estimatedArtifacts === 0) continue;
          const adapter = descriptor.metadata?.requiresManagedRuntime === true
            ? await options.adapters.ensure('markitdown')
            : probe;
          const batch = await adapter.collect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
          artifacts.push(...batch.artifacts);
        }
      }

      // DEF-005: scan for credential-like patterns before organizing; flagged
      // artifacts are skipped so the complete marker never reaches preview state.
      const safeArtifacts = artifacts.filter((artifact) => {
        const text = artifactContentText(artifact);
        const match = SECRET_PATTERNS.find((re) => re.test(text));
        if (match) {
          skippedFiles.push({ path: artifact.logicalKey, reason: 'Credential-like pattern detected; skipped to protect secrets' });
          warnings.push(`${artifact.logicalKey}: credential-like content detected and excluded from preview`);
          return false;
        }
        return true;
      });

      const manifest = await readManifest(workspacePaths(options.home, input.spaceId));
      const baseRevision = manifest?.baseRevision?.revision ?? '0';
      const organized = organizeArtifacts(safeArtifacts, {
       spaceId: input.spaceId,
       baseRevision,
       recipe: UNIFIED_RECIPE,
       now,
     });

      // Compare against the last confirmed bundle only after organization. A
      // CodeGraph standard scan owns its current source's base layer, not the
      // whole Space: deep, document, manual, and foreign-source knowledge must
      // survive in the locally persisted preview.
      let bundle = organized.bundle;
      let retainedProvenanceIds = new Set<string>();
      let diff: { added: number; modified: number; deleted: number; uploadBytes: number } | undefined;
      if (!baseRevision || baseRevision === '0') {
        diff = {
          added: bundle.pages.length + bundle.memories.length + bundle.relations.length,
          modified: 0,
          deleted: 0,
          uploadBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
        };
      } else {
        try {
          const baseData = await readBase(workspacePaths(options.home, input.spaceId), baseRevision);
          if (baseData === null) throw new Error('Confirmed base bundle is missing');
          const base = confirmedBaseBundle(baseData, baseRevision);
          if (codeBearing) {
            const reconciled = reconcileAnalysisLayers(base, bundle, {
              sourceKeys: new Set(codeSourceKeys),
              ownedLayers: new Set(['base']),
            });
            bundle = { ...reconciled.bundle, baseRevision };
            retainedProvenanceIds = reconciled.retainedProvenanceIds;
            warnings.push(...reconciled.warnings);
            diff = {
              added: reconciled.added,
              modified: reconciled.modified,
              deleted: reconciled.deleted,
              uploadBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
            };
          } else {
            const merged = mergeDocumentBundle(base, bundle);
            bundle = { ...merged.bundle, baseRevision };
            retainedProvenanceIds = merged.retainedProvenanceIds;
            diff = {
              added: merged.added,
              modified: merged.modified,
              deleted: merged.deleted,
              uploadBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
            };
          }
        } catch (error) {
          throw unavailableConfirmedBase(error);
        }
      }
      const acknowledged = new Set(
        safeArtifacts.filter((artifact) => artifact.sensitivity === 'review-required').map((artifact) => artifact.artifactId),
      );
      const issues = validateKnowledgeBundle(bundle, safeArtifacts, UNIFIED_RECIPE, {
        expectedBaseRevision: baseRevision,
        acknowledgedReviewArtifactIds: acknowledged,
        trustedRevisionProvenanceIds: new Set(),
        retainedProvenanceIds,
      });
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        throw new OnboardingError({
          code: 'SCAN_FAILED',
          message: `knowledge validation failed: ${errors.map((issue) => issue.message).join('; ')}`,
          retryable: true,
        });
      }

     return {
        bundle,
        sourceKey: codeSourceKeys.length > 0
          ? codeSourceKeys.sort().join(',')
          : createHash('sha256').update([...input.sourcePaths].sort().join('\n')).digest('hex'),
        processedFiles: codeProcessedFiles + safeArtifacts.filter((artifact) => artifact.kind === 'document').length,
        skippedFiles,
        warnings,
        ...(diff ? { diff } : {}),
      };
    },
  });
}

function confirmedBaseBundle(value: unknown, revision: string): KnowledgeBundle {
  const legacy = KnowledgeBundleSchema.safeParse(value);
  if (legacy.success) return legacy.data;
  const tree = TreeRevisionContentManifestV2Schema.parse(value);
  return KnowledgeBundleSchema.parse({
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'document-library@1',
    spaceId: tree.spaceId,
    baseRevision: revision,
    pages: tree.pages.map((page) => {
      const artifactId = `sync-v2:${revision}:${page.pageId}`;
      return {
        pageId: page.pageId,
        spaceId: tree.spaceId,
        path: page.path,
        title: page.title,
        body: page.body,
        artifactIds: [artifactId],
        contentHash: page.contentHash,
        updatedAt: page.updatedAt,
      };
    }),
    memories: [],
    relations: [],
    provenance: tree.pages.map((page) => ({
      itemId: page.pageId,
      artifactIds: [`sync-v2:${revision}:${page.pageId}`],
      sensitivity: 'shareable',
    })),
    deletions: [],
  });
}

function unavailableConfirmedBase(cause: unknown): OnboardingError {
  const error = new OnboardingError({
    code: 'SCAN_FAILED',
    message: 'confirmed base bundle is unavailable',
    retryable: true,
    nextAction: 'refresh the confirmed knowledge base before preparing a new preview',
  });
  Object.assign(error, { cause, diagnostic: 'confirmed-base-read-or-validation-failed' });
  return error;
}

interface DocumentBundleMerge {
  bundle: KnowledgeBundle;
  added: number;
  modified: number;
  deleted: number;
  retainedProvenanceIds: Set<string>;
}

/**
 * Stage 1 has no strict persisted ownership for documents. Current document
 * items may replace a matching stable ID, but absence is never deletion proof.
 */
function mergeDocumentBundle(base: KnowledgeBundle, current: KnowledgeBundle): DocumentBundleMerge {
  const pages = mergeByStableId(base.pages, current.pages, (item) => item.pageId);
  const memories = mergeByStableId(base.memories, current.memories, (item) => item.memoryId);
  const relations = mergeByStableId(base.relations, current.relations, (item) => item.relationId);
  const provenance = mergeByStableId(base.provenance, current.provenance, (item) => item.itemId);
  const deletions = uniqueStableItems(current.deletions, (item) => item.deletionId);
  const retainedProvenanceIds = new Set(base.provenance
    .filter((item) => !current.provenance.some((candidate) => candidate.itemId === item.itemId))
    .map((item) => item.itemId));

  return {
    bundle: {
      ...current,
      baseRevision: base.baseRevision,
      pages: pages.items,
      memories: memories.items,
      relations: relations.items,
      provenance: provenance.items,
      deletions,
    },
    added: pages.added + memories.added + relations.added,
    modified: pages.modified + memories.modified + relations.modified,
    deleted: deletions.length,
    retainedProvenanceIds,
  };
}

function mergeByStableId<T>(base: T[], current: T[], id: (item: T) => string): { items: T[]; added: number; modified: number } {
  const baseItems = uniqueStableItems(base, id);
  const currentItems = uniqueStableItems(current, id);
  const baseById = new Map(baseItems.map((item) => [id(item), item]));
  const items = new Map(baseItems.map((item) => [id(item), item]));
  let added = 0;
  let modified = 0;
  for (const item of currentItems) {
    const stableId = id(item);
    const previous = baseById.get(stableId);
    if (previous === undefined) added += 1;
    else if (canonicalJson(previous) !== canonicalJson(item)) modified += 1;
    items.set(stableId, item);
  }
  return { items: [...items.values()].sort((left, right) => codeUnitCompare(id(left), id(right))), added, modified };
}

function uniqueStableItems<T>(items: T[], id: (item: T) => string): T[] {
  const byId = new Map<string, T>();
  for (const item of [...items].sort((left, right) => {
    const key = codeUnitCompare(id(left), id(right));
    return key || codeUnitCompare(canonicalJson(left), canonicalJson(right));
  })) {
    const stableId = id(item);
    const existing = byId.get(stableId);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(item)) {
      throw new Error(`Conflicting knowledge item ID ${stableId}`);
    }
    byId.set(stableId, item);
  }
  return [...byId.values()].sort((left, right) => codeUnitCompare(id(left), id(right)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort(codeUnitCompare).map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const SECRET_PATTERNS = [
  /FAKE_TOKEN[A-Z_0-9]*/i,
  /(?:sk_|AKIA|ghp_|gho_|xox[baprs]-)[A-Za-z0-9]{16,}/,
  /(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*['"]?[^\s'"{]{8,}/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
];

function artifactContentText(artifact: SourceArtifact): string {
  const c = artifact.content;
  return [c.title, c.summary, c.body, ...Object.values(c.fields ?? {})].join('\n');
}

function createFilePreviewStore(home: string): PreviewStore {
  const root = join(home, '.agentwiki', 'runtime', 'previews');
  const pathFor = (jobId: string): string => {
    if (!/^[0-9a-f-]{36}$/iu.test(jobId)) throw new Error('Invalid preview job ID');
    return join(root, `${jobId}.json`);
  };
  return {
    async save(jobId, preview) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const target = pathFor(jobId);
      const temporary = join(root, `.${randomUUID()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(preview)}\n`, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
      await chmod(target, 0o600);
    },
    async load(jobId) {
      try {
        return JSON.parse(await readFile(pathFor(jobId), 'utf8')) as Awaited<ReturnType<PreviewStore['load']>>;
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(jobId) {
      await rm(pathFor(jobId), { force: true });
    },
  };
}
