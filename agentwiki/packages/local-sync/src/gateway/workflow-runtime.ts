import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SourceAdapter } from '../protocol/adapter.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import type { Recipe } from '../protocol/recipe.js';
import { organizeArtifacts, validateKnowledgeBundle } from '../organize/index.js';
import { workspacePaths } from '../workspace/layout.js';
import { readManifest } from '../workspace/state.js';
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
          const adapter = await options.adapters.ensure(adapterId);
          const descriptor = await adapter.inspect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
          if (descriptor.estimatedArtifacts === 0) continue;
          const batch = await adapter.collect({ sourcePath, spaceId: input.spaceId, jobId: 'preview' });
          artifacts.push(...batch.artifacts);
        }
      }

      const manifest = await readManifest(workspacePaths(options.home, input.spaceId));
      const baseRevision = manifest?.baseRevision?.revision ?? '0';
      const organized = organizeArtifacts(artifacts, {
        spaceId: input.spaceId,
        baseRevision,
        recipe: UNIFIED_RECIPE,
        now,
      });
      const acknowledged = new Set(
        artifacts.filter((artifact) => artifact.sensitivity === 'review-required').map((artifact) => artifact.artifactId),
      );
      const issues = validateKnowledgeBundle(organized.bundle, artifacts, UNIFIED_RECIPE, {
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
        bundle: organized.bundle,
        sourceKey: createHash('sha256').update([...input.sourcePaths].sort().join('\n')).digest('hex'),
        processedFiles: artifacts.length,
        skippedFiles,
      };
    },
  });
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
