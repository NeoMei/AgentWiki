import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

import { spawnPnpmSync } from './package-manager-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protocolRoot = resolve(root, 'packages/sync-protocol');
const requireFromProtocol = createRequire(resolve(protocolRoot, 'package.json'));

test('sync protocol release manifest is exactly 0.6.0', async () => {
  const manifest = JSON.parse(await readFile(resolve(protocolRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '0.6.0');
});

test('clean protocol pack contains only public artifacts and works for ESM, CJS, vectors, and types', {
  timeout: 180_000,
}, async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'agentwiki-sync-protocol-pack-'));
  try {
    const packed = spawnPnpmSync(['pack', '--pack-destination', sandbox], {
      cwd: protocolRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_ignore_scripts: 'false' },
    });
    assert.equal(packed.status, 0, `pnpm pack failed:\n${packed.stdout}\n${packed.stderr}`);
    const archives = (await readdir(sandbox)).filter((name) => name.endsWith('.tgz'));
    assert.equal(archives.length, 1, 'pack must create exactly one tarball');
    const archive = resolve(sandbox, archives[0]);
    const listed = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    const files = listed.stdout.trim().split(/\r?\n/u).filter((path) => !path.endsWith('/'));
    assert.ok(files.includes('package/package.json'));
    assert.ok(files.includes('package/README.md'));
    assert.ok(files.includes('package/LICENSE'));
    assert.ok(files.includes('package/test-vectors/sync-v3.json'));
    assert.ok(files.some((path) => path.startsWith('package/dist/esm/')));
    assert.ok(files.some((path) => path.startsWith('package/dist/cjs/')));
    assert.equal(files.every((path) => /^package\/(?:package\.json|README\.md|LICENSE|test-vectors\/sync-v3\.json|dist\/(?:esm|cjs)\/)/u.test(path)), true);
    assert.equal(files.some((path) => /(?:^|\/)(?:src|scripts|apps|server|secrets?)(?:\/|$)|\.spec\./iu.test(path)), false);

    const extracted = resolve(sandbox, 'extracted');
    await mkdir(extracted);
    const extraction = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(extraction.status, 0, extraction.stderr);
    const packageRoot = resolve(extracted, 'package');
    await mkdir(resolve(packageRoot, 'node_modules'), { recursive: true });
    await symlink(dirname(requireFromProtocol.resolve('zod/package.json')), resolve(packageRoot, 'node_modules/zod'), 'dir');

    const esm = await import(pathToFileURL(resolve(packageRoot, 'dist/esm/index.js')).href);
    const cjs = createRequire(import.meta.url)(resolve(packageRoot, 'dist/cjs/index.js'));
    for (const consumer of [esm, cjs]) {
      assert.equal(typeof consumer.canonicalBytes, 'function');
      assert.equal(typeof consumer.treeConfirmationHashV3, 'function');
    }
    const vector = JSON.parse(await readFile(resolve(packageRoot, 'test-vectors/sync-v3.json'), 'utf8'));
    assert.match(vector.confirmation.expectedHash, /^[0-9a-f]{64}$/u);
    assert.equal(
      await esm.treeConfirmationHashV3(vector.confirmation.input),
      vector.confirmation.expectedHash,
    );

    const consumerRoot = resolve(sandbox, 'consumer');
    await mkdir(resolve(consumerRoot, 'node_modules/@neomei'), { recursive: true });
    await symlink(packageRoot, resolve(consumerRoot, 'node_modules/@neomei/agentwiki-sync-protocol'), 'dir');
    await symlink(dirname(requireFromProtocol.resolve('zod/package.json')), resolve(consumerRoot, 'node_modules/zod'), 'dir');
    await writeFile(resolve(consumerRoot, 'package.json'), '{"type":"module"}\n');
    await writeFile(resolve(consumerRoot, 'consumer.ts'), [
      "import { canonicalBytes, treeConfirmationHashV3 } from '@neomei/agentwiki-sync-protocol';",
      "import vector from '@neomei/agentwiki-sync-protocol/test-vectors/sync-v3.json' with { type: 'json' };",
      'void canonicalBytes(vector.confirmation.input);',
      'void treeConfirmationHashV3;',
    ].join('\n'));
    await writeFile(resolve(consumerRoot, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      strict: true, noEmit: true, module: 'NodeNext', moduleResolution: 'NodeNext',
      resolveJsonModule: true, target: 'ES2022', skipLibCheck: false,
    }, include: ['consumer.ts'] }));
    const typecheck = spawnPnpmSync(['exec', 'tsc', '-p', resolve(consumerRoot, 'tsconfig.json')], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(typecheck.status, 0, `tarball type consumer failed:\n${typecheck.stdout}\n${typecheck.stderr}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
