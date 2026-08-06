import type { LocalSyncConnection } from '../config.js';
import { AgentWikiClient, type RevisionHead, type RevisionDelta } from '../agentwiki-client.js';
import { workspacePaths, type SpaceWorkspacePaths } from '../workspace/layout.js';
import { stableSpaceId } from '../workspace/space.js';
import {
  ensureWorkspace,
  readManifest,
  writeManifest,
  writeBase,
  readBase,
  listWikiPages,
  readWikiPage,
  listWikiMemories,
  readWikiMemory,
  readWikiRelations,
  initManifest,
} from '../workspace/state.js';
import type { KnowledgeBundle, WikiPage, SharedMemory, KnowledgeRelation, DeletionProposal, BundleProvenance } from '../protocol/bundle.js';
import { KnowledgeBundleSchema } from '../protocol/bundle.js';
import type { RevisionPointer, LocalManifest } from '../workspace/manifest.js';
import { mergeBundles } from './merge.js';
import { contentHash } from '../utils/hash.js';

export interface SyncEngineOptions {
  connection: LocalSyncConnection;
  apiKey: string;
  client?: AgentWikiClient;
  home?: string;
  spaceId?: string;
}

export interface PullResult {
  updated: boolean;
  revisionId: string;
  pageCount: number;
  memoryCount: number;
  relationCount: number;
  conflicts: import('./merge.js').ConflictBundle[];
}

export interface PushResult {
  submitted: boolean;
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId: string;
  currentRevision: string;
}

export class SyncError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'SyncError';
  }
}

function isKnowledgeBundle(value: unknown): value is KnowledgeBundle {
  return KnowledgeBundleSchema.safeParse(value).success;
}

export class SyncEngine {
  private readonly client: AgentWikiClient;
  private readonly paths: SpaceWorkspacePaths;
  private readonly spaceId: string;

  constructor(private readonly options: SyncEngineOptions) {
    this.client = options.client ?? new AgentWikiClient();
    this.spaceId = options.spaceId ?? stableSpaceId(options.connection.serverUrl, options.connection.agentId);
    this.paths = workspacePaths(options.home ?? '', this.spaceId);
  }

  async ensureWorkspace(): Promise<void> {
    await ensureWorkspace(this.paths);
    const manifest = await readManifest(this.paths);
    if (!manifest) {
      await initManifest(this.paths, this.spaceId);
    }
  }

  async pull(): Promise<PullResult> {
    await this.ensureWorkspace();
    const manifest = await this.readManifest();
    const head = await this.client.getRevisionHead(this.options.connection, this.options.apiKey, this.spaceId);
    const basePointer = manifest.baseRevision as RevisionPointer | null | undefined;
    const baseRevision = basePointer?.revision ?? null;

    if (baseRevision === head.revisionId) {
      return {
        updated: false,
        revisionId: head.revisionId,
        pageCount: 0,
        memoryCount: 0,
        relationCount: 0,
        conflicts: [],
      };
    }

    const remoteBundle = await this.fetchRemoteBundle(head, baseRevision);
    const baseBundle = baseRevision
      ? ((await readBase(this.paths, baseRevision)) as KnowledgeBundle | null) ?? this.emptyBundle(this.spaceId)
      : this.emptyBundle(this.spaceId);

    const localBundle = await this.readLocalBundle();
    const dirty = this.isDirty(baseBundle, localBundle);

    if (dirty && baseRevision !== head.revisionId) {
      const merge = mergeBundles(baseBundle, localBundle, remoteBundle);
      if (merge.conflicts.length > 0) {
        return {
          updated: false,
          revisionId: head.revisionId,
          pageCount: 0,
          memoryCount: 0,
          relationCount: 0,
          conflicts: merge.conflicts,
        };
      }
      await this.materializeBundle(this.mergeResultToBundle(merge, baseBundle, remoteBundle));
    } else {
      await this.materializeBundle(remoteBundle);
    }

    await writeBase(this.paths, head.revisionId, remoteBundle);
    await writeManifest(this.paths, {
      ...manifest,
      baseRevision: { revision: head.revisionId, pulledAt: new Date().toISOString(), contentHash: head.contentHash },
      updatedAt: new Date().toISOString(),
    });

    return {
      updated: true,
      revisionId: head.revisionId,
      pageCount: remoteBundle.pages.length,
      memoryCount: remoteBundle.memories.length,
      relationCount: remoteBundle.relations.length,
      conflicts: [],
    };
  }

