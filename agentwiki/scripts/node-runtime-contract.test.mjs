import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
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

  const serverDocker = runtimeFiles[0];
  assert.match(
    serverDocker,
    /COPY packages\/sync-protocol\/package\.json \.\/packages\/sync-protocol\//,
    'the server image must install the workspace sync protocol dependency',
  );
  assert.match(
    serverDocker,
    /pnpm --filter @neomei\/agentwiki-sync-protocol build/,
    'the server image must build the workspace sync protocol dependency',
  );
  assert.match(
    serverDocker,
    /COPY --from=builder \/app\/packages\/sync-protocol\/dist \.\/packages\/sync-protocol\/dist/,
    'the server image must include the runtime sync protocol artifacts',
  );

  const deploy = await read('deploy.sh');
  assert.match(deploy, /SUPPORTED_NODE_MAJORS="24 26"/);
  assert.match(deploy, /\/usr\/bin\/node/);
  assert.match(deploy, /requires Node\.js 24 or 26/);
  assert.match(deploy, /chown -R -- .*\$HOME\/\$\{PROJECT_DIR\}/);
  const generateIndex = deploy.indexOf('pnpm --filter @agentwiki/server exec prisma generate');
  const protocolBuildIndex = deploy.indexOf(
    'pnpm --filter @neomei/agentwiki-sync-protocol build',
  );
  const buildIndex = deploy.indexOf('pnpm --filter @agentwiki/server build');
  assert.ok(generateIndex >= 0, 'direct deployment must explicitly regenerate Prisma Client');
  assert.ok(
    protocolBuildIndex >= 0,
    'direct deployment must build the workspace sync protocol package',
  );
  assert.ok(
    protocolBuildIndex < buildIndex,
    'the sync protocol package must be built before the server',
  );
  assert.ok(generateIndex < buildIndex, 'Prisma Client must be generated before the server build');
  assert.match(
    deploy,
    /apps packages scripts deploy deploy\.sh/,
    'direct deployment must package the sync migration utilities',
  );
  assert.match(
    deploy,
    /release_dir\/scripts\/.*HOME.*PROJECT_DIR.*scripts\//s,
    'direct deployment must install the sync migration utilities',
  );
  assert.notEqual((await stat(resolve(root, 'deploy.sh'))).mode & 0o111, 0, 'deploy.sh must be executable');
});

