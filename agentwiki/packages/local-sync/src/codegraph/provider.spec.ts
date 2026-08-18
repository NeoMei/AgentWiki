import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodeGraphCommandRunner } from './command-runner.js';
import { createCodeGraphProvider } from './provider.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-codegraph-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function executable(directory: string, name = 'codegraph'): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, '#!/bin/sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

async function codeSource(directory: string, name = 'source'): Promise<string> {
  const source = join(directory, name);
  await mkdir(source);
  await writeFile(join(source, 'main.ts'), 'export {};');
  return source;
}

function successfulRunner(overrides: Record<string, { stdout: string; stderr?: string; exitCode?: number }> = {}) {
  const commands: Array<{ command: string; args: string[] }> = [];
  const runner: CodeGraphCommandRunner = {
    async run(command, args) {
      commands.push({ command, args });
      const key = args.join(' ');
      const response = overrides[key] ?? ({
        '--version': { stdout: 'codegraph 1.5.0\n' },
        'status --help': { stdout: 'status --json <path>' },
        'sync --help': { stdout: 'sync <path>' },
        'files --help': { stdout: 'files --path <path> --format flat --json' },
      }[key]);
      if (!response) throw new Error(`Unexpected command: ${command} ${key}`);
      return { stdout: response.stdout, stderr: response.stderr ?? '', exitCode: response.exitCode ?? 0 };
    },
  };
  return { commands, runner };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('CodeGraph planning', () => {
  it('rejects oversized raw files output before JSON normalization can discard unknown fields', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    let statusCalls = 0;
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        if (args[0] === '--version') return { stdout: 'codegraph 1.5.0', stderr: '', exitCode: 0 };
        if (args[1] === '--help') return { stdout: 'help', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') {
          statusCalls += 1;
          return { stdout: JSON.stringify({ initialized: true, files: 0, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 0, modified: 0, removed: 0 } }), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'files') return { stdout: JSON.stringify({ files: [], ignoredPayload: 'x'.repeat(1_000_001) }), stderr: '', exitCode: 0 };
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: root });
    const plan = await provider.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });

    await expect(provider.execute(plan!)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    expect(statusCalls).toBe(3);
    expect(canonicalSource).toBeTruthy();
  });

  it('rejects a changed confirmed plan before it can mutate an index', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    let versionCalls = 0;
    const commands: string[] = [];
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        commands.push(args.join(' '));
        if (args[0] === '--version') return { stdout: versionCalls++ === 0 ? 'codegraph 1.5.0' : 'codegraph 1.6.0', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') return { stdout: JSON.stringify({ initialized: false }), stderr: '', exitCode: 0 };
        if (args[0] === 'files') return { stdout: JSON.stringify([]), stderr: '', exitCode: 0 };
        return { stdout: 'help', stderr: '', exitCode: 0 };
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: root });
    const plan = await provider.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });

    await expect(provider.execute(plan!)).rejects.toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
    expect(commands).not.toContain(`init ${canonicalSource}`);
    expect(commands).not.toContain(`sync ${canonicalSource}`);
  });

  it.each([
    { initialized: true, files: 1, indexState: 'partial', pendingRefs: 0 },
    { initialized: true, files: 1, indexState: 'failed', pendingRefs: 0 },
    { initialized: true, files: 1, indexState: 'interrupted', pendingRefs: 0 },
    { initialized: true, files: 1, indexState: 'complete', pendingRefs: 1 },
    { initialized: true, files: 1, indexState: 'complete' },
  ])('does not persist an unusable post-mutation status', async (postMutationStatus) => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    let statusCalls = 0;
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        if (args[0] === '--version') return { stdout: 'codegraph 1.5.0', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') {
          statusCalls += 1;
          const status = statusCalls <= 2
            ? { initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 1, modified: 0, removed: 0 } }
            : postMutationStatus;
          return { stdout: JSON.stringify(status), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'sync') return { stdout: '', stderr: '', exitCode: 0 };
        if (args[1] === '--help') return { stdout: 'help', stderr: '', exitCode: 0 };
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: root });
    const plan = await provider.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });

    await expect(provider.execute(plan!)).rejects.toMatchObject({ code: 'CODEGRAPH_INDEX_INCOMPLETE' });
    expect(await provider.snapshotStore.read(plan!.sources[0].sourceKey)).toBeNull();
    expect(canonicalSource).toBeTruthy();
  });

  it('prefers AGENTWIKI_CODEGRAPH_BIN and plans without mutation', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root, 'explicit-codegraph');
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const { commands, runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: {
        stdout: JSON.stringify({ initialized: true, fileCount: 12, pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: 'complete', pendingRefs: 0 } }),
      },
    });

    const plan = await createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).plan({
      sourcePaths: [source], sourceType: 'code', analysisMode: 'standard',
    });

    expect(plan).toMatchObject({ detectedVersion: 'codegraph 1.5.0', analysisMode: 'standard', sources: [{ action: 'none', indexState: 'ready', estimatedFiles: 12 }] });
    expect(plan?.executableIdentity).toContain(binary);
    expect(commands.some(({ args }) => args[0] === 'init')).toBe(false);
    expect(commands.some(({ args }) => args[0] === 'sync' && args[1] !== '--help')).toBe(false);
    expect(commands.some(({ args }) => args[0] === 'index')).toBe(false);
  });

  it('discovers codegraph on PATH when no explicit binary is configured', async () => {
    const root = await temporaryDirectory();
    const binaryDirectory = join(root, 'bin');
    await mkdir(binaryDirectory);
    const binary = await executable(binaryDirectory);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const { runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: { stdout: JSON.stringify({ initialized: true, files: 12, indexState: 'complete', pendingRefs: 0 }) },
    });

    const plan = await createCodeGraphProvider({ runner, environment: { PATH: binaryDirectory } }).plan({
      sourcePaths: [source], sourceType: 'code', analysisMode: 'deep',
    });

    expect(plan?.analysisMode).toBe('deep');
    expect(plan?.executableIdentity).toContain(binary);
  });

  it('returns null for an auto source that contains no code filenames', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const documents = join(root, 'documents');
    await mkdir(documents);
    await writeFile(join(documents, 'readme.md'), 'document only');
    const { commands, runner } = successfulRunner();

    await expect(createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).plan({
      sourcePaths: [documents], sourceType: 'auto', analysisMode: 'standard',
    })).resolves.toBeNull();
    expect(commands).toEqual([]);
  });

  it('returns a deterministic plan for compatible status JSON shapes and ignores unknown fields', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const first = await codeSource(root, 'first');
    const second = await codeSource(root, 'second');
    const canonicalFirst = await realpath(first);
    const canonicalSecond = await realpath(second);
    const { runner } = successfulRunner({
      [`status --json ${canonicalFirst}`]: { stdout: JSON.stringify({ initialized: true, fileCount: 12, pendingChanges: { added: 0, modified: 0, removed: 0 }, index: { state: 'complete', pendingRefs: 0 }, ignored: 'field' }) },
      [`status --json ${canonicalSecond}`]: { stdout: JSON.stringify({ initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, ignored: true }) },
    });

    const plan = await createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).plan({
      sourcePaths: [second, first], sourceType: 'code', analysisMode: 'standard',
    });

    expect(plan?.sources).toHaveLength(2);
    expect(plan?.sources.every((source) => source.action === 'none' && source.indexState === 'ready' && source.estimatedFiles === 12)).toBe(true);
    expect(plan?.localScanPlanHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    ['missing executable', {}, 'CODEGRAPH_NOT_FOUND'],
    ['a non-zero version probe', { '--version': { stdout: '', stderr: 'broken', exitCode: 1 } }, 'CODEGRAPH_NOT_FOUND'],
    ['a status missing a file count', { status: { stdout: JSON.stringify({ initialized: true, indexState: 'complete', pendingRefs: 0 }) } }, 'CODEGRAPH_CAPABILITY_UNSUPPORTED'],
    ['an incomplete status', { status: { stdout: JSON.stringify({ initialized: true, files: 12, indexState: 'building', pendingRefs: 1 }) } }, 'CODEGRAPH_INDEX_INCOMPLETE'],
  ])('fails closed for %s', async (_name, override, code) => {
    const root = await temporaryDirectory();
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const binary = await executable(root);
    const overrides = 'status' in override ? { [`status --json ${canonicalSource}`]: override.status } : override;
    const { runner } = successfulRunner(overrides);
    const environment = code === 'CODEGRAPH_NOT_FOUND' && _name === 'missing executable'
      ? { PATH: join(root, 'empty') }
      : { AGENTWIKI_CODEGRAPH_BIN: binary };

    await expect(createCodeGraphProvider({ runner, environment }).plan({
      sourcePaths: [source], sourceType: 'code', analysisMode: 'standard',
    })).rejects.toMatchObject({ code });
  });

  it.each([
    ['an empty pendingChanges object', { initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, pendingChanges: {} }],
    ['a partial pendingChanges object', { initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 0, modified: 0 } }],
    ['a partial nested index shape mixed with top-level fields', { initialized: true, fileCount: 12, index: { state: 'complete' }, pendingRefs: 0, pendingChanges: { added: 0, modified: 0, removed: 0 } }],
    ['a negative pendingChanges count', { initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: -1, modified: 0, removed: 0 } }],
    ['a non-integer pendingChanges count', { initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 0.5, modified: 0, removed: 0 } }],
    ['conflicting index state aliases', { initialized: true, files: 12, indexState: 'complete', pendingRefs: 0, index: { state: 'stale', pendingRefs: 0 } }],
    ['conflicting file count aliases', { initialized: true, fileCount: 12, files: 13, indexState: 'complete', pendingRefs: 0 }],
    ['conflicting pending reference aliases', { initialized: true, files: 12, pendingRefs: 0, index: { state: 'complete', pendingRefs: 1 } }],
  ])('rejects malformed or conflicting status JSON: %s', async (_name, status) => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const { runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: { stdout: JSON.stringify(status) },
    });

    await expect(createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).plan({
      sourcePaths: [source], sourceType: 'code', analysisMode: 'standard',
    })).rejects.toMatchObject({ code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED' });
  });

  it('uses only the documented read-only probes with bounded command options', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const calls: Array<{ args: string[]; timeoutMs: number; maxBufferBytes: number }> = [];
    const runner: CodeGraphCommandRunner = {
      async run(_command, args, options) {
        calls.push({ args, timeoutMs: options.timeoutMs, maxBufferBytes: options.maxBufferBytes });
        if (args[0] === 'status' && args[1] === '--json') {
          return { stdout: JSON.stringify({ initialized: true, files: 1, indexState: 'complete', pendingRefs: 0 }), stderr: '', exitCode: 0 };
        }
        return { stdout: args[0] === '--version' ? '1.5.0' : 'help', stderr: '', exitCode: 0 };
      },
    };

    await createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).plan({
      sourcePaths: [source], sourceType: 'code', analysisMode: 'standard',
    });

    expect(calls.map((call) => call.args.join(' '))).toEqual([
      '--version', 'status --help', 'sync --help', 'files --help', `status --json ${canonicalSource}`,
    ]);
    expect(calls.every((call) => call.timeoutMs === 30_000 && call.maxBufferBytes === 8 * 1024 * 1024)).toBe(true);
  });
});
