import { OnboardingError } from '../onboarding/errors.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { analyzeBaseKnowledge, type BaseAnalysisOutput, type GeneratedKnowledgeDocument } from './base-analyzer.js';
import type { LocalScanPlan } from './contracts.js';
import { GeneratedCodeGraphAdapter } from './generated-adapter.js';
import { GeneratedKnowledgeStore } from './generated-store.js';
import { createInternalGeneratedKnowledgeStore } from './generated-store.internal.js';
import type { ValidatedGeneratedPublishSet } from './generated-store.js';
import type { NormalizedCodeSnapshot } from './normalizer.js';
import type { CodeGraphProvider, PlanCodeScanInput } from './provider.js';

export interface PrepareInput {
  spaceId: string;
  sourcePaths: string[];
  sourceType?: 'auto' | 'code' | 'documents';
  analysisMode?: 'standard' | 'deep';
  localScanPlanHash?: string;
  confirmedLocalScan?: boolean;
}

interface GeneratedKnowledgeStoreLike {
  writeBase(sourceKey: string, snapshotHash: string, documents: GeneratedKnowledgeDocument[]): Promise<void>;
  withPublishedBatch<T>(sourceKeys: string[], consume: (sets: ValidatedGeneratedPublishSet[]) => Promise<T>): Promise<T>;
}

export interface CodeGraphPipelineOptions {
  /** Exact runtime home shared by scanner snapshots and generated artifacts. */
  home: string;
  provider: CodeGraphProvider;
  generatedStore?: GeneratedKnowledgeStoreLike;
  analyze?: (snapshot: NormalizedCodeSnapshot, options: { maxGeneratedBytes: number }) => BaseAnalysisOutput;
}

const HASH = /^[a-f0-9]{64}$/u;

function deepUnsupported(): OnboardingError {
  return new OnboardingError({
    code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED',
    message: 'deep CodeGraph analysis is not available in this stage',
    retryable: false,
    nextAction: 'deep analysis is not installed yet',
  });
}

function confirmationRequired(): OnboardingError {
  return new OnboardingError({
    code: 'CONFIRMATION_REQUIRED',
    message: 'code knowledge preparation requires a matching confirmed local scan plan',
    retryable: false,
  });
}

function planChanged(): OnboardingError {
  return new OnboardingError({
    code: 'CODEGRAPH_SCAN_PLAN_CHANGED',
    message: 'the confirmed CodeGraph scan plan has changed; create and confirm a new local scan plan',
    retryable: true,
  });
}

/**
 * Executes only a freshly replanned, explicitly-confirmed standard scan. It
 * owns the local CodeGraph-to-artifact bridge; callers never receive raw
 * snapshots or generated-store paths.
 */
export class CodeGraphPipeline {
  private readonly generatedStore: GeneratedKnowledgeStoreLike;
  private readonly analyze: NonNullable<CodeGraphPipelineOptions['analyze']>;

  constructor(private readonly options: CodeGraphPipelineOptions) {
    if (typeof options.home !== 'string' || options.home.length === 0) throw new OnboardingError({ code: 'CODE_ANALYSIS_FAILED', message: 'CodeGraph runtime home is required', retryable: false });
    this.generatedStore = options.generatedStore ?? createInternalGeneratedKnowledgeStore(options.home);
    this.analyze = options.analyze ?? analyzeBaseKnowledge;
  }

  async plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null> {
    if (input.analysisMode === 'deep') throw deepUnsupported();
    return this.options.provider.plan(input);
  }

  async collect(input: {
    spaceId: string;
    sourcePaths: string[];
    sourceType: 'auto' | 'code' | 'documents';
    analysisMode: 'standard';
    localScanPlanHash: string;
    confirmedLocalScan: true;
  }): Promise<{ artifacts: SourceArtifact[]; sourceKeys: string[]; processedFiles: number; warnings: string[] }> {
    if (input.analysisMode !== 'standard') throw deepUnsupported();
    if (input.confirmedLocalScan !== true) throw confirmationRequired();
    if (typeof input.localScanPlanHash !== 'string' || !HASH.test(input.localScanPlanHash)) throw planChanged();

    // Never reuse a process-local plan: an exact new read-only plan is the
    // consent boundary immediately before the provider's locked recheck.
    const plan = await this.plan({
      sourcePaths: input.sourcePaths,
      sourceType: input.sourceType,
      analysisMode: 'standard',
    });
    if (plan === null || plan.localScanPlanHash !== input.localScanPlanHash) throw planChanged();

    return this.options.provider.withConfirmedSnapshots(plan, async (snapshots) => {
      const prepared: Array<{ sourceKey: string; snapshotHash: string; analyzed: BaseAnalysisOutput; files: number }> = [];
      const warnings: string[] = [];
      let processedFiles = 0;

      for (const confirmed of snapshots) {
        const normalized = { manifest: confirmed.snapshot.manifest, files: confirmed.snapshot.files } as NormalizedCodeSnapshot;
        const analyzed = this.analyze(normalized, { maxGeneratedBytes: plan.limits.maxGeneratedBytes });
        prepared.push({ sourceKey: confirmed.sourceKey, snapshotHash: confirmed.snapshotHash, analyzed, files: confirmed.files });
        warnings.push(...analyzed.warnings);
        processedFiles += confirmed.files;
      }

      // The provider still owns all source leases here. A callback failure
      // returns no artifacts and lets withPublishedBatch restore any promoted
      // generated publish set before those leases are released.
      for (const item of prepared) await this.generatedStore.writeBase(item.sourceKey, item.snapshotHash, item.analyzed.documents);
      const adapter = new GeneratedCodeGraphAdapter(this.generatedStore as GeneratedKnowledgeStore);
      const artifacts = await this.generatedStore.withPublishedBatch(
        prepared.map((item) => item.sourceKey),
        async (sets) => sets.flatMap((published) => adapter.adaptValidatedPublish({ spaceId: input.spaceId, published })),
      );

      return {
        artifacts,
        sourceKeys: snapshots.map((snapshot) => snapshot.sourceKey).sort(),
        processedFiles,
        warnings: warnings.sort(),
      };
    });
  }
}
