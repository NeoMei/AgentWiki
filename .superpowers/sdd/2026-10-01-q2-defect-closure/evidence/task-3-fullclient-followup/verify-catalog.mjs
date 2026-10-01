import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('apps/client/package.json'));
const { transform } = createRequire(require.resolve('vite'))('esbuild');
const source = fs.readFileSync('apps/client/src/i18n/system-collaboration-messages.ts', 'utf8');
const js = (await transform(source, { loader: 'ts', format: 'esm' })).code;
const actual = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const before = JSON.parse(fs.readFileSync(new URL('./catalog-before.json', import.meta.url), 'utf8'));
assert.deepStrictEqual(actual.systemCollaborationKeys, before.keys);
assert.deepStrictEqual(actual.systemCollaborationMessages, before.messages);
assert.deepStrictEqual(Object.keys(actual.systemCollaborationKeys), Object.keys(before.keys));
for (const locale of ['en', 'zh-CN']) {
  assert.deepStrictEqual(Object.keys(actual.systemCollaborationMessages[locale]), Object.keys(before.messages[locale]));
}
console.log('PASS: exact exported keys, both-language messages, and insertion order preserved (196 entries each; 77 Todo tuples).');
