import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AgentWikiClient } from '../packages/local-sync/dist/agentwiki-client.js';
import { SyncEngine } from '../packages/local-sync/dist/sync/sync-engine.js';
import { contentHash } from '../packages/local-sync/dist/utils/hash.js';
import { workspacePaths } from '../packages/local-sync/dist/workspace/layout.js';
import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const PREFIX = 'AGENTWIKI_CROSS_MACHINE_E2E';

async function request(apiUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
  return data;
}

function wikiPage(spaceId, pageId, title, body) {
  return {
    pageId,
    spaceId,
    path: `pages/${pageId}.md`,
    title,
    body,
    artifactIds: [],
    contentHash: contentHash(body),
    updatedAt: new Date().toISOString(),
  };
}

function bundle(spaceId, baseRevision, pages, memories = [], relations = [], deletions = []) {
  return {
    schemaVersion: 'knowledge-bundle@1',
    recipeVersion: 'code-wiki@1',
    spaceId,
    baseRevision,
    pages,
    memories,
    relations,
    provenance: [],
    deletions,
  };
}

async function waitForPendingChangeSet(apiUrl, token, spaceId, agentId, seenIds) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const changes = await request(apiUrl, `/review?spaceId=${encodeURIComponent(spaceId)}`, { token });
    const pending = changes.find((change) => (
      change.status === 'pending_review'
      && change.createdByAgentId === agentId
      && !seenIds.has(change.id)
    ));
    if (pending) return pending;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error('Timed out waiting for the cross-machine knowledge ChangeSet');
}

async function pushAndPublish(engine, proposedBundle, apiUrl, token, spaceId, agentId, seenIds) {
  const pushPromise = engine.push(proposedBundle);
  const changeSet = await waitForPendingChangeSet(apiUrl, token, spaceId, agentId, seenIds);
  seenIds.add(changeSet.id);
  for (const item of changeSet.items) {
    await request(apiUrl, `/change-sets/${changeSet.id}/items/${item.id}`, {
      method: 'PATCH', token, body: { status: 'accepted' },
    });
  }
  await request(apiUrl, `/change-sets/${changeSet.id}/approve`, {
    method: 'POST', token, body: { comment: 'cross-machine E2E' },
  });
  await request(apiUrl, `/change-sets/${changeSet.id}/publish`, { method: 'POST', token });
  const result = await pushPromise;
  assert.equal(result.status, 'published');
  return result;
}

