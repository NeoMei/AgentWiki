import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  expectedMarkdownTestDatabaseIdentity,
  validateMarkdownTestDatabaseUrl,
  withMarkdownTestDatabase,
} from './markdown-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const baseDatabaseUrl = process.env.MARKDOWN_TEST_DATABASE_URL;

function createAdminClient(databaseUrl) {
  const administrativeUrl = validateMarkdownTestDatabaseUrl(databaseUrl);
  administrativeUrl.searchParams.delete('schema');
  return new PrismaClient({ datasources: { db: { url: administrativeUrl.toString() } } });
}

test('Markdown database URLs fail closed', () => {
  assert.throws(() => validateMarkdownTestDatabaseUrl(undefined), /required/iu);
  assert.throws(
    () => validateMarkdownTestDatabaseUrl('mysql://localhost/agentwiki_test'),
    /PostgreSQL/iu,
  );
  assert.throws(
    () => validateMarkdownTestDatabaseUrl('postgresql://localhost/agentwiki'),
    /database name.*test/iu,
  );

  for (const repeatedSchema of [
    'schema=markdown_test_one&schema=markdown_test_two',
    'schema=markdown_test_safe&schema=public',
    'schema=public&schema=markdown_test_safe',
    'schema=&schema=markdown_test_safe',
  ]) {
    assert.throws(
      () => validateMarkdownTestDatabaseUrl(
        `postgresql://localhost/agentwiki_test?${repeatedSchema}`,
      ),
      /schema/iu,
    );
  }

  for (const schema of ['', 'public', 'markdown_test_UPPER', 'markdown-test-hyphen']) {
    assert.throws(
      () => validateMarkdownTestDatabaseUrl(
        `postgresql://localhost/agentwiki_test?schema=${encodeURIComponent(schema)}`,
      ),
      /schema/iu,
    );
  }

  assert.doesNotThrow(
    () => validateMarkdownTestDatabaseUrl('postgresql://localhost/agentwiki_test'),
  );
  assert.doesNotThrow(
    () => validateMarkdownTestDatabaseUrl(
      'postgresql://localhost/agentwiki_test?schema=markdown_test_existing_1',
    ),
  );

  const unixSocketUrl = validateMarkdownTestDatabaseUrl(
    'postgresql://neomei@/agentwiki_collaboration_test?host=/tmp',
  );
  assert.equal(unixSocketUrl.hostname, 'localhost');
  assert.equal(unixSocketUrl.username, 'neomei');
  assert.equal(unixSocketUrl.pathname, '/agentwiki_collaboration_test');
  assert.equal(unixSocketUrl.searchParams.get('host'), '/tmp');

  for (const nonSocketEmptyAuthority of [
    'postgresql://neomei@/agentwiki_collaboration_test',
    'postgresql://neomei@/agentwiki_collaboration_test?host=localhost',
    'postgresql://neomei@/agentwiki_collaboration_test?host=/tmp&host=/var/run/postgresql',
  ]) {
    assert.throws(
      () => validateMarkdownTestDatabaseUrl(nonSocketEmptyAuthority),
      /valid PostgreSQL URL/iu,
    );
  }
});

test('Markdown database identity expectations derive from socket and TCP test URLs', () => {
  assert.deepEqual(
    expectedMarkdownTestDatabaseIdentity(
      'postgresql://neomei@/agentwiki_collaboration_test?host=/tmp',
    ),
    { database: 'agentwiki_collaboration_test', role: 'neomei', unixSocket: true },
  );
  assert.deepEqual(
    expectedMarkdownTestDatabaseIdentity(
      'postgresql://ci_markdown@127.0.0.1/ci_markdown_test',
    ),
    { database: 'ci_markdown_test', role: 'ci_markdown', unixSocket: false },
  );
});

