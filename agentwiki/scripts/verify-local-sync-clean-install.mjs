import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protocolName = '@neomei/agentwiki-sync-protocol';
const localSyncName = '@neomei/agentwiki-local-sync';

function pack(packageName, destination) {
  execFileSync('pnpm', ['--filter', packageName, 'pack', '--pack-destination', destination], {
    cwd: root,
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
  pack(protocolName, packDirectory);
  pack(localSyncName, packDirectory);

  const protocolTarball = await findTarball(packDirectory, 'neomei-agentwiki-sync-protocol-');
  const localSyncTarball = await findTarball(packDirectory, 'neomei-agentwiki-local-sync-');
  execFileSync('npm', [
    'install', '--prefix', installDirectory, '--ignore-scripts', '--no-audit', '--no-fund',
    protocolTarball, localSyncTarball,
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
  assert.equal(installedProtocol.version, '0.2.0');
  assert.equal(installedLocalSync.version, '0.5.0');
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
  })}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