  async push(bundle: KnowledgeBundle): Promise<PushResult> {
    const pullResult = await this.pull();
    if (pullResult.conflicts.length > 0) {
      throw new SyncError('Pull produced conflicts; resolve them before pushing.', 'CONFLICTS');
    }
    const manifest = await this.readManifest();

    const idempotencyKey = `push-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const confirmationHash = await this.confirmationHash(bundle);

    const result = await this.client.submitKnowledge(
      this.options.connection,
      this.options.apiKey,
      this.spaceId,
      bundle,
      idempotencyKey,
      confirmationHash,
    );

    if (this.isStaleError(result)) {
      await this.pull();
      throw new SyncError('Base revision changed during push; please resolve conflicts and retry.', 'STALE_BASE');
    }

    if (result.status === 'pending_review') {
      await writeManifest(this.paths, {
        ...manifest,
        pendingRevision: { revision: result.currentRevision, pulledAt: new Date().toISOString(), contentHash: contentHash(result.currentRevision) },
        updatedAt: new Date().toISOString(),
      });
      const final = await this.pollSubmission(result.submissionId, 30_000, 1_000);
      if (final.status === 'pending_review') {
        return {
          submitted: true,
          status: 'pending_review',
          submissionId: result.submissionId,
          currentRevision: result.currentRevision,
        };
      }
      if (this.isStaleError(final)) {
        await this.pull();
        throw new SyncError('Base revision changed during push; please resolve conflicts and retry.', 'STALE_BASE');
      }
      if (final.status === 'published' || final.status === 'noop' || final.status === 'existing') {
        await writeManifest(this.paths, {
          ...manifest,
          pendingRevision: null,
          baseRevision: { revision: final.currentRevision, pulledAt: new Date().toISOString(), contentHash: contentHash(final.currentRevision) },
          updatedAt: new Date().toISOString(),
        });
        await this.pull();
        return {
          submitted: true,
          status: final.status,
          submissionId: result.submissionId,
          currentRevision: final.currentRevision,
        };
      }
      throw new SyncError(`Submission ended with unexpected status: ${final.status}`, 'SUBMISSION_FAILED');
    }

    if (result.status === 'published' || result.status === 'noop' || result.status === 'existing') {
      await writeManifest(this.paths, {
        ...manifest,
        pendingRevision: null,
        baseRevision: { revision: result.currentRevision, pulledAt: new Date().toISOString(), contentHash: contentHash(result.currentRevision) },
        updatedAt: new Date().toISOString(),
      });
      await this.pull();
    }

    return {
      submitted: true,
      status: result.status,
      submissionId: result.submissionId,
      currentRevision: result.currentRevision,
    };
  }

  async diffLocalRemote(): Promise<ReturnType<typeof mergeBundles>> {
    const manifest = await this.readManifest();
    const basePointer = manifest.baseRevision as RevisionPointer | null | undefined;
    const baseBundle = basePointer?.revision
      ? ((await readBase(this.paths, basePointer.revision)) as KnowledgeBundle | null)
      : null;
    const localBundle = await this.readLocalBundle();
    const remoteSnapshot = await this.client.getSnapshot(
      this.options.connection,
      this.options.apiKey,
      this.spaceId,
    );

    return mergeBundles(
      baseBundle ?? this.emptyBundle(this.spaceId),
      localBundle,
      remoteSnapshot.bundle,
    );
  }

  private async readManifest(): Promise<LocalManifest> {
    let manifest = await readManifest(this.paths);
    if (!manifest) {
      await this.ensureWorkspace();
      manifest = await readManifest(this.paths);
    }
    if (!manifest) throw new Error(`Failed to initialize manifest for space ${this.spaceId}`);
    return manifest;
  }

  private async fetchRemoteBundle(head: RevisionHead, baseRevision: string | null): Promise<KnowledgeBundle> {
    if (baseRevision) {
      const delta = await this.client.getDelta(this.options.connection, this.options.apiKey, this.spaceId, baseRevision);
      const merged = this.mergeDeltaRevisions(delta, head.revisionId);
      if (merged) {
        return merged;
      }
    }
    const snapshot = await this.client.getSnapshot(this.options.connection, this.options.apiKey, this.spaceId);
    return snapshot.bundle;
  }

  private mergeDeltaRevisions(delta: RevisionDelta, targetRevisionId: string): KnowledgeBundle | null {
    if (delta.toRevision !== targetRevisionId || delta.revisions.length === 0) return null;
    let accumulated: KnowledgeBundle | null = null;
    for (const r of delta.revisions) {
      const extracted = this.extractBundleFromDelta(r.delta);
      if (!extracted) return null;
      if (!accumulated) {
        accumulated = extracted;
      } else {
        accumulated = this.applyDeltaToBundle(accumulated, extracted);
      }
    }
    return accumulated;
  }

  private extractBundleFromDelta(deltaValue: unknown): KnowledgeBundle | null {
    if (isKnowledgeBundle(deltaValue)) {
      return deltaValue;
    }
    if (typeof deltaValue === 'object' && deltaValue !== null && 'bundle' in deltaValue) {
      const bundle = (deltaValue as Record<string, unknown>).bundle;
      if (isKnowledgeBundle(bundle)) {
        return bundle;
      }
    }
    return null;
  }

  private applyDeltaToBundle(base: KnowledgeBundle, delta: KnowledgeBundle): KnowledgeBundle {
    const pageMap = new Map(base.pages.map((p) => [p.pageId, p]));
    const memoryMap = new Map(base.memories.map((m) => [m.memoryId, m]));
    const relationMap = new Map(base.relations.map((r) => [r.relationId, r]));
    for (const page of delta.pages) pageMap.set(page.pageId, page);
    for (const memory of delta.memories) memoryMap.set(memory.memoryId, memory);
    for (const relation of delta.relations) relationMap.set(relation.relationId, relation);
    for (const del of delta.deletions) {
      if (del.itemType === 'page') pageMap.delete(del.itemId);
      else if (del.itemType === 'memory') memoryMap.delete(del.itemId);
      else if (del.itemType === 'relation') relationMap.delete(del.itemId);
    }
    return {
      ...base,
      baseRevision: delta.baseRevision,
      pages: Array.from(pageMap.values()),
      memories: Array.from(memoryMap.values()),
      relations: Array.from(relationMap.values()),
      deletions: [...base.deletions, ...delta.deletions],
      provenance: [...base.provenance, ...delta.provenance],
    };
  }

  private async pollSubmission(submissionId: string, timeoutMs: number, intervalMs: number): Promise<ReturnType<AgentWikiClient['submitKnowledge']>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await this.client.getSubmission(
        this.options.connection,
        this.options.apiKey,
        this.spaceId,
        submissionId,
      );
      if (result.status !== 'pending_review') {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { status: 'pending_review', submissionId, changeSetId: null, currentRevision: '' };
  }

  private isStaleError(result: unknown): result is { code: 'STALE_BASE_REVISION' } {
    return typeof result === 'object' && result !== null && 'code' in result && (result as Record<string, unknown>).code === 'STALE_BASE_REVISION';
  }

  private async materializeBundle(bundle: KnowledgeBundle): Promise<void> {
    const tmpDir = `${this.paths.wikiRoot}.tmp`;
    const { mkdir, rm, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(join(tmpDir, 'pages'), { recursive: true });
    await mkdir(join(tmpDir, 'memories'), { recursive: true });
    for (const page of bundle.pages) {
      await writeFile(join(tmpDir, 'pages', `${page.pageId}.md`), page.body, 'utf-8');
    }
    for (const memory of bundle.memories) {
      await writeFile(join(tmpDir, 'memories', `${memory.memoryId}.json`), `${JSON.stringify(memory, null, 2)}\n`, 'utf-8');
    }
    await writeFile(join(tmpDir, 'relations.json'), `${JSON.stringify(bundle.relations, null, 2)}\n`, 'utf-8');
    await rm(this.paths.wikiRoot, { recursive: true, force: true });
    const { rename } = await import('node:fs/promises');
    await rename(tmpDir, this.paths.wikiRoot);
  }

  private async readLocalBundle(): Promise<KnowledgeBundle> {
    const pageIds = await listWikiPages(this.paths);
    const pages: WikiPage[] = [];
    for (const id of pageIds) {
      const body = await readWikiPage(this.paths, id);
      if (body === null) continue;
      pages.push({
        pageId: id,
        spaceId: this.spaceId,
        path: `pages/${id}.md`,
        title: id,
        body,
        artifactIds: [],
        contentHash: contentHash(body),
        updatedAt: new Date().toISOString(),
      });
    }

    const memoryIds = await listWikiMemories(this.paths);
    const memories: SharedMemory[] = [];
    for (const id of memoryIds) {
      const raw = await readWikiMemory(this.paths, id);
      if (!raw) continue;
      memories.push(raw as SharedMemory);
    }

    const relations = (await readWikiRelations(this.paths)) as KnowledgeRelation[];
    const manifest = await this.readManifest();

    return {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'unknown',
      spaceId: this.spaceId,
      baseRevision: manifest.baseRevision?.revision ?? '0',
      pages,
      memories,
      relations,
      provenance: [],
      deletions: [],
    };
  }

  private isDirty(base: KnowledgeBundle, local: KnowledgeBundle): boolean {
    const strip = (b: KnowledgeBundle) => ({
      pages: b.pages.map((p) => ({ id: p.pageId, hash: p.contentHash })).sort((a, b) => a.id.localeCompare(b.id)),
      memories: b.memories.map((m) => ({ id: m.memoryId, hash: m.contentHash })).sort((a, b) => a.id.localeCompare(b.id)),
      relations: b.relations.map((r) => r.relationId).sort(),
    });
    return JSON.stringify(strip(base)) !== JSON.stringify(strip(local));
  }

  private mergeResultToBundle(
    merge: ReturnType<typeof mergeBundles>,
    base: KnowledgeBundle,
    remote: KnowledgeBundle,
  ): KnowledgeBundle {
    const pages = merge.pages.map((p) => p.proposed ?? p.local ?? p.remote).filter(Boolean) as WikiPage[];
    const memories = merge.memories.map((m) => m.proposed ?? m.local ?? m.remote).filter(Boolean) as SharedMemory[];
    const relations = merge.relations.map((r) => r.proposed ?? r.local ?? r.remote).filter(Boolean) as KnowledgeRelation[];
    const deletions: DeletionProposal[] = [];
    const provenance: BundleProvenance[] = [];
    for (const record of [...base.provenance, ...remote.provenance]) {
      if (!provenance.find((p) => p.itemId === record.itemId)) {
        provenance.push(record);
      }
    }
    return {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: remote.recipeVersion ?? base.recipeVersion ?? 'unknown',
      spaceId: this.spaceId,
      baseRevision: remote.baseRevision,
      pages,
      memories,
      relations,
      provenance,
      deletions,
    };
  }

  private emptyBundle(spaceId: string): KnowledgeBundle {
    return {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'unknown',
      spaceId,
      baseRevision: '0',
      pages: [],
      memories: [],
      relations: [],
      provenance: [],
      deletions: [],
    };
  }

  private async confirmationHash(bundle: KnowledgeBundle): Promise<string> {
    const manifest = await this.readManifest();
    const baseRevision = manifest.baseRevision?.revision ?? bundle.baseRevision ?? '0';
    const payload = {
      spaceId: bundle.spaceId,
      baseRevision,
      pageIds: bundle.pages.map((p) => p.pageId).sort(),
      memoryIds: bundle.memories.map((m) => m.memoryId).sort(),
      relationIds: bundle.relations.map((r) => r.relationId).sort(),
      deleted: bundle.deletions.map((d) => d.itemId).sort(),
    };
    return contentHash(JSON.stringify(payload, Object.keys(payload).sort()));
  }
}
