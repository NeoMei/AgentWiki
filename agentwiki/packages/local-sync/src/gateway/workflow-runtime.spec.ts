import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SourceAdapter } from '../protocol/adapter.js';
import { assertKnowledgeBundle } from '../protocol/bundle.js';
import type { SourceArtifact } from '../protocol/artifact.js';
import { createKnowledgeWorkflowRuntime } from './workflow-runtime.js';

const homes: string[] = [];

async function temporaryHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'aw-workflow-runtime-'));
  homes.push(home);
  return home;
}

function artifact(kind: 'code' | 'document', logicalKey: string): SourceArtifact {
  return {
    artifactId: `${kind}-${logicalKey}`,
    adapterId: kind === 'code' ? 'codebase-memory' : 'markitdown',
    adapterVersion: '1.0.0',
    sourceId: `source-${kind}`,
    logicalKey,
    contentHash: `hash-${logicalKey}`,
    updatedAt: '2026-08-11T00:00:00.000Z',
    kind,
    content: { title: logicalKey, body: `# ${logicalKey}` },
    evidence: [{ evidenceId: `e-${logicalKey}`, sourceUri: `test://${logicalKey}`, sourceHash: `hash-${logicalKey}` }],
    sensitivity: 'shareable',
  };
}

function adapter(kind: 'code' | 'document'): SourceAdapter {
  return {
    manifest: () => ({
      adapterId: kind === 'code' ? 'codebase-memory' : 'markitdown',
      version: '1.0.0', protocolVersion: '1.0', inputKinds: ['directory'], artifactKinds: [kind],
      supportsIncremental: true, permissions: ['read-source-path'], runtime: { kind: 'future' },
    }),
    inspect: vi.fn(async (input) => ({
      adapterId: kind === 'code' ? 'codebase-memory' : 'markitdown', sourcePath: input.sourcePath,
      displayName: input.sourcePath,
      kind: kind === 'code' ? ('code' as const) : ('documents' as const),
      estimatedArtifacts: 1,
      sourceHash: `hash-${kind}`,
    })),
    collect: vi.fn(async (input) => ({ artifacts: [artifact(kind, `${kind}-${input.sourcePath.split('/').pop()}`)], hasMore: false })),
  };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('createKnowledgeWorkflowRuntime', () => {
  it('collects code and documents locally, persists a valid bundle, then pulls before push', async () => {
    const home = await temporaryHome();
    const source = await temporaryHome();
    await writeFile(join(source, 'README.md'), '# Runtime fixture');
    const adapters = {
      ensure: vi.fn(async (id: string) => adapter(id === 'codebase-memory' ? 'code' : 'document')),
    };
    const calls: string[] = [];
    const sync = {
      pull: vi.fn(async (spaceId: string) => { calls.push(`pull:${spaceId}`); return { revisionId: '0' }; }),
      push: vi.fn(async (spaceId: string, value: unknown) => {
        calls.push(`push:${spaceId}`);
        assertKnowledgeBundle(value);
        return { conflict: false, revisionId: 'rev-1', status: 'published' as const, submissionId: 'sub-1' };
      }),
    };

    const first = createKnowledgeWorkflowRuntime({ home, adapters, sync, now: () => new Date('2026-08-11T00:00:00.000Z') });
    const preview = await first.prepare({ spaceId: 'space-1', sourcePaths: [source], sourceType: 'auto' });

    expect(preview.summary.filesProcessed).toBe(2);
    expect(adapters.ensure).not.toHaveBeenCalledWith('markitdown');
    expect(calls).toEqual([]);

    const resumed = createKnowledgeWorkflowRuntime({ home, adapters, sync, now: () => new Date('2026-08-11T00:00:00.000Z') });
    const result = await resumed.confirmAndSync({ jobId: preview.jobId, previewHash: preview.previewHash, confirmed: true });

    expect(result).toMatchObject({ revisionId: 'rev-1', status: 'published', submissionId: 'sub-1' });
    expect(calls).toEqual(['pull:space-1', 'push:space-1']);
  });
});
