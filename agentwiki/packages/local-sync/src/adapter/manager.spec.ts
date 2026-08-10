import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterManager, AdapterRuntimeError } from './manager.js';
import type { ManagedAdapter, RuntimeStatus, ExecFn } from './manager.js';

function fakeExec(
  records: Record<string, { stdout: string; stderr?: string }>,
): ExecFn {
  return async (file: string, args?: readonly string[] | null) => {
    const argsArr = args ?? [];
    const key = [file, ...argsArr].join(' ');
    const record = records[key];
    if (!record) {
      const err = new Error(`Command not found in fake exec: ${key}`);
      (err as unknown as { code: number }).code = 127;
      throw err;
    }
    return { stdout: record.stdout, stderr: record.stderr ?? '' };
  };
}

function stubAdapter(id: string): ManagedAdapter {
  return {
    adapterId: id,
    displayName: id,
    descriptor: {
      kind: 'node-module',
      packageName: id,
      packageVersion: '1.0.0',
      installCommand: ['npm', 'install', `${id}@1.0.0`],
    },
    factory: () => ({
      manifest: () => ({
        adapterId: id,
        version: '1.0.0',
        protocolVersion: '1.0',
        inputKinds: ['directory'],
        artifactKinds: ['document'],
        supportsIncremental: false,
        permissions: ['read-source-path'],
        runtime: { kind: 'node-module' },
      }),
      inspect: async () => ({
        adapterId: id,
        sourcePath: '/tmp/x',
        displayName: 'x',
        kind: 'documents',
        estimatedArtifacts: 1,
        sourceHash: 'sh1',
      }),
      collect: async () => ({ artifacts: [], hasMore: false }),
    }),
  };
}

