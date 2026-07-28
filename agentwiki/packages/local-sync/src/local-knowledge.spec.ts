import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inspectLocalSource,
  inspectOpenWikiProvider,
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

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('OpenWiki provider disclosure', () => {
  it('classifies loopback OpenAI-compatible OpenWiki as local', () => {
    expect(inspectOpenWikiProvider({
      OPENWIKI_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:11434/v1',
      OPENWIKI_MODEL_ID: 'llama3.2',
    })).toEqual(expect.objectContaining({
      provider: 'openai-compatible', model: 'llama3.2', local: true,
    }));
  });

  it('classifies a provider without a loopback base URL as remote', () => {
    expect(inspectOpenWikiProvider({ OPENWIKI_PROVIDER: 'anthropic' }).local).toBe(false);
  });

  it('does not treat a hostname beginning with 127 as loopback', () => {
    expect(inspectOpenWikiProvider({
      OPENWIKI_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'http://127.evil.example/v1',
    }).local).toBe(false);
  });

  it('recognizes IPv4 and IPv6 loopback addresses', () => {
    expect(inspectOpenWikiProvider({
      OPENWIKI_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'http://127.255.0.1/v1',
    }).local).toBe(true);
    expect(inspectOpenWikiProvider({
      OPENWIKI_PROVIDER: 'openai-compatible',
      OPENAI_COMPATIBLE_BASE_URL: 'http://[::1]:11434/v1',
    }).local).toBe(true);
  });
});

