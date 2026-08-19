import { lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCodeGraphFiles } from './normalizer.js';
import type { LocalScanPlan } from './contracts.js';
import type { CodeGraphProvider, ConfirmedCodeSnapshot } from './provider.js';

const productionHome = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => productionHome.value }));
const { CodeGraphPipeline } = await import('./pipeline.js');

const directories: string[] = [];
async function temporaryDirectory() { const path = await mkdtemp(join(tmpdir(), 'agentwiki-pipeline-home-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const sourceKey = 'a'.repeat(64);
function plan(): LocalScanPlan {
  return { schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: '/private/codegraph', detectedVersion: 'codegraph 1.5.0', capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } }, analysisMode: 'standard', sources: [{ sourceKey, displayPath: 'fixture', canonicalSourcePath: '/private/fixture', indexPath: '/private/fixture/.codegraph', action: 'none', indexState: 'ready', estimatedFiles: 1 }], limits: { maxFiles: 10, maxGeneratedBytes: 10_000 }, localScanPlanHash: 'c'.repeat(64) };
}

describe('CodeGraphPipeline runtime home', () => {
  it('keeps generated snapshots under the injected home and never touches the process home', async () => {
    const home = await temporaryDirectory();
    productionHome.value = await temporaryDirectory();
    const normalized = normalizeCodeGraphFiles([{ path: 'src/main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }], { sourceKey, sourceRoot: '/private/fixture', scanner: { provider: 'codegraph', detectedVersion: 'codegraph 1.5.0', capabilities: plan().capabilities }, indexedAt: '2026-08-19T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000 });
    const provider = { plan: async () => plan(), withConfirmedSnapshots: async <T>(_plan: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T> => consume([{ sourceKey, snapshotHash: normalized.manifest.snapshotHash, files: 1, snapshot: normalized }]) } as unknown as CodeGraphProvider;
    const pipeline = new CodeGraphPipeline({ home, provider });

    await pipeline.collect({ spaceId: 'space-1', sourcePaths: ['/private/fixture'], sourceType: 'code', analysisMode: 'standard', localScanPlanHash: plan().localScanPlanHash, confirmedLocalScan: true });

    await expect(lstat(join(home, '.agentwiki', 'workspaces', sourceKey, 'generated', 'codegraph', 'publish'))).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await expect(lstat(join(productionHome.value, '.agentwiki'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed for an injected-home .agentwiki symlink without writing through it', async () => {
    const home = await temporaryDirectory();
    const external = await temporaryDirectory();
    productionHome.value = await temporaryDirectory();
    await writeFile(join(external, 'sentinel.txt'), 'external bytes\n');
    await symlink(external, join(home, '.agentwiki'));
    const normalized = normalizeCodeGraphFiles([{ path: 'src/main.ts', language: 'typescript', nodeCount: 1, sizeBytes: 1 }], { sourceKey, sourceRoot: '/private/fixture', scanner: { provider: 'codegraph', detectedVersion: 'codegraph 1.5.0', capabilities: plan().capabilities }, indexedAt: '2026-08-19T00:00:00.000Z', maxFiles: 10, maxGeneratedBytes: 10_000 });
    const provider = { plan: async () => plan(), withConfirmedSnapshots: async <T>(_plan: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T> => consume([{ sourceKey, snapshotHash: normalized.manifest.snapshotHash, files: 1, snapshot: normalized }]) } as unknown as CodeGraphProvider;

    await expect(new CodeGraphPipeline({ home, provider }).collect({ spaceId: 'space-1', sourcePaths: ['/private/fixture'], sourceType: 'code', analysisMode: 'standard', localScanPlanHash: plan().localScanPlanHash, confirmedLocalScan: true })).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
    await expect((await import('node:fs/promises')).readFile(join(external, 'sentinel.txt'), 'utf8')).resolves.toBe('external bytes\n');
  });
});
