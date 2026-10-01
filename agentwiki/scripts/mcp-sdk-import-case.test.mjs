import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:[cm]?js|tsx?)$/u.test(entry.name) ? [path] : [];
  }));
  return files.flat();
}

test('MCP SDK imports match installed SDK filenames on case-sensitive filesystems', async () => {
  const files = (await Promise.all([
    'packages/local-sync/src', 'apps/server/src', 'scripts',
  ].map((path) => sourceFiles(join(root, path))))).flat();
  let checked = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    // Repository scripts resolve the SDK from the server workspace, as in the
    // production E2E scripts; pnpm does not expose it at the repository root.
    const require = createRequire(file.startsWith(join(root, 'scripts'))
      ? join(root, 'apps/server/package.json') : file);
    for (const match of source.matchAll(/['"](@modelcontextprotocol\/sdk\/[^'"]+\.js)['"]/gu)) {
      const resolved = require.resolve(match[1]);
      const installedNames = await readdir(dirname(resolved));
      assert.ok(installedNames.includes(basename(resolved)), `${file}: ${match[1]} must match the SDK's actual filename casing`);
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'the SDK import inventory must not be empty');
});
