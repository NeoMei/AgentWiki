import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncEngine } from './sync-engine.js';
import { AgentWikiClient } from '../agentwiki-client.js';
import type { LocalSyncConnection } from '../config.js';
import type { KnowledgeBundle } from '../protocol/bundle.js';
import type { RevisionHead, RevisionSnapshot, KnowledgeSubmissionResult } from '../agentwiki-client.js';

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

function makeClient(): {
  client: AgentWikiClient;
  calls: { method: string; args: unknown[] }[];
  setHead: (head: RevisionHead) => void;
  setSnapshot: (snapshot: RevisionSnapshot) => void;
  setSubmitResult: (result: KnowledgeSubmissionResult) => void;
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
      pages: [{
        pageId: 'p1',
        spaceId: 'space-1',
        path: 'p1.md',
        title: 'Page',
        body: 'Hello',
        artifactIds: ['a1'],
        contentHash: 'hash-1',
        updatedAt: '2026-07-30T00:00:00.000Z',
      }],
    }),
  };
  let submitResult: KnowledgeSubmissionResult = {
    status: 'published',
    submissionId: 'sub-1',
    changeSetId: null,
    currentRevision: 'rev-2',
  };

  const client = new AgentWikiClient(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ method: init?.method ?? 'GET', args: [url] });
    if (url.includes('/knowledge-revisions/current')) {
      return new Response(JSON.stringify(head), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/knowledge-revisions/snapshot')) {
      return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/knowledge-submissions')) {
      return new Response(JSON.stringify(submitResult), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  return {
    client,
    calls,
    setHead: (h) => { head = h; },
    setSnapshot: (s) => { snapshot = s; },
    setSubmitResult: (r) => { submitResult = r; },
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
});
