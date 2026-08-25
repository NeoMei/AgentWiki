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

test('space templates require sourceLocale without relying on CHECK null semantics', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /\("scope" = 'space' AND "spaceId" IS NOT NULL AND "scopeKey" = "spaceId" AND "sourceLocale" IS NOT NULL AND "sourceLocale" IN \('zh-CN', 'en'\) AND "nameKey" IS NOT NULL\)/u,
  );
});

test('Page template provenance requires sourceTemplateLocale explicitly', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /\("sourceTemplateId" IS NOT NULL AND "sourceTemplateVersion" IS NOT NULL AND "sourceTemplateLocale" IS NOT NULL AND "sourceTemplateLocale" IN \('zh-CN', 'en'\)\)/u,
  );
});

test('Page provenance foreign key rejects template version key updates', async () => {
  const schema = await read('apps/server/prisma/schema.prisma');
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    schema,
    /sourceTemplateVersionRecord\s+PageTemplateVersion\?\s+@relation\("PageSourceTemplateVersion", fields: \[sourceTemplateId, sourceTemplateVersion\], references: \[templateId, version\], onDelete: Restrict, onUpdate: Restrict\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("sourceTemplateId", "sourceTemplateVersion"\) REFERENCES "PageTemplateVersion"\("templateId", "version"\) ON DELETE RESTRICT ON UPDATE RESTRICT/u,
  );
});

test('PageTemplateVersion identity and content fields reject changes', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /IF NEW\."id" IS DISTINCT FROM OLD\."id"\s+OR NEW\."templateId" IS DISTINCT FROM OLD\."templateId"\s+OR NEW\."version" IS DISTINCT FROM OLD\."version"\s+OR NEW\."contentI18n" IS DISTINCT FROM OLD\."contentI18n"\s+OR NEW\."contentHash" IS DISTINCT FROM OLD\."contentHash"\s+OR NEW\."createdAt" IS DISTINCT FROM OLD\."createdAt"\s+THEN\s+RAISE EXCEPTION 'PageTemplateVersion identity and content are immutable';\s+END IF;/u,
  );
});

test('PageTemplateVersion provenance fields only allow existing foreign keys to be cleared', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /IF NEW\."sourcePageId" IS DISTINCT FROM OLD\."sourcePageId"\s+AND NOT \(OLD\."sourcePageId" IS NOT NULL AND NEW\."sourcePageId" IS NULL\)\s+THEN\s+RAISE EXCEPTION 'PageTemplateVersion sourcePageId may only be cleared';\s+END IF;/u,
  );
  assert.match(
    migration,
    /IF NEW\."createdById" IS DISTINCT FROM OLD\."createdById"\s+AND NOT \(OLD\."createdById" IS NOT NULL AND NEW\."createdById" IS NULL\)\s+THEN\s+RAISE EXCEPTION 'PageTemplateVersion createdById may only be cleared';\s+END IF;/u,
  );
  assert.match(migration, /RETURN NEW;/u);
  assert.match(
    migration,
    /CREATE TRIGGER "PageTemplateVersion_immutable_update"\s+BEFORE UPDATE ON "PageTemplateVersion"\s+FOR EACH ROW\s+EXECUTE FUNCTION "reject_page_template_version_update"\(\);/u,
  );
});

test('PageTemplateVersion provenance foreign keys retain ON DELETE SET NULL', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /FOREIGN KEY \("sourcePageId"\) REFERENCES "Page"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("createdById"\) REFERENCES "User"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/u,
  );
});

test('immutable version protection preserves Space and template delete cascades', async () => {
  const migration = await read('apps/server/prisma/migrations/20260825150000_add_page_templates/migration.sql');
  assert.match(
    migration,
    /FOREIGN KEY \("spaceId"\) REFERENCES "Space"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("templateId"\) REFERENCES "PageTemplate"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/u,
  );
});
