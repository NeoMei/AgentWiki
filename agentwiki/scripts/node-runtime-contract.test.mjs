import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(root, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');

async function activeFiles(path) {
  const entry = resolve(root, path);
  const entries = await readdir(entry, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (child) => {
    const relative = `${path}/${child.name}`;
    return child.isDirectory() ? activeFiles(relative) : [relative];
  }));
  return files.flat();
}

function normalizeLegacySurface(value) {
  let decoded = value;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (/%[0-9a-f]{2}/iu.test(decoded)) {
      decoded = decoded.replace(/%([0-9a-f]{2})/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
      continue;
    }
    if (/%[0-9a-f]/iu.test(decoded)) throw new Error('invalid percent encoding');
    break;
  }
  return decoded
    .replace(/\\x([0-9a-f]{2})/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})/giu, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .normalize('NFKC')
    .toLowerCase();
}

const MAX_ACTIVE_SURFACE_LENGTH = 512 * 1024;

function parseStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return null;
  let value = '';
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      if (index + 1 >= source.length) return null;
      value += character + source[index + 1];
      index += 1;
      continue;
    }
    if (character === quote) return { value, end: index + 1 };
    value += character;
  }
  return null;
}

function skipWhitespace(source, start) {
  let index = start;
  while (index < source.length && /\s/u.test(source[index])) index += 1;
  return index;
}

function assembledStringValues(source) {
  const assembled = [];
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] === '[') {
      let position = skipWhitespace(source, start + 1);
      const values = [];
      let item = parseStringLiteral(source, position);
      while (item) {
        values.push(item.value);
        position = skipWhitespace(source, item.end);
        if (source[position] !== ',') break;
        position = skipWhitespace(source, position + 1);
        item = parseStringLiteral(source, position);
      }
      position = skipWhitespace(source, item ? item.end : position);
      if (values.length >= 2 && source[position] === ']') {
        position = skipWhitespace(source, position + 1);
        if (source.startsWith('.join', position)) {
          position = skipWhitespace(source, position + '.join'.length);
          if (source[position] === '(') {
            const separator = parseStringLiteral(source, skipWhitespace(source, position + 1));
            if (separator && (separator.value === '-' || separator.value === '_') && source[skipWhitespace(source, separator.end)] === ')') {
              assembled.push(values.join(separator.value));
            }
          }
        }
      }
    }

    const first = parseStringLiteral(source, start);
    if (!first) continue;
    const values = [first.value];
    let position = skipWhitespace(source, first.end);
    while (source[position] === '+') {
      const next = parseStringLiteral(source, skipWhitespace(source, position + 1));
      if (!next) break;
      values.push(next.value);
      position = skipWhitespace(source, next.end);
    }
    if (values.length >= 2) assembled.push(values.join(''));
    start = first.end - 1;
  }
  return assembled;
}

function containsRetiredCodebaseToken(value) {
  return normalizeLegacySurface(value).replace(/[^a-z0-9]/gu, '').includes('codebasememory');
}

function isRetiredCodebaseSurface(value) {
  if (value.length > MAX_ACTIVE_SURFACE_LENGTH) throw new Error('bounded scan limit exceeded');
  return value.split(/\r?\n/u).some(containsRetiredCodebaseToken)
    || assembledStringValues(value).some(containsRetiredCodebaseToken);
}

function isRetiredPackedModule(path) {
  return isRetiredCodebaseSurface(path) || /(?:^|\/)(?:local-knowledge|mcp)(?:\.|\/)/iu.test(path);
}

let packJsonParseCount = 0;

function packFilesFromNpmJson(output, packageName) {
  packJsonParseCount += 1;
  const parsed = JSON.parse(output);
  let report;
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) throw new Error('npm pack JSON must contain exactly one package report');
    [report] = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const entries = Object.entries(parsed);
    const named = entries.filter(([name]) => name === packageName);
    if (named.length === 1) [, report] = named[0];
    else if (entries.length === 1) [, report] = entries[0];
    else throw new Error('npm pack JSON package report is ambiguous');
  } else {
    throw new Error('npm pack JSON must be an array or a package-keyed object');
  }
  if (!report || typeof report !== 'object' || !Array.isArray(report.files) || report.files.length === 0) {
    throw new Error('npm pack JSON report must contain a non-empty files array');
  }
  return report.files.map((file) => {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string' || file.path.length === 0) {
      throw new Error('npm pack JSON files must contain non-empty paths');
    }
    return file.path;
  });
}

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