test('attachment migration enforces Space-scoped names, metadata checks, and delete behavior', {
  skip: baseDatabaseUrl ? false : 'MARKDOWN_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withMarkdownTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^markdown_test_[a-z0-9_]+$/u);
    assert.notEqual(schemaName, 'public');
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = schemaName.replace('markdown_test_', '');
    const ids = Object.fromEntries(
      ['user1', 'user2', 'space1', 'space2'].map((name) => [name, `${name}_${suffix}`]),
    );
    const activeAttachment = {
      displayName: 'Logo.PNG',
      nameKey: 'logo.png',
      contentHash: 'a'.repeat(64),
      storageKey: `aa/${'a'.repeat(64)}`,
      mimeType: 'image/png',
      sizeBytes: 128n,
      width: 64,
      height: 32,
    };

    const expectedIdentity = expectedMarkdownTestDatabaseIdentity(baseDatabaseUrl);
    try {
      const session = await prisma.$queryRawUnsafe(
        `SELECT current_database() AS database, current_user AS role,
                current_schema() AS schema, current_setting('search_path') AS search_path,
                inet_server_addr() IS NULL AS unix_socket`,
      );
      assert.equal(session[0].schema, schemaName);
      assert.equal(session[0].database, expectedIdentity.database);
      assert.equal(session[0].role, expectedIdentity.role);
      assert.equal(session[0].unix_socket, expectedIdentity.unixSocket);
      assert.match(session[0].search_path, new RegExp(schemaName, 'u'));

      const guards = await prisma.$queryRawUnsafe(
        `SELECT conname AS name FROM pg_constraint
         WHERE connamespace = $1::regnamespace AND conname IN (
           'SpaceAttachment_hash_check', 'SpaceAttachment_size_check',
           'SpaceAttachment_dimensions_check', 'SpaceAttachment_state_check'
         )
         UNION ALL
         SELECT indexname AS name FROM pg_indexes
         WHERE schemaname = $1 AND indexname IN (
           'SpaceAttachment_spaceId_nameKey_key',
           'SpaceAttachment_spaceId_status_updatedAt_idx',
           'SpaceAttachment_contentHash_idx',
           'SpaceAttachment_status_archivedAt_idx'
         )
         ORDER BY name`,
        schemaName,
      );
      assert.deepEqual(guards.map(({ name }) => name), [
        'SpaceAttachment_contentHash_idx',
        'SpaceAttachment_dimensions_check',
        'SpaceAttachment_hash_check',
        'SpaceAttachment_size_check',
        'SpaceAttachment_spaceId_nameKey_key',
        'SpaceAttachment_spaceId_status_updatedAt_idx',
        'SpaceAttachment_state_check',
        'SpaceAttachment_status_archivedAt_idx',
      ]);

      await prisma.user.createMany({ data: [
        { id: ids.user1, email: `${ids.user1}@markdown.test` },
        { id: ids.user2, email: `${ids.user2}@markdown.test` },
      ] });
      await prisma.space.createMany({ data: [
        { id: ids.space1, name: 'Space 1', slug: ids.space1 },
        { id: ids.space2, name: 'Space 2', slug: ids.space2 },
      ] });

      const first = await prisma.spaceAttachment.create({ data: {
        ...activeAttachment,
        id: `attachment1_${suffix}`,
        spaceId: ids.space1,
        uploadedByUserId: ids.user1,
      } });
      assert.equal(first.status, 'active');
      assert.equal(first.archivedAt, null);

      await assert.rejects(
        prisma.spaceAttachment.create({ data: {
          ...activeAttachment,
          id: `duplicate_${suffix}`,
          displayName: ' logo.png ',
          contentHash: 'b'.repeat(64),
          storageKey: `bb/${'b'.repeat(64)}`,
          spaceId: ids.space1,
        } }),
        /P2002|unique constraint/iu,
      );

      const crossSpace = await prisma.spaceAttachment.create({ data: {
        ...activeAttachment,
        id: `attachment2_${suffix}`,
        contentHash: 'c'.repeat(64),
        storageKey: `cc/${'c'.repeat(64)}`,
        spaceId: ids.space2,
        uploadedByUserId: ids.user2,
      } });
      assert.equal(crossSpace.nameKey, first.nameKey);

      const invalidAttachments = [
        ['hash', { contentHash: 'A'.repeat(64) }],
        ['size', { sizeBytes: 0n }],
        ['width', { width: 0 }],
        ['height', { height: -1 }],
        ['active-state', { archivedAt: new Date('2026-08-26T00:00:00.000Z') }],
        ['archived-state', { status: 'archived' }],
      ];
      for (const [name, overrides] of invalidAttachments) {
        await assert.rejects(
          prisma.spaceAttachment.create({ data: {
            ...activeAttachment,
            ...overrides,
            id: `invalid_${name}_${suffix}`,
            displayName: `${name}.png`,
            nameKey: `${name}.png`,
            contentHash: overrides.contentHash ?? 'd'.repeat(64),
            storageKey: `${name}/${'d'.repeat(64)}`,
            spaceId: ids.space1,
          } }),
          /check|constraint/iu,
          `${name} must be rejected`,
        );
      }

      const archived = await prisma.spaceAttachment.create({ data: {
        ...activeAttachment,
        id: `archived_${suffix}`,
        displayName: 'Archived.png',
        nameKey: 'archived.png',
        contentHash: 'e'.repeat(64),
        storageKey: `ee/${'e'.repeat(64)}`,
        status: 'archived',
        archivedAt: new Date('2026-08-26T00:00:00.000Z'),
        spaceId: ids.space1,
      } });
      assert.equal(archived.status, 'archived');
      assert.ok(archived.archivedAt);

      await prisma.user.delete({ where: { id: ids.user1 } });
      const uploaderCleared = await prisma.spaceAttachment.findUniqueOrThrow({
        where: { id: first.id },
        select: { uploadedByUserId: true },
      });
      assert.equal(uploaderCleared.uploadedByUserId, null);

      await prisma.space.delete({ where: { id: ids.space1 } });
      assert.equal(
        await prisma.spaceAttachment.count({ where: { spaceId: ids.space1 } }),
        0,
      );
      assert.equal(
        await prisma.spaceAttachment.count({ where: { id: crossSpace.id } }),
        1,
      );
    } finally {
      await prisma.$disconnect();
    }
  });
});

test('Markdown test schemas are removed when the callback fails', {
  skip: baseDatabaseUrl ? false : 'MARKDOWN_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  let failedSchemaName;
  await assert.rejects(
    withMarkdownTestDatabase(baseDatabaseUrl, async ({ schemaName }) => {
      failedSchemaName = schemaName;
      assert.match(schemaName, /^markdown_test_[a-z0-9_]+$/u);
      throw new Error('deliberate callback failure');
    }),
    /deliberate callback failure/iu,
  );

  assert.ok(failedSchemaName);
  const admin = createAdminClient(baseDatabaseUrl);
  try {
    const remaining = await admin.$queryRawUnsafe(
      'SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = $1',
      failedSchemaName,
    );
    assert.equal(remaining[0].count, 0);
  } finally {
    await admin.$disconnect();
  }
});
