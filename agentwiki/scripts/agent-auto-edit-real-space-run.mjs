#!/usr/bin/env node

/**
 * Guarded real queue-save verifier for the current human Space.
 *
 * This file never logs in, registers an account, generates a JWT, reads a
 * browser profile, or accepts an Agent/API key. It only uses a human Bearer
 * token supplied explicitly by the operator (AGENTWIKI_HUMAN_TOKEN or stdin),
 * and all mutations go through the normal HTTP API. Invocation without
 * --execute is an offline plan. Production execution additionally requires
 * AGENTWIKI_REAL_SPACE_WRITE=YES.
 */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const EXPECTED_SOURCE_COUNT = 9;
const POLL_TIMEOUT_MS = 390_000;
const INTENT = '根据本目录所有测试报告，更新当前测试页中的 bug 状态汇总表。保留原表字段、逐项回复与回归信息；将完整结果保存到当前页。';

function parseArgs(argv) {
  const result = { execute: false, tokenStdin: false, seedHistory: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--execute') result.execute = true;
    else if (value === '--token-stdin') result.tokenStdin = true;
    else if (value === '--seed-history') result.seedHistory = Number(argv[++index]);
    else if (value === '--help' || value === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!Number.isInteger(result.seedHistory) || result.seedHistory < 0 || result.seedHistory > 9) throw new Error('--seed-history must be 0 through 9');
  return result;
}

function help() {
  process.stdout.write([
    'Offline (default): node scripts/agent-auto-edit-real-space-run.mjs',
    'Real run (operator approval required):',
    '  AGENTWIKI_REAL_SPACE_WRITE=YES AGENTWIKI_API_URL=https://host/api \\',
    '  AGENTWIKI_SPACE_ID=<space> AGENTWIKI_SOURCE_FOLDER_ID=<folder> \\',
    '  AGENTWIKI_HUMAN_TOKEN=<short-lived human JWT> \\',
    '  node scripts/agent-auto-edit-real-space-run.mjs --execute',
    'Or pipe the human token without putting it in shell history:',
    '  printf %s "$TOKEN_FROM_TRUSTED_SECRET_STORE" | AGENTWIKI_REAL_SPACE_WRITE=YES ... node ... --execute --token-stdin',
    '',
    'The verifier does not read Chrome localStorage/passwords. If no human token is available, use the browser runbook in acceptance-plan.md.',
  ].join('\n') + '\n');
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assertHumanCredential(token) {
  if (!token || token.length < 20) throw new Error('A human Bearer token is required');
  if (token.startsWith('awk_') || token.startsWith('agk_')) throw new Error('Agent/API keys are forbidden; use a human JWT');
  // Do not decode or print the token. The authenticated /users/me request is
  // the authority check; this shape check only rejects obvious API keys.
  if (token.split('.').length !== 3) throw new Error('The supplied credential is not a JWT; no API key fallback is allowed');
}

async function readHumanToken({ fromStdin }) {
  const token = fromStdin ? readFileSync(0, 'utf8').trim() : process.env.AGENTWIKI_HUMAN_TOKEN?.trim();
  assertHumanCredential(token);
  return token;
}

async function api(apiUrl, path, { token, method = 'GET', body, timeoutMs = 30_000 } = {}) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`HTTP request failed: ${method} ${path}`);
  }
  const text = await response.text();
  let value = null;
  if (text) {
    try { value = JSON.parse(text); } catch { throw new Error(`HTTP response was not JSON: ${method} ${path}`); }
  }
  if (!response.ok) {
    const message = value && typeof value === 'object' && 'message' in value ? String(value.message) : `status ${response.status}`;
    throw new Error(`HTTP ${method} ${path}: ${message.slice(0, 240)}`);
  }
  return value;
}

function bodyHash(value) {
  assert.equal(typeof value, 'string');
  return createHash('sha256').update(value).digest('hex');
}

async function currentRevision(apiUrl, token, spaceId) {
  const value = await api(apiUrl, `/spaces/${encodeURIComponent(spaceId)}/content-tree?take=1`, { token });
  assert.match(String(value?.treeRevision), /^(?:0|[1-9]\d*)$/u);
  return String(value.treeRevision);
}

