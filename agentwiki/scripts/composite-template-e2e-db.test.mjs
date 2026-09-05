import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { withCompositeTemplateE2EDatabase } from './composite-template-e2e-support.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(new URL('./composite-template-e2e.mjs', import.meta.url));
const databaseUrl = process.env.COMPOSITE_TEMPLATE_E2E_DATABASE_URL
  ?? process.env.PAGE_TEMPLATE_TEST_DATABASE_URL;

test('acceptance database creates exactly one mac_e2e schema and cleans it without changing public', {
  timeout: 120_000,
}, async () => {
  const observed = await withCompositeTemplateE2EDatabase(
    databaseUrl,
    async ({ databaseUrl: generatedUrl, schemaName, publicInventoryDigest }) => {
      assert.match(schemaName, /^mac_e2e_[A-Za-z0-9_]+$/u);
      assert.equal(new URL(generatedUrl).searchParams.get('schema'), schemaName);
      assert.match(publicInventoryDigest, /^[a-f0-9]{64}$/u);
      return { schemaName, publicInventoryDigest };
    },
  );
  assert.match(observed.schemaName, /^mac_e2e_/u);
});

test('acceptance runner starts API worker and Vite through the generated schema and cleans them', {
  timeout: 120_000,
}, () => {
  const result = spawnSync(process.execPath, [script, 'startup'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 115_000,
    env: process.env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const records = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.match(records[0].schemaName, /^mac_e2e_[A-Za-z0-9_]+$/u);
  assert.equal(records[0].status, 'STARTUP_READY');
  assert.equal(records[1].status, 'CLEANED');
  assert.doesNotMatch(result.stdout, /postgresql:|redis:|secret/u);
});
