import type { LocalSyncConnection } from '../config.js';
import { AgentWikiClient, AgentWikiClientError, type RevisionHead, type RevisionDelta } from '../agentwiki-client.js';
import { workspacePaths, type SpaceWorkspacePaths } from '../workspace/layout.js';
import { stableSpaceId } from '../workspace/space.js';
import {
  applyFolderTreeTransactionV2,
  ensureWorkspace,
  readFolderIdentityStateV2,
  recoverFolderTreeTransactionV2,
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
import { mergeBundles, mergeTreeManifestsV2, type TreeConflictV2 } from './merge.js';
import { contentHash } from '../utils/hash.js';
import {
  canonicalTreeRevisionManifestV2,
  contentHash as treePageContentHash,
  pathKey,
  treeRevisionDeltaV2,
  treeRevisionContentHashV2,
  TreeRevisionContentManifestV2Schema,
  validatePortableMarkdownPath,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
import type { FolderIdentityStateV2 } from '../workspace/manifest.js';
import { randomUUID } from 'node:crypto';

export interface SyncEngineOptions {
  connection: LocalSyncConnection;
  apiKey: string;
  syncDeviceCredential?: string;
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
  conflicts: Array<import('./merge.js').ConflictBundle | TreeConflictV2>;
}

export interface PushResult {
  submitted: boolean;
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId?: string;
  changeSetId: string | null;
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
    if (this.options.syncDeviceCredential) return this.pullTreeV2();
    await this.ensureWorkspace();
    const manifest = await this.readManifest();
    let head: RevisionHead;
    try {
      head = await this.client.getRevisionHead(this.options.connection, this.options.apiKey, this.spaceId);
    } catch (error) {
      if (error instanceof AgentWikiClientError && error.code === 'SYNC_PROTOCOL_UPGRADE_REQUIRED') {
        if (!this.options.syncDeviceCredential) {
          throw new SyncError('Folder-aware Sync Protocol v2 requires a configured human device credential.', 'SYNC_DEVICE_CREDENTIAL_REQUIRED');
        }
        return this.pullTreeV2();
      }
      throw error;
    }
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

  async pullTreeV2(): Promise<PullResult> {
    await this.ensureWorkspace();
    const credential = this.requireSyncDeviceCredential();
    await recoverFolderTreeTransactionV2(this.paths, 'replay');
    const head = await this.client.getTreeRevisionHeadV2(this.options.connection, credential, this.spaceId);
    let state = await readFolderIdentityStateV2(this.paths);
    if (state?.revision === head.revision) {
      const scanned = await this.assertTreeNoopBindingV2(state, head.revisionContentHash);
      const base = this.assertTreeBase(await readBase(this.paths, state.revision), state.revision);
      const localIdentityMerge = mergeTreeManifestsV2(base, scanned.manifest, base, scanned.unidentifiedFolders);
      if (!localIdentityMerge.manifest || localIdentityMerge.conflicts.length > 0) {
        return {
          updated: false, revisionId: head.revision, pageCount: 0, memoryCount: 0, relationCount: 0,
          conflicts: localIdentityMerge.conflicts,
        };
      }
      await this.persistLocalIdentityStateV2(state, base, localIdentityMerge.manifest);
      return { updated: false, revisionId: head.revision, pageCount: 0, memoryCount: 0, relationCount: 0, conflicts: [] };
    }
    const snapshot = await this.client.getTreeSnapshotV2(this.options.connection, credential, this.spaceId, head.revision);
    if (snapshot.revision !== head.revision || snapshot.revisionContentHash !== head.revisionContentHash) {
      throw new SyncError('Folder snapshot did not match the negotiated head.', 'RESPONSE_INVALID');
    }
    let base: TreeRevisionContentManifestV2;
    if (state) {
      base = this.assertTreeBase(await readBase(this.paths, state.revision), state.revision);
    } else {
      const localManifest = await this.readManifest();
      const legacyRevision = localManifest.baseRevision?.revision;
      const legacyBase = legacyRevision ? await readBase(this.paths, legacyRevision) : null;
      if (legacyRevision && isKnowledgeBundle(legacyBase)) {
        base = canonicalTreeRevisionManifestV2({
          protocolVersion: '2', spaceId: this.spaceId, folders: [],
          pages: legacyBase.pages.map((page) => ({
            pageId: page.pageId, folderId: null, path: `pages/${page.pageId}.md`, title: page.title,
            body: page.body, contentHash: contentHash(page.body), updatedAt: page.updatedAt,
          })),
        });
        state = { schemaVersion: 2, spaceId: this.spaceId, revision: legacyRevision, folders: {} };
      } else {
        base = this.emptyTree();
        state = { schemaVersion: 2, spaceId: this.spaceId, revision: '0', folders: {} };
      }
    }
    const { manifest: local, unidentifiedFolders } = await this.scanLocalTreeV2(base, state);
    const localIdentityMerge = mergeTreeManifestsV2(base, local, base, unidentifiedFolders);
    if (!localIdentityMerge.manifest || localIdentityMerge.conflicts.length > 0) {
      return { updated: false, revisionId: head.revision, pageCount: 0, memoryCount: 0, relationCount: 0, conflicts: localIdentityMerge.conflicts };
    }
    state = await this.persistLocalIdentityStateV2(state, base, localIdentityMerge.manifest);
    const merge = mergeTreeManifestsV2(base, localIdentityMerge.manifest, snapshot.manifest);
    if (!merge.manifest || merge.conflicts.length > 0) {
      return { updated: false, revisionId: head.revision, pageCount: 0, memoryCount: 0, relationCount: 0, conflicts: merge.conflicts };
    }
    await applyFolderTreeTransactionV2(
      this.paths,
      localIdentityMerge.manifest,
      merge.manifest,
      state,
      {
        revision: head.revision,
        controlBase: snapshot.manifest,
        revisionContentHash: head.revisionContentHash,
        pulledAt: new Date().toISOString(),
        finalState: this.identityStateForLocalTreeV2(
          state, merge.manifest, base, snapshot.manifest, head.revision,
        ),
      },
    );
    return {
      updated: true, revisionId: head.revision, pageCount: snapshot.manifest.pages.length,
      memoryCount: 0, relationCount: 0, conflicts: [],
    };
  }

  async pushTreeV2(targetInput: TreeRevisionContentManifestV2 | KnowledgeBundle): Promise<{ revision: string; status: 'published' | 'noop' }> {
    await this.ensureWorkspace();
    const credential = this.requireSyncDeviceCredential();
    await recoverFolderTreeTransactionV2(this.paths, 'replay');
    let state = await readFolderIdentityStateV2(this.paths);
    if (!state) throw new SyncError('Pull the Folder-aware Space before publishing.', 'V2_BASE_REQUIRED');
    const base = this.assertTreeBase(await readBase(this.paths, state.revision), state.revision);
    const scanned = await this.scanLocalTreeV2(base, state);
    const currentMerge = mergeTreeManifestsV2(base, scanned.manifest, base, scanned.unidentifiedFolders);
    if (!currentMerge.manifest || currentMerge.conflicts.length > 0) {
      throw new SyncError('Local Folder identities are ambiguous; resolve them before publishing.', 'FOLDER_IDENTITY_AMBIGUOUS');
    }
    state = await this.persistLocalIdentityStateV2(state, base, currentMerge.manifest);
    const target = isKnowledgeBundle(targetInput)
      ? await this.knowledgeBundleToTreeV2(targetInput, currentMerge.manifest)
      : canonicalTreeRevisionManifestV2(targetInput);
    if (target.spaceId !== this.spaceId) throw new SyncError('Folder publish Space mismatch.', 'SPACE_MISMATCH');
    const changes = treeRevisionDeltaV2(base, target);
    const result = await this.client.pushTreeChangesV2(
      this.options.connection, credential, this.spaceId, state.revision, changes,
    );
    const snapshot = await this.client.getTreeSnapshotV2(this.options.connection, credential, this.spaceId, result.revision);
    if (snapshot.revision !== result.revision || snapshot.revisionContentHash !== result.revisionContentHash) {
      throw new SyncError('Published Folder snapshot did not match the server result.', 'RESPONSE_INVALID');
    }
    await applyFolderTreeTransactionV2(
      this.paths,
      currentMerge.manifest,
      snapshot.manifest,
      state,
      {
        revision: result.revision,
        controlBase: snapshot.manifest,
        revisionContentHash: result.revisionContentHash,
        pulledAt: new Date().toISOString(),
        finalState: this.identityStateForLocalTreeV2(
          state, snapshot.manifest, base, snapshot.manifest, result.revision,
        ),
      },
    );
    return { revision: result.revision, status: result.status };
  }

  async push(bundle: KnowledgeBundle): Promise<PushResult> {
    if (this.options.syncDeviceCredential) {
      const result = await this.pushTreeV2(bundle);
      return {
        submitted: true,
        status: result.status,
        changeSetId: null,
        currentRevision: result.revision,
      };
    }
    const pullResult = await this.pull();
    if (pullResult.conflicts.length > 0) {
      throw new SyncError('Pull produced conflicts; resolve them before pushing.', 'CONFLICTS');
    }
    const manifest = await this.readManifest();

    const confirmationHash = await this.confirmationHash(bundle);
    const idempotencyKey = `push-${confirmationHash}`;

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
          changeSetId: result.changeSetId,
          currentRevision: result.currentRevision,
        };
      }
      if (this.isStaleError(final)) {
        await this.pull();
        throw new SyncError('Base revision changed during push; please resolve conflicts and retry.', 'STALE_BASE');
      }
      if (final.status === 'published' || final.status === 'noop' || final.status === 'existing') {
        await this.refreshPublishedRevision(final.currentRevision);
        return {
          submitted: true,
          status: final.status,
          submissionId: result.submissionId,
          changeSetId: final.changeSetId ?? result.changeSetId,
          currentRevision: final.currentRevision,
        };
      }
      throw new SyncError(`Submission ended with unexpected status: ${final.status}`, 'SUBMISSION_FAILED');
    }

    if (result.status === 'published' || result.status === 'noop' || result.status === 'existing') {
      await this.refreshPublishedRevision(result.currentRevision);
    }

    return {
      submitted: true,
      status: result.status,
      submissionId: result.submissionId,
      changeSetId: result.changeSetId,
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

  private requireSyncDeviceCredential(): string {
    const credential = this.options.syncDeviceCredential;
    if (!credential) {
      throw new SyncError('Folder-aware Sync Protocol v2 requires a configured human device credential.', 'SYNC_DEVICE_CREDENTIAL_REQUIRED');
    }
    return credential;
  }

  private emptyTree(): TreeRevisionContentManifestV2 {
    return { protocolVersion: '2', spaceId: this.spaceId, folders: [], pages: [] };
  }

  private assertTreeBase(value: unknown, revision: string): TreeRevisionContentManifestV2 {
    const parsed = TreeRevisionContentManifestV2Schema.safeParse(value);
    if (!parsed.success || parsed.data.spaceId !== this.spaceId) {
      throw new SyncError(`Private Folder base ${revision} is missing or invalid.`, 'V2_BASE_INVALID');
    }
    return canonicalTreeRevisionManifestV2(parsed.data);
  }

  private async assertTreeNoopBindingV2(
    state: FolderIdentityStateV2,
    expectedRevisionContentHash: string,
  ): Promise<{
    manifest: TreeRevisionContentManifestV2;
    unidentifiedFolders: import('./merge.js').UnidentifiedLocalFolderV2[];
  }> {
    try {
      if (state.spaceId !== this.spaceId) throw new TypeError('Folder identity Space mismatch');
      const base = this.assertTreeBase(await readBase(this.paths, state.revision), state.revision);
      if (await treeRevisionContentHashV2(base) !== expectedRevisionContentHash) {
        throw new TypeError('Private Folder base hash mismatch');
      }
      const manifest = await this.readManifest();
      if (manifest.baseRevision?.revision !== state.revision
        || manifest.baseRevision.contentHash !== expectedRevisionContentHash) {
        throw new TypeError('Private Folder manifest binding mismatch');
      }
      for (const folder of base.folders) {
        if (!state.folders[folder.folderId]) throw new TypeError('Private Folder identity binding is incomplete');
      }
      return await this.scanLocalTreeV2(base, state);
    } catch (error) {
      if (error instanceof SyncError && error.code !== 'V2_BASE_INVALID') throw error;
      throw new SyncError('Private Folder control state is missing, corrupt, or not fully bound.', 'V2_CONTROL_STATE_INVALID');
    }
  }

  private identityStateForLocalTreeV2(
    state: FolderIdentityStateV2,
    local: TreeRevisionContentManifestV2,
    previousBase: TreeRevisionContentManifestV2 = local,
    nextControlBase: TreeRevisionContentManifestV2 = previousBase,
    revision = state.revision,
  ): FolderIdentityStateV2 {
    const activeFolderIds = new Set(local.folders.map((folder) => folder.folderId));
    const previousFolderIds = new Set(previousBase.folders.map((folder) => folder.folderId));
    const nextFolderIds = new Set(nextControlBase.folders.map((folder) => folder.folderId));
    const pendingDeletes = Object.entries(state.folders).filter(([folderId]) => (
      !activeFolderIds.has(folderId) && previousFolderIds.has(folderId) && nextFolderIds.has(folderId)
    ));
    return {
      ...state,
      revision,
      folders: Object.fromEntries([
        ...local.folders.map((folder) => [folder.folderId, {
          path: folder.path,
          pathKey: pathKey(folder.path),
          updatedAt: folder.updatedAt,
        }] as const),
        ...pendingDeletes,
      ]),
    };
  }

  private async persistLocalIdentityStateV2(
    state: FolderIdentityStateV2,
    controlBase: TreeRevisionContentManifestV2,
    local: TreeRevisionContentManifestV2,
  ): Promise<FolderIdentityStateV2> {
    const pendingState = this.identityStateForLocalTreeV2(state, local, controlBase, controlBase);
    if (JSON.stringify(pendingState) === JSON.stringify(state)) return state;
    await applyFolderTreeTransactionV2(this.paths, local, local, pendingState, {
      revision: state.revision,
      controlBase,
      revisionContentHash: await treeRevisionContentHashV2(controlBase),
      pulledAt: (await this.readManifest()).baseRevision?.pulledAt ?? new Date().toISOString(),
      finalState: pendingState,
    });
    return pendingState;
  }

  private async knowledgeBundleToTreeV2(
    bundle: KnowledgeBundle,
    current: TreeRevisionContentManifestV2,
  ): Promise<TreeRevisionContentManifestV2> {
    if (bundle.spaceId !== this.spaceId) throw new SyncError('Folder publish Space mismatch.', 'SPACE_MISMATCH');
    const foldersByPathKey = new Map<string, typeof current.folders>();
    for (const folder of current.folders) {
      const key = pathKey(folder.path);
      foldersByPathKey.set(key, [...(foldersByPathKey.get(key) ?? []), folder]);
    }
    const pages = await Promise.all(bundle.pages.map(async (page) => {
      const suppliedPath = page.path.startsWith('pages/') ? page.path : `pages/${page.path}`;
      let portablePath: string;
      try {
        portablePath = validatePortableMarkdownPath(suppliedPath).path;
      } catch {
        throw new SyncError(`Bundle Page ${page.pageId} path is not canonical.`, 'PAGE_PATH_INVALID');
      }
      const { dirname } = await import('node:path');
      const directory = dirname(suppliedPath);
      const matchingFolders = directory === 'pages'
        ? []
        : (foldersByPathKey.get(pathKey(directory)) ?? []).filter((folder) => folder.path === directory);
      if (directory !== 'pages' && matchingFolders.length !== 1) {
        throw new SyncError(`Bundle Page ${page.pageId} references an unknown Folder path.`, 'FOLDER_IDENTITY_UNKNOWN');
      }
      if (portablePath !== suppliedPath) {
        throw new SyncError(`Bundle Page ${page.pageId} path is not canonical.`, 'PAGE_PATH_INVALID');
      }
      const folderId = directory === 'pages' ? null : matchingFolders[0]!.folderId;
      return {
        pageId: page.pageId,
        folderId,
        path: portablePath,
        title: page.title,
        body: page.body,
        contentHash: await treePageContentHash(page.body),
        updatedAt: page.updatedAt,
      };
    }));
    return canonicalTreeRevisionManifestV2({
      protocolVersion: '2',
      spaceId: this.spaceId,
      folders: current.folders,
      pages,
    });
  }

  private async scanLocalTreeV2(
    base: TreeRevisionContentManifestV2,
    state: FolderIdentityStateV2,
  ): Promise<{ manifest: TreeRevisionContentManifestV2; unidentifiedFolders: import('./merge.js').UnidentifiedLocalFolderV2[] }> {
    const { lstat, readFile, readdir } = await import('node:fs/promises');
    const { basename, dirname, join } = await import('node:path');
    const root = await lstat(this.paths.pagesDir);
    if (root.isSymbolicLink() || !root.isDirectory()) {
      throw new SyncError('Managed pages root is unsafe.', 'UNSAFE_LOCAL_TREE');
    }
    const folders: TreeRevisionContentManifestV2['folders'] = [];
    const pages: TreeRevisionContentManifestV2['pages'] = [];
    const knownDirectories = new Set<string>();
    const knownFiles = new Set<string>();
    const baseFolders = new Map(base.folders.map((folder) => [folder.folderId, folder]));
    const stateFolderIdsByPath = new Map(Object.entries(state.folders).map(([folderId, identity]) => [identity.pathKey, folderId]));
    for (const folder of base.folders) {
      const identity = state.folders[folder.folderId];
      if (!identity) throw new SyncError('Folder identity state does not match the private base.', 'FOLDER_IDENTITY_INVALID');
    }
    for (const [folderId, identity] of Object.entries(state.folders)) {
      const previous = baseFolders.get(folderId);
      const relativePath = identity.path.slice('pages/'.length);
      knownDirectories.add(relativePath);
      try {
        const entry = await lstat(join(this.paths.pagesDir, relativePath));
        if (entry.isSymbolicLink()) throw new SyncError('Managed Folder is a symbolic link.', 'UNSAFE_LOCAL_TREE');
        if (!entry.isDirectory()) throw new SyncError('Managed Folder path is not a directory.', 'UNSAFE_LOCAL_TREE');
        const parentPath = dirname(identity.path);
        const parentFolderId = parentPath === 'pages' ? null : stateFolderIdsByPath.get(pathKey(parentPath));
        if (parentFolderId === undefined) throw new SyncError('Folder identity parent path is not bound.', 'FOLDER_IDENTITY_INVALID');
        folders.push({
          folderId,
          parentFolderId,
          name: basename(identity.path),
          path: identity.path,
          sortOrder: previous?.sortOrder ?? 0,
          updatedAt: identity.updatedAt,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const foundPageIds = new Set<string>();
    for (const page of base.pages) {
      const identity = page.folderId === null ? null : state.folders[page.folderId];
      if (page.folderId !== null && !identity) throw new SyncError('Page Folder identity is missing.', 'FOLDER_IDENTITY_INVALID');
      const expectedPath = identity ? `${identity.path}/${basename(page.path)}` : page.path;
      const relativePath = expectedPath.slice('pages/'.length);
      knownFiles.add(relativePath);
      try {
        const entry = await lstat(join(this.paths.pagesDir, relativePath));
        if (entry.isSymbolicLink() || !entry.isFile()) throw new SyncError('Managed Page path is unsafe.', 'UNSAFE_LOCAL_TREE');
        const body = await readFile(join(this.paths.pagesDir, relativePath), 'utf8');
        pages.push({ ...page, path: expectedPath, body, contentHash: await treePageContentHash(body) });
        foundPageIds.add(page.pageId);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const unknownDirectories = new Map<string, { empty: boolean; proposedFolderId: string }>();
    const unknownFiles: string[] = [];
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = join(directory, entry.name);
        const identity = await lstat(absolute);
        if (identity.isSymbolicLink()) throw new SyncError('Managed tree contains a symbolic link.', 'UNSAFE_LOCAL_TREE');
        if (identity.isDirectory()) {
          if (!knownDirectories.has(relativePath)) {
            const children = await readdir(absolute);
            unknownDirectories.set(`pages/${relativePath}`, { empty: children.length === 0, proposedFolderId: randomUUID() });
          }
          await walk(absolute, relativePath);
        } else if (identity.isFile() && !knownFiles.has(relativePath)) {
          unknownFiles.push(relativePath);
        } else if (!identity.isFile()) {
          throw new SyncError(`Managed tree entry ${relativePath} is unsafe.`, 'UNSAFE_LOCAL_TREE');
        }
      }
    };
    await walk(this.paths.pagesDir, '');
    const candidateFolderIds = new Map<string, Set<string>>();
    const claimedPageIds = new Set<string>();
    const recoveredPages: Array<{ page: TreeRevisionContentManifestV2['pages'][number]; relativePath: string }> = [];
    for (const relativePath of unknownFiles) {
      const body = await readFile(join(this.paths.pagesDir, relativePath), 'utf8');
      const bodyHash = await treePageContentHash(body);
      const candidates = base.pages.filter((page) => !foundPageIds.has(page.pageId) && !claimedPageIds.has(page.pageId)
        && page.contentHash === bodyHash);
      if (candidates.length !== 1) {
        throw new SyncError(`Local Page ${relativePath} has ${candidates.length} stable identity matches.`, 'PAGE_IDENTITY_AMBIGUOUS');
      }
      const page = candidates[0]!;
      claimedPageIds.add(page.pageId);
      let folderId = page.folderId;
      const relativeDirectory = dirname(relativePath);
      let folderPath = relativeDirectory === '.' ? 'pages' : `pages/${relativeDirectory}`;
      while (folderPath !== 'pages' && folderId !== null) {
        const evidence = candidateFolderIds.get(folderPath) ?? new Set<string>();
        evidence.add(folderId);
        candidateFolderIds.set(folderPath, evidence);
        folderId = baseFolders.get(folderId)?.parentFolderId ?? null;
        folderPath = dirname(folderPath);
      }
      recoveredPages.push({ page: { ...page, path: `pages/${relativePath}`, body, contentHash: bodyHash }, relativePath });
    }
    const unidentifiedFolders: import('./merge.js').UnidentifiedLocalFolderV2[] = [...unknownDirectories.entries()]
      .map(([folderPath, value]) => ({
        path: folderPath,
        empty: value.empty,
        possibleFolderIds: [...(candidateFolderIds.get(folderPath) ?? [])].sort(),
        proposedFolderId: value.proposedFolderId,
        updatedAt: new Date().toISOString(),
    }));
    for (const recovered of recoveredPages) {
      const relativeDirectory = dirname(recovered.relativePath);
      const containingPath = relativeDirectory === '.' ? 'pages' : `pages/${relativeDirectory}`;
      let folderId: string | null;
      if (containingPath === 'pages') {
        folderId = null;
      } else {
        folderId = stateFolderIdsByPath.get(pathKey(containingPath)) ?? null;
        if (folderId === null) {
          const evidence = candidateFolderIds.get(containingPath) ?? new Set<string>();
          if (evidence.size > 1) throw new SyncError('Folder has conflicting descendant Page identities.', 'FOLDER_IDENTITY_AMBIGUOUS');
          folderId = evidence.values().next().value
            ?? unknownDirectories.get(containingPath)?.proposedFolderId
            ?? null;
        }
        if (folderId === null) throw new SyncError('Page parent Folder identity is ambiguous.', 'FOLDER_IDENTITY_AMBIGUOUS');
      }
      pages.push({ ...recovered.page, folderId });
    }
    return {
      manifest: canonicalTreeRevisionManifestV2({ protocolVersion: '2', spaceId: this.spaceId, folders, pages }),
      unidentifiedFolders,
    };
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
      await writeFile(safeMaterializedPath(join(tmpDir, 'pages'), page.pageId, '.md'), page.body, 'utf-8');
    }
    for (const memory of bundle.memories) {
      await writeFile(safeMaterializedPath(join(tmpDir, 'memories'), memory.memoryId, '.json'), `${JSON.stringify(memory, null, 2)}\n`, 'utf-8');
    }
    await writeFile(join(tmpDir, 'relations.json'), `${JSON.stringify(bundle.relations, null, 2)}\n`, 'utf-8');
    await rm(this.paths.wikiRoot, { recursive: true, force: true });
    const { rename } = await import('node:fs/promises');
    await rename(tmpDir, this.paths.wikiRoot);
  }

  private async refreshPublishedRevision(revisionId: string): Promise<void> {
    const snapshot = await this.client.getSnapshot(
      this.options.connection,
      this.options.apiKey,
      this.spaceId,
      revisionId,
    );
    await this.materializeBundle(snapshot.bundle);
    await writeBase(this.paths, revisionId, snapshot.bundle);
    const manifest = await this.readManifest();
    await writeManifest(this.paths, {
      ...manifest,
      pendingRevision: null,
      baseRevision: {
        revision: revisionId,
        pulledAt: new Date().toISOString(),
        contentHash: snapshot.contentHash,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  private async readLocalBundle(): Promise<KnowledgeBundle> {
    const manifest = await this.readManifest();
    const baseBundle = manifest.baseRevision?.revision
      ? ((await readBase(this.paths, manifest.baseRevision.revision)) as KnowledgeBundle | null)
      : null;
    const basePages = new Map((baseBundle?.pages ?? []).map((page) => [page.pageId, page]));
    const pageIds = await listWikiPages(this.paths);
    const pages: WikiPage[] = [];
    for (const id of pageIds) {
      const body = await readWikiPage(this.paths, id);
      if (body === null) continue;
      const previous = basePages.get(id);
      pages.push({
        ...previous,
        pageId: id,
        spaceId: this.spaceId,
        path: previous?.path ?? `pages/${id}.md`,
        title: previous?.title ?? id,
        body,
        artifactIds: previous?.artifactIds ?? [],
        contentHash: contentHash(body),
        updatedAt: previous?.updatedAt ?? new Date().toISOString(),
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

function safeMaterializedPath(directory: string, id: string, suffix: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error('Remote knowledge identifier is not safe for local materialization');
  }
  return `${directory}/${id}${suffix}`;
}
