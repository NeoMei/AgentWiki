import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./server-test-harness.mjs', import.meta.url));

test('server test harness fails closed without a dedicated database', () => {
  const env = { ...process.env };
  delete env.COLLABORATION_TEST_DATABASE_URL;
  delete env.DATABASE_URL;
  const result = spawnSync(process.execPath, [script, 'plan'], { encoding: 'utf8', env });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /COLLABORATION_TEST_DATABASE_URL is required/u);
});

test('server test harness declares random schema isolation without leaking credentials', () => {
  const result = spawnSync(process.execPath, [script, 'plan'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      COLLABORATION_TEST_DATABASE_URL: 'postgresql://tester:secret@localhost/agentwiki_test',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'ready',
    databaseIsolation: 'random collaboration_test_* schema',
  });
  assert.doesNotMatch(result.stdout, /secret|postgresql:\/\//u);
});
