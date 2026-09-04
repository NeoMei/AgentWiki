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
    await mkdir(join(runtimePath, '.venv', 'bin'), { recursive: true });
  });

  afterEach(async () => {
    await rm(runtimePath, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
  });

  it('manifest validates against schema', () => {
    const manifest = adapter.manifest();
    expect(manifest.adapterId).toBe('markitdown');
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.artifactKinds).toContain('document');
    expect(manifest.supportsIncremental).toBe(true);
    expect(manifest.runtime).toMatchObject({
      kind: 'python-venv',
      packageName: 'markitdown',
      packageVersion: '0.1.6',
      packageExtras: ['pdf', 'docx'],
    });
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
    expect(descriptor.metadata).toMatchObject({ requiresManagedRuntime: false });
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
    const expectedPython = process.platform === 'win32'
      ? join(runtimePath, '.venv', 'Scripts', 'python.exe')
      : join(runtimePath, '.venv', 'bin', 'python');
    adapter = new MarkitdownAdapter(runtimePath, async (file, args) => {
      expect(file).toBe(expectedPython);
      expect(args.slice(0, 2)).toEqual(['-m', 'markitdown']);
      return { stdout: fakeOutput, stderr: '' };
    });

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
    });

    expect((await adapter.inspect({ sourcePath, spaceId: 'space-1', jobId: 'job-1' })).metadata)
      .toMatchObject({ requiresManagedRuntime: true });

    assertArtifactBatch(batch);
    expect(batch.artifacts.length).toBe(1);
    expect(batch.artifacts[0].logicalKey).toBe('doc.pdf');
    expect(batch.artifacts[0].content.body).toContain(fakeOutput);
  });

  it('executes the managed Python runtime directly', async () => {
    await writeFile(join(sourcePath, 'doc.pdf'), 'binary-pdf-stub');
    const python = process.platform === 'win32'
      ? join(runtimePath, '.venv', 'Scripts', 'python.exe')
      : join(runtimePath, '.venv', 'bin', 'python');
    adapter = new MarkitdownAdapter(runtimePath, async (file) => {
      expect(file).toBe(python);
      return { stdout: 'Converted by a non-JavaScript CLI\n', stderr: '' };
    });

    const batch = await adapter.collect({ sourcePath, spaceId: 'space-1', jobId: 'job-1' });

    expect(batch.artifacts).toHaveLength(1);
    expect(batch.artifacts[0].content.body).toContain('Converted by a non-JavaScript CLI');
    expect(batch.artifacts[0].content.body).not.toContain('Conversion failed');
  });

  it('uses the relocatable venv Python module entrypoint', async () => {
    await writeFile(join(sourcePath, 'relocated.pdf'), 'binary-pdf-stub');
    adapter = new MarkitdownAdapter(runtimePath, async () => ({
      stdout: 'Converted after runtime relocation\n', stderr: '',
    }));

    const batch = await adapter.collect({ sourcePath, spaceId: 'space-1', jobId: 'job-1' });

    expect(batch.artifacts).toHaveLength(1);
    expect(batch.artifacts[0].content.body).toContain('Converted after runtime relocation');
  });

  it('fails the scan instead of publishing a conversion error as knowledge', async () => {
    await writeFile(join(sourcePath, 'broken.pdf'), 'binary-pdf-stub');

    await expect(
      adapter.collect({ sourcePath, spaceId: 'space-1', jobId: 'job-1' }),
    ).rejects.toThrow(/broken\.pdf/);
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

  it('does not exceed maxFiles across nested directories', async () => {
    await mkdir(join(sourcePath, 'a'));
    await mkdir(join(sourcePath, 'b'));
    await writeFile(join(sourcePath, 'a', 'first.md'), '# First');
    await writeFile(join(sourcePath, 'b', 'second.md'), '# Second');

    const batch = await adapter.collect({
      sourcePath,
      spaceId: 'space-1',
      jobId: 'job-1',
      limits: { maxFiles: 1 },
    });

    expect(batch.artifacts).toHaveLength(1);
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
