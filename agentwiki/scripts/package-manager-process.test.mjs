import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolvePackageManagerInvocation, spawnPackageManagerSync } from './package-manager-process.mjs';
import {
  createProcessTreeTerminationPlan,
  terminateProcessTree,
} from './package-manager-process-runner.mjs';

test('uses the package manager directly on POSIX', () => {
  assert.deepEqual(resolvePackageManagerInvocation('pnpm', ['test'], { platform: 'linux' }), {
    executable: 'pnpm',
    args: ['test'],
  });
});

test('launches package-manager JavaScript entry points through Node on Windows', () => {
  const invocation = resolvePackageManagerInvocation('pnpm', ['test'], {
    platform: 'win32',
    executable: 'C:\\Node\\node.exe',
    env: { npm_execpath: 'C:\\tools\\pnpm.mjs' },
    fileExists: (candidate) => candidate === 'C:\\tools\\pnpm.mjs',
  });
  assert.deepEqual(invocation, {
    executable: 'C:\\Node\\node.exe',
    args: ['C:\\tools\\pnpm.mjs', 'test'],
  });
});

test('bypasses an existing Windows cmd shim when a runnable JavaScript entry point exists', () => {
  const invocation = resolvePackageManagerInvocation('pnpm', ['test'], {
    platform: 'win32',
    executable: 'C:\\Node\\node.exe',
    env: { npm_execpath: 'C:\\tools\\pnpm.cmd' },
    fileExists: (candidate) => (
      candidate === 'C:\\tools\\pnpm.cmd'
      || candidate === 'C:\\Node\\node_modules\\pnpm\\bin\\pnpm.cjs'
    ),
  });
  assert.deepEqual(invocation, {
    executable: 'C:\\Node\\node.exe',
    args: ['C:\\Node\\node_modules\\pnpm\\bin\\pnpm.cjs', 'test'],
  });
});

test('sync spawning preserves the caller options', () => {
  let received;
  const result = spawnPackageManagerSync('npm', ['test'], { cwd: '/repo' }, {
    platform: 'win32',
    executable: 'C:\\Node\\node.exe',
    env: {},
    fileExists: (candidate) => candidate.endsWith('npm-cli.js'),
    spawnSync: (...args) => { received = args; return { status: 0 }; },
  });
  assert.equal(result.status, 0);
  assert.equal(received[0], 'C:\\Node\\node.exe');
  assert.match(received[1][0], /npm-cli\.js$/u);
  assert.deepEqual(received[1].slice(1), ['test']);
  assert.deepEqual(received[2], { cwd: '/repo' });
});

test('migration process options always carry a bounded timeout', async () => {
  const helpers = await import('./package-manager-process.mjs');
  assert.equal(typeof helpers.boundedMigrationOptions, 'function');
  assert.deepEqual(helpers.boundedMigrationOptions({ cwd: '/repo' }), {
    cwd: '/repo',
    timeout: 90_000,
  });
  assert.deepEqual(helpers.boundedMigrationOptions({ timeout: 120_000 }), {
    timeout: 90_000,
  });
  assert.deepEqual(helpers.boundedMigrationOptions({ timeout: 30_000 }), {
    timeout: 30_000,
  });
});

test('a timed-out synchronous package-manager command terminates its whole process tree', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'agentwiki-package-manager-timeout-'));
  const sentinel = join(sandbox, 'grandchild-survived');
  const grandchild = [
    "const { writeFileSync } = require('node:fs');",
    'const sentinel = process.argv[1];',
    "setTimeout(() => writeFileSync(sentinel, 'survived'), 1_500);",
  ].join('\n');
  const parent = [
    "const { spawn } = require('node:child_process');",
    'const [sentinel, grandchild] = process.argv.slice(1);',
    "spawn(process.execPath, ['-e', grandchild, sentinel], { stdio: 'ignore' });",
    'setTimeout(() => {}, 10_000);',
  ].join('\n');

  try {
    const startedAt = Date.now();
    const result = spawnPackageManagerSync(process.execPath, ['-e', parent, sentinel, grandchild], {
      encoding: 'utf8',
      timeout: 500,
    });

    assert.equal(result.error?.code, 'ETIMEDOUT');
    assert.ok(Date.now() - startedAt < 3_000, 'the synchronous API must return within a bounded interval');
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    assert.equal(existsSync(sentinel), false, 'a grandchild survived the timeout and wrote the sentinel');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('Windows process-tree termination targets one exact PID without a shell', async () => {
  assert.deepEqual(createProcessTreeTerminationPlan(4242, 'win32'), {
    executable: 'taskkill.exe',
    args: ['/PID', '4242', '/T', '/F'],
  });
  let invocation;
  await terminateProcessTree(4242, {
    platform: 'win32',
    spawnProcess: (...args) => {
      invocation = args;
      const taskkill = new EventEmitter();
      taskkill.kill = () => {};
      queueMicrotask(() => taskkill.emit('close', 0));
      return taskkill;
    },
  });
  assert.deepEqual(invocation, [
    'taskkill.exe',
    ['/PID', '4242', '/T', '/F'],
    { stdio: 'ignore', windowsHide: true },
  ]);
});

test('POSIX process-tree termination targets only the child process group', () => {
  assert.deepEqual(createProcessTreeTerminationPlan(4242, 'darwin'), {
    processGroup: -4242,
    gracefulSignal: 'SIGTERM',
    forceSignal: 'SIGKILL',
  });
});

test('the bounded wrapper preserves spawnSync failure results', () => {
  const missing = join(tmpdir(), `agentwiki-missing-package-manager-${process.pid}`);
  const result = spawnPackageManagerSync(missing, [], {
    encoding: 'utf8',
    timeout: 250,
  });

  assert.equal(result.pid, 0);
  assert.equal(result.status, null);
  assert.equal(result.signal, null);
  assert.equal(result.output, null);
  assert.equal(result.stdout, undefined);
  assert.equal(result.stderr, undefined);
  assert.equal(result.error?.code, 'ENOENT');
  assert.equal(result.error?.syscall, `spawnSync ${missing}`);
  assert.equal(result.error?.path, missing);
  assert.deepEqual(result.error?.spawnargs, []);
});

test('a successful bounded command returns when the command exits instead of waiting for its timeout', () => {
  const startedAt = Date.now();
  const result = spawnPackageManagerSync(process.execPath, ['-e', "process.stdout.write('done')"], {
    encoding: 'utf8',
    timeout: 2_000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.equal(result.stdout, 'done');
  assert.ok(Date.now() - startedAt < 1_000, 'the completed command waited for the unused timeout timer');
});