async function listFolderChildren(apiUrl, token, spaceId, parentFolderId) {
  const nodes = [];
  let cursor;
  do {
    const query = new URLSearchParams({ take: '200' });
    if (parentFolderId) query.set('parentFolderId', parentFolderId);
    if (cursor) query.set('cursor', cursor);
    const value = await api(apiUrl, `/spaces/${encodeURIComponent(spaceId)}/content-tree?${query}`, { token });
    nodes.push(...(value?.data || []));
    cursor = value?.nextCursor || undefined;
  } while (cursor);
  return nodes;
}

async function listSubtree(apiUrl, token, spaceId, rootFolderId) {
  const pageNodes = [];
  const folders = [rootFolderId];
  while (folders.length) {
    const folderId = folders.shift();
    const children = await listFolderChildren(apiUrl, token, spaceId, folderId);
    pageNodes.push(...children.filter(node => node.kind === 'page'));
    folders.push(...children.filter(node => node.kind === 'folder').map(node => node.id));
  }
  return pageNodes;
}

async function createFolder(apiUrl, token, spaceId, name, parentId = null) {
  const value = await api(apiUrl, `/spaces/${encodeURIComponent(spaceId)}/folders`, {
    method: 'POST', token,
    body: { name, parentId, expectedTreeRevision: await currentRevision(apiUrl, token, spaceId) },
  });
  assert.ok(value?.folder?.id, 'folder create did not return an ID');
  return value.folder;
}

async function createPage(apiUrl, token, spaceId, folderId, title, content, format = 'markdown') {
  const value = await api(apiUrl, '/pages', {
    method: 'POST', token,
    body: { spaceId, folderId, title: title.slice(0, 200), content, format, expectedTreeRevision: await currentRevision(apiUrl, token, spaceId) },
  });
  assert.ok(value?.id, 'page create did not return an ID');
  return value;
}

async function waitForTurn(apiUrl, token, sessionId, turnId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    const detail = await api(apiUrl, `/assist/sessions/${encodeURIComponent(sessionId)}`, { token });
    latest = detail?.turns?.find(turn => turn.id === turnId);
    if (latest && ['done', 'failed', 'cancelled'].includes(latest.status)) return latest;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Turn ${turnId} exceeded ${timeoutMs}ms (last status ${latest?.status || 'unknown'})`);
}

async function submitTurn(apiUrl, token, sessionId, payload, timeoutMs) {
  const created = await api(apiUrl, `/assist/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: 'POST', token, body: { clientRequestId: randomUUID(), ...payload },
  });
  return waitForTurn(apiUrl, token, sessionId, created.id, timeoutMs);
}

async function deleteFolder(apiUrl, token, spaceId, folderId) {
  const path = `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}`;
  const impact = await api(apiUrl, `${path}/delete-impact`, { token });
  await api(apiUrl, path, { method: 'DELETE', token, body: {
    expectedUpdatedAt: impact.rootUpdatedAt,
    expectedTreeRevision: String(impact.treeRevision),
    expectedImpactHash: impact.impactHash,
  } });
  return { deletionImpact: impact };
}

