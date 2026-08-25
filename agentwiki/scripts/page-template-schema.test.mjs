import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFile(path.join(root, relative), 'utf8');

test('page templates keep immutable versions and compound Page provenance', async () => {
  const schema = await read('apps/server/prisma/schema.prisma');
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(schema, /model PageTemplate \{/u);
  assert.match(schema, /model PageTemplateVersion \{/u);
  assert.match(schema, /@@unique\(\[templateId, version\]\)/u);
  assert.match(schema, /sourceTemplateVersion\s+Int\?/u);
  assert.match(migration, /Page_template_source_tuple_check/u);
  assert.match(migration, /FOREIGN KEY \("sourceTemplateId", "sourceTemplateVersion"\)/u);
  assert.match(migration, /REFERENCES "PageTemplateVersion"\("templateId", "version"\)/u);
  assert.match(migration, /ON DELETE RESTRICT/u);
});
