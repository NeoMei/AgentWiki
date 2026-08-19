import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentHash } from '../utils/hash.js';

const mockedHome = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async (importOriginal) => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => mockedHome.value }));
const { GeneratedKnowledgeStore } = await import('./generated-store.js');

const sourceKey = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const directories: string[] = [];

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('generated knowledge store facade', () => {
  it('passes a tiny public per-document cap to the fixed-root internal core', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentwiki-generated-facade-'));
    directories.push(home); mockedHome.value = home;
    const content = '# too long\n';
    const store = new GeneratedKnowledgeStore({ maxGeneratedBytes: 100, maxDocumentBytes: 1 });
    await expect(store.writeBase(sourceKey, snapshotHash, [{
      record: {
        schemaVersion: 'agentwiki-generated-code-knowledge@1', relativePath: 'architecture/overview.md', logicalKey: 'codegraph/architecture/overview', title: 'Repository overview', analysisLayer: 'base', sourceKey, snapshotHash, contentHash: contentHash(content), evidenceIds: ['snapshot:architecture/overview.md'],
      }, content,
    }])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });
});
