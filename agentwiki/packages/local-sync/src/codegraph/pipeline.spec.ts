import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { analyzeBaseKnowledge } from './base-analyzer.js';
import type { LocalScanPlan } from './contracts.js';
import { normalizeCodeGraphFiles } from './normalizer.js';
import { CodeGraphPipeline } from './pipeline.js';
import { createCodeGraphProvider, type CodeGraphProvider, type ConfirmedCodeSnapshot } from './provider.js';
import type { CodeGraphCommandRunner } from './command-runner.js';
import { CodeSnapshotStore } from './snapshot-store.js';
import { createInternalGeneratedKnowledgeStore } from './generated-store.internal.js';

const sourceKey = 'a'.repeat(64);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-codegraph-pipeline-'));
  temporaryDirectories.push(directory);
  return directory;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function plan(hash = 'c'.repeat(64)): LocalScanPlan {
  return {
    schemaVersion: 'agentwiki-local-scan-plan@1',
    provider: 'codegraph',
    executableIdentity: '/usr/local/bin/codegraph:1',
    detectedVersion: 'codegraph 1.5.0',
    capabilities: {
      required: { 'index.status': true, 'index.sync': true, 'files.list': true },
      optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
    },
    analysisMode: 'standard',
    sources: [{ sourceKey, displayPath: 'fixture', canonicalSourcePath: '/private/fixture', indexPath: '/private/fixture/.codegraph', action: 'sync', indexState: 'stale', estimatedFiles: 1 }],
    limits: { maxFiles: 10, maxGeneratedBytes: 100_000 },
    localScanPlanHash: hash,
  };
}