test('direct production deployment rejects a stale non-HTTPS public Agent API URL', async () => {
  const deploy = await read('deploy.sh');
  assert.match(deploy, /PUBLIC_API_URL/);
  assert.match(deploy, /https:\/\//);
  assert.match(deploy, /must be the externally reachable HTTPS \/api URL/);
  assert.match(deploy, /packages\/local-sync\/package\.json/);
  assert.match(deploy, /LOCAL_SYNC_PACKAGE_VERSION/);
  assert.match(deploy, /AGENTWIKI_SERVER_PEPPER/);
  assert.match(deploy, /AGENTWIKI_DEPLOYMENT_SEED/);
  assert.match(deploy, /openssl rand -base64 32/);
  assert.match(deploy, /Buffer\.from\(process\.argv\[1\], "base64"\)\.length !== 32/);
});

test('the sync v1 backfill can read nullable Release A rows with the final Prisma Client', async () => {
  const backfill = await read('scripts/backfill-sync-v1.mjs');
  assert.doesNotMatch(backfill, /prisma\.page\.findMany/);
  assert.doesNotMatch(backfill, /prisma\.spaceKnowledgeRevision\.findMany/);
  assert.doesNotMatch(backfill, /syncPath:\s*null/);
  assert.match(backfill, /prisma\.\$queryRawUnsafe/);
  assert.match(backfill, /tx\.\$executeRawUnsafe/);
  assert.doesNotMatch(backfill, /const revisionContentHash\s*=/);
  assert.match(backfill, /const computedRevisionContentHash\s*=/);
  assert.match(backfill, /if \(revision\.revisionContentHash\)/);
  assert.match(backfill, /migrationBatchId: `\$\{batchId\}:\$\{revision\.id\}`/);
  assert.doesNotMatch(backfill, /space\.findMany\(\{\s*where:\s*\{\s*deletedAt:\s*null/);
  assert.match(backfill, /space\.findMany\(\{\s*select:\s*\{\s*id:\s*true\s*\}\s*\}\)/);
  assert.match(backfill, /FROM "Page"/);
  assert.match(backfill, /FROM "SpaceKnowledgeRevision"/);
});

test('Nginx sends Socket.IO websocket upgrades directly to the API', async () => {
  const nginx = await read('deploy/nginx/agentwiki.conf');
  const socketLocation = nginx.match(/location \/socket\.io\/ \{([\s\S]*?)\n    \}/)?.[1];

  assert.ok(socketLocation, 'Nginx must define a dedicated /socket.io/ location');
  assert.match(socketLocation, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(socketLocation, /proxy_http_version 1\.1;/);
  assert.match(socketLocation, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(socketLocation, /proxy_set_header Connection "upgrade";/);
});

test('Compose forwards onboarding and OpenCode routing configuration to the API', async () => {
  const compose = await read('docker-compose.yml');
  const version = JSON.parse(await read('packages/local-sync/package.json')).version;
  assert.match(compose, /PUBLIC_API_URL: \$\{PUBLIC_API_URL:\?PUBLIC_API_URL is required\}/);
  assert.match(
    compose,
    new RegExp(`LOCAL_SYNC_PACKAGE_VERSION: \\$\\{LOCAL_SYNC_PACKAGE_VERSION:-${version.replaceAll('.', '\\.')}\\}`),
  );
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
  assert.equal(version, '0.3.7');
  for (const path of [
    '.env.example',
    'README.md',
    'apps/client/src/config/localSync.ts',
    'apps/client/src/features/about/OnboardPage.tsx',
    'apps/server/.env.example',
    'apps/server/src/onboard/onboard.controller.ts',
    'docker-compose.yml',
    'packages/local-sync/README.md',
    'packages/local-sync/src/gateway/entry.ts',
    'packages/local-sync/src/gateway/remote-mcp-bridge.ts',
    'packages/local-sync/src/gateway/server.ts',
    'packages/local-sync/src/installer/plan.ts',
    'packages/local-sync/src/local-knowledge.ts',
    'packages/local-sync/src/onboarding/runtime.ts',
    'packages/local-sync/src/onboarding/verifier.ts',
    'scripts/local-sync-e2e.mjs',
  ]) {
    assert.match(await read(path), new RegExp(version.replaceAll('.', '\\.')), `${path} must use ${version}`);
  }
});

test('every user-facing local-sync surface uses the published npm package name', async () => {
  for (const path of [
    'packages/local-sync/README.md',
    'packages/local-sync/skill/SKILL.md',
    'apps/client/src/features/about/OnboardPage.tsx',
    'apps/server/src/onboard/onboard.controller.ts',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /@agentwiki\/local-sync/, `${path} must not use the retired npm scope`);
    assert.match(source, /@neomei\/agentwiki-local-sync/, `${path} must name the published package`);
  }
});



test('the onboard controller advertises the pinned 0.3.7 onboarding command', async () => {
  const source = await read('apps/server/src/onboard/onboard.controller.ts');
  assert.match(source, /0\.3\.7/, 'onboard controller must reference 0.3.7');
  assert.match(source, /onboard --server/, 'onboard controller must advertise the pinned onboard command');
  assert.doesNotMatch(source, /connect --server/, 'onboard controller must not advertise the retired connect command');
  assert.doesNotMatch(source, /--orchestrator/, 'onboard controller must not advertise --orchestrator');
});

test('the local-sync CLI exposes gateway and onboard commands without connect', async () => {
  const source = await read('packages/local-sync/src/cli.ts');
  const usage = source.match(/CLI_USAGE = '([^']+)'/);
  assert.ok(usage, 'CLI_USAGE must be defined');
  assert.match(usage[1], /onboard/, 'CLI must expose onboard');
  assert.match(usage[1], /gateway/, 'CLI must expose gateway');
  assert.doesNotMatch(usage[1], /\bconnect\b/, 'CLI must not expose connect');
  assert.doesNotMatch(usage[1], /--orchestrator/, 'CLI must not expose --orchestrator');
});

test('every active Agent connection surface exposes only the unified gateway', async () => {
  const sources = await Promise.all([
    'apps/client/src/features/agent/AgentDetail.tsx',
    'apps/client/src/features/agent/LocalSyncInstallCard.tsx',
    'apps/client/src/features/about/OnboardPage.tsx',
    'apps/server/src/core/agent/local-sync-installation.service.ts',
    'packages/local-sync/README.md',
    'packages/local-sync/skill/SKILL.md',
  ].map(read));
  const active = sources.join('\n');

  assert.doesNotMatch(active, /mcp add agentwiki-/i, 'must not register a credential-specific remote MCP');
  assert.doesNotMatch(active, /mcp add[^\n]*\/api\/mcp/i, 'must not register the remote MCP beside the gateway');
  assert.doesNotMatch(active, /connect --server/i, 'must not advertise the retired connect command');
  assert.doesNotMatch(active, /two MCP servers|两个 MCP/i, 'must not advertise two AgentWiki MCP servers');
  assert.match(active, /wiki_\*|wiki_/i, 'the unified gateway must document remote wiki tools');
  assert.match(active, /knowledge_\*|knowledge_/i, 'the unified gateway must document combined knowledge tools');
});

test('the onboard.json endpoint returns 410 Gone with a replacement command', async () => {
  const source = await read('apps/server/src/onboard/onboard.controller.ts');
  assert.match(source, /410/, 'onboard.json must return 410');
  assert.match(source, /@HttpCode\(HttpStatus\.GONE\)/, 'onboard.json must use the real HTTP 410 status');
  assert.match(source, /replacement/, 'onboard.json must include a replacement command');
  assert.doesNotMatch(source, /OnboardPlan/, 'the old OnboardPlan type must be removed');
});

test('the local-sync README documents the supported Node majors', async () => {
  const readme = await read('packages/local-sync/README.md');
  assert.match(readme, /Node\.js 24 or 26/);
  assert.doesNotMatch(readme, /Node\.js 20 or later/);
  assert.match(readme, /Python 3\.10 or later/);
});

test('production dependency floors exclude patched network and routing vulnerabilities', async () => {
  const workspace = await read('pnpm-workspace.yaml');
  const server = JSON.parse(await read('apps/server/package.json'));
  const client = JSON.parse(await read('apps/client/package.json'));
  const localSync = JSON.parse(await read('packages/local-sync/package.json'));

  assert.equal(server.dependencies['@modelcontextprotocol/sdk'], '^1.30.0');
  assert.equal(localSync.dependencies['@modelcontextprotocol/sdk'], '^1.30.0');
  assert.equal(client.dependencies['react-router-dom'], '^7.18.2');
  assert.match(workspace, /'@hono\/node-server': '2\.1\.0'/);
  assert.match(workspace, /body-parser: '1\.20\.6'/);
  assert.match(workspace, /hono: '4\.13\.1'/);
  assert.match(workspace, /qs: '6\.15\.3'/);
});
