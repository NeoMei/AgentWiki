import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../apps/server/prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../apps/server/prisma/migrations/20260823090000_bind_agent_credentials_to_grants/migration.sql',
  import.meta.url,
);

test('Agent Credential is an identity bound to one Grant authorization', async () => {
  const schema = await readFile(schemaUrl, 'utf8');
  const credential = schema.match(/model AgentCredential \{([\s\S]*?)\n\}/u)?.[1] ?? '';
  const grant = schema.match(/model AgentGrant \{([\s\S]*?)\n\}/u)?.[1] ?? '';

  assert.match(credential, /authorization\s+AgentGrant\s+@relation\(fields: \[authorizationId, agentId\], references: \[id, agentId\], onDelete: Cascade\)/u);
  assert.match(credential, /authorizationId\s+String/u);
  assert.doesNotMatch(credential, /^\s*(?:role|scopes)\s+/mu);
  assert.match(grant, /credentials\s+AgentCredential\[\]/u);
  assert.match(grant, /@@unique\(\[id, agentId\]\)/u);
  assert.doesNotMatch(grant, /^\s*scopes\s+/mu);
});

test('single-source migration deliberately invalidates old Credentials and removes duplicate permission state', async () => {
  const migration = await readFile(migrationUrl, 'utf8').catch(() => '');

  assert.match(migration, /DELETE FROM "AgentCredential"/u);
  assert.match(migration, /DROP COLUMN "role"/u);
  assert.match(migration, /DROP COLUMN "scopes"/u);
  assert.match(migration, /ALTER TABLE "AgentGrant"\s+DROP COLUMN "scopes"/u);
  assert.match(migration, /UNIQUE INDEX "AgentGrant_id_agentId_key"\s+ON "AgentGrant"\("id", "agentId"\)/u);
  assert.match(migration, /FOREIGN KEY \("authorizationId", "agentId"\)\s+REFERENCES "AgentGrant"\("id", "agentId"\)\s+ON DELETE CASCADE/u);
});