describe('AdapterManager', () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'agentwiki-runtime-'));
  });

  afterEach(async () => {
    await rm(tempHome, { recursive: true, force: true });
  });

  it('lists managed adapters', () => {
    const manager = new AdapterManager({ runtimeHome: tempHome });
    const ids = manager.listManaged().map((a) => a.adapterId).sort();
    expect(ids).toEqual(['codebase-memory', 'markitdown']);
  });

  it('installs Microsoft MarkItDown in an isolated Python environment', async () => {
    const calls: Array<{ file: string; args: string[]; timeout?: number }> = [];
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      exec: async (file, args, options) => {
        calls.push({
          file,
          args: [...(args ?? [])],
          timeout: (options as { timeout?: number } | undefined)?.timeout,
        });
        return { stdout: '', stderr: '' };
      },
    });

    const status = await manager.install('markitdown');

    expect(status).toMatchObject({ installed: true, version: '0.1.6' });
    const venvCall = calls.find((call) => call.args.includes('venv'));
    const pipCall = calls.find((call) => call.args.includes('pip'));
    expect(venvCall).toMatchObject({ args: ['-m', 'venv', '.venv'] });
    expect(pipCall?.file).toMatch(/\.venv\/bin\/python$/);
    expect(pipCall?.args).toEqual([
      '-m', 'pip', 'install', '--disable-pip-version-check', '--no-input',
      'markitdown[pdf,docx]==0.1.6',
    ]);
    expect(pipCall?.timeout).toBe(30 * 60_000);
  });

  it('selects a Python interpreter that satisfies MarkItDown requirements', async () => {
    const calls: Array<{ file: string; args: string[] }> = [];
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      exec: async (file, args) => {
        const argv = [...(args ?? [])];
        calls.push({ file, args: argv });
        if (argv.some((value) => value.startsWith('import sys'))) {
          if (file === 'python3.12') return { stdout: '3.12\n', stderr: '' };
          const error = new Error(`${file} is unavailable`);
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          throw error;
        }
        return { stdout: '', stderr: '' };
      },
    });

    await manager.install('markitdown');

    expect(calls).toContainEqual({ file: 'python3.12', args: ['-m', 'venv', '.venv'] });
    expect(calls.some((call) => call.file === 'python3' && call.args.includes('venv'))).toBe(false);
  });

  it('detects missing adapter as not installed', async () => {
    const manager = new AdapterManager({ runtimeHome: tempHome });
    const status = await manager.detect('codebase-memory');
    expect(status).toEqual({ installed: false });
  });

  it('detects installed adapter from manifest', async () => {
    const manager = new AdapterManager({ runtimeHome: tempHome });
    const dir = join(tempHome, 'codebase-memory', 'pkg@1.0.0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(
      join(tempHome, 'codebase-memory', '.agentwiki-runtime.json'),
      JSON.stringify({ installed: true, path: dir, version: '1.0.0', checksum: 'abc' }),
    );

    const status = await manager.detect('codebase-memory');
    expect(status).toMatchObject({ installed: true, path: dir, version: '1.0.0', checksum: 'abc' });
  });

  it('throws for unknown adapter', async () => {
    const manager = new AdapterManager({ runtimeHome: tempHome });
    await expect(manager.detect('unknown')).rejects.toThrow(AdapterRuntimeError);
  });

  it('installs adapter into versioned directory', async () => {
    const adapter = stubAdapter('stub');
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      managedAdapters: [adapter],
      exec: fakeExec({
        'npm install stub@1.0.0': {
          stdout: JSON.stringify({ version: '1.0.0' }),
        },
      }),
    });

    const status = await manager.install('stub');
    expect(status.installed).toBe(true);
    expect((status as Extract<typeof status, { installed: true }>).version).toBe('1.0.0');
    const manifest = JSON.parse(
      await readFile(join(tempHome, 'stub', '.agentwiki-runtime.json'), 'utf8'),
    ) as RuntimeStatus & { installed: boolean };
    expect(manifest.installed).toBe(true);
  });

  it('reuses installed adapter on ensure', async () => {
    const adapter = stubAdapter('stub');
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      managedAdapters: [adapter],
      exec: async () => ({ stdout: '', stderr: '' }),
    });

    const dir = join(tempHome, 'stub', 'stub@1.0.0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(
      join(tempHome, 'stub', '.agentwiki-runtime.json'),
      JSON.stringify({ installed: true, path: dir, version: '1.0.0', checksum: '' }),
    );

    const instance = await manager.ensure('stub');
    expect(instance.manifest().adapterId).toBe('stub');
  });

  it('reinstalls when checksum mismatch', async () => {
    const adapter = stubAdapter('stub');
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      managedAdapters: [adapter],
      exec: fakeExec({
        'npm install stub@1.0.0': { stdout: '' },
      }),
    });

    const dir = join(tempHome, 'stub', 'stub@1.0.0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(
      join(tempHome, 'stub', '.agentwiki-runtime.json'),
      JSON.stringify({ installed: true, path: dir, version: '1.0.0', checksum: 'mismatch' }),
    );

    const status = await manager.ensure('stub');
    expect(status.manifest().adapterId).toBe('stub');
  });

  it('verify throws on checksum mismatch', async () => {
    const adapter = stubAdapter('stub');
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      managedAdapters: [adapter],
    });

    const dir = join(tempHome, 'stub', 'stub@1.0.0');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'package.json'), '{}');
    await writeFile(
      join(tempHome, 'stub', '.agentwiki-runtime.json'),
      JSON.stringify({ installed: true, path: dir, version: '1.0.0', checksum: 'mismatch' }),
    );

    await expect(manager.verify('stub')).rejects.toThrow(AdapterRuntimeError);
  });

  it('includes hidden runtime directories in checksum verification', async () => {
    const manager = new AdapterManager({
      runtimeHome: tempHome,
      exec: async () => ({ stdout: '', stderr: '' }),
    });
    const status = await manager.install('markitdown');
    if (!status.installed) throw new Error('Expected installed runtime');
    const hiddenRuntimeFile = join(status.path, '.venv', 'bin', 'injected');
    await mkdir(join(status.path, '.venv', 'bin'), { recursive: true });
    await writeFile(hiddenRuntimeFile, 'tampered');

    await expect(manager.verify('markitdown')).rejects.toThrow(/checksum mismatch/);
  });

  it('remove clears runtime directory', async () => {
    const manager = new AdapterManager({ runtimeHome: tempHome });
    const dir = join(tempHome, 'codebase-memory');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'placeholder'), 'x');
    await manager.remove('codebase-memory');
    await expect(readFile(join(dir, 'placeholder'))).rejects.toThrow();
  });
});
