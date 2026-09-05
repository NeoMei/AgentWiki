import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const candidates = [
  { name: '@neomei/agentwiki-sync-protocol', version: '0.5.1' },
  { name: '@neomei/agentwiki-local-sync', version: '0.8.0' },
];

async function loadGate() {
  return import('./sync-v3-registry-collision-gate.mjs');
}

async function withRegistry(handler, operation) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    return await operation(`http://127.0.0.1:${address.port}/`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('release manifests and the explicit registry command use the unoccupied candidates', async () => {
  const [root, protocol, localSync] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../packages/sync-protocol/package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../packages/local-sync/package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  assert.equal(protocol.version, '0.5.1');
  assert.equal(localSync.version, '0.8.0');
  assert.equal(localSync.dependencies[protocol.name], '0.5.1');
  assert.equal(
    root.scripts['test:release:sync-v3-registry'],
    'node scripts/sync-v3-registry-collision-gate.mjs --registry=https://registry.npmjs.org/',
  );
});

test('registry collision gate rejects an occupied candidate', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  await withRegistry((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    const occupied = request.url?.includes('sync-protocol');
    response.end(JSON.stringify({ versions: occupied ? { '0.5.1': {} } : { '0.7.0': {} } }));
  }, async (registryUrl) => {
    await assert.rejects(
      assertNpmReleaseCandidatesAvailable({ registryUrl, candidates }),
      /already exists/u,
    );
  });
});

test('registry collision gate accepts candidates only after both version lists are fetched', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  const requested = [];
  await withRegistry((request, response) => {
    requested.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ versions: { '0.5.0': {}, '0.7.0': {} } }));
  }, async (registryUrl) => {
    const result = await assertNpmReleaseCandidatesAvailable({ registryUrl, candidates });
    assert.deepEqual(result, { registryUrl, candidates });
    assert.equal(requested.length, 2);
  });
});

test('registry collision gate fails closed on non-2xx responses', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  await withRegistry((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'authentication required' }));
  }, async (registryUrl) => {
    await assert.rejects(
      assertNpmReleaseCandidatesAvailable({ registryUrl, candidates }),
      /status 401/u,
    );
  });
});

test('registry collision gate fails closed on malformed metadata', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  await withRegistry((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{not-json');
  }, async (registryUrl) => {
    await assert.rejects(
      assertNpmReleaseCandidatesAvailable({ registryUrl, candidates }),
      /valid registry metadata/u,
    );
  });
});

test('registry collision gate fails closed on network errors and an omitted registry URL', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.equal(typeof address, 'object');
  server.close();
  await once(server, 'close');

  await assert.rejects(
    assertNpmReleaseCandidatesAvailable({
      registryUrl: `http://127.0.0.1:${address.port}/`, candidates,
    }),
    /request failed/u,
  );
  await assert.rejects(
    assertNpmReleaseCandidatesAvailable({ registryUrl: '', candidates }),
    /explicit registry URL/u,
  );
});
