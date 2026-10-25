import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { buildAcceptancePlan, summarizeSources } from './agent-auto-edit-real-space-acceptance.mjs';

const pages = Array.from({ length: 9 }, (_, index) => ({
  id: `report-${index}`, title: `Private title ${index}`, content: `报告正文-private-${index}`, updatedAt: '2026-10-26T00:00:00.000Z',
}));

test('offline metrics retain real Unicode byte size and omit all source bodies', () => {
  const metrics = summarizeSources(pages);
  assert.equal(metrics.count, 9);
  assert.ok(metrics.bytes > metrics.characters);
  assert.equal(metrics.documents[0].sha256.length, 64);
  const serialized = JSON.stringify(buildAcceptancePlan({ sources: pages }));
  assert.ok(!serialized.includes('报告正文-private'));
  assert.ok(!serialized.includes('Private title'));
});

test('isolated plan separates the nine source copies from the target page', () => {
  const plan = buildAcceptancePlan({ spaceId: 's', sourceFolderId: 'original' });
  const clone = plan.steps.find(step => step.repeat === 9 && step.method === 'POST');
  const target = plan.steps.find(step => step.save === '$target');
  const turn = plan.steps.find(step => step.save === '$turn');
  assert.equal(clone.body.folderId, '$sourceCopyFolder');
  assert.equal(target.body.folderId, '$fixtureRoot');
  assert.equal(turn.body.directory.folderId, '$sourceCopyFolder');
  assert.equal(turn.body.pageId, '$target');
  assert.equal(plan.networkCalls, 0);
});

test('live-source plan clearly records auto-create and history limitations', () => {
  const plan = buildAcceptancePlan({ mode: 'live-sources', sourceFolderId: 'original' });
  assert.ok(plan.limitations.some(value => value.includes('grants both update and create')));
  assert.ok(plan.limitations.some(value => value.includes('no history import/clone')));
  assert.ok(plan.cleanup.some(value => typeof value === 'string' && value.includes('Never attach these disposable pages to the original session')));
  assert.equal(plan.steps.find(step => step.save === '$turn').body.directory.folderId, 'original');
});

test('rejects insufficient source fixtures and duplicate identifiers', () => {
  assert.throws(() => summarizeSources(pages.slice(0, 8)), /source count/);
  assert.throws(() => summarizeSources(pages.map(page => ({ ...page, id: 'same' }))), /unique/);
});

test('CLI prints an offline plan and rejects an execution flag', () => {
  const script = new URL('./agent-auto-edit-real-space-acceptance.mjs', import.meta.url);
  const result = JSON.parse(execFileSync(process.execPath, [script.pathname], { encoding: 'utf8' }));
  assert.equal(result.status, 'prepared-only');
  assert.equal(result.networkCalls, 0);
  assert.throws(() => execFileSync(process.execPath, [script.pathname, '--execute'], { stdio: 'pipe' }), /Command failed/);
});
