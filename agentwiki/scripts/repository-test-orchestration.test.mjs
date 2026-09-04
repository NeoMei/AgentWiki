import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const harness = fileURLToPath(new URL('./repository-test-harness.mjs', import.meta.url));

test('repository test plan builds generated dependencies before every test phase', () => {
  const result = spawnSync(process.execPath, [harness, 'plan'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.phases.map((phase) => phase.id), [
    'build-test-dependencies',
    'runtime-tests',
    'server-tests',
    'client-tests',
    'sync-protocol-tests',
    'local-sync-tests',
  ]);
  assert.deepEqual(plan.phases[0].args, [
    '--filter', 'shared', 'build',
    '&&', '--filter', '@neomei/agentwiki-sync-protocol', 'build',
    '&&', '--filter', '@agentwiki/server', 'build',
  ]);
});
