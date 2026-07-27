import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

const capture = (source, pattern, description) => {
  const match = source.match(pattern);
  assert.ok(match, `Could not find ${description}`);
  return match[2];
};

test('Compose probes the health controller through the configured global prefix', async () => {
  const [main, healthController, compose] = await Promise.all([
    read('apps/server/src/main.ts'),
    read('apps/server/src/health.controller.ts'),
    read('docker-compose.yml'),
  ]);

  const prefix = capture(main, /setGlobalPrefix\((['"])([^'"]+)\1\)/, 'Nest global prefix');
  const controllerPath = capture(
    healthController,
    /@Controller\((['"])([^'"]+)\1\)/,
    'health controller path',
  );
  const healthcheckUrl = capture(
    compose,
    /fetch\((['"])(https?:\/\/[^'"]+)\1\)/,
    'Compose backend healthcheck URL',
  );

  const expectedPath = `/${prefix}/${controllerPath}`;
  assert.equal(expectedPath, '/api/health');
  assert.equal(new URL(healthcheckUrl).pathname, expectedPath);
});