test('active local-sync surfaces cannot retain a retired Codebase Memory path', async () => {
  const paths = [
    ...await activeFiles('packages/local-sync/src'),
    'README.md',
    'packages/local-sync/README.md',
    'packages/local-sync/skill/SKILL.md',
    'packages/local-sync/package.json',
    '.gitignore',
  ];
  const matches = [];
  for (const path of paths) {
    const source = await read(path);
    try {
      if (isRetiredCodebaseSurface(source)) matches.push(path);
    } catch (error) {
      matches.push(`${path} (normalization failed: ${error instanceof Error ? error.message : String(error)})`);
    }
  }
  assert.deepEqual(matches, [], `Retired Codebase Memory references remain in active surfaces:\n${matches.join('\n')}`);

  await assert.rejects(
    stat(resolve(root, '.codebase-memory/graph.db.zst')),
    { code: 'ENOENT' },
    'The retired graph artifact must not remain in the working tree',
  );
});

test('retired local-path normalization rejects encoded and assembled spellings', () => {
  for (const sample of [
    'codebase%2Dmemory',
    'codebase%252Dmemory',
    'codebase‑memory',
    'codebase\\x2dmemory',
    'codebase\\u002dmemory',
    "['codebase', 'memory'].join('-')",
    "['codebase', 'memory'].join('_')",
    "'codebase' + '_' + 'memory'",
    "'codebase' +\n'-memory'",
    "['codebase',\n'memory'].join('-')",
    "'code' + 'base' + '-' + 'memory'",
    '"codebase" +\n"_" +\n"memory"',
  ]) {
    assert.equal(isRetiredCodebaseSurface(sample), true, sample);
  }
  for (const sample of ['CodeGraph generated knowledge', "['codegraph', 'memory'].join('-')", "'codebase'\n'memory'"]) {
    assert.equal(isRetiredCodebaseSurface(sample), false, sample);
  }
  assert.throws(() => normalizeLegacySurface('codebase%2'), /invalid percent encoding/);
  assert.throws(() => isRetiredCodebaseSurface('safe\n'.repeat(110_000)), /bounded scan limit/);
});

test('npm pack JSON parsing accepts supported result shapes and rejects ambiguity', () => {
  const packageName = '@neomei/agentwiki-local-sync';
  const report = { name: packageName, files: [{ path: 'dist/cli.js' }] };
  assert.deepEqual(packFilesFromNpmJson(JSON.stringify([report]), packageName), ['dist/cli.js']);
  assert.deepEqual(packFilesFromNpmJson(JSON.stringify({ [packageName]: report }), packageName), ['dist/cli.js']);
  for (const fixture of [[], [report, report], {}, { first: report, second: report }, { [packageName]: { files: [] } }]) {
    assert.throws(() => packFilesFromNpmJson(JSON.stringify(fixture), packageName));
  }
});

test('the local-sync clean script only removes its own real dist directory', async () => {
  const clean = await read('packages/local-sync/scripts/clean-dist.mjs');
  assert.match(clean, /realpathSync\(resolve\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)\)/u);
  assert.match(clean, /dirname\(dist\) !== packageRoot \|\| basename\(dist\) !== 'dist'/u);
  assert.match(clean, /lstatSync\(dist\)/u);
  assert.match(clean, /entry\.isSymbolicLink\(\)/u);
  assert.match(clean, /realpathSync\(dist\) !== dist/u);
  assert.match(clean, /rmSync\(dist, \{ recursive: true, force: true \}\)/u);
});

