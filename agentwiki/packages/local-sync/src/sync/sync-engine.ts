import type { LocalSyncConnection } from '../config.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import { workspacePaths, type SpaceWorkspacePaths } from '../workspace/layout.js';
import { stableSpaceId } from '../workspace/space.js';
import {
  ensureWorkspace,
  readManifest,
  writeManifest,
  writeBase,
  readBase,
  writeWikiPage,
  writeWikiMemory,
  writeWikiRelations,
  listWikiPages,
  readWikiPage,

  readWikiRelations,
  initManifest,
} from '../workspace/state.js';
import type { KnowledgeBundle, WikiPage, SharedMemory, KnowledgeRelation } from '../protocol/bundle.js';
import type { RevisionPointer } from '../workspace/manifest.js';
import { mergeBundles } from './merge.js';

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
}

export interface PushResult {
  submitted: boolean;
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId: string;
  currentRevision: string;
}

export class SyncEngine {
  private readonly client: AgentWikiClient;
  private readonly paths: SpaceWorkspacePaths;
  private readonly spaceId: string;

  constructor(private readonly options: SyncEngineOptions) {
    this.client = options.client ?? new AgentWikiClient();
    this.spaceId = options.spaceId ?? stableSpaceId(options.connection.serverUrl, options.connection.agentId);
    this.paths = workspacePaths(options.home ?? "", this.spaceId);
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
      };
    }

    const snapshot = baseRevision
      ? await this.client.getDelta(this.options.connection, this.options.apiKey, this.spaceId, baseRevision)
      : await this.client.getSnapshot(this.options.connection, this.options.apiKey, this.spaceId);

    const bundle = 'bundle' in snapshot && snapshot.bundle
      ? snapshot.bundle
      : await this.materializeDelta();

    await this.materializeBundle(bundle);
    await writeBase(this.paths, head.revisionId, bundle);
    await writeManifest(this.paths, {
      ...manifest,
      baseRevision: { revision: head.revisionId, pulledAt: new Date().toISOString(), contentHash: head.contentHash },
      updatedAt: new Date().toISOString(),
    });

    return {
      updated: true,
      revisionId: head.revisionId,
      pageCount: bundle.pages.length,
      memoryCount: bundle.memories.length,
      relationCount: bundle.relations.length,
    };
  }

  async push(bundle: KnowledgeBundle): Promise<PushResult> {
    await this.pull();
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

    if ('code' in result && result.code === 'STALE_BASE_REVISION') {
      await this.pull();
      throw new Error('Base revision changed during push; please resolve conflicts and retry.');
    }

    if (result.status === 'published' || result.status === 'noop' || result.status === 'existing') {
      await writeManifest(this.paths, {
        ...manifest,
        baseRevision: { revision: result.currentRevision, pulledAt: new Date().toISOString(), contentHash: '' },
        updatedAt: new Date().toISOString(),
      });
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

  private async readManifest() {
    let manifest = await readManifest(this.paths);
    if (!manifest) {
      await this.ensureWorkspace();
      manifest = await readManifest(this.paths);
    }
    if (!manifest) throw new Error(`Failed to initialize manifest for space ${this.spaceId}`);
    return manifest;
  }

  private async materializeBundle(bundle: KnowledgeBundle): Promise<void> {
    await Promise.all(bundle.pages.map((page) => writeWikiPage(this.paths, page.pageId, page.body)));
    await Promise.all(bundle.memories.map((memory) => writeWikiMemory(this.paths, memory.memoryId, memory)));
    await writeWikiRelations(this.paths, bundle.relations);
  }

  private async materializeDelta(): Promise<KnowledgeBundle> {
    const snapshot = await this.client.getSnapshot(this.options.connection, this.options.apiKey, this.spaceId);
    return snapshot.bundle;
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
        contentHash: '',
        updatedAt: new Date().toISOString(),
      });
    }

    const memories: SharedMemory[] = [];
    const relations = (await readWikiRelations(this.paths)) as KnowledgeRelation[];

    return {
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'unknown',
      spaceId: this.spaceId,
      baseRevision: (await this.readManifest()).baseRevision?.revision ?? '0',
      pages,
      memories,
      relations,
      provenance: [],
      deletions: [],
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
    return `${bundle.baseRevision}-${Date.now()}`;
  }
}
