import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { GATEWAY_PACKAGE_VERSION } from './package-release.js';
import {
  ensureGatewayRuntime,
  gatewayRuntimeCliPath,
  gatewayRuntimeDir,
  localGatewayCommand,
  readGatewayRuntime,
  stageGatewayRuntimeFixture,
} from './gateway-runtime.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function home(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'aw-runtime-'));
  cleanup.push(path);
  return path;
}

describe('gateway runtime path', () => {
  it('installs under the documented versioned directory and launches without npx', async () => {
    const root = await home();
    const runtime = await stageGatewayRuntimeFixture(root);

    expect(gatewayRuntimeDir(root)).toBe(join(root, '.agentwiki', 'runtime', `local-sync-${GATEWAY_PACKAGE_VERSION}`));
    expect(runtime.cliPath).toBe(gatewayRuntimeCliPath(root));
    expect(localGatewayCommand(runtime, 'conn-1')).toEqual([
      runtime.nodePath, runtime.cliPath, 'gateway', '--connection', 'conn-1',
    ]);
    expect(localGatewayCommand(runtime, 'conn-1').join(' ')).not.toContain('npx');
  });

  it('reads back a staged runtime and rejects a version mismatch', async () => {
    const root = await home();
    const staged = await stageGatewayRuntimeFixture(root);
    await expect(readGatewayRuntime(root)).resolves.toEqual(staged);

    await writeFile(
      join(gatewayRuntimeDir(root), 'node_modules', '@neomei', 'agentwiki-local-sync', 'package.json'),
      JSON.stringify({ name: '@neomei/agentwiki-local-sync', version: '0.13.4' }),
    );
    await expect(readGatewayRuntime(root)).resolves.toBeNull();
  });

  it('returns null for a missing runtime instead of creating it', async () => {
    const root = await home();
    await expect(readGatewayRuntime(root)).resolves.toBeNull();
    await expect(stat(gatewayRuntimeDir(root))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('ensureGatewayRuntime', () => {
  it('installs once and reuses the verified runtime without another install', async () => {
    const root = await home();
    const stages: string[] = [];
    const first = await ensureGatewayRuntime({
      home: root,
      install: async (target) => {
        stages.push(target);
        await seedPackage(target);
      },
    });
    expect(stages).toHaveLength(1);
    expect(first.cliPath).toBe(gatewayRuntimeCliPath(root));

    const second = await ensureGatewayRuntime({
      home: root,
      install: async (target) => {
        stages.push(target);
        await seedPackage(target);
      },
    });
    expect(stages).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('does not leave a staging directory behind when installation fails', async () => {
    const root = await home();
    await expect(ensureGatewayRuntime({
      home: root,
      install: async () => { throw new Error('registry unreachable'); },
    })).rejects.toThrow('registry unreachable');
    await expect(readGatewayRuntime(root)).resolves.toBeNull();
    const runtimeRoot = join(root, '.agentwiki', 'runtime');
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(runtimeRoot)).filter((name) => name.startsWith('.install-'))).toEqual([]);
  });

  it('records the Node used for installation so later launches use it too', async () => {
    const root = await home();
    const runtime = await ensureGatewayRuntime({
      home: root,
      install: async (target) => seedPackage(target),
    });
    const manifest = JSON.parse(await readFile(join(gatewayRuntimeDir(root), 'runtime.json'), 'utf8'));
    expect(manifest.nodePath).toBe(runtime.nodePath);
    expect(manifest.version).toBe(GATEWAY_PACKAGE_VERSION);
    if (process.platform !== 'win32') {
      expect((await stat(join(gatewayRuntimeDir(root), 'runtime.json'))).mode & 0o777).toBe(0o600);
      expect((await stat(gatewayRuntimeDir(root))).mode & 0o700).toBe(0o700);
    }
  });

  it.skipIf(process.platform === 'win32')('runs the installed CLI without any npm or registry access', async () => {
    const root = await home();
    const runtime = await ensureGatewayRuntime({
      home: root,
      install: async (target) => seedPackage(target, '#!/usr/bin/env node\nconsole.log(JSON.stringify({argv: process.argv.slice(2), node: process.version}));\n'),
    });
    // A PATH that contains only the selected Node proves startup resolves no
    // external npx or npm; the absolute CLI path is executed directly.
    const { stdout } = await promisify(execFile)(runtime.nodePath, localGatewayCommand(runtime, 'conn-offline').slice(1), {
      env: { PATH: '' },
    });
    const output = JSON.parse(stdout);
    expect(output.argv).toEqual(['gateway', '--connection', 'conn-offline']);
    expect(output.node).toBe(process.version);
  });
});

async function seedPackage(target: string, cli = '#!/usr/bin/env node\nprocess.exit(0);\n'): Promise<void> {
  const packageDir = join(target, 'node_modules', '@neomei', 'agentwiki-local-sync');
  await mkdir(join(packageDir, 'dist'), { recursive: true, mode: 0o700 });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@neomei/agentwiki-local-sync', version: GATEWAY_PACKAGE_VERSION }));
  await writeFile(join(packageDir, 'dist', 'cli.js'), cli, { mode: 0o755 });
}
