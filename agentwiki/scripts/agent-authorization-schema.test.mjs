import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../apps/server/prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL(
  '../apps/server/prisma/migrations/20260823090000_bind_agent_credentials_to_grants/migration.sql',
  import.meta.url,
);
const deploymentUrl = new URL(
  '../docs/operations/unified-agent-access-roles-0.5.0-deployment.md',
  import.meta.url,
);
const deployScriptUrl = new URL('../deploy.sh', import.meta.url);

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

test('breaking authorization migration stops old API and Worker processes before dropping columns', async () => {
  const deployment = await readFile(deploymentUrl, 'utf8');
  const stop = deployment.indexOf('Stop and drain the existing AgentWiki API and Worker processes');
  const migrate = deployment.indexOf('Apply Prisma migrations while the old API and Worker remain stopped');
  const start = deployment.indexOf('start only the newly built AgentWiki API and Worker');

  assert.ok(stop >= 0, 'deployment gate must stop and drain old processes');
  assert.ok(migrate > stop, 'migration must happen after old processes stop');
  assert.ok(start > migrate, 'new processes must start only after migration');
});

test('the real deploy entry builds in staging, stops old processes, migrates, then atomically activates', async () => {
  const deploy = await readFile(deployScriptUrl, 'utf8');
  const stagedBuild = deploy.indexOf('Build and verify the staged release before stopping production.');
  const stop = deploy.indexOf('systemctl --user stop agentwiki-api.service agentwiki-worker.service agentwiki-frontend.service');
  const drain = deploy.indexOf('Old AgentWiki node processes did not stop; refusing schema migration.');
  const migrate = deploy.indexOf('pnpm --filter @agentwiki/server exec prisma migrate deploy');
  const activate = deploy.indexOf('mv -- "\\$release_dir" "\\$live_dir"');
  const restart = deploy.indexOf('systemctl --user restart agentwiki-api.service');

  assert.ok(stagedBuild >= 0, 'deploy must prepare a staged release');
  assert.ok(stop > stagedBuild, 'old processes stop only after the staged build is ready');
  assert.ok(drain > stop, 'legacy node processes must be drained after service stop');
  assert.ok(migrate > drain, 'migration must wait for every old AgentWiki node process to exit');
  assert.ok(migrate > stop, 'breaking migration must run after old processes stop');
  assert.ok(activate > migrate, 'the staged release activates only after migration');
  assert.ok(restart > activate, 'only the new release may restart');
  assert.doesNotMatch(deploy, /rsync[^\n]+release_dir\/apps[^\n]+PROJECT_DIR/u);
  const migrationStarted = deploy.indexOf('migration_started=1');
  assert.ok(migrationStarted > drain, 'staging preservation begins only after old processes drain');
  assert.ok(migrationStarted < migrate, 'staging must be preserved before migration can change the database');
  assert.match(deploy, /migration_started:-0/u, 'every attempted migration must preserve the staged release');
  assert.match(deploy, /Failed to activate staged release/u, 'activation failure must be explicit');
  assert.match(deploy, /mv -- "\\\$previous_dir" "\\\$live_dir"/u, 'failed activation must restore the live path');
});
