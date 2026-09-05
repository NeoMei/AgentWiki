import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { spawnPackageManagerSync } from './package-manager-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protocolRoot = resolve(root, 'packages/sync-protocol');

async function regularFileManifest(directory, relativeDirectory = '') {
  const entries = await readdir(join(directory, relativeDirectory), { withFileTypes: true });
  const manifest = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      manifest.push(...await regularFileManifest(directory, relativePath));
      continue;
    }
    if (!entry.isFile()) throw new Error(`Protocol artifact contains unsupported entry: ${relativePath}`);
    if (relativePath === 'package.json') continue;
    const bytes = await readFile(join(directory, relativePath));
    manifest.push({
      path: relativePath,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return manifest;
}

const allowedLocalPrepack = 'pnpm build && pnpm test && pnpm verify:sync-v3-builds';

async function comparablePackageManifest(directory, side) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (side === 'local') {
    assert.equal(
      manifest.scripts?.prepack,
      allowedLocalPrepack,
      'local protocol manifest has an unexpected prepack script',
    );
    delete manifest.scripts.prepack;
  } else {
    assert.equal(
      manifest.scripts?.prepack,
      undefined,
      'registry protocol manifest unexpectedly has a prepack script',
    );
  }
  return manifest;
}

export async function assertProtocolTreesEqual(localDirectory, registryDirectory) {
  assert.deepEqual(
    await comparablePackageManifest(localDirectory, 'local'),
    await comparablePackageManifest(registryDirectory, 'registry'),
    'local protocol package manifest differs from immutable registry artifact',
  );
  assert.deepEqual(
    await regularFileManifest(localDirectory),
    await regularFileManifest(registryDirectory),
    'local protocol package differs from immutable registry artifact',
  );
}

async function exactlyOneTarball(directory) {
  const archives = (await readdir(directory)).filter((entry) => entry.endsWith('.tgz'));
  if (archives.length !== 1) throw new Error('Protocol parity pack must produce exactly one tarball');
  return join(directory, archives[0]);
}

function runNpmPack(args, cwd) {
  const result = spawnPackageManagerSync('npm', args, {
    cwd,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Protocol parity npm pack failed: ${result.error?.message ?? result.stderr}`);
  }
}

function extractTarball(archive, destination) {
  const result = spawnSync('tar', ['-xzf', archive, '-C', destination], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Protocol parity extraction failed: ${result.error?.message ?? result.stderr}`);
  }
}

export async function verifyPublishedProtocolParity({ registryUrl }) {
  const registry = new URL(registryUrl);
  if (!['http:', 'https:'].includes(registry.protocol) || registry.username || registry.password) {
    throw new Error('Protocol parity registry must be an HTTP(S) URL without credentials');
  }
  const manifest = JSON.parse(await readFile(join(protocolRoot, 'package.json'), 'utf8'));
  if (manifest.name !== '@neomei/agentwiki-sync-protocol' || manifest.version !== '0.5.1') {
    throw new Error('Protocol parity is pinned to immutable @neomei/agentwiki-sync-protocol@0.5.1');
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'agentwiki-protocol-parity-'));
  try {
    const localPack = join(temporaryRoot, 'local-pack');
    const registryPack = join(temporaryRoot, 'registry-pack');
    const localExtracted = join(temporaryRoot, 'local-extracted');
    const registryExtracted = join(temporaryRoot, 'registry-extracted');
    await Promise.all([
      mkdir(localPack), mkdir(registryPack), mkdir(localExtracted), mkdir(registryExtracted),
    ]);
    runNpmPack(['pack', '--ignore-scripts', '--pack-destination', localPack], protocolRoot);
    runNpmPack([
      'pack', `${manifest.name}@${manifest.version}`, '--ignore-scripts',
      '--registry', registry.href, '--pack-destination', registryPack,
    ], root);
    extractTarball(await exactlyOneTarball(localPack), localExtracted);
    extractTarball(await exactlyOneTarball(registryPack), registryExtracted);
    await assertProtocolTreesEqual(
      join(localExtracted, 'package'),
      join(registryExtracted, 'package'),
    );
    return { package: manifest.name, version: manifest.version, registry: registry.href };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main(argv) {
  const registryArguments = argv.filter((value) => value.startsWith('--registry='));
  if (registryArguments.length !== 1 || argv.length !== 1) {
    throw new Error('Usage: sync-protocol-registry-parity.mjs --registry=<explicit-url>');
  }
  const result = await verifyPublishedProtocolParity({
    registryUrl: registryArguments[0].slice('--registry='.length),
  });
  process.stdout.write(`${JSON.stringify({ status: 'identical', ...result })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
