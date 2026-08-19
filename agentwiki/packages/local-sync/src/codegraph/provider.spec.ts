import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CodeGraphCommandRunner } from './command-runner.js';
import { normalizeCodeGraphFiles, type NormalizedCodeSnapshot } from './normalizer.js';
import { CodeSnapshotStore } from './snapshot-store.js';
import { analyzeBaseKnowledge } from './base-analyzer.js';
import { createInternalGeneratedKnowledgeStore } from './generated-store.internal.js';
import { createCodeGraphProvider, safeCodeGraphVersion, type ConfirmedCodeSnapshot } from './provider.js';

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function executeForTest(provider: ReturnType<typeof createCodeGraphProvider>, plan: NonNullable<Awaited<ReturnType<ReturnType<typeof createCodeGraphProvider>['plan']>>>) {
  return provider.withConfirmedSnapshots(plan, async (snapshots) => snapshots.map(({ sourceKey, snapshotHash, files }) => ({ sourceKey, snapshotHash, files })));
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
  it.each([
    ['1.5.0-alpha.1+build.2', 'codegraph 1.5.0-alpha.1+build.2'],
    ['v1.5.0-alpha.1+build.2', 'codegraph v1.5.0-alpha.1+build.2'],
    ['CodeGraph 1.5.0-alpha.1+build.2', 'codegraph 1.5.0-alpha.1+build.2'],
    ['codegraph version v1.5.0', 'codegraph v1.5.0'],
  ])('normalizes the safe CodeGraph SemVer token %s', (input, expected) => {
    expect(safeCodeGraphVersion(input)).toBe(expected);
  });

  it.each([
    '', '   ', 'codegraph 1.5.0\n/path', '/private/codegraph 1.5.0',
    'codegraph 1.5.0 diagnostic', 'codegraph 1.5.0_alpha', 'codegraph 01.5.0',
    `codegraph 1.5.0-${'x'.repeat(120)}`,
  ])('rejects unsafe or non-SemVer CodeGraph version text', (input) => {
    expect(safeCodeGraphVersion(input)).toBeNull();
  });

  it('diagnoses CodeGraph with read-only probes and reports an optional source index without mutation', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const { commands, runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: {
        stdout: JSON.stringify({ initialized: true, files: 12, indexState: 'complete', pendingRefs: 0 }),
      },
    });

    const diagnosis = await createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } })
      .diagnose({ sourcePath: source });

    expect(diagnosis).toMatchObject({
      available: true,
      detectedVersion: 'codegraph 1.5.0',
      capabilities: {
        required: { 'index.status': true, 'index.sync': true, 'files.list': true },
        optional: { 'symbols.list': false, 'relations.read': false },
      },
      source: { indexState: 'ready', estimatedFiles: 12 },
    });
    expect(commands.some(({ args }) => ['init', 'sync'].includes(args[0] ?? '') && args[1] !== '--help')).toBe(false);
  });

  it('reports missing CodeGraph and unsupported required capabilities without an exact version gate', async () => {
    const root = await temporaryDirectory();
    await expect(createCodeGraphProvider({ environment: { PATH: join(root, 'empty') } }).diagnose()).resolves.toMatchObject({
      available: false,
      code: 'CODEGRAPH_NOT_FOUND',
    });

    const binary = await executable(root);
    const { runner } = successfulRunner({ 'files --help': { stdout: '', exitCode: 1 } });
    await expect(createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).diagnose())
      .resolves.toMatchObject({ available: true, detectedVersion: 'codegraph 1.5.0', capabilities: { required: { 'files.list': false } } });
  });

  it('rejects version output that contains a path or diagnostic instead of exposing it as an identifier', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const { runner } = successfulRunner({ '--version': { stdout: 'codegraph 1.5.0\n/private/secret-token\n' } });
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } });

    await expect(provider.diagnose()).resolves.toMatchObject({ available: false, code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED' });
  });

  it('keeps an available CodeGraph diagnostic healthy when only an optional source index cannot be read', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const { runner } = successfulRunner({ 'status --json': { stdout: '', exitCode: 1 } });

    await expect(createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary } }).diagnose({ sourcePath: source }))
      .resolves.toMatchObject({ available: true, detectedVersion: 'codegraph 1.5.0', source: { indexState: 'unavailable' } });
  });

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

    await expect(executeForTest(provider, plan!)).rejects.toMatchObject({ code: 'CODE_SNAPSHOT_INVALID' });
    expect(statusCalls).toBe(3);
    expect(canonicalSource).toBeTruthy();
  });

  it('supplies a fully immutable confirmed snapshot collection', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const secondSource = await codeSource(root, 'second');
    const canonicalSource = await realpath(source);
    const canonicalSecondSource = await realpath(secondSource);
    const status = JSON.stringify({ initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 0, modified: 0, removed: 0 } });
    const { runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: { stdout: status },
      [`status --json ${canonicalSecondSource}`]: { stdout: status },
      [`files --path ${canonicalSource} --format flat --json`]: { stdout: JSON.stringify({ files: [{ path: 'src/main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }] }) },
      [`files --path ${canonicalSecondSource} --format flat --json`]: { stdout: JSON.stringify({ files: [{ path: 'src/second.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }] }) },
    });
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: root });
    const confirmed = await provider.plan({ sourcePaths: [source, secondSource], sourceType: 'code', analysisMode: 'standard' });
    const mutations = await provider.withConfirmedSnapshots(confirmed!, async (snapshots) => {
      const entry = snapshots[0]!;
      const mutableEntries = snapshots as unknown as ConfirmedCodeSnapshot[];
      const mutableEntry = entry as unknown as { sourceKey: string; snapshotHash: string; files: number };
      const mutableSnapshot = entry.snapshot as unknown as { manifest: { snapshotHash: string }; files: Array<{ path: string }> };
      const before = JSON.stringify(snapshots);
      const mutates = (change: () => void) => {
        try { change(); return true; } catch { return false; }
      };
      const results = [
        mutates(() => { mutableEntries.push(entry); }),
        mutates(() => { mutableEntries.reverse(); }),
        mutates(() => { mutableEntries[0] = mutableEntries[1]!; }),
        mutates(() => { mutableEntry.sourceKey = 'f'.repeat(64); }),
        mutates(() => { mutableEntry.snapshotHash = 'e'.repeat(64); }),
        mutates(() => { mutableEntry.files = 999; }),
        mutates(() => { mutableSnapshot.manifest.snapshotHash = 'd'.repeat(64); }),
        mutates(() => { mutableSnapshot.files[0]!.path = 'src/changed.ts'; }),
      ];
      return { before, after: JSON.stringify(snapshots), results, outer: Object.isFrozen(snapshots), entry: Object.isFrozen(entry) };
    });

    expect(mutations).toMatchObject({ before: mutations.after, results: [false, false, false, false, false, false, false, false], outer: true, entry: true });
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

    await expect(executeForTest(provider, plan!)).rejects.toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
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

    await expect(executeForTest(provider, plan!)).rejects.toMatchObject({ code: 'CODEGRAPH_INDEX_INCOMPLETE' });
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

  it('persists through the source lease instead of reacquiring a direct snapshot write', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    const status = JSON.stringify({ initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 0, modified: 0, removed: 0 } });
    const { runner } = successfulRunner({
      [`status --json ${canonicalSource}`]: { stdout: status },
      [`files --path ${canonicalSource} --format flat --json`]: { stdout: JSON.stringify({ files: [{ path: 'main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }] }) },
    });
    const lease = {};
    let written: NormalizedCodeSnapshot | undefined;
    const snapshotStore = {
      withLock: async (_key: string, consume: (value: unknown) => Promise<unknown>) => consume(lease),
      write: async () => { throw new Error('direct write must not run'); },
      writeWithLease: async (snapshot: NormalizedCodeSnapshot, actualLease: unknown) => {
        expect(actualLease).toBe(lease);
        written = snapshot;
        return { snapshotHash: 'b'.repeat(64), counts: { files: 1 } };
      },
      readWithLease: async (_key: string, actualLease: unknown) => {
        expect(actualLease).toBe(lease);
        if (!written) throw new Error('writeWithLease did not receive a snapshot');
        return { ...written, manifest: { ...written.manifest, snapshotHash: 'b'.repeat(64) } };
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, snapshotStore: snapshotStore as never });
    const current = await provider.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });

    await expect(executeForTest(provider, current!)).resolves.toEqual([{ sourceKey: current!.sources[0]!.sourceKey, snapshotHash: 'b'.repeat(64), files: 1 }]);
  });

  it.each([
    ['pending changes remain after sync', { added: 1, modified: 0, removed: 0 }],
    ['scanner changes again after sync', { added: 0, modified: 1, removed: 0 }],
  ])('fails closed without snapshot or callback when %s', async (_name, pendingChanges) => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const source = await codeSource(root);
    const canonicalSource = await realpath(source);
    let statusCalls = 0;
    let callbackCalls = 0;
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        if (args[0] === '--version') return { stdout: 'codegraph 1.5.0', stderr: '', exitCode: 0 };
        if (args[1] === '--help') return { stdout: 'help', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') {
          statusCalls += 1;
          const status = statusCalls <= 2
            ? { initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: { added: 1, modified: 0, removed: 0 } }
            : { initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges };
          return { stdout: JSON.stringify(status), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'sync') return { stdout: '', stderr: '', exitCode: 0 };
        if (args[0] === 'files') return { stdout: JSON.stringify({ files: [{ path: 'src/main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }] }), stderr: '', exitCode: 0 };
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: root });
    const confirmed = await provider.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });
    const generated = createInternalGeneratedKnowledgeStore(root);
    const retainedSnapshot = normalizeCodeGraphFiles([{ path: 'src/retained.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }], {
      sourceKey: confirmed!.sources[0]!.sourceKey,
      sourceRoot: canonicalSource,
      scanner: { provider: 'codegraph', detectedVersion: confirmed!.detectedVersion, capabilities: confirmed!.capabilities },
      indexedAt: '2026-08-19T00:00:00.000Z', maxFiles: confirmed!.limits.maxFiles, maxGeneratedBytes: confirmed!.limits.maxGeneratedBytes,
    });
    const retainedDocuments = analyzeBaseKnowledge(retainedSnapshot, { maxGeneratedBytes: confirmed!.limits.maxGeneratedBytes }).documents;
    await generated.writeBase(retainedSnapshot.manifest.sourceKey, retainedSnapshot.manifest.snapshotHash, retainedDocuments);
    await generated.withPublishedBatch([retainedSnapshot.manifest.sourceKey], async () => undefined);
    const retainedPublish = await generated.readPublish(retainedSnapshot.manifest.sourceKey);

    let failure: unknown;
    try { await provider.withConfirmedSnapshots(confirmed!, async () => { callbackCalls += 1; }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'CODEGRAPH_INDEX_INCOMPLETE', message: 'CodeGraph index is incomplete' });
    expect(JSON.stringify(failure)).not.toContain(canonicalSource);
    expect(callbackCalls).toBe(0);
    expect(await new CodeSnapshotStore({ home: root }).read(confirmed!.sources[0]!.sourceKey)).toBeNull();
    expect((await generated.readPublish(retainedSnapshot.manifest.sourceKey))?.manifest.snapshotHash).toBe(retainedPublish?.manifest.snapshotHash);
    expect(canonicalSource).toBeTruthy();
  });

  it('keeps different sources independent and reversed multi-source confirmations deadlock-free', async () => {
    const root = await temporaryDirectory();
    const binary = await executable(root);
    const firstSource = await codeSource(root, 'first');
    const secondSource = await codeSource(root, 'second');
    const firstPath = await realpath(firstSource);
    let syncs = 0;
    const statusAfterSync = new Set<string>();
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        if (args[0] === '--version') return { stdout: 'codegraph 1.5.0', stderr: '', exitCode: 0 };
        if (args[1] === '--help') return { stdout: 'help', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') {
          const sourcePath = args[2]!;
          const postScan = statusAfterSync.delete(sourcePath);
          return { stdout: JSON.stringify({ initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: postScan ? { added: 0, modified: 0, removed: 0 } : { added: 1, modified: 0, removed: 0 } }), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'sync') { syncs += 1; statusAfterSync.add(args[1]!); return { stdout: '', stderr: '', exitCode: 0 }; }
        if (args[0] === 'files') {
          const path = args[2];
          return { stdout: JSON.stringify({ files: [{ path: path === firstPath ? 'src/first.ts' : 'src/second.ts', language: 'typescript', nodeCount: syncs, sizeBytes: syncs }] }), stderr: '', exitCode: 0 };
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      },
    };
    const provider = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home: join(root, 'home') });
    const firstPlan = await provider.plan({ sourcePaths: [firstSource], sourceType: 'code', analysisMode: 'standard' });
    const secondPlan = await provider.plan({ sourcePaths: [secondSource], sourceType: 'code', analysisMode: 'standard' });
    const releaseFirst = deferred();
    const firstEntered = deferred();
    const secondEntered = deferred();
    const first = provider.withConfirmedSnapshots(firstPlan!, async (snapshots) => {
      expect(Object.isFrozen(snapshots[0]!.snapshot)).toBe(true);
      firstEntered.resolve();
      await releaseFirst.promise;
      return snapshots[0]!.snapshotHash;
    });
    await firstEntered.promise;
    const second = provider.withConfirmedSnapshots(secondPlan!, async (snapshots) => {
      secondEntered.resolve();
      return snapshots[0]!.snapshotHash;
    });
    const secondProgressedWhileFirstWasHeld = await Promise.race([secondEntered.promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000))]);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondProgressedWhileFirstWasHeld).toBe(true);

    const forward = await provider.plan({ sourcePaths: [firstSource, secondSource], sourceType: 'code', analysisMode: 'standard' });
    const reversed = await provider.plan({ sourcePaths: [secondSource, firstSource], sourceType: 'code', analysisMode: 'standard' });
    expect(forward!.localScanPlanHash).toBe(reversed!.localScanPlanHash);
    await expect(Promise.all([
      provider.withConfirmedSnapshots(forward!, async (snapshots) => snapshots.map((snapshot) => snapshot.snapshotHash)),
      provider.withConfirmedSnapshots(reversed!, async (snapshots) => snapshots.map((snapshot) => snapshot.snapshotHash)),
    ])).resolves.toHaveLength(2);
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