export async function runCrossMachineE2E(environment = process.env) {
  const apiUrl = assertE2ETarget(environment.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api', environment, PREFIX);
  const suffix = `${Date.now()}-${process.pid}`;
  const fixture = { userId: '', spaceId: '', agentId: '' };
  const tempHome = await mkdtemp(join(os.tmpdir(), 'agentwiki-cross-machine-'));
  const seenChangeSets = new Set();
  let token = '';

  try {
    const registration = await request(apiUrl, '/auth/register', {
      method: 'POST',
      body: { email: `cross-machine-${suffix}@example.test`, password: `Cross-${suffix}!`, name: 'Cross-machine E2E' },
    });
    token = registration.access_token;
    fixture.userId = registration.user.id;

    const space = await request(apiUrl, '/spaces', {
      method: 'POST', token, body: { name: `Cross-machine ${suffix}` },
    });
    fixture.spaceId = space.id;
    const agent = await request(apiUrl, '/agents', {
      method: 'POST', token, body: { name: `Cross-machine ${suffix}` },
    });
    fixture.agentId = agent.id;

    const installation = await request(apiUrl, `/agents/${agent.id}/local-sync-installations`, {
      method: 'POST', token,
      body: { spaceId: space.id, role: 'publisher', pluginVersion: '0.7.0' },
    });
    const credential = await request(apiUrl, '/integrations/local-sync/exchange', {
      method: 'POST', body: { code: installation.code },
    });
    assert.ok(credential.apiKey, 'Unified connection exchange must create the Agent credential');
    assert.equal(credential.role, 'publisher');
    assert.equal(credential.spaceId, space.id);

    const connection = {
      id: `cross-${suffix}`,
      serverUrl: apiUrl,
      agentId: agent.id,
      credentialId: credential.id,
      pluginVersion: '0.7.0',
      client: 'codex',
      mcpName: 'agentwiki',
    };
    const client = new AgentWikiClient();
    const homeA = join(tempHome, 'machine-a');
    const homeB = join(tempHome, 'machine-b');
    const homeC = join(tempHome, 'machine-c');
    await mkdir(homeA, { recursive: true });
    await mkdir(homeB, { recursive: true });
    await mkdir(homeC, { recursive: true });
    const machineA = new SyncEngine({ connection, apiKey: credential.apiKey, client, home: homeA, spaceId: space.id });
    const machineB = new SyncEngine({ connection, apiKey: credential.apiKey, client, home: homeB, spaceId: space.id });

    const firstPull = await machineA.pull();
    assert.equal(firstPull.revisionId, '0');
    const pageA = wikiPage(space.id, `machine-a-${suffix}`, 'Machine A Page', '# Machine A\n\nCreated on machine A.');
    const anchorPage = wikiPage(space.id, `anchor-${suffix}`, 'Shared Anchor', '# Shared Anchor\n\nRelation target.');
    const sharedMemory = {
      memoryId: `memory-${suffix}`, spaceId: space.id, key: 'shared-fact', value: 'A cross-machine shared memory.', scope: 'space',
      artifactIds: [], contentHash: contentHash('A cross-machine shared memory.'), updatedAt: new Date().toISOString(),
    };
    const sharedRelation = {
      relationId: `relation-${suffix}`, spaceId: space.id, sourceId: pageA.pageId, targetId: anchorPage.pageId,
      relationType: 'supports', artifactIds: [],
    };
    const pathsA = workspacePaths(homeA, space.id);
    await writeFile(join(pathsA.pagesDir, `${pageA.pageId}.md`), pageA.body, 'utf8');
    await writeFile(join(pathsA.pagesDir, `${anchorPage.pageId}.md`), anchorPage.body, 'utf8');
    const firstPush = await pushAndPublish(
      machineA,
      bundle(space.id, firstPull.revisionId, [pageA, anchorPage], [sharedMemory], [sharedRelation]),
      apiUrl, token, space.id, agent.id, seenChangeSets,
    );

    const pullB = await machineB.pull();
    assert.equal(pullB.updated, true);
    assert.equal(pullB.memoryCount, 1);
    assert.equal(pullB.relationCount, 1);
    assert.match(await readFile(join(workspacePaths(homeB, space.id).pagesDir, `${pageA.pageId}.md`), 'utf8'), /machine A/i);

    const pageB = wikiPage(space.id, `machine-b-${suffix}`, 'Machine B Page', '# Machine B\n\nCreated on machine B.');
    await writeFile(join(workspacePaths(homeB, space.id).pagesDir, `${pageB.pageId}.md`), pageB.body, 'utf8');
    const secondPush = await pushAndPublish(
      machineB,
      bundle(space.id, firstPush.currentRevision, [pageA, anchorPage, pageB], [sharedMemory], [sharedRelation]),
      apiUrl, token, space.id, agent.id, seenChangeSets,
    );
    assert.notEqual(secondPush.currentRevision, firstPush.currentRevision, 'the second publish must advance the authoritative revision');
    const manifestA = JSON.parse(await readFile(pathsA.manifestFile, 'utf8'));
    const headAfterB = await client.getRevisionHead(connection, credential.apiKey, space.id);
    assert.equal(manifestA.baseRevision?.revision, firstPush.currentRevision, 'machine A must still point to its first published revision');
    assert.equal(headAfterB.revisionId, secondPush.currentRevision, 'server head must expose machine B publication');

    const pullA = await machineA.pull();
    assert.equal(pullA.conflicts.length, 0, `non-overlapping machine B addition conflicted: ${JSON.stringify(pullA.conflicts)}`);
    assert.equal(pullA.updated, true);
    assert.equal(pullA.pageCount, 3);
    assert.match(await readFile(join(pathsA.pagesDir, `${pageB.pageId}.md`), 'utf8'), /machine B/i);

    await machineB.pull();
    await writeFile(join(workspacePaths(homeB, space.id).pagesDir, `${pageA.pageId}.md`), '# Machine A\n\nConflicting local edit.', 'utf8');
    const remotePageA = wikiPage(space.id, pageA.pageId, pageA.title, '# Machine A\n\nConflicting remote edit.');
    const updatedRelation = { ...sharedRelation, relationType: 'contradicts' };
    await writeFile(join(pathsA.pagesDir, `${pageA.pageId}.md`), remotePageA.body, 'utf8');
    const thirdPush = await pushAndPublish(
      machineA,
      bundle(space.id, secondPush.currentRevision, [remotePageA, anchorPage, pageB], [sharedMemory], [updatedRelation]),
      apiUrl, token, space.id, agent.id, seenChangeSets,
    );

    const conflictPull = await machineB.pull();
    assert.ok(conflictPull.conflicts.length > 0, 'divergent local and remote edits must produce a conflict');
    assert.equal(conflictPull.updated, false, 'conflicted remote state must not overwrite local files');
    assert.match(await readFile(join(workspacePaths(homeB, space.id).pagesDir, `${pageA.pageId}.md`), 'utf8'), /local edit/);

    const machineC = new SyncEngine({ connection, apiKey: credential.apiKey, client, home: homeC, spaceId: space.id });
    const pullC = await machineC.pull();
    assert.equal(pullC.pageCount, 3);
    const relationState = JSON.parse(await readFile(workspacePaths(homeC, space.id).relationsFile, 'utf8'));
    assert.equal(relationState[0]?.relationType, 'contradicts', 'Agent relation modification must publish through review');
    const deletionBundle = bundle(
      space.id,
      thirdPush.currentRevision,
      [remotePageA, anchorPage],
      [],
      [],
      [
        { deletionId: `delete-page-${suffix}`, itemType: 'page', itemId: pageB.pageId, reason: 'cross-machine deletion check' },
        { deletionId: `delete-memory-${suffix}`, itemType: 'memory', itemId: sharedMemory.memoryId, reason: 'cross-machine deletion check' },
        { deletionId: `delete-relation-${suffix}`, itemType: 'relation', itemId: sharedRelation.relationId, reason: 'cross-machine deletion check' },
      ],
    );
    const deletionPush = await pushAndPublish(
      machineC, deletionBundle, apiUrl, token, space.id, agent.id, seenChangeSets,
    );
    const deletionSnapshot = await client.getSnapshot(connection, credential.apiKey, space.id, deletionPush.currentRevision);
    assert.equal(deletionSnapshot.bundle.pages.some((page) => page.pageId === pageB.pageId), false);
    assert.equal(deletionSnapshot.bundle.memories.length, 0);
    assert.equal(deletionSnapshot.bundle.relations.length, 0);

    return {
      status: 'passed',
      realSyncEngine: true,
      revisions: [firstPush.currentRevision, secondPush.currentRevision],
      conflicts: conflictPull.conflicts.length,
      memories: 1,
      relations: 1,
      approvedDeletions: 3,
    };
  } finally {
    await rm(tempHome, { recursive: true, force: true });
    if (token) {
      await cleanupFixture(fixture, async (kind, id) => {
        const endpoint = kind === 'agent' ? `/agents/${id}` : kind === 'space' ? `/spaces/${id}` : `/users/${id}`;
        await request(apiUrl, endpoint, { method: 'DELETE', token });
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCrossMachineE2E()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
