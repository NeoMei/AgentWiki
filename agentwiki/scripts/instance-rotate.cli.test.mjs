import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnPnpmSync } from './package-manager-process.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('root instance:rotate resolves the server Prisma client before validating arguments', () => {
  const result = spawnPnpmSync(['instance:rotate'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

  assert.notEqual(result.status, 0, 'missing confirmation must fail closed');
  assert.match(output, /Usage: node scripts\/instance-rotate\.mjs --confirm-new-deployment/u);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package '@prisma\/client'/u);
});
