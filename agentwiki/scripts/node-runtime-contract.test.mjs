import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

test('the repository supports Node 24 and Node 26', async () => {
  assert.ok(['24', '26'].includes(process.versions.node.split('.')[0]));

  const packageJson = JSON.parse(await read('package.json'));
  assert.equal(packageJson.engines.node, '>=24 <25 || >=26 <27');
  assert.equal(packageJson.packageManager, 'pnpm@11.9.0');
  assert.equal(
    packageJson.scripts.postinstall,
    'pnpm --filter @agentwiki/server exec prisma generate',
  );
  assert.equal((await read('.node-version')).trim(), '24');

  const serverPackage = JSON.parse(await read('apps/server/package.json'));
  assert.equal(serverPackage.devDependencies['@types/node'], '^24.0.0');
});

test('Docker defaults to Node 24 and direct deployment accepts the supported majors', async () => {
  const runtimeFiles = await Promise.all([
    read('apps/server/Dockerfile'),
    read('apps/client/Dockerfile'),
    read('docker-compose.yml'),
  ]);
  for (const source of runtimeFiles) {
    assert.match(source, /node:24-alpine/);
    assert.doesNotMatch(source, /node:20-alpine/);
  }

  const deploy = await read('deploy.sh');
  assert.match(deploy, /SUPPORTED_NODE_MAJORS="24 26"/);
  assert.match(deploy, /\/usr\/bin\/node/);
  assert.match(deploy, /requires Node\.js 24 or 26/);
});
