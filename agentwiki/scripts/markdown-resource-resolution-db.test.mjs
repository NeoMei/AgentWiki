import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withMarkdownTestDatabase } from './markdown-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { foldCase } = requireFromServer('@neomei/agentwiki-sync-protocol');
const baseDatabaseUrl = process.env.MARKDOWN_TEST_DATABASE_URL;

test('page identity migration matches Unicode 15.1 folding and exposes indexed lookups', {
  skip: baseDatabaseUrl ? false : 'MARKDOWN_TEST_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  await withMarkdownTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    const prisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: [{ emit: 'event', level: 'query' }],
    });
    try {
      const parityCases = [
        [' Trimmed Title ', 'trimmed title'],
        ['Stra\u00dfe', 'strasse'],
        ['\u039f\u03a3', '\u03bf\u03c3'],
        ['Cafe\u0301', 'caf\u00e9'],
        ['\u00a0\u3000Padded\ufeff', 'padded'],
      ];
      for (const [input, expected] of parityCases) {
        const [row] = await prisma.$queryRawUnsafe(
          'SELECT markdown_page_identity($1) AS identity',
          input,
        );
        assert.equal(row.identity, expected, `database identity mismatch for ${JSON.stringify(input)}`);
      }
      const caseFoldingSource = await readFile(new URL(
        '../packages/sync-protocol/src/unicode/case-folding-data.ts', import.meta.url,
      ), 'utf8');
      const serializedMap = caseFoldingSource.match(/new Map\((\[[\s\S]*\])\);\s*$/u)?.[1];
      assert.ok(serializedMap, 'Unicode 15.1 case-folding map must be readable');
      const everyMappedCharacter = JSON.parse(serializedMap)
        .map(([codePoint]) => String.fromCodePoint(codePoint)).join('');
      const [completeParity] = await prisma.$queryRawUnsafe(
        'SELECT markdown_page_identity($1) AS identity',
        everyMappedCharacter,
      );
      assert.equal(
        completeParity.identity,
        foldCase(everyMappedCharacter.normalize('NFC').trim()),
      );
      const [functionContract] = await prisma.$queryRawUnsafe(
        `SELECT p.provolatile AS volatility, p.proparallel AS parallel,
                p.proisstrict AS strict, p.prosecdef AS security_definer
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = $1 AND p.proname = 'markdown_page_identity'`,
        schemaName,
      );
      assert.deepEqual(functionContract, {
        volatility: 'i', parallel: 's', strict: true, security_definer: false,
      });

      const indexes = await prisma.$queryRawUnsafe(
        `SELECT indexname AS name, indexdef AS definition
         FROM pg_indexes
         WHERE schemaname = $1 AND indexname IN (
           'Page_spaceId_slugMarkdownIdentity_idx',
           'Page_spaceId_titleMarkdownIdentity_idx',
           'Page_spaceId_syncPathMarkdownIdentity_idx'
         )
         ORDER BY indexname`,
        schemaName,
      );
      assert.deepEqual(indexes.map(({ name }) => name), [
        'Page_spaceId_slugMarkdownIdentity_idx',
        'Page_spaceId_syncPathMarkdownIdentity_idx',
        'Page_spaceId_titleMarkdownIdentity_idx',
      ]);
      for (const { definition } of indexes) {
        assert.match(definition, /markdown_page_identity/iu);
        assert.match(definition, /WHERE \("deletedAt" IS NULL\)/u);
      }

      const userId = `markdown_user_${schemaName}`;
      const spaceId = `markdown_space_${schemaName}`;
      await prisma.user.create({ data: { id: userId, email: `${userId}@example.test` } });
      await prisma.space.create({ data: { id: spaceId, name: 'Markdown resolver', slug: spaceId } });
      await prisma.spaceMember.create({ data: { userId, spaceId, role: 'viewer' } });
      await prisma.page.createMany({ data: [
        {
          id: `trim-title_${schemaName}`, spaceId, authorId: userId,
          title: ' Trimmed Title ', slug: `trim-title-${schemaName}`,
          syncPath: 'Trimmed Title.md', syncPathKey: 'trimmed title.md',
        },
        {
          id: `trim-slug_${schemaName}`, spaceId, authorId: userId,
          title: 'Trimmed slug', slug: ' trim-slug ',
          syncPath: 'Trimmed slug.md', syncPathKey: 'trimmed slug.md',
        },
        {
          id: `unicode-path_${schemaName}`, spaceId, authorId: userId,
          title: 'Unicode path', slug: `unicode-path-${schemaName}`,
          syncPath: 'Stra\u00dfe/Guide.md', syncPathKey: 'strasse/guide.md',
        },
        {
          id: `trim-path_${schemaName}`, spaceId, authorId: userId,
          title: 'Trimmed path', slug: `trim-path-${schemaName}`,
          syncPath: ' Guide.md', syncPathKey: ' guide.md',
        },
        {
          id: `unicode-title_${schemaName}`, spaceId, authorId: userId,
          title: 'Stra\u00dfe', slug: `unicode-title-${schemaName}`,
          syncPath: 'Unicode title.md', syncPathKey: 'unicode title.md',
        },
        {
          id: `unicode-slug_${schemaName}`, spaceId, authorId: userId,
          title: 'Unicode slug', slug: '\u039f\u03a3',
          syncPath: 'Unicode slug.md', syncPathKey: 'unicode slug.md',
        },
        {
          id: `nfd-title_${schemaName}`, spaceId, authorId: userId,
          title: 'Cafe\u0301', slug: `nfd-title-${schemaName}`,
          syncPath: 'NFD title.md', syncPathKey: 'nfd title.md',
        },
      ] });
      await prisma.spaceAttachment.create({ data: {
        id: `attachment_${schemaName}`, spaceId, displayName: 'Diagram.png',
        nameKey: 'diagram.png', contentHash: 'a'.repeat(64),
        storageKey: `aa/${'a'.repeat(64)}`, mimeType: 'image/png',
        sizeBytes: 128n, width: 16, height: 8,
      } });

      const queries = [];
      prisma.$on('query', ({ query }) => queries.push(query));
      const { AuthorizationService } = await import(
        '../apps/server/dist/core/authorization/authorization.service.js'
      );
      const { MarkdownResourceService } = await import(
        '../apps/server/dist/markdown-resources/markdown-resource.service.js'
      );
      const resolver = new MarkdownResourceService(prisma, new AuthorizationService(prisma));
      const results = await resolver.resolve(spaceId, [
        { key: 'trim-title', kind: 'page', target: 'Trimmed Title' },
        { key: 'trim-slug', kind: 'page', target: 'trim-slug' },
        { key: 'unicode-path', kind: 'page', target: 'Stra\u00dfe/Guide.md' },
        { key: 'trim-path', kind: 'page', target: ' Guide.md ' },
        { key: 'unicode-title', kind: 'page', target: 'STRASSE' },
        { key: 'unicode-slug', kind: 'page', target: '\u03bf\u03c3' },
        { key: 'nfc-title', kind: 'page', target: 'CAF\u00c9' },
        { key: 'attachment', kind: 'attachment', target: 'diagram.png' },
      ], { userId });

      assert.deepEqual(results.map(({ key, status, kind }) => ({ key, status, kind })), [
        { key: 'trim-title', status: 'resolved', kind: 'page' },
        { key: 'trim-slug', status: 'resolved', kind: 'page' },
        { key: 'unicode-path', status: 'resolved', kind: 'page' },
        { key: 'trim-path', status: 'resolved', kind: 'page' },
        { key: 'unicode-title', status: 'resolved', kind: 'page' },
        { key: 'unicode-slug', status: 'resolved', kind: 'page' },
        { key: 'nfc-title', status: 'resolved', kind: 'page' },
        { key: 'attachment', status: 'resolved', kind: 'attachment' },
      ]);
      assert.equal(queries.filter((query) => /FROM (?:(?:"[^"]+"\.)?)"Page"/u.test(query)).length, 3);
      assert.equal(queries.filter((query) => /FROM (?:(?:"[^"]+"\.)?)"SpaceAttachment"/u.test(query)).length, 1);

      const plans = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return Promise.all(['slug', 'title', 'syncPath'].map((column) => tx.$queryRawUnsafe(
          `EXPLAIN (FORMAT JSON) SELECT "id" FROM "Page"
           WHERE "spaceId" = $1 AND "deletedAt" IS NULL
             AND markdown_page_identity("${column}") IN ($2)
           LIMIT 201`,
          spaceId,
          column === 'slug' ? 'trim-slug' : 'trimmed title',
        )));
      });
      assert.match(JSON.stringify(plans[0]), /Page_spaceId_slugMarkdownIdentity_idx/u);
      assert.match(JSON.stringify(plans[1]), /Page_spaceId_titleMarkdownIdentity_idx/u);
      assert.match(JSON.stringify(plans[2]), /Page_spaceId_syncPathMarkdownIdentity_idx/u);
    } finally {
      await prisma.$disconnect();
    }
  });
});
