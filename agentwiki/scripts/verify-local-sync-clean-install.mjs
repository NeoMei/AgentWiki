import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protocolName = '@neomei/agentwiki-sync-protocol';
const localSyncName = '@neomei/agentwiki-local-sync';
const protocolManifest = JSON.parse(await readFile(join(root, 'packages', 'sync-protocol', 'package.json'), 'utf8'));
const localSyncManifest = JSON.parse(await readFile(join(root, 'packages', 'local-sync', 'package.json'), 'utf8'));
const expectedProtocolVersion = protocolManifest.version;
const expectedLocalSyncVersion = localSyncManifest.version;
const registryProtocol = process.env.AGENTWIKI_PROTOCOL_INSTALL_SOURCE === 'registry';

function pack(packageDirectory, destination) {
  execFileSync('npm', ['pack', '--pack-destination', destination], {
    cwd: join(root, packageDirectory),
    stdio: 'inherit',
  });
}

async function findTarball(directory, prefix) {
  const matches = (await readdir(directory)).filter((entry) => entry.startsWith(prefix) && entry.endsWith('.tgz'));
  assert.equal(matches.length, 1, `expected exactly one ${prefix} tarball`);
  return join(directory, matches[0]);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentwiki-clean-install-'));
const packDirectory = join(temporaryRoot, 'pack');
const installDirectory = join(temporaryRoot, 'install');
const npmCache = join(temporaryRoot, 'npm-cache');

try {
  await mkdir(packDirectory, { recursive: true });
  if (!registryProtocol) pack(join('packages', 'sync-protocol'), packDirectory);
  pack(join('packages', 'local-sync'), packDirectory);

  const protocolSource = registryProtocol
    ? `${protocolName}@${expectedProtocolVersion}`
    : await findTarball(packDirectory, 'neomei-agentwiki-sync-protocol-');
  const localSyncTarball = await findTarball(packDirectory, 'neomei-agentwiki-local-sync-');
  const installSources = registryProtocol
    ? [localSyncTarball]
    : [protocolSource, localSyncTarball];
  execFileSync('npm', [
    'install', '--prefix', installDirectory, '--ignore-scripts', '--no-audit', '--no-fund',
    ...installSources,
  ], {
    cwd: temporaryRoot,
    env: { ...process.env, npm_config_cache: npmCache },
    stdio: 'inherit',
  });

  const installedProtocol = JSON.parse(await readFile(join(
    installDirectory, 'node_modules', '@neomei', 'agentwiki-sync-protocol', 'package.json',
  ), 'utf8'));
  const installedLocalSync = JSON.parse(await readFile(join(
    installDirectory, 'node_modules', '@neomei', 'agentwiki-local-sync', 'package.json',
  ), 'utf8'));
  assert.equal(installedProtocol.version, expectedProtocolVersion);
  assert.equal(installedLocalSync.version, expectedLocalSyncVersion);
  assert.equal(installedLocalSync.dependencies[protocolName], installedProtocol.version);

  const cli = spawnSync(process.execPath, [
    join(installDirectory, 'node_modules', '@neomei', 'agentwiki-local-sync', 'dist', 'cli.js'),
    '--help',
  ], { cwd: temporaryRoot, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /onboard\|gateway\|doctor\|uninstall/u);

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    localSyncVersion: installedLocalSync.version,
    syncProtocolVersion: installedProtocol.version,
    protocolSource: registryProtocol ? 'registry' : 'local-tarball',
  })}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
