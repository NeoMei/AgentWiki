/**
 * High-level knowledge workflows that wrap local orchestration and remote
 * sync into the three hybrid gateway tools.
 *
 * prepare() does all local work and persists a preview without any network
 * call. confirmAndSync() validates the preview hash, pulls before pushing, and
 * rejects conflicts. pull() refreshes the local workspace from the server.
 *
 * All side-effecting collaborators are injected so tests stay deterministic.
 */
import { createHash, randomUUID } from 'node:crypto';
import { OnboardingError } from '../onboarding/errors.js';
import type { KnowledgeBundle } from '../protocol/bundle.js';

export interface PrepareInput {
  spaceId: string;
  sourcePaths: string[];
  sourceType?: 'auto' | 'code' | 'documents';
}

export interface PrepareResult {
  jobId: string;
  previewHash: string;
  summary: {
    filesProcessed: number;
    filesSkipped: number;
    sourceKey: string;
  };
  warnings: string[];
}

export interface ConfirmSyncInput {
  jobId: string;
  previewHash: string;
  confirmed: boolean;
}

export interface ConfirmSyncResult {
  revisionId: string;
  synced: true;
  status?: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId?: string;
  changeSetId?: string | null;
}

export interface PullInput {
  spaceId: string;
}

/** Preview bundle stored locally between prepare and confirm. */
interface StoredPreview {
  hash: string;
  data: unknown;
}

/** Injected local knowledge preparation. */
export interface PrepareFn {
  (input: PrepareInput): Promise<{
    bundle: KnowledgeBundle;
    sourceKey: string;
    processedFiles: number;
    skippedFiles: unknown[];
  }>;
}

/** Injected preview persistence. */
export interface PreviewStore {
  save(jobId: string, preview: StoredPreview): Promise<void>;
  load(jobId: string): Promise<StoredPreview | null>;
  remove(jobId: string): Promise<void>;
}

/** Injected remote sync operations. */
export interface RemoteSync {
  pull(spaceId: string): Promise<{ revisionId: string }>;
  push(spaceId: string, bundle: KnowledgeBundle): Promise<{
    conflict: boolean;
    revisionId: string;
    status?: 'pending_review' | 'published' | 'noop' | 'existing';
    submissionId?: string;
    changeSetId?: string | null;
  }>;
}

export interface WorkflowDeps {
  prepare: PrepareFn;
  previews: PreviewStore;
  remote: RemoteSync;
}

export class KnowledgeWorkflows {
  constructor(private readonly deps: WorkflowDeps) {}

  /**
   * Discover adapters, collect, organize, validate and persist a preview.
   * Makes zero network calls.
   */
  async prepare(input: PrepareInput): Promise<PrepareResult> {
    const prepared = await this.deps.prepare(input);
    const previewData = prepared.bundle;
    const previewHash = sha256(previewData);
    const jobId = randomUUID();
    await this.deps.previews.save(jobId, { hash: previewHash, data: previewData });
    return {
      jobId,
      previewHash,
      summary: {
        filesProcessed: prepared.processedFiles,
        filesSkipped: prepared.skippedFiles.length,
        sourceKey: prepared.sourceKey,
      },
      warnings: [],
    };
  }

  /**
   * Validate the preview, pull before push, and upload only the confirmed
   * bundle. Rejects changed/expired previews and sync conflicts.
   */
  async confirmAndSync(input: ConfirmSyncInput): Promise<ConfirmSyncResult> {
    if (!input.confirmed) {
      throw new OnboardingError({
        code: 'CONFIRMATION_REQUIRED',
        message: 'knowledge sync requires explicit confirmation',
        retryable: false,
      });
    }

    const stored = await this.deps.previews.load(input.jobId);
    if (stored === null) {
      throw new OnboardingError({
        code: 'PREVIEW_CHANGED',
        message: 'preview not found or expired',
        retryable: true,
      });
    }

    if (stored.hash !== input.previewHash) {
      throw new OnboardingError({
        code: 'PREVIEW_CHANGED',
        message: 'preview hash mismatch; the preview has changed since preparation',
        retryable: true,
      });
    }

    // Pull before push to check revision and detect conflicts.
    const bundle = stored.data as KnowledgeBundle;
    const pulled = await this.deps.remote.pull(bundle.spaceId);
    if (pulled.revisionId !== bundle.baseRevision) {
      throw new OnboardingError({
        code: 'PREVIEW_CHANGED',
        message: 'authoritative revision changed after preview; prepare a new preview',
        retryable: true,
      });
    }
    const pushResult = await this.deps.remote.push(bundle.spaceId, bundle);
    if (pushResult.conflict) {
      throw new OnboardingError({
        code: 'SYNC_CONFLICT',
        message: 'three-way merge conflict detected; manual resolution required',
        retryable: true,
      });
    }

    await this.deps.previews.remove(input.jobId);
    return {
      revisionId: pushResult.revisionId,
      synced: true,
      ...(pushResult.status ? { status: pushResult.status } : {}),
      ...(pushResult.submissionId ? { submissionId: pushResult.submissionId } : {}),
      ...(pushResult.changeSetId !== undefined ? { changeSetId: pushResult.changeSetId } : {}),
    };
  }

  /** Refresh the local Space workspace from the authoritative server revision. */
  async pull(input: PullInput): Promise<{ revisionId: string }> {
    return this.deps.remote.pull(input.spaceId);
  }
}

/** In-memory preview store for tests and ephemeral sessions. */
export function createInMemoryPreviewStore(): PreviewStore {
  const store = new Map<string, StoredPreview>();
  return {
    async save(jobId, preview) {
      store.set(jobId, preview);
    },
    async load(jobId) {
      return store.get(jobId) ?? null;
    },
    async remove(jobId) {
      store.delete(jobId);
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',') + '}';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
