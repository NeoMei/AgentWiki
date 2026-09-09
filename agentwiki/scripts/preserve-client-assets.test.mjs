import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { preserveClientAssets } from './preserve-client-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'agentwiki-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const old = join(root, 'old'), next = join(root, 'next');
  mkdirSync(join(old, 'assets'), { recursive: true });
  mkdirSync(join(next, 'assets'), { recursive: true });
  writeFileSync(join(old, 'index.html'), 'old entry');
  writeFileSync(join(next, 'index.html'), 'new entry');
  return { root, old, next };
}

test('retains old lazy chunks without replacing the new entry or new chunks', (t) => {
  const { old, next } = fixture(t);
  writeFileSync(join(old, 'assets/editor-old.js'), 'old editor');
  writeFileSync(join(next, 'assets/editor-new.js'), 'new editor');
  assert.equal(preserveClientAssets(old, next), 1);
  assert.equal(readFileSync(join(next, 'assets/editor-old.js'), 'utf8'), 'old editor');
  assert.equal(readFileSync(join(next, 'assets/editor-new.js'), 'utf8'), 'new editor');
  assert.equal(readFileSync(join(next, 'index.html'), 'utf8'), 'new entry');
});

test('accepts identical shared assets and fails closed on a name/content collision', (t) => {
  const { old, next } = fixture(t);
  for (const dir of [old, next]) writeFileSync(join(dir, 'assets/shared.js'), 'identical');
  assert.equal(preserveClientAssets(old, next), 0);
  writeFileSync(join(old, 'assets/shared.js'), 'different');
  assert.throws(() => preserveClientAssets(old, next), /collision/u);
  assert.equal(readFileSync(join(next, 'assets/shared.js'), 'utf8'), 'identical');
});

test('refuses symbolic links instead of copying files outside a build', (t) => {
  const { root, old, next } = fixture(t);
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'outside/private'), 'private');
  symlinkSync(join(root, 'outside'), join(old, 'assets/linked.js'), 'junction');
  assert.throws(() => preserveClientAssets(old, next), /regular file/u);
  assert.equal(existsSync(join(next, 'assets/linked.js')), false);
});
