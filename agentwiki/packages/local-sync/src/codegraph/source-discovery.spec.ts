import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverCodeSources } from './source-discovery.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'agentwiki-codegraph-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('CodeGraph source discovery', () => {
  it('uses bounded filename-only inspection to include code and exclude document-only auto sources', async () => {
    const root = await temporaryDirectory();
    const code = join(root, 'code');
    const documents = join(root, 'documents');
    await mkdir(code);
    await mkdir(documents);
    await writeFile(join(code, 'package.json'), '{"private":true}');
    await writeFile(join(documents, 'notes.md'), 'do not inspect this body');

    await expect(discoverCodeSources({ sourcePaths: [code, documents], sourceType: 'auto' }))
      .resolves.toEqual([expect.objectContaining({ canonicalSourcePath: await realpath(code) })]);
  });

  it('accepts a normal directory and its in-repository .codegraph directory', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'main.ts'), 'export {};');
    await mkdir(join(root, '.codegraph'));

    await expect(discoverCodeSources({ sourcePaths: [root], sourceType: 'code' }))
      .resolves.toEqual([expect.objectContaining({ canonicalSourcePath: await realpath(root), indexPath: join(await realpath(root), '.codegraph') })]);
  });

  it('canonicalizes an in-repository source symlink', async () => {
    const root = await temporaryDirectory();
    const repository = join(root, 'repository');
    const sourceLink = join(root, 'repository-link');
    await mkdir(repository);
    await writeFile(join(repository, 'main.ts'), 'export {};');
    await symlink(repository, sourceLink);

    await expect(discoverCodeSources({ sourcePaths: [sourceLink], sourceType: 'code' }))
      .resolves.toEqual([expect.objectContaining({ canonicalSourcePath: await realpath(repository) })]);
  });

  it.each([
    ['a traversal path', async () => {
      const root = await temporaryDirectory();
      const repository = join(root, 'repository');
      await mkdir(repository);
      return `${repository}/../repository`;
    }],
    ['the current home directory', async () => process.env.HOME!],
    ['the filesystem root', async () => '/'],
  ])('rejects %s before command planning', async (_name, sourcePath) => {
    await expect(discoverCodeSources({ sourcePaths: [await sourcePath()], sourceType: 'code' }))
      .rejects.toMatchObject({ code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED' });
  });

  it('rejects a .codegraph symlink that escapes its canonical source root', async () => {
    const root = await temporaryDirectory();
    const repository = join(root, 'repository');
    const outside = join(root, 'outside');
    await mkdir(repository);
    await mkdir(outside);
    await writeFile(join(repository, 'main.ts'), 'export {};');
    await symlink(outside, join(repository, '.codegraph'));

    await expect(discoverCodeSources({ sourcePaths: [repository], sourceType: 'code' }))
      .rejects.toMatchObject({ code: 'CODEGRAPH_CAPABILITY_UNSUPPORTED' });
  });
});
