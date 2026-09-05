import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertProtocolTreesEqual } from './sync-protocol-registry-parity.mjs';

test('protocol registry parity compares extracted paths and bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentwiki-protocol-parity-test-'));
  const local = join(root, 'local');
  const registry = join(root, 'registry');
  try {
    await Promise.all([
      mkdir(join(local, 'dist'), { recursive: true }),
      mkdir(join(registry, 'dist'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(local, 'package.json'), `${JSON.stringify({
        version: '0.5.1',
        scripts: { test: 'vitest run', prepack: 'pnpm build && pnpm test && pnpm verify:sync-v3-builds' },
        dependencies: { zod: '^3.25.76' },
      }, null, 2)}\n`),
      writeFile(join(registry, 'package.json'), JSON.stringify({
        dependencies: { zod: '^3.25.76' },
        scripts: { test: 'vitest run' },
        version: '0.5.1',
      })),
      writeFile(join(local, 'dist/index.js'), 'export const version = 3;\n'),
      writeFile(join(registry, 'dist/index.js'), 'export const version = 3;\n'),
    ]);
    await assert.doesNotReject(assertProtocolTreesEqual(local, registry));
    await writeFile(join(registry, 'dist/index.js'), 'export const version = 2;\n');
    await assert.rejects(
      assertProtocolTreesEqual(local, registry),
      /differs from immutable registry artifact/u,
    );

    await writeFile(join(registry, 'dist/index.js'), 'export const version = 3;\n');
    const registryManifest = JSON.parse(await readFile(join(registry, 'package.json'), 'utf8'));
    registryManifest.dependencies.zod = '^4.0.0';
    await writeFile(join(registry, 'package.json'), JSON.stringify(registryManifest));
    await assert.rejects(
      assertProtocolTreesEqual(local, registry),
      /manifest differs from immutable registry artifact/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
