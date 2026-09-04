import assert from 'node:assert/strict';
import test from 'node:test';
import * as pgvectorDatabase from './pgvector-test-database.mjs';

test('pgvector database URLs require an unambiguous loopback host', () => {
  for (const unsafeHost of [
    '203.0.113.10',
    'localhost.evil',
    '2130706433',
    '0x7f000001',
  ]) {
    assert.throws(
      () => pgvectorDatabase.validatePgvectorTestDatabaseUrl(
        `postgresql://${unsafeHost}/agentwiki_test`,
      ),
      /loopback/iu,
    );
  }
  for (const loopbackHost of ['localhost', '127.42.0.9', '[0:0:0:0:0:0:0:1]']) {
    assert.doesNotThrow(
      () => pgvectorDatabase.validatePgvectorTestDatabaseUrl(
        `postgresql://${loopbackHost}/agentwiki_test`,
      ),
    );
  }
});

test('pgvector preflight rejects a missing or non-public vector extension', async () => {
  assert.equal(typeof pgvectorDatabase.assertPgvectorDatabaseSafetyPreflight, 'function');
  await assert.rejects(
    pgvectorDatabase.assertPgvectorDatabaseSafetyPreflight({ $queryRaw: async () => [] }),
    /vector extension must be preconfigured in public/iu,
  );
  await assert.rejects(
    pgvectorDatabase.assertPgvectorDatabaseSafetyPreflight({
      $queryRaw: async () => [{ name: 'vector', schema: 'private' }],
    }),
    /vector extension must be preconfigured in public/iu,
  );
});

test('pgvector index selection ignores a same-named public index', () => {
  assert.equal(typeof pgvectorDatabase.selectPgvectorIndexForSchema, 'function');
  const selected = pgvectorDatabase.selectPgvectorIndexForSchema([
    {
      schemaName: 'public',
      indexName: 'Page_embeddingVector_hnsw',
      indexDefinition: 'CREATE INDEX public-decoy',
      options: ['m=1'],
    },
    {
      schemaName: 'pgvector_test_target',
      indexName: 'Page_embeddingVector_hnsw',
      indexDefinition: 'CREATE INDEX target',
      options: ['m=32', 'ef_construction=256'],
    },
  ], 'pgvector_test_target', 'Page_embeddingVector_hnsw');
  assert.deepEqual(selected, {
    schemaName: 'pgvector_test_target',
    indexName: 'Page_embeddingVector_hnsw',
    indexDefinition: 'CREATE INDEX target',
    options: ['m=32', 'ef_construction=256'],
  });
});
