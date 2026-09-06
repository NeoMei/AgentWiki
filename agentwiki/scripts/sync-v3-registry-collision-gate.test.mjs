import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const candidates = [{ name: '@neomei/agentwiki-local-sync', version: '0.9.0' }];

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

test('release manifests and the explicit registry command check only unpublished Local Sync', async () => {
  const [root, protocol, localSync] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../packages/sync-protocol/package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../packages/local-sync/package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  assert.equal(protocol.version, '0.6.0');
  assert.equal(localSync.version, '0.9.0');
  assert.equal(localSync.dependencies[protocol.name], '0.6.0');
  assert.equal(root.devDependencies.semver, '7.8.5');
  assert.equal(
    root.scripts['test:release:sync-v3-registry'],
    'node scripts/sync-v3-registry-collision-gate.mjs --registry=https://registry.npmjs.org/',
  );
  const { releaseCandidates } = await loadGate();
  assert.deepEqual(await releaseCandidates(), candidates);
});

test('deployment runbook gates Local Sync publication on candidate registry-protocol install', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const runbook = readme.replace(/\s+/gu, ' ').toLowerCase();
  const orderedMarkers = [
    'publish sync-protocol 0.6.0 first',
    '`pnpm test:release:sync-protocol-registry-parity`',
    '`pnpm test:package:local-sync-registry-protocol`',
    'publish local sync 0.9.0',
    'npm install --prefix <empty-install-dir>',
    '<empty-install-dir>/node_modules/.bin/agentwiki-local-sync --help',
  ];
  let previous = -1;
  for (const marker of orderedMarkers) {
    const index = runbook.indexOf(marker);
    assert.ok(index >= 0, `deployment runbook must include ${marker}`);
    assert.ok(index > previous, `deployment runbook must order ${marker} after the prior gate`);
    previous = index;
  }
  assert.match(readme, /`pnpm test:release:sync-v3-registry`/u);
  assert.match(
    readme,
    /deployment remains blocked\s+until both packages are publicly available and pass their post-publication gates/iu,
  );
});

test('registry collision gate rejects an occupied candidate', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  await withRegistry((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    assert.match(request.url ?? '', /local-sync/u);
    response.end(JSON.stringify({ versions: { '0.9.0': {} } }));
  }, async (registryUrl) => {
    await assert.rejects(
      assertNpmReleaseCandidatesAvailable({ registryUrl, candidates }),
      /already exists/u,
    );
  });
});

test('registry collision gate accepts the Local Sync candidate after its version list is fetched', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  const requested = [];
  await withRegistry((request, response) => {
    requested.push(request.url);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ versions: { '0.5.0': {}, '0.7.0': {} } }));
  }, async (registryUrl) => {
    const result = await assertNpmReleaseCandidatesAvailable({ registryUrl, candidates });
    assert.deepEqual(result, { registryUrl, candidates });
    assert.equal(requested.length, 1);
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

async function assertMetadataRejected(metadata) {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => metadata,
  });
  await assert.rejects(
    assertNpmReleaseCandidatesAvailable({
      registryUrl: 'https://registry.example.test/',
      candidates: [candidates[0]],
      fetchImpl,
    }),
    /valid registry metadata/u,
  );
}

test('registry collision gate rejects metadata without a versions object', async () => {
  await assertMetadataRejected({});
});

test('registry collision gate rejects an empty versions object', async () => {
  await assertMetadataRejected({ versions: {} });
});

test('registry collision gate rejects a versions object without a strict semver key', async () => {
  await assertMetadataRejected({ versions: { 'not-semver': {} } });
});

test('registry collision gate accepts metadata with at least one strict semver key', async () => {
  const { assertNpmReleaseCandidatesAvailable } = await loadGate();
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ versions: { 'not-semver': {}, '0.5.0': {} } }),
  });
  const result = await assertNpmReleaseCandidatesAvailable({
    registryUrl: 'https://registry.example.test/',
    candidates: [candidates[0]],
    fetchImpl,
  });
  assert.deepEqual(result.candidates, [candidates[0]]);
});

test('registry collision gate rejects metadata for a different package name', async () => {
  await assertMetadataRejected({
    name: '@neomei/not-the-requested-package',
    versions: { '0.5.0': {} },
  });
});

test('registry collision gate rejects null and array versions values', async () => {
  await assertMetadataRejected({ versions: null });
  await assertMetadataRejected({ versions: ['0.5.0'] });
});

test('registry collision gate rejects a prototype-trick versions object', async () => {
  const inheritedVersions = Object.create({ '0.5.0': {} });
  inheritedVersions['0.4.0'] = {};
  await assertMetadataRejected({ versions: inheritedVersions });
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
