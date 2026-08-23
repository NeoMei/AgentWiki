import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageJson = fileURLToPath(new URL('../../package.json', import.meta.url));
const readme = fileURLToPath(new URL('../../README.md', import.meta.url));

describe('local-sync package boundary', () => {
  it('pins onboarding instructions to the published package version', async () => {
    const manifest = JSON.parse(await readFile(packageJson, 'utf8')) as { version: string };
    const content = await readFile(readme, 'utf8');

    expect(manifest.version).toBe('0.5.1');
    expect(content).toContain(`## Onboarding (${manifest.version})`);
    expect(content.match(new RegExp(`@neomei/agentwiki-local-sync@${manifest.version.replaceAll('.', '\\.')}`, 'g'))).toHaveLength(2);
    expect(content).not.toContain('@neomei/agentwiki-local-sync@0.4.0');
  });

  it('keeps only the historical dist allowlist and exact safe adapter entrypoints', async () => {
    const manifest = JSON.parse(await readFile(packageJson, 'utf8')) as { main: string; types: string; exports?: Record<string, unknown> };
    expect(manifest.exports).toMatchObject({
      '.': { import: manifest.main, types: manifest.types },
      './dist/sync/*': './dist/sync/*',
      './dist/utils/*': './dist/utils/*',
      './dist/agentwiki-client.js': expect.any(Object),
    });
    expect(manifest.exports).toMatchObject({
      './dist/adapter/index.js': expect.any(Object),
      './dist/adapter/manager.js': expect.any(Object),
      './dist/adapter/markitdown.js': expect.any(Object),
    });
    expect(manifest.exports).not.toHaveProperty('./dist/adapter/*');
    expect(manifest.exports).not.toHaveProperty('./dist/*');
    expect(manifest.exports).not.toHaveProperty('./dist/codegraph/*');
    expect(manifest.exports).not.toHaveProperty('./dist/codegraph/index.js');
    expect(manifest.exports).not.toHaveProperty('./dist/codegraph/generated-store-core*');
    expect(manifest.exports).not.toHaveProperty('./dist/codegraph/generated-store.internal*');
  });

  it.each([
    '@neomei/agentwiki-local-sync/dist/codegraph/index.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/%69ndex.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/generated-store.js',
    '@neomei/agentwiki-local-sync/dist/codegraph/%67enerated-store.js',
  ])('does not export mutable CodeGraph internals through %s', (subpath) => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(subpath)}).then(() => process.exit(1), (error) => { process.stdout.write(error.code ?? ''); process.exit(error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ? 0 : 1); })`,
    ], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
  });
});
