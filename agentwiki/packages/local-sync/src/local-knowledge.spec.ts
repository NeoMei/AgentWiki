import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
