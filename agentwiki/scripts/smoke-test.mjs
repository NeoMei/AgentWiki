import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const PREFIX = 'AGENTWIKI_SMOKE_E2E';

async function request(apiUrl, path, { method = 'GET', token, body, expected } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (expected ? !expected.includes(response.status) : !response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}`);
  }
  return { status: response.status, data };
}

export async function runSmoke(environment = process.env) {
  const apiUrl = assertE2ETarget(
    environment.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api',
    environment,
    PREFIX,
  );
  const suffix = `${Date.now()}-${process.pid}`;
  const email = `smoke-${suffix}@example.test`;
  const password = `Smoke-${suffix}!`;
  const fixture = { userId: '', spaceId: '', agentId: '' };
  let token = '';

  try {
    const health = await request(apiUrl, '/health');
    assert.equal(health.data.status, 'ok');

    const registration = await request(apiUrl, '/auth/register', {
      method: 'POST', body: { email, password, name: 'Smoke E2E' },
    });
    token = registration.data.access_token;
    fixture.userId = registration.data.user.id;
    assert.ok(token);

    const login = await request(apiUrl, '/auth/login', {
      method: 'POST', body: { email, password },
    });
    assert.ok(login.data.access_token);
    await request(apiUrl, '/auth/login', {
      method: 'POST', body: { email, password: 'incorrect-password' }, expected: [400, 401],
    });
    await request(apiUrl, '/auth/register', {
      method: 'POST', body: { email, password, name: 'Duplicate' }, expected: [400, 409],
    });

    const space = await request(apiUrl, '/spaces', {
      method: 'POST', token, body: { name: `Smoke ${suffix}` },
    });
    fixture.spaceId = space.data.id;
    const spaces = await request(apiUrl, '/spaces', { token });
    assert.ok((spaces.data.data ?? spaces.data).some((candidate) => candidate.id === space.data.id));

    const createdPage = await request(apiUrl, '/pages', {
      method: 'POST', token,
      body: { spaceId: space.data.id, title: 'Smoke Page', content: '# Smoke\n\nTest content.' },
    });
    const listedPages = await request(apiUrl, `/pages?spaceId=${encodeURIComponent(space.data.id)}`, { token });
    const pages = listedPages.data.data ?? listedPages.data;
    const page = pages.find((candidate) => candidate.id === createdPage.data.id);
    assert.ok(page);
    await request(apiUrl, `/pages/${page.id}`, {
      method: 'PATCH', token,
      body: { content: '# Updated\n\nNew content.', expectedUpdatedAt: page.updatedAt },
    });
    const updatedPage = await request(apiUrl, `/pages/${page.id}`, { token });
    assert.match(updatedPage.data.content, /New content/);
    const versions = await request(apiUrl, `/pages/${page.id}/versions`, { token });
    assert.ok(Array.isArray(versions.data) && versions.data.length >= 1);

    const agent = await request(apiUrl, '/agents', {
      method: 'POST', token, body: { name: `Smoke ${suffix}` },
    });
    fixture.agentId = agent.data.id;
    const installation = await request(apiUrl, `/agents/${agent.data.id}/local-sync-installations`, {
      method: 'POST', token,
      body: { spaceId: space.data.id, role: 'editor', pluginVersion: '0.5.0' },
    });
    const credential = await request(apiUrl, '/integrations/local-sync/exchange', {
      method: 'POST', body: { code: installation.data.code },
    });
    assert.ok(credential.data.apiKey);
    assert.equal(credential.data.role, 'editor');
    assert.equal(credential.data.spaceId, space.data.id);

    await request(apiUrl, '/search?q=Smoke', { token });
    await request(apiUrl, `/knowledge/graph/${space.data.id}`, { token });
    const profile = await request(apiUrl, '/users/me', { token });
    assert.equal(profile.data.email, email);
    await request(apiUrl, '/integrations/mcp', { token });

    return { status: 'passed', checks: 18 };
  } finally {
    if (token) {
      await cleanupFixture(fixture, async (kind, id) => {
        const endpoint = kind === 'agent' ? `/agents/${id}` : kind === 'space' ? `/spaces/${id}` : `/users/${id}`;
        await request(apiUrl, endpoint, { method: 'DELETE', token });
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runSmoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
