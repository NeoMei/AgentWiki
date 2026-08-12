import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SourceAdapter } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import type { KnowledgeBundle } from '../protocol/bundle.js';
import { MarkitdownAdapter } from '../adapter/markitdown.js';
import type { Recipe } from '../protocol/recipe.js';
import { organizeArtifacts, validateKnowledgeBundle } from '../organize/index.js';
import { workspacePaths } from '../workspace/layout.js';
import { readBase, readManifest } from '../workspace/state.js';
import { OnboardingError } from '../onboarding/errors.js';
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
  return new KnowledgeWorkflows({
    previews: createFilePreviewStore(options.home),
    remote: options.sync,
    prepare: async (input) => {
      const artifacts: SourceArtifact[] = [];
      const skippedFiles: unknown[] = [];
      const adapterIds = input.sourceType === 'code'
        ? ['codebase-memory']
        : input.sourceType === 'documents'
          ? ['markitdown']
          : ['codebase-memory', 'markitdown'];

      for (const sourcePath of input.sourcePaths) {
        for (const adapterId of adapterIds) {
          const probe = adapterId === 'markitdown' ? new MarkitdownAdapter('') : await options.adapters.ensure(adapterId);
          const descriptor = await probe.inspect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
          if (descriptor.estimatedArtifacts === 0) continue;
          const adapter = adapterId === 'markitdown' && descriptor.metadata?.requiresManagedRuntime === true
            ? await options.adapters.ensure(adapterId)
            : probe;
          const batch = await adapter.collect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
         artifacts.push(...batch.artifacts);
       }
    }

      // DEF-005: scan for credential-like patterns before organizing; flagged
      // artifacts are skipped so the complete marker never reaches preview state.
      const warnings: string[] = [];
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

      // DEF-003/004: compare with the last confirmed base bundle to compute
      // added/modified/deleted counts and generate deletion proposals for
      // locally-removed pages. Falls back gracefully if base is unavailable.
      let bundle = organized.bundle;
      let diff: { added: number; modified: number; deleted: number; uploadBytes: number } | undefined;
      if (!baseRevision || baseRevision === '0') {
        diff = {
          added: bundle.pages.length,
          modified: 0,
          deleted: 0,
          uploadBytes: Buffer.byteLength(JSON.stringify(bundle), 'utf8'),
        };
      } else {
        try {
          const baseData = await readBase(workspacePaths(options.home, input.spaceId), baseRevision);
          if (baseData && typeof baseData === 'object' && 'pages' in baseData && Array.isArray((baseData as { pages: unknown[] }).pages)) {
            const basePages = new Map((baseData as KnowledgeBundle).pages.map((p) => [p.pageId, p.contentHash]));
            const localPageIds = new Set(bundle.pages.map((p) => p.pageId));
            let added = 0;
            let modified = 0;
            for (const page of bundle.pages) {
              const baseHash = basePages.get(page.pageId);
              if (baseHash === undefined) added += 1;
              else if (baseHash !== page.contentHash) modified += 1;
            }
            const deletionProposals = [];
            for (const [pageId] of basePages) {
              if (!localPageIds.has(pageId)) {
                deletionProposals.push({ deletionId: `del-${pageId}`, itemType: 'page' as const, itemId: pageId, reason: 'Source file removed since last sync' });
              }
            }
            if (deletionProposals.length > 0) {
              bundle = { ...bundle, deletions: [...bundle.deletions, ...deletionProposals] };
            }
            const uploadBytes = Buffer.byteLength(JSON.stringify(bundle), 'utf8');
            diff = { added, modified, deleted: deletionProposals.length, uploadBytes };
          }
        } catch {
          // Base bundle unavailable; diff stays undefined.
        }
      }
      const acknowledged = new Set(
        safeArtifacts.filter((artifact) => artifact.sensitivity === 'review-required').map((artifact) => artifact.artifactId),
      );
      const issues = validateKnowledgeBundle(bundle, safeArtifacts, UNIFIED_RECIPE, {
        expectedBaseRevision: baseRevision,
        acknowledgedReviewArtifactIds: acknowledged,
        trustedRevisionProvenanceIds: new Set(),
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
        sourceKey: createHash('sha256').update([...input.sourcePaths].sort().join('\n')).digest('hex'),
        processedFiles: safeArtifacts.length,
        skippedFiles,
        warnings,
        ...(diff ? { diff } : {}),
      };
    },
  });
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