describe('local knowledge preparation', () => {
  it('does not disclose the absolute source path during inspection', async () => {
    const { home, source } = await fixture();
    const run = vi.fn<CommandRunner>((command, args) => (
      args[0] === '--version' ? commandResult(`${command} 1.0.0`) : commandResult()
    ));

    const inspection = await inspectLocalSource(source, dependencies(home, run));

    expect(inspection).toMatchObject({
      displayName: basename(source),
      kind: 'mixed',
      files: { code: 1, documents: 2, unsupported: 1 },
    });
    expect(JSON.stringify(inspection)).not.toContain(source);
  });

  it('refuses a remote provider before invoking OpenWiki', async () => {
    const { home, source } = await fixture();
    const run = vi.fn<CommandRunner>(() => commandResult());

    await expect(prepareKnowledgeSync({ path: source, allowRemoteModel: false }, dependencies(home, run)))
      .rejects.toThrow('Remote OpenWiki model consent is required');
    expect(run).not.toHaveBeenCalledWith('openwiki', expect.any(Array), expect.anything());
  });

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
      if (command === 'openwiki') {
        expect(args).toEqual(['code', '--update', '--print']);
        expect(options?.env?.DO_NOT_TRACK).toBe('1');
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        const output = join(options.cwd, 'openwiki', 'guides');
        await mkdir(output, { recursive: true });
        await writeFile(join(output, 'project.md'), '# Generated\n');
        await writeFile(join(options.cwd, 'openwiki', 'INSTRUCTIONS.md'), '# Internal\n');
      }
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({
      path: source,
      allowRemoteModel: true,
      codebaseMemorySummary: 'Architecture summary',
    }, dependencies(home, run));

    expect(run).toHaveBeenCalledWith('markitdown', expect.arrayContaining(['-o']), expect.objectContaining({ cwd: expect.any(String) }));
    expect(run).toHaveBeenCalledWith('openwiki', ['code', '--update', '--print'], expect.objectContaining({
      cwd: expect.any(String), env: expect.objectContaining({ DO_NOT_TRACK: '1' }),
    }));
    expect(prepared.envelope.documents.map((document) => document.path).sort()).toEqual([
      'architecture/codebase-memory.md',
      'openwiki/guides/project.md',
    ]);
    expect(prepared.envelope.documents.every((document) => document.path !== 'openwiki/INSTRUCTIONS.md')).toBe(true);
    expect(prepared.envelope.documents).toContainEqual(expect.objectContaining({
      path: 'openwiki/guides/project.md',
      contentHash: createHash('sha256').update('# Generated\n', 'utf8').digest('hex'),
    }));
    expect(new TextDecoder().decode(prepared.envelopeBytes)).not.toContain(source);
  });

  it('uses the tracked Git file list when the source is a Git repository', async () => {
    const { home, source } = await fixture();
    await mkdir(join(source, '.git'));
    const run = vi.fn<CommandRunner>(async (command, args, options) => {
      if (command === 'git' && args[0] === 'ls-files') return commandResult('README.md\0');
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        await mkdir(join(options.cwd, 'openwiki'), { recursive: true });
        await writeFile(join(options.cwd, 'openwiki', 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });

    await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, dependencies(home, run));

    expect(run).toHaveBeenCalledWith('git', ['ls-files', '-co', '--exclude-standard', '-z'], expect.objectContaining({ cwd: expect.any(String) }));
    expect(run).toHaveBeenCalledWith('git', ['init'], expect.objectContaining({ cwd: expect.any(String) }));
  });

  it('rejects a symlink whose target escapes the source root', async () => {
    const { home, source } = await fixture();
    const outside = await temporaryDirectory('agentwiki-local-outside-');
    const target = join(outside, 'secret.md');
    await writeFile(target, 'outside root\n');
    await symlink(target, join(source, 'escape.md'));
    const run = vi.fn<CommandRunner>(async (command, _args, options) => {
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        await mkdir(join(options.cwd, 'openwiki'), { recursive: true });
        await writeFile(join(options.cwd, 'openwiki', 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual({ path: 'escape.md', reason: 'Symlink escapes source root' });
  });

  it('continues after a document conversion failure and reports the skipped source file', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'broken.pdf'), 'PDF fixture');
    await writeFile(join(source, 'valid.docx'), 'DOCX fixture');
    const run = vi.fn<CommandRunner>(async (command, args, options) => {
      if (command === 'markitdown') {
        if (args[0].endsWith('broken.pdf')) return { status: 1, stdout: '', stderr: 'converter failed' };
        await writeFile(args[2], '# Converted\n');
      }
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        await mkdir(join(options.cwd, 'openwiki'), { recursive: true });
        await writeFile(join(options.cwd, 'openwiki', 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual(expect.objectContaining({ path: 'broken.pdf', reason: expect.stringMatching(/converter failed/) }));
    expect(run).toHaveBeenCalledWith('openwiki', ['code', '--update', '--print'], expect.anything());
  });

  it('does not overwrite Markdown when a same-named PDF is converted', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'guide.md'), '# Original Markdown\n');
    await writeFile(join(source, 'guide.pdf'), 'PDF fixture');
    const run = vi.fn<CommandRunner>(async (command, args, options) => {
      if (command === 'markitdown') {
        expect(args[2]).toMatch(/guide\.pdf\.md$/u);
        await writeFile(args[2], '# Converted PDF\n');
      }
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        expect(await readFile(join(options.cwd, 'guide.md'), 'utf8')).toBe('# Original Markdown\n');
        await mkdir(join(options.cwd, 'openwiki'), { recursive: true });
        await writeFile(join(options.cwd, 'openwiki', 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });

    await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, dependencies(home, run));
  });

  it('enforces configured staging file-count and total-size limits', async () => {
    const home = await temporaryDirectory('agentwiki-local-home-');
    const source = await temporaryDirectory('agentwiki-local-source-');
    await writeFile(join(source, 'first.md'), 'a');
    await writeFile(join(source, 'second.md'), 'b');
    const run = vi.fn<CommandRunner>(async (command, _args, options) => {
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        await mkdir(join(options.cwd, 'openwiki'), { recursive: true });
        await writeFile(join(options.cwd, 'openwiki', 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });
    const countLimitedDependencies = Object.assign(dependencies(home, run), {
      limits: { maxInputFiles: 1, maxInputBytes: 100 },
    });
    const sizeLimitedDependencies = Object.assign(dependencies(home, run), {
      limits: { maxInputFiles: 100, maxInputBytes: 1 },
    });

    const countLimited = await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, countLimitedDependencies);
    const sizeLimited = await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, sizeLimitedDependencies);

    expect(countLimited.skippedFiles).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/file limit/) }));
    expect(sizeLimited.skippedFiles).toContainEqual(expect.objectContaining({ reason: expect.stringMatching(/size limit/) }));
  });

  it('reports unreadable or oversized files as skipped rather than silently discarding them', async () => {
    const { home, source } = await fixture();
    await writeFile(join(source, 'large.md'), 'x'.repeat(1_048_577));
    const run = vi.fn<CommandRunner>(async (command, args, options) => {
      if (command === 'openwiki') {
        if (typeof options?.cwd !== 'string') throw new Error('OpenWiki staging directory is required');
        const output = join(options.cwd, 'openwiki');
        await mkdir(output, { recursive: true });
        await writeFile(join(output, 'generated.md'), '# Generated\n');
      }
      return commandResult();
    });

    const prepared = await prepareKnowledgeSync({ path: source, allowRemoteModel: true }, dependencies(home, run));

    expect(prepared.skippedFiles).toContainEqual(expect.objectContaining({ path: 'large.md', reason: expect.stringMatching(/1 MiB/) }));
  });
});