test('local-sync builds and packs without retired modules or public subpaths', async () => {
  const packageRoot = resolve(root, 'packages/local-sync');
  const packageJson = JSON.parse(await read('packages/local-sync/package.json'));
  assert.match(packageJson.scripts.build, /^node \.\/scripts\/clean-dist\.mjs && tsc$/u);
  execFileSync('pnpm', ['--dir', packageRoot, 'run', 'build'], { cwd: root, stdio: 'inherit' });

  for (const path of [
    'dist/adapter/codebase-memory.js', 'dist/adapter/codebase-memory.d.ts',
    'dist/local-knowledge.js', 'dist/local-knowledge.d.ts',
    'dist/mcp.js', 'dist/mcp.d.ts',
  ]) {
    await assert.rejects(stat(resolve(packageRoot, path)), { code: 'ENOENT' }, `${path} must not survive a fresh build`);
  }

  const cache = await mkdtemp(join(tmpdir(), 'agentwiki-pack-'));
  try {
    const packed = execFileSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: packageRoot,
      env: { ...process.env, npm_config_cache: cache },
      encoding: 'utf8',
    });
    const parserCountBeforeLivePack = packJsonParseCount;
    const files = packFilesFromNpmJson(packed, packageJson.name);
    assert.equal(packJsonParseCount, parserCountBeforeLivePack + 1, 'the live npm pack output must execute the JSON parser');
    assert.ok(files.includes('scripts/clean-dist.mjs'), 'the packed build must include its exact clean script');
    assert.deepEqual(files.filter((path) => path.startsWith('scripts/')), ['scripts/clean-dist.mjs']);
    const retired = files.filter(isRetiredPackedModule);
    assert.deepEqual(retired, [], `retired modules must not be packed:\n${retired.join('\n')}`);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }

  let rejectedSubpaths = 0;
  for (const subpath of [
    '@neomei/agentwiki-local-sync/dist/adapter/codebase-memory.js',
    '@neomei/agentwiki-local-sync/dist/local-knowledge.js',
    '@neomei/agentwiki-local-sync/dist/mcp.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/index.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/%69ndex.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/generated-store.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/%67enerated-store.js',
  ]) {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(subpath)}).then(() => process.exit(1), (error) => { process.stdout.write(error.code ?? ''); process.exit(error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? 0 : 1); })`,
    ], { cwd: packageRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, `${subpath} must be blocked by package exports: ${result.stderr}`);
    assert.equal(result.stdout, 'ERR_PACKAGE_PATH_NOT_EXPORTED');
    rejectedSubpaths += 1;
  }
  assert.equal(rejectedSubpaths, 7, 'the live package resolution checks must execute for every retired or private subpath');
});

test('every active local-sync release surface uses the package version', async () => {
  const version = JSON.parse(await read('packages/local-sync/package.json')).version;
  assert.equal(version, '0.4.0');
  for (const path of [
    '.env.example',
    'README.md',
    'apps/client/src/config/localSync.ts',
    'apps/client/e2e/local-sync.spec.ts',
    'apps/client/e2e/onboarding-device.spec.ts',
    'apps/server/.env.example',
    'apps/server/src/onboard/onboard.controller.ts',
    'docker-compose.yml',
    'packages/local-sync/README.md',
    'packages/local-sync/src/gateway/entry.ts',
    'packages/local-sync/src/gateway/remote-mcp-bridge.ts',
    'packages/local-sync/src/gateway/server.ts',
    'packages/local-sync/src/installer/plan.ts',
    'packages/local-sync/src/onboarding/runtime.ts',
    'packages/local-sync/src/onboarding/verifier.ts',
    'scripts/cross-machine-e2e.mjs',
  ]) {
    assert.match(await read(path), new RegExp(version.replaceAll('.', '\\.')), `${path} must use ${version}`);
  }
});

test('every user-facing local-sync surface uses the published npm package name', async () => {
  for (const path of [
    'packages/local-sync/README.md',
    'packages/local-sync/skill/SKILL.md',
    'apps/client/src/config/localSync.ts',
    'apps/client/e2e/local-sync.spec.ts',
    'apps/server/src/onboard/onboard.controller.ts',
  ]) {
    const source = await read(path);
    assert.doesNotMatch(source, /@agentwiki\/local-sync/, `${path} must not use the retired npm scope`);
    assert.match(source, /@neomei\/agentwiki-local-sync/, `${path} must name the published package`);
  }
});



test('the onboard controller advertises the pinned 0.4.0 onboarding command', async () => {
  const source = await read('apps/server/src/onboard/onboard.controller.ts');
  assert.match(source, /0\.4\.0/, 'onboard controller must reference 0.4.0');
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
  assert.doesNotMatch(active, /agentwiki-local-sync\s+(?:mcp|scan|sync|upgrade)\b/i, 'must not advertise retired public CLI commands');
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

test('local-sync guidance documents the confirmed CodeGraph standard-analysis flow', async () => {
  const packageJson = JSON.parse(await read('packages/local-sync/package.json'));
  assert.equal(packageJson.engines.node, '>=24 <25 || >=26 <27');

  for (const path of ['packages/local-sync/README.md', 'packages/local-sync/skill/SKILL.md']) {
    const source = await read(path);
    assert.match(source, /CodeGraph/);
    assert.match(source, /analysisMode:\s*standard/);
    assert.match(source, /localScanPlanHash/);
    assert.match(source, /local_scan_sources/);
    assert.match(source, /knowledge_prepare/);
    assert.match(source, /knowledge_confirm_and_sync/);
    assert.match(source, /(?:确认.*扫描|扫描.*确认|confirmation.*scan|scan.*confirmation)/isu, `${path} must require a separate scan confirmation`);
    assert.match(source, /(?:确认.*同步|同步.*确认|confirmation.*sync|sync.*confirmation)/isu, `${path} must require a separate sync confirmation`);
    assert.doesNotMatch(source, /AgentWiki[^\n]{0,100}(?:installs?|upgrades?)\s+CodeGraph/i);
    assert.doesNotMatch(source, /automatically[^\n]{0,100}(?:deep|深度分析)|(?:deep|深度分析)[^\n]{0,100}automatically/i);
  }
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
