import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncEngine, SyncError } from './sync-engine.js';
import { AgentWikiClient, AgentWikiClientError } from '../agentwiki-client.js';
import type { LocalSyncConnection } from '../config.js';
import type { KnowledgeBundle, WikiPage } from '../protocol/bundle.js';
import type { RevisionHead, RevisionSnapshot, KnowledgeSubmissionResult } from '../agentwiki-client.js';
import { workspacePaths } from '../workspace/layout.js';
import { contentHash } from '../utils/hash.js';
import {
  applyFolderTreeTransactionV2,
  ensureWorkspace,
  initManifest,
  readBase,
  readFolderIdentityStateV2,
  writeBase,
  writeFolderIdentityStateV2,
  writeManifest,
} from '../workspace/state.js';
import { contentHash as treePageContentHash, treeRevisionContentHashV2, type TreeRevisionContentManifestV2 } from '@neomei/agentwiki-sync-protocol';

function makeBundle(overrides: Partial<KnowledgeBundle> = {}): KnowledgeBundle {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'document-library@1',
    spaceId: 'space-1',
    baseRevision: '0',
    pages: [],
    memories: [],
    relations: [],
    provenance: [],
    deletions: [],
    ...overrides,
  };
}

function makePage(id: string, body: string, title = id): WikiPage {
  return {
    pageId: id,
    spaceId: 'space-1',
    path: `${id}.md`,
    title,
    body,
    artifactIds: [],
    contentHash: contentHash(body),
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}


function makeClient(): {
  client: AgentWikiClient;
  calls: { method: string; args: unknown[] }[];
  setHead: (h: RevisionHead) => void;
  setSnapshot: (s: RevisionSnapshot) => void;
  setSubmitResult: (r: KnowledgeSubmissionResult) => void;
  setSubmissionStatus: (s: KnowledgeSubmissionResult) => void;
} {
  const calls: { method: string; args: unknown[] }[] = [];
  let head: RevisionHead = { revisionId: 'rev-1', sequence: 1, contentHash: 'hash-1' };
  let snapshot: RevisionSnapshot = {
    revisionId: 'rev-1',
    sequence: 1,
    contentHash: 'hash-1',
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'document-library@1',
    bundle: makeBundle({
      pages: [makePage('p1', 'Hello')],
    }),
  };
  let submissionResult: KnowledgeSubmissionResult = {
    status: 'published',
    submissionId: 'sub-1',
    changeSetId: null,
    currentRevision: 'rev-2',
  };
  let submissionStatus: KnowledgeSubmissionResult = submissionResult;

  const client = new AgentWikiClient(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({ method, args: [url, init] });
    if (url.includes('/knowledge-revisions/current') && !url.includes('/snapshot') && !url.includes('/delta')) {
      return new Response(JSON.stringify(head), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/knowledge-revisions\/[^/]+\/snapshot/.test(url)) {
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\/knowledge-revisions\/delta/.test(url) || /\/knowledge-revisions\/[^/]+\/delta/.test(url)) {
      const delta: {
        fromRevision: string;
        toRevision: string;
        revisions: Array<{ revisionId: string; sequence: number; contentHash: string; delta: KnowledgeBundle }>;
      } = {
        fromRevision: 'rev-1',
        toRevision: head.revisionId,
        revisions: [{
          revisionId: head.revisionId,
          sequence: head.sequence,
          contentHash: head.contentHash,
          delta: snapshot.bundle,
        }],
      };
      return new Response(JSON.stringify(delta), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/knowledge-submissions/') && !url.endsWith('/knowledge-submissions')) {
      return new Response(JSON.stringify(submissionStatus), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/knowledge-submissions')) {
      return new Response(JSON.stringify(submissionResult), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  return {
    client,
    calls,
    setHead: (h: RevisionHead) => { head = h; },
    setSnapshot: (s: RevisionSnapshot) => { snapshot = s; },
    setSubmitResult: (r: KnowledgeSubmissionResult) => { submissionResult = r; },
    setSubmissionStatus: (s: KnowledgeSubmissionResult) => { submissionStatus = s; },
  };
}

describe('SyncEngine', () => {
  let tempHome: string;
  const connection: LocalSyncConnection = {
    id: 'conn-1',
    serverUrl: 'http://localhost:3000/api',
    agentId: 'agent-1',
    credentialId: 'cred-1',
    pluginVersion: '0.2.0',
    client: 'codex',
    mcpName: 'agentwiki-local',
  };

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'agentwiki-sync-test-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('pull materializes remote snapshot into workspace', async () => {
    const { client } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    const result = await engine.pull();
    expect(result.updated).toBe(true);
    expect(result.pageCount).toBe(1);
    expect(result.revisionId).toBe('rev-1');
  });

  it('fails locally when a Folder Space requires v2 but no device credential is configured', async () => {
    const client = {
      getRevisionHead: async () => { throw new AgentWikiClientError('upgrade', 409, 'SYNC_PROTOCOL_UPGRADE_REQUIRED'); },
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({ connection, apiKey: 'agk_must-not-be-reused', client, home: tempHome, spaceId: 'space-1' });

    await expect(engine.pull()).rejects.toMatchObject({ code: 'SYNC_DEVICE_CREDENTIAL_REQUIRED' });
  });

  it('upgrades a legacy v1 workspace into a Folder tree without flattening or losing Page identity', async () => {
    const legacy = makeClient();
    await new SyncEngine({ connection, apiKey: 'agk_test', client: legacy.client, home: tempHome, spaceId: 'space-1' }).pull();
    const updatedAt = '2026-08-29T00:00:00.000Z';
    const remoteTree = {
      protocolVersion: '2' as const, spaceId: 'space-1',
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Folder', path: 'pages/Folder', sortOrder: 0, updatedAt }],
      pages: [{ pageId: 'p1', folderId: 'f1', path: 'pages/Folder/Page.md', title: 'Page', body: 'Hello', contentHash: contentHash('Hello'), updatedAt }],
    };
    const remoteTreeHash = await treeRevisionContentHashV2(remoteTree);
    const v2Client = {
      getRevisionHead: async () => { throw new AgentWikiClientError('upgrade', 409, 'SYNC_PROTOCOL_UPGRADE_REQUIRED'); },
      getTreeRevisionHeadV2: async () => ({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
        revisionContentHash: remoteTreeHash, folderCount: '1', pageCount: '1', revisionManifestByteLength: '1', revisionBodyBytes: '5', publishedAt: updatedAt,
      }),
      getTreeSnapshotV2: async () => ({ revision: 'rev-2', sequence: 2, revisionContentHash: remoteTreeHash, manifest: remoteTree }),
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({
      connection, apiKey: 'agk_must-not-be-used-for-v2', syncDeviceCredential: 'device-secret',
      client: v2Client, home: tempHome, spaceId: 'space-1',
    });

    const result = await engine.pull();

    expect(result.updated).toBe(true);
    expect(await import('node:fs/promises').then(({ readFile }) => readFile(join(workspacePaths(tempHome, 'space-1').pagesDir, 'Folder', 'Page.md'), 'utf8'))).toBe('Hello');
  });

  it('fails closed instead of declaring a v2 no-op when its private base binding is missing', async () => {
    const paths = workspacePaths(tempHome, 'space-1');
    await ensureWorkspace(paths);
    await initManifest(paths, 'space-1');
    await import('../workspace/state.js').then(({ writeFolderIdentityStateV2 }) => writeFolderIdentityStateV2(paths, {
      schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', folders: {},
    }));
    const client = {
      getTreeRevisionHeadV2: async () => ({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
        revisionContentHash: 'a'.repeat(64), folderCount: '0', pageCount: '0', revisionManifestByteLength: '1', revisionBodyBytes: '0', publishedAt: '2026-08-29T00:00:00.000Z',
      }),
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({
      connection, apiKey: 'agent-key-must-not-be-used', syncDeviceCredential: 'private-device-token',
      client, home: tempHome, spaceId: 'space-1',
    });

    await expect(engine.pullTreeV2()).rejects.toMatchObject({ code: 'V2_CONTROL_STATE_INVALID' });
  });

  it('recovers a renamed Folder from one stable descendant Page and keeps the rename pending locally', async () => {
    const paths = workspacePaths(tempHome, 'space-1');
    await ensureWorkspace(paths);
    const localManifest = await initManifest(paths, 'space-1', '2026-08-29T00:00:00.000Z');
    const body = '# Stable descendant\n';
    const baseTree: TreeRevisionContentManifestV2 = {
      protocolVersion: '2', spaceId: 'space-1',
      folders: [{ folderId: 'f1', parentFolderId: null, name: 'Before', path: 'pages/Before', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' }],
      pages: [{ pageId: 'p1', folderId: 'f1', path: 'pages/Before/Page.md', title: 'Page', body, contentHash: await treePageContentHash(body), updatedAt: '2026-08-29T00:00:00.000Z' }],
    };
    await applyFolderTreeTransactionV2(paths, { protocolVersion: '2', spaceId: 'space-1', folders: [], pages: [] }, baseTree, {
      schemaVersion: 2, spaceId: 'space-1', revision: '0', folders: {},
    }, { revision: 'rev-1' });
    const rev1Hash = await treeRevisionContentHashV2(baseTree);
    await writeBase(paths, 'rev-1', baseTree);
    await writeManifest(paths, {
      ...localManifest,
      baseRevision: { revision: 'rev-1', pulledAt: '2026-08-29T00:00:00.000Z', contentHash: rev1Hash },
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    await rename(join(paths.pagesDir, 'Before'), join(paths.pagesDir, 'After'));
    const rev2Hash = await treeRevisionContentHashV2(baseTree);
    const client = {
      getTreeRevisionHeadV2: async () => ({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
        revisionContentHash: rev2Hash, folderCount: '1', pageCount: '1', revisionManifestByteLength: '1', revisionBodyBytes: String(Buffer.byteLength(body)), publishedAt: '2026-08-29T00:00:00.000Z',
      }),
      getTreeSnapshotV2: async () => ({ revision: 'rev-2', sequence: 2, revisionContentHash: rev2Hash, manifest: baseTree }),
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({
      connection, apiKey: 'agent-key-must-not-be-used', syncDeviceCredential: 'private-device-token',
      client, home: tempHome, spaceId: 'space-1',
    });

    await expect(engine.pullTreeV2()).resolves.toMatchObject({ updated: true, revisionId: 'rev-2', conflicts: [] });
    expect(await readFolderIdentityStateV2(paths)).toMatchObject({ revision: 'rev-2', folders: { f1: { path: 'pages/After' } } });
    expect(await readBase(paths, 'rev-2')).toEqual(baseTree);
  });

  it.each([0, 2])('rejects an externally moved Page with %i stable identity candidates', async (candidateCount) => {
    const paths = workspacePaths(tempHome, 'space-1');
    await ensureWorkspace(paths);
    const timestamp = '2026-08-29T00:00:00.000Z';
    const localManifest = await initManifest(paths, 'space-1', timestamp);
    const matchingBody = '# Same body\n';
    const matchingHash = await treePageContentHash(matchingBody);
    const baseTree: TreeRevisionContentManifestV2 = {
      protocolVersion: '2',
      spaceId: 'space-1',
      folders: Array.from({ length: Math.max(candidateCount, 1) }, (_, index) => ({
        folderId: `f${index + 1}`,
        parentFolderId: null,
        name: `Before ${index + 1}`,
        path: `pages/Before ${index + 1}`,
        sortOrder: 0,
        updatedAt: timestamp,
      })),
      pages: Array.from({ length: Math.max(candidateCount, 1) }, (_, index) => ({
        pageId: `p${index + 1}`,
        folderId: `f${index + 1}`,
        path: `pages/Before ${index + 1}/Page.md`,
        title: 'Page',
        body: matchingBody,
        contentHash: matchingHash,
        updatedAt: timestamp,
      })),
    };
    await applyFolderTreeTransactionV2(paths, { protocolVersion: '2', spaceId: 'space-1', folders: [], pages: [] }, baseTree, {
      schemaVersion: 2, spaceId: 'space-1', revision: '0', folders: {},
    }, { revision: 'rev-1' });
    const rev1Hash = await treeRevisionContentHashV2(baseTree);
    await writeBase(paths, 'rev-1', baseTree);
    await writeManifest(paths, {
      ...localManifest,
      baseRevision: { revision: 'rev-1', pulledAt: timestamp, contentHash: rev1Hash },
      updatedAt: timestamp,
    });
    for (const folder of baseTree.folders) {
      await rm(join(paths.pagesDir, folder.name), { recursive: true });
    }
    await mkdir(join(paths.pagesDir, 'After'));
    await writeFile(join(paths.pagesDir, 'After', 'Page.md'), candidateCount === 0 ? '# No match\n' : matchingBody);
    const client = {
      getTreeRevisionHeadV2: async () => ({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
        revisionContentHash: rev1Hash, folderCount: String(baseTree.folders.length), pageCount: String(baseTree.pages.length),
        revisionManifestByteLength: '1', revisionBodyBytes: '1', publishedAt: timestamp,
      }),
      getTreeSnapshotV2: async () => ({ revision: 'rev-2', sequence: 2, revisionContentHash: rev1Hash, manifest: baseTree }),
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({
      connection, apiKey: 'agent-key-must-not-be-used', syncDeviceCredential: 'private-device-token',
      client, home: tempHome, spaceId: 'space-1',
    });

    await expect(engine.pullTreeV2()).rejects.toMatchObject({
      code: 'PAGE_IDENTITY_AMBIGUOUS',
      message: expect.stringContaining(`${candidateCount} stable identity matches`),
    });
  });

  it('assigns a UUID to a new empty local Folder and publishes it as an upsert without flattening', async () => {
    const paths = workspacePaths(tempHome, 'space-1');
    await ensureWorkspace(paths);
    const initialManifest = await initManifest(paths, 'space-1', '2026-08-29T00:00:00.000Z');
    const emptyTree: TreeRevisionContentManifestV2 = { protocolVersion: '2', spaceId: 'space-1', folders: [], pages: [] };
    const rev1Hash = await treeRevisionContentHashV2(emptyTree);
    await writeBase(paths, 'rev-1', emptyTree);
    await writeFolderIdentityStateV2(paths, { schemaVersion: 2, spaceId: 'space-1', revision: 'rev-1', folders: {} });
    await writeManifest(paths, {
      ...initialManifest,
      baseRevision: { revision: 'rev-1', pulledAt: '2026-08-29T00:00:00.000Z', contentHash: rev1Hash },
      updatedAt: '2026-08-29T00:00:00.000Z',
    });
    await mkdir(join(paths.pagesDir, 'New Empty'));
    let published = emptyTree;
    let pushedChanges: import('@neomei/agentwiki-sync-protocol').TreePushChangeV2[] = [];
    let revisionContentHash = rev1Hash;
    const client = {
      pushTreeChangesV2: async (_connection: unknown, credential: string, spaceId: string, baseRevision: string, changes: import('@neomei/agentwiki-sync-protocol').TreePushChangeV2[]) => {
        expect(credential).toBe('private-device-token');
        expect(spaceId).toBe('space-1');
        expect(baseRevision).toBe('rev-1');
        pushedChanges = changes;
        published = {
          protocolVersion: '2', spaceId: 'space-1', pages: [],
          folders: changes.filter((change) => change.operation === 'upsert_folder').map((change) => change.folder),
        };
        revisionContentHash = await treeRevisionContentHashV2(published);
        return { protocolVersion: '2', status: 'published', revision: 'rev-2', sequence: 2, publishedAt: '2026-08-29T00:00:00.000Z', revisionContentHash, folderCount: '1', pageCount: '0', revisionManifestByteLength: '1', revisionBodyBytes: '0', changeSetId: null };
      },
      getTreeSnapshotV2: async () => ({ revision: 'rev-2', sequence: 2, revisionContentHash, manifest: published }),
    } as unknown as AgentWikiClient;
    const engine = new SyncEngine({
      connection, apiKey: 'agent-key-must-not-be-used', syncDeviceCredential: 'private-device-token',
      client, home: tempHome, spaceId: 'space-1',
    });
    const bundle = makeBundle({ spaceId: 'space-1', baseRevision: 'rev-1' });

    await expect(engine.pushTreeV2(bundle)).resolves.toEqual({ revision: 'rev-2', status: 'published' });

    expect(pushedChanges).toEqual([
      expect.objectContaining({
        operation: 'upsert_folder',
        folder: expect.objectContaining({
          folderId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
          parentFolderId: null,
          path: 'pages/New Empty',
        }),
      }),
    ]);
    expect(await readBase(paths, 'rev-2')).toEqual(published);
    expect(await readFolderIdentityStateV2(paths)).toMatchObject({ revision: 'rev-2' });
  });

  it('pull is noop when local base revision matches remote head', async () => {
    const { client, setHead } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    await engine.pull();
    setHead({ revisionId: 'rev-1', sequence: 1, contentHash: 'hash-1' });
    const result = await engine.pull();
    expect(result.updated).toBe(false);
  });

  it('push submits bundle and updates base revision', async () => {
    const { client, setSubmitResult } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    setSubmitResult({ status: 'published', submissionId: 'sub-2', changeSetId: null, currentRevision: 'rev-2' });
    const bundle = makeBundle();
    const result = await engine.push(bundle);
    expect(result.submitted).toBe(true);
    expect(result.status).toBe('published');
    expect(result.currentRevision).toBe('rev-2');
  });

  it('uses a deterministic idempotency key when the same confirmed bundle is retried', async () => {
    const { client, calls } = makeClient();
    const bundle = makeBundle();
    const first = new SyncEngine({ connection, apiKey: 'agk_test', client, home: join(tempHome, 'first'), spaceId: 'space-1' });
    const second = new SyncEngine({ connection, apiKey: 'agk_test', client, home: join(tempHome, 'second'), spaceId: 'space-1' });

    await first.push(bundle);
    await second.push(bundle);

    const keys = calls
      .filter((call) => call.method === 'POST' && (call.args[0] as string).includes('/knowledge-submissions'))
      .map((call) => JSON.parse(((call.args[1] as RequestInit).body as string)).idempotencyKey as string);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('uses delta when base revision exists and server returns bundle-shaped delta', async () => {
    const { client, setHead, setSnapshot, calls } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    await engine.pull();
    setHead({ revisionId: 'rev-2', sequence: 2, contentHash: 'hash-2' });
    setSnapshot({
      revisionId: 'rev-2',
      sequence: 2,
      contentHash: 'hash-2',
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'document-library@1',
      bundle: makeBundle({ pages: [makePage('p1', 'Hello'), makePage('p2', 'World')] }),
    });
    const result = await engine.pull();
    expect(result.updated).toBe(true);
    expect(result.pageCount).toBe(2);
    const snapshotCalls = calls.filter((c) => /\/knowledge-revisions\/[^/]+\/snapshot/.test(c.args[0] as string));
    expect(snapshotCalls.length).toBe(1); // initial snapshot only
    const deltaCalls = calls.filter((c) => (c.args[0] as string).includes('/knowledge-revisions/delta'));
    expect(deltaCalls.length).toBe(1);
  });

  it('polls pending submission until published and updates base revision', async () => {
    const { client, setSubmitResult, setSubmissionStatus } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    setSubmitResult({ status: 'pending_review', submissionId: 'sub-pending', changeSetId: 'cs-1', currentRevision: 'rev-1' });
    setSubmissionStatus({ status: 'pending_review', submissionId: 'sub-pending', changeSetId: 'cs-1', currentRevision: 'rev-1' });
    const pendingPromise = engine.push(makeBundle());
    setTimeout(() => {
      setSubmissionStatus({ status: 'published', submissionId: 'sub-pending', changeSetId: 'cs-1', currentRevision: 'rev-2' });
    }, 50);
    const result = await pendingPromise;
    expect(result.status).toBe('published');
    expect(result.changeSetId).toBe('cs-1');
    expect(result.currentRevision).toBe('rev-2');
  });

  it('pull reports conflicts when local and remote diverge from base', async () => {
    const { client, setSnapshot, setHead } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    await engine.pull();
    // local modifies p1
    const paths = workspacePaths(tempHome, 'space-1');
    await mkdir(paths.pagesDir, { recursive: true }); await writeFile(join(paths.pagesDir, "p1.md"), "Local edit", "utf-8");
    // remote also modifies p1 on a newer revision
    setHead({ revisionId: 'rev-2', sequence: 2, contentHash: 'hash-2' });
    setSnapshot({
      revisionId: 'rev-2',
      sequence: 2,
      contentHash: 'hash-2',
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'document-library@1',
      bundle: makeBundle({ pages: [makePage('p1', 'Remote edit')] }),
    });
    const result = await engine.pull();
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0] && (result.conflicts[0] as { itemId: string }).itemId).toBe('p1');
  });

  it('two-machine workflow: B pulls A push, edits, pushes; A pulls merged result', async () => {
    const state = makeClient();
    let revision = 1;
    const head = () => ({ revisionId: `rev-${revision}`, sequence: revision, contentHash: `hash-${revision}` });
    state.setHead(head());
    state.setSnapshot({
      revisionId: 'rev-1',
      sequence: 1,
      contentHash: 'hash-1',
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'document-library@1',
      bundle: makeBundle({ pages: [makePage('p1', 'A initial')] }),
    });
    state.setSubmitResult({ status: 'published', submissionId: 'sub-a', changeSetId: null, currentRevision: 'rev-2' });

    const homeA = join(tempHome, 'a');
    const homeB = join(tempHome, 'b');
    await mkdir(homeA);
    await mkdir(homeB);

    const engineA = new SyncEngine({ connection, apiKey: 'agk_test', client: state.client, home: homeA, spaceId: 'space-1' });
    const engineB = new SyncEngine({ connection, apiKey: 'agk_test', client: state.client, home: homeB, spaceId: 'space-1' });

    // A pushes local edit
    await engineA.pull();
    const pathsA = workspacePaths(homeA, 'space-1');
    await mkdir(pathsA.pagesDir, { recursive: true }); await writeFile(join(pathsA.pagesDir, 'p1.md'), 'A edited', 'utf-8');
    revision = 2;
    state.setHead(head());
    state.setSnapshot({ revisionId: 'rev-2', sequence: 2, contentHash: 'hash-2', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'document-library@1', bundle: makeBundle({ pages: [makePage('p1', 'A edited')] }) });
    state.setSubmitResult({ status: 'published', submissionId: 'sub-b', changeSetId: null, currentRevision: 'rev-3' });
    await engineA.push(makeBundle({ pages: [makePage('p1', 'A edited')] }));

    // B pulls, edits, pushes
    revision = 3;
    state.setHead(head());
    state.setSnapshot({ revisionId: 'rev-3', sequence: 3, contentHash: 'hash-3', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'document-library@1', bundle: makeBundle({ pages: [makePage('p1', 'A edited'), makePage('p2', 'B added')] }) });
    state.setSubmitResult({ status: 'published', submissionId: 'sub-c', changeSetId: null, currentRevision: 'rev-4' });
    await engineB.pull();
    const pathsB = workspacePaths(homeB, 'space-1');
    await mkdir(pathsB.pagesDir, { recursive: true }); await writeFile(join(pathsB.pagesDir, 'p2.md'), 'B page', 'utf-8');
    await engineB.push(makeBundle({ pages: [makePage('p1', 'A edited'), makePage('p2', 'B page')] }));

    // A pulls again and sees both pages
    revision = 4;
    state.setHead(head());
    state.setSnapshot({ revisionId: 'rev-4', sequence: 4, contentHash: 'hash-4', schemaVersion: 'knowledge-bundle@1', recipeVersion: 'document-library@1', bundle: makeBundle({ pages: [makePage('p1', 'A edited'), makePage('p2', 'B page')] }) });
        const finalA = await engineA.pull();
    expect(finalA.pageCount).toBe(2);
  });

  it('push throws SyncError when pull produces conflicts', async () => {
    const { client, setSnapshot, setHead } = makeClient();
    const engine = new SyncEngine({ connection, apiKey: 'agk_test', client, home: tempHome, spaceId: 'space-1' });
    await engine.pull();
    const paths = workspacePaths(tempHome, 'space-1');
    await mkdir(paths.pagesDir, { recursive: true }); await writeFile(join(paths.pagesDir, "p1.md"), "Local edit", "utf-8");
    setHead({ revisionId: 'rev-2', sequence: 2, contentHash: 'hash-2' });
    setSnapshot({
      revisionId: 'rev-2',
      sequence: 2,
      contentHash: 'hash-2',
      schemaVersion: 'knowledge-bundle@1',
      recipeVersion: 'document-library@1',
      bundle: makeBundle({ pages: [makePage('p1', 'Remote edit')] }),
    });
    await expect(engine.push(makeBundle())).rejects.toBeInstanceOf(SyncError);
  });
});
