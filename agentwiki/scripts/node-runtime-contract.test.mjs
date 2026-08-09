import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(root, '..');
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
  assert.equal(
    serverPackage.dependencies['opencode-ai'],
    '1.18.12',
    'the worker release must install the pinned OpenCode CLI it executes',
  );
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
  assert.match(deploy, /chown -R -- .*\$HOME\/\$\{PROJECT_DIR\}/);
  const generateIndex = deploy.indexOf('pnpm --filter @agentwiki/server exec prisma generate');
  const buildIndex = deploy.indexOf('pnpm --filter @agentwiki/server build');
  assert.ok(generateIndex >= 0, 'direct deployment must explicitly regenerate Prisma Client');
  assert.ok(generateIndex < buildIndex, 'Prisma Client must be generated before the server build');
});

test('direct production deployment rejects a stale non-HTTPS public Agent API URL', async () => {
  const deploy = await read('deploy.sh');
  assert.match(deploy, /PUBLIC_API_URL/);
  assert.match(deploy, /https:\/\//);
  assert.match(deploy, /must be the externally reachable HTTPS \/api URL/);
});

test('Compose forwards onboarding and OpenCode routing configuration to the API', async () => {
  const compose = await read('docker-compose.yml');
  assert.match(compose, /PUBLIC_API_URL: \$\{PUBLIC_API_URL:\?PUBLIC_API_URL is required\}/);
  assert.match(compose, /LOCAL_SYNC_PACKAGE_VERSION: \$\{LOCAL_SYNC_PACKAGE_VERSION:-0\.2\.6\}/);
  assert.match(compose, /ASSIST_OPENCODE_ALLOW_PAID_FALLBACK: \$\{ASSIST_OPENCODE_ALLOW_PAID_FALLBACK:-true\}/);
  assert.match(compose, /OPENROUTER_API_KEY: \$\{OPENROUTER_API_KEY:-\}/);
});

test('the product no longer carries the retired external wiki compiler path', () => {
  const retiredName = ['Open', 'Wiki'].join('');
  let matches = '';
  try {
    matches = execFileSync('git', ['grep', '-in', retiredName, '--', '.'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    if (error?.status !== 1) throw error;
  }
  assert.equal(matches, '', `Retired local knowledge instructions remain:\n${matches}`);
});

test('every active local-sync release surface uses the package version', async () => {
  const version = JSON.parse(await read('packages/local-sync/package.json')).version;
  assert.equal(version, '0.2.6');
  for (const path of [
    '.env.example',
    'apps/client/src/config/localSync.ts',
    'apps/server/.env.example',
    'apps/server/src/onboard/onboard.controller.ts',
    'packages/local-sync/src/local-knowledge.ts',
    'scripts/local-sync-e2e.mjs',
  ]) {
    assert.match(await read(path), new RegExp(version.replaceAll('.', '\\.')), `${path} must use ${version}`);
  }
});
