import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerUnit = await readFile(new URL('../deploy/systemd/agentwiki-worker.service', import.meta.url), 'utf8');
const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('production worker runtimes enforce a private hard quota for Git ingestion temp files', () => {
  assert.match(workerUnit, /^TemporaryFileSystem=\/tmp:.*size=256M.*$/mu);
  assert.match(compose, /worker:[\s\S]*?tmpfs:\s*\n\s*- \/tmp:.*size=268435456/mu);
});