function snapshot() {
  return normalizeCodeGraphFiles([{ path: 'src/main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 10 }], {
    sourceKey,
    sourceRoot: '/private/fixture',
    scanner: {
      provider: 'codegraph' as const,
      detectedVersion: 'codegraph 1.5.0',
      capabilities: plan().capabilities,
    },
    indexedAt: '2026-08-19T00:00:00.000Z',
    maxFiles: 10,
    maxGeneratedBytes: 100_000,
  });
}

describe('CodeGraphPipeline', () => {
  it('replans before collecting and produces generated artifacts in the standard local order', async () => {
    const calls: string[] = [];
    const currentPlan = plan();
    const normalized = snapshot();
    let documents: ReturnType<typeof analyzeBaseKnowledge>['documents'] = [];
    const pipeline = new CodeGraphPipeline({
      home: '/private/runtime-home',
      provider: {
        plan: async () => { calls.push('plan'); return currentPlan; },
        withConfirmedSnapshots: async <T>(confirmed: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T> => {
          calls.push('validate', 'execute');
          expect(confirmed.localScanPlanHash).toBe(currentPlan.localScanPlanHash);
          return consume([{ sourceKey, snapshotHash: normalized.manifest.snapshotHash, files: 1, snapshot: { manifest: normalized.manifest, files: normalized.files, filesNdjson: normalized.filesNdjson, modulesNdjson: normalized.modulesNdjson, symbolsNdjson: normalized.symbolsNdjson, relationsNdjson: normalized.relationsNdjson } }]);
        },
      } as unknown as CodeGraphProvider,
      generatedStore: {
        writeBase: async (_sourceKey, _snapshotHash, value) => { documents = value; },
        withPublishedBatch: async (_sourceKeys, consume) => { calls.push('batch publish'); const artifacts = await consume([{ manifest: {} as never, documents }]); calls.push('adapter'); return artifacts; },
      },
      analyze: (value, options) => { calls.push('analyze all'); return analyzeBaseKnowledge(value, options); },
    });

    const result = await pipeline.collect({
      spaceId: 'space-1', sourcePaths: ['/private/fixture'], sourceType: 'code', analysisMode: 'standard',
      localScanPlanHash: currentPlan.localScanPlanHash, confirmedLocalScan: true,
    });

    expect(result.sourceKeys).toEqual([sourceKey]);
    expect(result.processedFiles).toBe(1);
    expect(result.artifacts).toHaveLength(2);
    expect(calls).toEqual(['plan', 'validate', 'execute', 'analyze all', 'batch publish', 'adapter']);
  });

  it('fails closed before execution when a freshly planned hash differs from confirmation', async () => {
    const withConfirmedSnapshots = async () => { throw new Error('must not execute'); };
    const pipeline = new CodeGraphPipeline({
      home: '/private/runtime-home',
      provider: { plan: async () => plan('d'.repeat(64)), withConfirmedSnapshots } as unknown as CodeGraphProvider,
      generatedStore: {} as never,
    });

    await expect(pipeline.collect({
      spaceId: 'space-1', sourcePaths: ['/private/fixture'], sourceType: 'code', analysisMode: 'standard',
      localScanPlanHash: 'c'.repeat(64), confirmedLocalScan: true,
    })).rejects.toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
  });

  it('holds a real source lease through real generated batch adaptation and publishes only each caller’s confirmed snapshot', async () => {
    const root = await temporaryDirectory();
    const home = join(root, 'home');
    const source = join(root, 'source');
    const binary = join(root, 'codegraph');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'main.ts'), 'export {};');
    await writeFile(binary, '#!/bin/sh\nexit 0\n');
    await chmod(binary, 0o755);
    const canonicalSource = await realpath(source);
    let scans = 0;
    const secondSourceLockRequested = deferred();
    const adaptationEntered = deferred();
    const releaseAdaptation = deferred();
    const adaptationReturned = deferred();
    const providerCallbackPendingRelease = deferred();
    const releaseProviderCallback = deferred();
    const runner: CodeGraphCommandRunner = {
      async run(_command, args) {
        if (args[0] === '--version') return { stdout: 'codegraph 1.5.0', stderr: '', exitCode: 0 };
        if (args[1] === '--help') return { stdout: 'help', stderr: '', exitCode: 0 };
        if (args[0] === 'status' && args[1] === '--json') {
          const postScan = scans > 0 && args[2] === canonicalSource && statusAfterSync;
          if (postScan) statusAfterSync = false;
          return { stdout: JSON.stringify({ initialized: true, files: 1, indexState: 'complete', pendingRefs: 0, pendingChanges: postScan ? { added: 0, modified: 0, removed: 0 } : { added: 1, modified: 0, removed: 0 } }), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'sync') {
          scans += 1;
          statusAfterSync = true;
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        if (args[0] === 'files' && args[2] === canonicalSource) {
          const files = scans === 1
            ? [{ path: 'src/first.ts', language: 'typescript', nodeCount: 1, sizeBytes: 10 }]
            : [{ path: 'src/second.ts', language: 'typescript', nodeCount: 2, sizeBytes: 20 }];
          return { stdout: JSON.stringify({ files }), stderr: '', exitCode: 0 };
        }
        throw new Error(`Unexpected command: ${args.join(' ')}`);
      },
    };
    let statusAfterSync = false;
    const snapshotStore = new CodeSnapshotStore({ home });
    const sourceLock = snapshotStore.withLock.bind(snapshotStore);
    let lockRequests = 0;
    snapshotStore.withLock = async (key, consume) => {
      lockRequests += 1;
      if (lockRequests === 2) secondSourceLockRequested.resolve();
      return sourceLock(key, consume);
    };
    const actual = createCodeGraphProvider({ runner, environment: { AGENTWIKI_CODEGRAPH_BIN: binary }, home, snapshotStore });
    const confirmedPlan = await actual.plan({ sourcePaths: [source], sourceType: 'code', analysisMode: 'standard' });
    expect(confirmedPlan).not.toBeNull();
    const confirmedSourceKey = confirmedPlan!.sources[0]!.sourceKey;
    const generated = createInternalGeneratedKnowledgeStore(home);
    const baseWrites: string[] = [];
    const publishCalls: string[][] = [];
    let firstCallback = true;
    let firstHash = '';
    let secondHash = '';
    const wrapped = {
      plan: actual.plan,
      withConfirmedSnapshots: async <T>(value: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T> => {
        return actual.withConfirmedSnapshots(value, async (snapshots) => {
          const isFirst = firstCallback;
          firstCallback = false;
          if (isFirst) firstHash = snapshots[0]!.snapshotHash;
          else secondHash = snapshots[0]!.snapshotHash;
          const result = await consume(snapshots);
          if (isFirst) {
            providerCallbackPendingRelease.resolve();
            await releaseProviderCallback.promise;
          }
          return result;
        });
      },
    };
    const pipeline = new CodeGraphPipeline({
      home,
      provider: wrapped as unknown as CodeGraphProvider,
      generatedStore: {
        writeBase: async (key, hash, documents) => { baseWrites.push(hash); await generated.writeBase(key, hash, documents); },
        withPublishedBatch: async (keys, consume) => {
          publishCalls.push([...keys]);
          return generated.withPublishedBatch(keys, async (sets) => {
            if (publishCalls.length === 1) {
              adaptationEntered.resolve();
              await releaseAdaptation.promise;
            }
            const artifacts = await consume(sets);
            if (publishCalls.length === 1) adaptationReturned.resolve();
            return artifacts;
          });
        },
      },
    });
    const collect = () => pipeline.collect({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'code', analysisMode: 'standard', localScanPlanHash: confirmedPlan!.localScanPlanHash, confirmedLocalScan: true });
    const firstRun = collect();
    await adaptationEntered.promise;
    const secondRun = collect();
    await secondSourceLockRequested.promise;
    expect({ scans, baseWrites, publishCalls }).toEqual({ scans: 1, baseWrites: [firstHash], publishCalls: [[confirmedSourceKey]] });
    releaseAdaptation.resolve();
    await adaptationReturned.promise;
    await providerCallbackPendingRelease.promise;
    expect({ scans, baseWrites, publishCalls }).toEqual({ scans: 1, baseWrites: [firstHash], publishCalls: [[confirmedSourceKey]] });
    const publishedA = await generated.readPublish(confirmedSourceKey);
    expect(publishedA?.manifest.snapshotHash).toBe(firstHash);
    expect(publishedA?.manifest.records.every((record) => record.sourceKey === confirmedSourceKey && record.snapshotHash === firstHash)).toBe(true);
    releaseProviderCallback.resolve();
    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);
    expect(firstResult.artifacts).toHaveLength(1);
    expect(secondResult.artifacts).toHaveLength(1);
    expect(firstResult.artifacts[0]).toMatchObject({ sourceId: firstHash, content: { body: expect.stringContaining(`Snapshot hash: ${firstHash}`), metadata: { ownership: { sourceKey: confirmedSourceKey, snapshotHash: firstHash } } } });
    expect(secondResult.artifacts[0]).toMatchObject({ sourceId: secondHash, content: { body: expect.stringContaining(`Snapshot hash: ${secondHash}`), metadata: { ownership: { sourceKey: confirmedSourceKey, snapshotHash: secondHash } } } });
    const publishedB = await generated.readPublish(confirmedSourceKey);
    expect(publishedB?.manifest.snapshotHash).toBe(secondHash);
    expect(publishedB?.manifest.records.every((record) => record.sourceKey === confirmedSourceKey && record.snapshotHash === secondHash)).toBe(true);
  });
});
