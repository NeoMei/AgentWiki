import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GeneratedCodeGraphAdapter } from './generated-adapter.js';
import { GeneratedKnowledgeStore } from './generated-store.js';
import { GeneratedKnowledgeStoreCore } from './generated-store.internal.js';
import { contentHash } from '../utils/hash.js';

const sourceKey = 'a'.repeat(64);
const snapshotHash = 'b'.repeat(64);
const directories: string[] = [];

async function preparedStore() {
  const home = await mkdtemp(join(tmpdir(), 'agentwiki-generated-adapter-'));
  directories.push(home);
  const store = new GeneratedKnowledgeStoreCore({ home });
  const content = '# Repository overview\n\nOnly normalized filename facts.\n';
  await store.writeBase(sourceKey, snapshotHash, [{
    record: {
      schemaVersion: 'agentwiki-generated-code-knowledge@1',
      relativePath: 'architecture/overview.md',
      logicalKey: 'codegraph/architecture/overview',
      title: 'Repository overview',
      analysisLayer: 'base',
      sourceKey,
      snapshotHash,
      contentHash: contentHash(content),
      evidenceIds: ['snapshot:architecture/overview.md'],
    },
    content,
  }]);
  await store.publish(sourceKey, snapshotHash);
  return store as unknown as GeneratedKnowledgeStore;
}

afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('generated CodeGraph adapter', () => {
  it('keeps same logical generated pages from different sources distinct', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentwiki-generated-adapter-multi-'));
    directories.push(home);
    const otherSourceKey = 'c'.repeat(64);
    const store = new GeneratedKnowledgeStoreCore({ home });
    for (const key of [sourceKey, otherSourceKey]) {
      const content = `# Repository overview for ${key}\n`;
      await store.writeBase(key, snapshotHash, [{
        record: {
          schemaVersion: 'agentwiki-generated-code-knowledge@1', relativePath: 'architecture/overview.md', logicalKey: 'codegraph/architecture/overview', title: 'Repository overview', analysisLayer: 'base', sourceKey: key, snapshotHash, contentHash: contentHash(content), evidenceIds: ['snapshot:architecture/overview.md'],
        }, content,
      }]);
      await store.publish(key, snapshotHash);
    }
    const adapter = new GeneratedCodeGraphAdapter(store as unknown as GeneratedKnowledgeStore);
    const first = await adapter.collect({ spaceId: 'space-1', sourceKey });
    const second = await adapter.collect({ spaceId: 'space-1', sourceKey: otherSourceKey });

    expect(first.artifacts[0]!.artifactId).not.toBe(second.artifacts[0]!.artifactId);
    expect(first.artifacts[0]!.content.metadata?.identityKey).toBe(`codegraph/architecture/overview@${sourceKey}`);
    expect(second.artifacts[0]!.content.metadata?.identityKey).toBe(`codegraph/architecture/overview@${otherSourceKey}`);
    expect(first.artifacts[0]!.logicalKey).toBe('codegraph/architecture/overview');
    expect(second.artifacts[0]!.evidence[0]!.sourceUri).toContain(otherSourceKey);
  });

  it('turns every validated generated Markdown document into a stable, shareable source artifact', async () => {
    const adapter = new GeneratedCodeGraphAdapter(await preparedStore());
    const first = await adapter.collect({ spaceId: 'space-1', sourceKey });
    const second = await adapter.collect({ spaceId: 'space-1', sourceKey });

    expect(first).toEqual(second);
    expect(first.artifacts).toHaveLength(1);
    expect(first.artifacts[0]).toMatchObject({
      adapterId: 'agentwiki-codegraph-generated',
      sourceId: snapshotHash,
      logicalKey: 'codegraph/architecture/overview',
      kind: 'code',
      sensitivity: 'shareable',
      content: { metadata: { identityKey: `codegraph/architecture/overview@${sourceKey}`, ownership: { producer: 'agentwiki-codegraph-generated', logicalKey: 'codegraph/architecture/overview', analysisLayer: 'base', sourceKey, snapshotHash } } },
    });
    expect(first.artifacts[0]!.evidence).toEqual([{
      evidenceId: 'snapshot:architecture/overview.md',
      sourceUri: `agentwiki-code-snapshot://${sourceKey}/architecture/overview.md`,
      sourceHash: snapshotHash,
    }]);
    expect(first.artifacts[0]!.evidence[0]!.sourceUri).not.toContain('/private/');
  });

  it('uses segment-encoded evidence URIs rather than rendering raw generated paths', async () => {
    const home = await mkdtemp(join(tmpdir(), 'agentwiki-generated-adapter-uri-'));
    directories.push(home);
    const store = new GeneratedKnowledgeStoreCore({ home });
    const content = '# Overview\n';
    await expect(store.writeBase(sourceKey, snapshotHash, [{
      record: {
        schemaVersion: 'agentwiki-generated-code-knowledge@1', relativePath: 'architecture/over view?.md', logicalKey: 'codegraph/architecture/over-view', title: 'Overview', analysisLayer: 'base', sourceKey, snapshotHash, contentHash: contentHash(content), evidenceIds: ['snapshot:architecture/over view?.md'],
      }, content,
    }])).rejects.toThrow(/CODE_ANALYSIS_FAILED/u);
  });
});
