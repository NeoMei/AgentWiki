import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  assertProductionSafeSyncV3Capabilities,
  assertProductionSafeSyncV3WithFreshDeviceCredential,
} from './smoke-test.mjs';

test('production smoke performs one read-only authenticated Sync v3 capabilities assertion', async () => {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      protocolVersion: '3',
      capabilitiesHash: 'a'.repeat(64),
      capabilities: { blobChunkBytes: 1_048_576 },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const result = await assertProductionSafeSyncV3Capabilities(
      `http://127.0.0.1:${address.port}/api`,
      'device-test-token',
    );
    assert.equal(result.protocolVersion, '3');
    assert.deepEqual(seen, [{
      method: 'GET',
      url: '/api/sync/v3/capabilities',
      authorization: 'Bearer device-test-token',
    }]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('production smoke provisions and activates a fresh device credential before the Sync v3 assertion', async () => {
  const humanToken = 'web-jwt-must-not-reach-sync-v3';
  const credentialId = 'credential-1';
  const seen = [];
  let issuedDeviceCredential = '';
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    seen.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });

    const created = request.url === '/api/integrations/obsidian/installations'
      || request.url === '/api/integrations/obsidian/exchange';
    response.writeHead(created ? 201 : 200, {
      'content-type': 'application/json',
    });
    if (request.url === '/api/integrations/obsidian/installations') {
      response.end(JSON.stringify({ installationId: 'installation-1', code: 'install-code' }));
      return;
    }
    if (request.url === '/api/integrations/obsidian/exchange') {
      issuedDeviceCredential = body.credential;
      response.end(JSON.stringify({ credentialId }));
      return;
    }
    if (request.url === '/api/integrations/obsidian/credentials/current/activate') {
      response.end(JSON.stringify({ credentialId, credentialStatus: 'active' }));
      return;
    }
    response.end(JSON.stringify({
      protocolVersion: '3',
      capabilitiesHash: 'b'.repeat(64),
      capabilities: { blobChunkBytes: 1_048_576 },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    assert.equal(typeof address, 'object');
    const result = await assertProductionSafeSyncV3WithFreshDeviceCredential(
      `http://127.0.0.1:${address.port}/api`,
      humanToken,
      'test-suffix',
    );
    assert.equal(result.protocolVersion, '3');
    assert.notEqual(issuedDeviceCredential, humanToken);
    assert.match(issuedDeviceCredential, /^[A-Za-z0-9_-]{43}$/u);
    assert.deepEqual(seen.map(({ method, url, authorization }) => ({ method, url, authorization })), [
      {
        method: 'POST',
        url: '/api/integrations/obsidian/installations',
        authorization: `Bearer ${humanToken}`,
      },
      {
        method: 'POST',
        url: '/api/integrations/obsidian/exchange',
        authorization: undefined,
      },
      {
        method: 'POST',
        url: '/api/integrations/obsidian/credentials/current/activate',
        authorization: `Bearer ${issuedDeviceCredential}`,
      },
      {
        method: 'GET',
        url: '/api/sync/v3/capabilities',
        authorization: `Bearer ${issuedDeviceCredential}`,
      },
    ]);
    assert.deepEqual(seen[0].body, undefined);
    assert.equal(seen[1].body.code, 'install-code');
    assert.equal(seen[1].body.credential, issuedDeviceCredential);
    assert.equal(seen[2].body.credentialId, credentialId);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
