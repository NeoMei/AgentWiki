import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkitdownAdapter } from './markitdown.js';
import { assertSourceDescriptor, assertArtifactBatch } from '../protocol/adapter.js';

describe('MarkitdownAdapter', () => {
  let runtimePath: string;
  let sourcePath: string;
  let adapter: MarkitdownAdapter;

  beforeEach(async () => {
    runtimePath = await mkdtemp(join(tmpdir(), 'md-runtime-'));
    sourcePath = await mkdtemp(join(tmpdir(), 'md-source-'));
    adapter = new MarkitdownAdapter(runtimePath);
    await mkdir(join(runtimePath, 'node_modules', '.bin'), { recursive: true });
  });

  afterEach(async () => {
    await rm(runtimePath, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
  });

  it('manifest validates against schema', () => {
    const manifest = adapter.manifest();
    expect(manifest.adapterId).toBe('markitdown');
    expect(manifest.artifactKinds).toContain('document');
    expect(manifest.supportsIncremental).toBe(true);
  });

  it('inspect returns descriptor with file count', async () => {
    await writeFile(join(sourcePath, 'a.md'), '# Hello');
    await writeFile(join(sourcePath, 'b.txt'), 'World');

    const descriptor = await adapter.inspect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    assertSourceDescriptor(descriptor);
    expect(descriptor.adapterId).toBe('markitdown');
    expect(descriptor.kind).toBe('documents');
    expect(descriptor.estimatedArtifacts).toBe(2);
  });

  it('collect converts markdown and text files', async () => {
    await writeFile(join(sourcePath, 'readme.md'), '# Readme\n\nContent.');
    await writeFile(join(sourcePath, 'notes.txt'), 'Plain notes.');

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    assertArtifactBatch(batch);
    expect(batch.artifacts.length).toBe(2);
    const keys = batch.artifacts.map((a) => a.logicalKey).sort();
    expect(keys).toEqual(['notes.txt', 'readme.md']);
    const readme = batch.artifacts.find((a) => a.logicalKey === 'readme.md')!;
    expect(readme.content.body).toContain('Readme');
    expect(readme.kind).toBe('document');
  });

  it('collect invokes markitdown binary for pdf/docx files', async () => {
    const fakeOutput = 'Converted document content';
    await writeFile(join(sourcePath, 'doc.pdf'), 'binary-pdf-stub');
    await writeMarkitdownCli(runtimePath, fakeOutput);

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    assertArtifactBatch(batch);
    expect(batch.artifacts.length).toBe(1);
    expect(batch.artifacts[0].logicalKey).toBe('doc.pdf');
    expect(batch.artifacts[0].content.body).toContain(fakeOutput);
  });

  it('collect skips local-only artifacts', async () => {
    await writeFile(
      join(sourcePath, 'secret.md'),
      '# Secret\n\nAPI_KEY=sk-abcdefghijklmnopqrstuvwxyz12345',
    );

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    expect(batch.artifacts.length).toBe(0);
  });

  it('collect respects limits', async () => {
    await writeFile(join(sourcePath, '1.md'), '# One');
    await writeFile(join(sourcePath, '2.md'), '# Two');

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
      limits: { maxFiles: 1 },
    });

    expect(batch.artifacts.length).toBe(1);
  });

  it('requires absolute source path', async () => {
    await expect(
      adapter.inspect({ sourcePath: 'relative/path', spaceId: 's', jobId: 'j' }),
    ).rejects.toThrow('Source path must be absolute');
  });

  it('does not follow symbolic links outside the selected source root', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'md-outside-'));
    try {
      await writeFile(join(outside, 'private.md'), 'password: SuperSecret123');
      await symlink(join(outside, 'private.md'), join(sourcePath, 'linked.md'));

      const batch = await adapter.collect({ sourcePath, spaceId: 's', jobId: 'j' });

      expect(batch.artifacts).toHaveLength(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

async function writeMarkitdownCli(runtimePath: string, output: string): Promise<void> {
  const bin = join(runtimePath, 'node_modules', '.bin', 'markitdown');
  const script = `#!/usr/bin/env node\nconsole.log(${JSON.stringify(output)});`;
  await writeFile(bin, script, { mode: 0o755 });
}