function offlinePlan() {
  return {
    status: 'prepared-only',
    networkCalls: 0,
    authentication: 'human JWT only; no login, registration, API key, JWT generation, password or browser profile access',
    sequence: [
      'GET /users/me (prove current credential is a human account)',
      'GET source folder tree + GET all 9 source pages + local SHA-256',
      'POST disposable root folder + sources child folder + 9 exact body copies + disposable target page',
      'POST new AssistSession; POST auto turn; poll GET session until done',
      'GET target page and all original 9 pages; verify receipt and unchanged hashes',
      'GET delete-impact + DELETE disposable root folder via normal API',
    ],
    limitations: [
      'No API route imports old history or deletes sessions; the audit session remains after fixture cleanup.',
      'The browser UI cannot share localStorage JWT with a Node process. If no human JWT is already available from a trusted secret handoff, execute the same sequence manually in the logged-in browser; never read Chrome passwords/localStorage for this script.',
    ],
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return help();
  if (!options.execute) return process.stdout.write(`${JSON.stringify(offlinePlan(), null, 2)}\n`);
  if (process.env.AGENTWIKI_REAL_SPACE_WRITE !== 'YES') throw new Error('Real execution requires AGENTWIKI_REAL_SPACE_WRITE=YES');
  const apiUrl = required('AGENTWIKI_API_URL').replace(/\/$/u, '');
  const spaceId = required('AGENTWIKI_SPACE_ID');
  const sourceFolderId = required('AGENTWIKI_SOURCE_FOLDER_ID');
  const token = await readHumanToken({ fromStdin: options.tokenStdin });
  const timeoutMs = Number(process.env.AGENTWIKI_ASSIST_POLL_MS || POLL_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 900_000) throw new Error('AGENTWIKI_ASSIST_POLL_MS must be 30000 through 900000');

  // The API is the authority for this check. HumanOnlyGuard rejects agents and
  // all API keys; this endpoint also avoids echoing any principal details.
  await api(apiUrl, '/users/me', { token });
  const sourceNodes = await listSubtree(apiUrl, token, spaceId, sourceFolderId);
  if (sourceNodes.length !== EXPECTED_SOURCE_COUNT) throw new Error(`Expected ${EXPECTED_SOURCE_COUNT} source pages, found ${sourceNodes.length}`);
  const originalPages = await Promise.all(sourceNodes.map(node => api(apiUrl, `/pages/${encodeURIComponent(node.id)}`, { token })));
  const originals = new Map(originalPages.map(page => [page.id, { title: page.title, content: page.content, updatedAt: page.updatedAt, hash: bodyHash(page.content) }]));
  if (originalPages.some(page => typeof page.content !== 'string' || page.content.length > 200_000)) throw new Error('A source page exceeds the normal page create limit');
  const runId = `AUTOTEST-${Date.now()}-${process.pid}`;
  let fixtureRoot;
  let session;
  try {
    fixtureRoot = await createFolder(apiUrl, token, spaceId, runId);
    const sourceCopies = await createFolder(apiUrl, token, spaceId, 'sources', fixtureRoot.id);
    const copies = [];
    for (const page of originalPages) copies.push(await createPage(apiUrl, token, spaceId, sourceCopies.id, `${runId} ${page.title}`, page.content, page.format || 'markdown'));
    const target = await createPage(apiUrl, token, spaceId, fixtureRoot.id, `${runId} Bug status summary`, originalPages.find(page => page.title === 'Bug 状态汇总表')?.content || '', 'markdown');
    session = await api(apiUrl, '/assist/sessions', { method: 'POST', token, body: { spaceId, title: `${runId} 9-report queue acceptance` } });
    for (let index = 0; index < options.seedHistory; index += 1) {
      const probe = await submitTurn(apiUrl, token, session.id, { mode: 'question', pageId: target.id, intent: `Acceptance history probe ${index + 1}: answer OK.` }, timeoutMs);
      if (probe.status !== 'done') throw new Error(`History probe ${index + 1} ended ${probe.status}`);
    }
    const latest = await api(apiUrl, `/pages/${encodeURIComponent(target.id)}`, { token });
    const turn = await submitTurn(apiUrl, token, session.id, {
      mode: 'auto', pageId: target.id, directory: { folderId: sourceCopies.id, recursive: true },
      snapshot: { title: latest.title, content: latest.content, updatedAt: latest.updatedAt }, intent: INTENT,
    }, timeoutMs);
    if (turn.status !== 'done') throw new Error(`Auto turn ended ${turn.status}: ${turn.failureCode || turn.error || 'unknown failure'}`);
    assert.equal(turn.result?.document?.operation, 'updated');
    assert.equal(turn.result.document.pageId, target.id);
    const saved = await api(apiUrl, `/pages/${encodeURIComponent(target.id)}`, { token });
    assert.equal(saved.updatedAt, turn.result.document.updatedAt);
    const after = await Promise.all(originalPages.map(page => api(apiUrl, `/pages/${encodeURIComponent(page.id)}`, { token })));
    for (const page of after) {
      const before = originals.get(page.id);
      assert.equal(page.title, before.title);
      assert.equal(page.updatedAt, before.updatedAt);
      assert.equal(bodyHash(page.content), before.hash);
    }
    process.stdout.write(`${JSON.stringify({ status: 'passed', sessionId: session.id, targetPageId: target.id, fixtureRootId: fixtureRoot.id, sourceCount: originalPages.length, targetUpdatedAt: saved.updatedAt }, null, 2)}\n`);
  } finally {
    if (fixtureRoot) await deleteFolder(apiUrl, token, spaceId, fixtureRoot.id);
  }
}

run().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });

