import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'scripts/collaboration-real-agent-harness.mjs');

test('real-client harness fails closed without a dedicated collaboration test database', () => {
  const env = { ...process.env };
  delete env.COLLABORATION_TEST_DATABASE_URL;
  delete env.DATABASE_URL;

  const result = spawnSync(process.execPath, [script, 'plan'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /COLLABORATION_TEST_DATABASE_URL is required/u,
  );
});

test('real-client harness publishes a secret-free five-template execution plan', () => {
  const result = spawnSync(process.execPath, [script, 'plan'], {
    cwd: root,
    env: {
      ...process.env,
      COLLABORATION_TEST_DATABASE_URL: 'postgresql://tester:secret@localhost/agentwiki_collaboration_test',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.clients, ['codex', 'claude']);
  assert.deepEqual(plan.templates, [
    'coding',
    'bid-writing',
    'paper-writing',
    'video-script-writing',
    'novel-writing',
  ]);
  assert.equal(plan.databaseIsolation, 'random collaboration_test_* schema');
  assert.doesNotMatch(result.stdout, /secret|postgresql:\/\//u);
});

test('serve mode requires an explicit absolute state file', () => {
  const result = spawnSync(process.execPath, [script, 'serve'], {
    cwd: root,
    env: {
      ...process.env,
      COLLABORATION_TEST_DATABASE_URL: 'postgresql://tester@localhost/agentwiki_collaboration_test',
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}${result.stderr}`,
    /COLLABORATION_ACCEPTANCE_STATE_FILE must be an absolute path/u,
  );
});

test('serve mode prepares all five real-client runs and removes secret state on shutdown', {
  skip: !process.env.COLLABORATION_TEST_DATABASE_URL,
  timeout: 120_000,
}, async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentwiki-real-client-harness-test-'));
  const stateFile = join(temporaryRoot, 'state.json');
  const child = spawn(process.execPath, [script, 'serve'], {
    cwd: root,
    env: {
      ...process.env,
      COLLABORATION_ACCEPTANCE_STATE_FILE: stateFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });

  try {
    await waitFor(() => output.includes('"status":"READY"') || child.exitCode !== null, 90_000);
    assert.equal(child.exitCode, null, output);
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    assert.match(state.schemaName, /^collaboration_test_[a-z0-9_]+$/u);
    assert.deepEqual(Object.keys(state.runs).sort(), [
      'bid-writing', 'coding', 'novel-writing', 'paper-writing', 'video-script-writing',
    ]);
    assert.equal((await stat(stateFile)).mode & 0o777, 0o600);

    child.kill('SIGTERM');
    await new Promise((resolveExit, rejectExit) => {
      child.once('exit', resolveExit);
      child.once('error', rejectExit);
    });
    assert.match(output, /"status":"CLEANED"/u);
    await assert.rejects(access(stateFile));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for real-client harness output');
}
