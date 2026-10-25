#!/usr/bin/env node

// Offline preparation only. This module has no HTTP/DB client and deliberately
// has no execution mode. A reviewer resolves and executes the API steps.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeSources(pages, expectedCount = 9) {
  assert.equal(pages.length, expectedCount, 'source count must match the real directory');
  assert.equal(new Set(pages.map(page => page.id)).size, pages.length, 'source IDs must be unique');
  const documents = pages.map(page => {
    assert.ok(typeof page.id === 'string' && page.id, 'source page ID is required');
    assert.equal(typeof page.title, 'string');
    assert.equal(typeof page.content, 'string');
    assert.ok(typeof page.updatedAt === 'string' && Number.isFinite(Date.parse(page.updatedAt)), 'source version is required');
    assert.ok(page.content.length <= 200_000, 'source body exceeds the clone API limit');
    return {
      pageId: page.id, updatedAt: page.updatedAt,
      characters: page.content.length, bytes: Buffer.byteLength(page.content),
      sha256: createHash('sha256').update(page.content).digest('hex'),
    };
  });
  return {
    count: documents.length,
    characters: documents.reduce((sum, page) => sum + page.characters, 0),
    bytes: documents.reduce((sum, page) => sum + page.bytes, 0),
    documents,
  };
}

export function buildAcceptancePlan({ mode = 'isolated', spaceId = '<spaceId>', sourceFolderId = '<sourceFolderId>', sources } = {}) {
  assert.ok(['isolated', 'live-sources'].includes(mode), 'mode must be isolated or live-sources');
  const prefix = `/spaces/${encodeURIComponent(spaceId)}`;
  const isolated = mode === 'isolated';
  return {
    status: 'prepared-only', networkCalls: 0, mode,
    sourceMetrics: sources ? summarizeSources(sources) : 'Provide --sources <local-json> for exact byte/character/hash measurements',
    placeholders: {
      '$treeRevision': 'Fresh GET content-tree treeRevision before every structural mutation',
      '$fixtureRoot': 'ID returned by creating a unique AUTOTEST folder in this Space root',
      '$sourceCopyFolder': 'Child folder below $fixtureRoot containing only the 9 cloned sources',
      '$target': 'ID returned by cloning the existing summary into $fixtureRoot',
      '$targetPage': 'Fresh GET /pages/$target result immediately before submitting the turn',
      '$session': 'New POST /assist/sessions result; never use the original production session',
      '$requestId': 'One UUID retained across a network retry of the same turn',
    },
    steps: [
      { method: 'GET', path: `${prefix}/content-tree?take=200&parentFolderId=${encodeURIComponent(sourceFolderId)}`, note: 'Follow pagination and child folders. Require exactly 9 pages; separately GET every /pages/:id and hash the complete body.' },
      { method: 'GET', path: `${prefix}/content-tree?take=1`, save: '$treeRevision' },
      { method: 'POST', path: `${prefix}/folders`, body: { name: 'AUTOTEST-<unique-run-id>', parentId: null, expectedTreeRevision: '$treeRevision' }, save: '$fixtureRoot' },
      ...(isolated ? [
        { method: 'POST', path: `${prefix}/folders`, body: { name: 'sources', parentId: '$fixtureRoot', expectedTreeRevision: '$freshTreeRevision' }, save: '$sourceCopyFolder' },
        { method: 'POST', path: '/pages', repeat: 9, body: { spaceId, folderId: '$sourceCopyFolder', title: '$source.title', content: '$source.content', format: '$source.format', expectedTreeRevision: '$freshTreeRevision' }, note: 'Keep each body exact; do not append markers or truncate. IDs, timestamps and path semantics change on cloning.' },
      ] : []),
      { method: 'POST', path: '/pages', body: { spaceId, folderId: '$fixtureRoot', title: 'AUTOTEST-<run-id>-summary', content: '$originalSummary.content', format: 'markdown', expectedTreeRevision: '$freshTreeRevision' }, save: '$target' },
      { method: 'POST', path: '/assist/sessions', body: { spaceId, title: 'AUTOTEST-<run-id>-9-report-acceptance' }, save: '$session' },
      { method: 'GET', path: '/pages/$target', save: '$targetPage' },
      { method: 'POST', path: '/assist/sessions/$session/turns', body: {
        clientRequestId: '$requestId', mode: 'auto', pageId: '$target',
        directory: { folderId: isolated ? '$sourceCopyFolder' : sourceFolderId, recursive: true },
        snapshot: { title: '$targetPage.title', content: '$targetPage.content', updatedAt: '$targetPage.updatedAt' },
        intent: '根据本目录所有测试报告，更新当前测试页中的 bug 状态汇总表。保留原表字段、逐项回复与回归信息；将完整结果保存到当前页。',
      }, save: '$turn' },
      { method: 'GET', path: '/assist/sessions/$session', note: 'Poll until this turn is terminal; record elapsed time, safe progress and document receipt. An HTTP 201/queued response is not success.' },
      { method: 'GET', path: '/pages/$target', note: 'Require done + action=update + receipt.operation=updated + receipt.pageId=$target + matching receipt.updatedAt. Compare saved body with result.changes and the original summary.' },
      { method: 'GET', path: '/pages/$originalSourceId', repeat: 9, note: 'Require identical title, updatedAt, and full-body SHA-256 for every original source.' },
    ],
    cleanup: [
      'Export the safe receipt and verify every created object ID is a test fixture before cleanup.',
      'If a task is still queued/running, POST /assist/tasks/$turn/cancel and wait for cancelled (or an already-committed done receipt) before deleting anything.',
      `GET ${prefix}/folders/$fixtureRoot/delete-impact; independently enumerate its complete subtree and match fixture IDs.`,
      { method: 'DELETE', path: `${prefix}/folders/$fixtureRoot`, body: { expectedUpdatedAt: '$impact.rootUpdatedAt', expectedTreeRevision: '$impact.treeRevision', expectedImpactHash: '$impact.impactHash' } },
      'Retain deletionBatchId and deletion timestamp from the receipt for normal folder restore if needed. Verify source hashes again and fixture folder absent from content-tree.',
      'There is no session-delete API. Its database row remains; deleting its source pages makes the test session inaccessible. Never attach these disposable pages to the original session.',
    ],
    limitations: [
      'A new session does not reproduce old history. The public API has no history import/clone endpoint; replay generates different results and cannot restore failed states or old timestamps.',
      'Exact old-history regression must use read-only executionContext/runner probes or an isolated DB fixture. Pair that evidence with this real queue-save evidence; do not call them the same test.',
      ...(isolated ? ['Clones keep body bytes, but new IDs and timestamps can affect links and report ordering; review source coverage in the saved table.'] : ['The live-sources mode grants both update and create. A wrong auto decision can create a page in the original source folder. This mode is lower volume, not a hard read-only boundary; prefer isolated mode.']),
      'Use the current human account. The AssistSession and folder controllers reject agent credentials.',
      'Browser opening/refresh acceptance remains separate: verify the saved target in the UI before cleanup.',
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!['--mode', '--space-id', '--source-folder-id', '--sources'].includes(arg) || !args[i + 1]) {
      throw new Error('Usage: node scripts/agent-auto-edit-real-space-acceptance.mjs [--mode isolated|live-sources] [--space-id ID] [--source-folder-id ID] [--sources local-pages.json]. No execution mode is provided.');
    }
    options[arg] = args[++i];
  }
  const sources = options['--sources'] ? JSON.parse(await readFile(options['--sources'], 'utf8')) : undefined;
  const plan = buildAcceptancePlan({ mode: options['--mode'], spaceId: options['--space-id'], sourceFolderId: options['--source-folder-id'], sources });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
