import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inspectLocalSource,
  prepareKnowledgeSync,
  type CommandRunner,
  type LocalKnowledgeDeps,
} from './local-knowledge.js';

const temporaryPaths: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  temporaryPaths.push(path);
  return path;
}

async function fixture(): Promise<{ home: string; source: string }> {
  const home = await temporaryDirectory('agentwiki-local-home-');
  const source = await temporaryDirectory('agentwiki-local-source-');
  await writeFile(join(source, 'README.md'), '# Project\n');
  await writeFile(join(source, 'notes.txt'), 'Notes\n');
  await writeFile(join(source, 'app.ts'), 'export const answer = 42;\n');
  await writeFile(join(source, 'unsupported.bin'), 'not indexed\n');
  return { home, source };
}

function commandResult(stdout = '', status = 0): { status: number; stdout: string; stderr: string } {
  return { status, stdout, stderr: '' };
}

function dependencies(home: string, run: CommandRunner): LocalKnowledgeDeps {
  return { home, run, now: () => new Date('2026-07-29T08:00:00.000Z') };
}

function mockRun(): ReturnType<typeof vi.fn> {
  return vi.fn<CommandRunner>((command) => {
    if (command === 'codebase-memory-mcp') {
      return Promise.resolve(commandResult(JSON.stringify({ summary: 'Architecture summary' })));
    }
    return Promise.resolve(commandResult());
  });
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('inspectLocalSource', () => {
  it('does not disclose the absolute source path during inspection', async () => {
    const { home, source } = await fixture();
    const run = vi.fn<CommandRunner>((command, args) => (
      args[0] === '--version' ? Promise.resolve(commandResult(`${command} 1.0.0`)) : Promise.resolve(commandResult())
    ));

    const inspection = await inspectLocalSource(source, dependencies(home, run));

    expect(inspection).toMatchObject({
      displayName: basename(source),
      kind: 'mixed',
      files: { code: 1, documents: 2, unsupported: 1 },
    });
    expect(JSON.stringify(inspection)).not.toContain(source);
  });

  it('ignores generated and dependency directories outside a Git repository', async () => {
    const { home, source } = await fixture();
    await mkdir(join(source, 'dist'), { recursive: true });
    await mkdir(join(source, 'node_modules', 'dependency'), { recursive: true });
    await mkdir(join(source, '.cache'), { recursive: true });
    await writeFile(join(source, 'dist', 'generated.js'), 'export const generated = true;\n');
    await writeFile(join(source, 'node_modules', 'dependency', 'index.js'), 'export const dependency = true;\n');
    await writeFile(join(source, '.cache', 'result.json'), '{}\n');
    const run = vi.fn<CommandRunner>((command, args) => (
      args[0] === '--version' ? Promise.resolve(commandResult(`${command} 1.0.0`)) : Promise.resolve(commandResult())
    ));

    const inspection = await inspectLocalSource(source, dependencies(home, run));

    expect(inspection.files).toEqual({ code: 1, documents: 2, unsupported: 1 });
  });
});

describe('prepareKnowledgeSync', () => {
  it('stages source files, converts office documents, and emits hashed OKF documents', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'guide.pdf'), 'PDF fixture');
    await writeFile(join(source, 'letter.docx'), 'DOCX fixture');

    const run = vi.fn<CommandRunner>(async (command, args, options) => {
      expect(Array.isArray(args)).toBe(true);
      expect(typeof command).toBe('string');

      if (command === 'markitdown') {
        expect(options?.env?.OPENAI_API_KEY).toBeUndefined();
        await writeFile(args[2], `# Converted ${args[0].split('/').at(-1)}\n`);
      }
      if (command === 'codebase-memory-mcp') {
        return commandResult(JSON.stringify({ summary: 'Architecture summary' }));
      }
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({
      path: source,
      allowRemoteModel: false,
      codebaseMemorySummary: 'Architecture summary',
    }, dependencies(home, run));

    const markitdownCalls = run.mock.calls.filter((call) => call[0] === 'markitdown');
    expect(markitdownCalls.length).toBeGreaterThan(0);
    expect(markitdownCalls.every((call) => call[1].includes('-o'))).toBe(true);
    const paths = prepared.envelope.documents.map((document) => document.path).sort();
    expect(paths).toContain('architecture/codebase-memory.md');
    expect(paths).toContain('README.md');
    expect(paths).toContain('notes.txt');
    expect(paths).toContain('guide.pdf.md');
    expect(paths).toContain('letter.docx.md');
    expect(prepared.envelope.documents.every((document) => Array.isArray(document.evidence))).toBe(true);
    expect(prepared.envelope.documents).toContainEqual(expect.objectContaining({
      path: 'README.md',
      contentHash: createHash('sha256').update('# Project\n', 'utf8').digest('hex'),
    }));
    expect(prepared.skippedFiles).not.toContainEqual({ path: 'app.ts', reason: 'Unsupported file type' });
    expect(prepared.skippedFiles).toContainEqual({ path: 'unsupported.bin', reason: 'Unsupported file type' });
    expect(new TextDecoder().decode(prepared.envelopeBytes)).not.toContain(source);
  });

  it('uses the tracked Git file list when the source is a Git repository', async () => {
    const { home, source } = await fixture();
    await mkdir(join(source, '.git'));
    const run = vi.fn<CommandRunner>(async (command, args) => {
      if (command === 'git' && args[0] === 'ls-files') return commandResult('README.md\0');
      if (command === 'codebase-memory-mcp') return commandResult(JSON.stringify({ summary: 'Git repo summary' }));
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run));

    expect(run).toHaveBeenCalledWith('git', ['ls-files', '-co', '--exclude-standard', '-z'], expect.objectContaining({ cwd: expect.any(String) }));
    expect(prepared.envelope.documents.map((d) => d.path)).toContain('README.md');
  });

  it('rejects a symlink whose target escapes the source root', async () => {
    const { home, source } = await fixture();
    const outside = await temporaryDirectory('agentwiki-local-outside-');
    const target = join(outside, 'secret.md');
    await writeFile(target, 'outside root\n');
    await symlink(target, join(source, 'escape.md'));
    const run = mockRun();

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual({ path: 'escape.md', reason: 'Symlink escapes source root' });
  });

  it('continues after a document conversion failure and reports the skipped source file', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'broken.pdf'), 'PDF fixture');
    await writeFile(join(source, 'valid.docx'), 'DOCX fixture');
    const run = vi.fn<CommandRunner>(async (command, args) => {
      if (command === 'markitdown') {
        if (args[0].endsWith('broken.pdf')) return { status: 1, stdout: '', stderr: 'converter failed' };
        await writeFile(args[2], '# Converted\n');
      }
      if (command === 'codebase-memory-mcp') return commandResult('{"summary":""}');
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual(expect.objectContaining({ path: 'broken.pdf', reason: expect.stringMatching(/converter failed/) }));
  });

  it('does not overwrite Markdown when a same-named PDF is converted', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'guide.md'), '# Original Markdown\n');
    await writeFile(join(source, 'guide.pdf'), 'PDF fixture');
    await writeFile(join(source, 'guide.pdf.md'), '# Pre-existing PDF Markdown\n');
    const run = vi.fn<CommandRunner>(async (command, args) => {
      if (command === 'markitdown') {
        expect(args[2]).toContain('_converted');
        expect(args[2]).toMatch(/guide\.pdf\.md$/u);
        await writeFile(args[2], '# Converted PDF\n');
      }
      if (command === 'codebase-memory-mcp') return commandResult('{"summary":""}');
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run));
    expect(prepared.skippedFiles.find((f) => f.path === 'guide.pdf' || f.path === 'guide.pdf.md')).toBeUndefined();
  });

  it('enforces configured staging file-count and total-size limits', async () => {
    const home = await temporaryDirectory('agentwiki-local-home-');
    const source = await temporaryDirectory('agentwiki-local-source-');
    await writeFile(join(source, 'first.md'), 'a');
    await writeFile(join(source, 'second.md'), 'b');
    const run = mockRun();
    const countLimitedDependencies = Object.assign(dependencies(home, run), {
      limits: { maxInputFiles: 1, maxInputBytes: 100 },
    });
    const sizeLimitedDependencies = Object.assign(dependencies(home, run), {
      limits: { maxInputFiles: 100, maxInputBytes: 1 },
    });

    const countLimited = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, countLimitedDependencies);
    const sizeLimited = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, sizeLimitedDependencies);

    expect(countLimited.skippedFiles).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/file limit/) }));
    expect(sizeLimited.skippedFiles).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/size limit/) }));
  });

  it('reports unreadable or oversized files as skipped rather than silently discarding them', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'large.md'), 'x'.repeat(1_048_577));
    const run = mockRun();

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual(expect.objectContaining({ path: 'large.md', reason: expect.stringMatching(/1 MiB/) }));
  });
});
