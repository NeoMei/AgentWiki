import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePackageManagerInvocation, spawnPackageManagerSync } from './package-manager-process.mjs';

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
