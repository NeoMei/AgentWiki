import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodebaseMemoryAdapter } from './codebase-memory.js';
import { assertSourceDescriptor, assertArtifactBatch } from '../protocol/adapter.js';

describe('CodebaseMemoryAdapter', () => {
  let runtimePath: string;
  let sourcePath: string;
  let adapter: CodebaseMemoryAdapter;

  beforeEach(async () => {
    runtimePath = await mkdtemp(join(tmpdir(), 'cm-runtime-'));
    sourcePath = await mkdtemp(join(tmpdir(), 'cm-source-'));
    adapter = new CodebaseMemoryAdapter(runtimePath);
    await mkdir(join(runtimePath, 'node_modules', '.bin'), { recursive: true });
  });

  afterEach(async () => {
    await rm(runtimePath, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
  });

  it('manifest validates against schema', () => {
    const manifest = adapter.manifest();
    expect(manifest.adapterId).toBe('codebase-memory');
    expect(manifest.artifactKinds).toContain('code');
    expect(manifest.supportsIncremental).toBe(true);
  });

  it('inspect returns descriptor with hash and metadata', async () => {
    const graph = {
      nodes: [
        { qualified_name: 'pkg.foo.bar', label: 'Function', name: 'bar', file_path: '/src/foo.ts' },
      ],
      edges: [],
    };
    await writeCodebaseMemoryCli(runtimePath, graph);

    const descriptor = await adapter.inspect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    assertSourceDescriptor(descriptor);
    expect(descriptor.adapterId).toBe('codebase-memory');
    expect(descriptor.kind).toBe('code');
    expect(descriptor.estimatedArtifacts).toBe(1);
    expect(descriptor.metadata).toMatchObject({ nodeCount: 1, edgeCount: 0 });
  });

  it('collect emits one artifact per node', async () => {
    const graph = {
      nodes: [
        { qualified_name: 'pkg.foo', label: 'Class', name: 'Foo', file_path: '/src/foo.ts' },
        { qualified_name: 'pkg.bar', label: 'Function', name: 'bar' },
      ],
      edges: [{ source: 'pkg.foo', target: 'pkg.bar', relationship: 'calls' }],
    };
    await writeCodebaseMemoryCli(runtimePath, graph);

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    assertArtifactBatch(batch);
    expect(batch.artifacts.length).toBe(2);
    expect(batch.hasMore).toBe(false);

    const [first] = batch.artifacts;
    expect(first.adapterId).toBe('codebase-memory');
    expect(first.kind).toBe('code');
    expect(first.content.title).toBe('Class');
    expect(first.evidence.length).toBe(1);
  });

  it('collect skips local-only artifacts containing secrets', async () => {
    const graph = {
      nodes: [
        { qualified_name: 'pkg.secret', label: 'Constant API_KEY=sk-abcdefghijklmnopqrstuvwxyz12345', name: 'API_KEY', file_path: '/src/secret.ts' },
        { qualified_name: 'pkg.safe', label: 'Function', name: 'safe' },
      ],
      edges: [],
    };
    await writeCodebaseMemoryCli(runtimePath, graph);
    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    const keys = batch.artifacts.map((a) => a.logicalKey);
    expect(keys).toContain('pkg.safe');
    expect(keys).not.toContain('pkg.secret');
  });

  it('requires absolute source path', async () => {
    await expect(
      adapter.inspect({ sourcePath: 'relative/path', spaceId: 's', jobId: 'j' }),
    ).rejects.toThrow('Source path must be absolute');
  });

  it('uses the supported CLI tools and unwraps MCP JSON output', async () => {
    const callsPath = join(runtimePath, 'calls.jsonl');
    const bin = join(runtimePath, 'node_modules', '.bin', 'codebase-memory-mcp');
    await writeFile(bin, `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const tool = process.argv[4];
const value = tool === 'index_repository'
  ? { project: 'tiny-project', nodes: 7, edges: 6, status: 'indexed' }
  : { project: 'tiny-project', total_nodes: 7, total_edges: 6, languages: [{ language: 'TypeScript', file_count: 2 }], packages: [{ name: 'src', node_count: 6 }] };
console.log(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false }));
`, { mode: 0o755 });

    const batch = await adapter.collect({ sourcePath, spaceId: 'space-1', jobId: 'job-1' });
    const calls = (await import('node:fs/promises')).readFile(callsPath, 'utf8');

    expect(await calls).toContain('index_repository');
    expect(await calls).toContain('get_architecture');
    expect(batch.artifacts).toContainEqual(expect.objectContaining({
      logicalKey: 'architecture/overview',
      kind: 'code',
    }));
  });
});

async function writeCodebaseMemoryCli(runtimePath: string, graph: Record<string, unknown>): Promise<void> {
  const bin = join(runtimePath, 'node_modules', '.bin', 'codebase-memory-mcp');
  const script = `#!/usr/bin/env node\nconsole.log(JSON.stringify(${JSON.stringify(graph)}));`;
  await writeFile(bin, script, { mode: 0o755 });
}
