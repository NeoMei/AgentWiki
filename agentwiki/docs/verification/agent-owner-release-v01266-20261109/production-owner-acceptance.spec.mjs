import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { assertFixtureMutation, initializeLanguage, noExecution, redact, validateOrigin } from './production-owner-acceptance.mjs';
import { createFixtureRequester } from '../notes-release-v01264-20261028/browser-request-policy.mjs';

function fixture() {
  const owner = { id: 'u-own', token: 'fixture-token', label: 'owner', email: 'owner@example.test', password: 'fixture-password' };
  const peer = { id: 'u-peer', token: 'fixture-peer-token', label: 'peer', email: 'peer@example.test', password: 'fixture-password' };
  const state = { prefix: 'aw66-test', ownerName: 'aw66-test-same-owner', agentName: 'aw66-test same-agent', spaceName: 'aw66-test owner-qa', owner, peer,
    accounts: [owner, peer], spaces: [{ id: 's-own', owner }], agents: [{ id: 'a-own', owner }, { id: 'a-peer', owner: peer }], grants: [{ agentId: 'a-own', spaceId: 's-own', owner }] };
  return { state, owner, peer };
}

test('owned fixture creation and cleanup are allowed but foreign ownership and body expansion are rejected', () => {
  const { state, owner, peer } = fixture();
  assert.doesNotThrow(() => assertFixtureMutation(state, owner, '/spaces', 'POST', { name: state.spaceName, approvalPolicy: 'no-review' }));
  assert.doesNotThrow(() => assertFixtureMutation(state, peer, '/agents/a-peer/grants/s-own', 'PUT', { role: 'editor' }));
  assert.doesNotThrow(() => assertFixtureMutation(state, owner, '/agents/a-own/grants/s-own', 'DELETE'));
  assert.doesNotThrow(() => assertFixtureMutation(state, owner, '/users/u-own', 'DELETE'));
  assert.throws(() => assertFixtureMutation(state, peer, '/spaces/s-own', 'DELETE'));
  assert.throws(() => assertFixtureMutation(state, peer, '/agents/a-own', 'DELETE'));
  assert.throws(() => assertFixtureMutation(state, owner, '/agents/a-own/grants/s-foreign', 'PUT', { role: 'editor' }));
  assert.throws(() => assertFixtureMutation(state, owner, '/agents/a-own/grants/s-own', 'PUT', { role: 'publisher' }));
  assert.throws(() => assertFixtureMutation(state, owner, '/spaces', 'POST', { name: state.spaceName, approvalPolicy: 'no-review', privateExistingId: 'foreign' }));
});

test('registration is pinned to the disposable actor and same-owner display name', () => {
  const { state, owner } = fixture();
  assert.doesNotThrow(() => assertFixtureMutation(state, owner, '/auth/register', 'POST', { email: owner.email, password: owner.password, name: state.ownerName }));
  assert.throws(() => assertFixtureMutation(state, owner, '/auth/register', 'POST', { email: 'someone-else@example.test', password: owner.password, name: state.ownerName }));
  assert.throws(() => assertFixtureMutation(state, owner, '/auth/register', 'POST', { email: owner.email, password: owner.password, name: 'existing user' }));
  assert.throws(() => assertFixtureMutation({ ...state, ownerName: 'invalid whitespace' }, owner, '/auth/register', 'POST', { email: owner.email, password: owner.password, name: 'invalid whitespace' }));
  assert.throws(() => assertFixtureMutation(state, { ...owner }, '/auth/login', 'POST', { email: owner.email, password: owner.password }));
});

test('new isolated profiles default to English while selected Chinese survives later page loads', () => {
  const items = new Map(), storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  initializeLanguage(storage);
  assert.equal(storage.getItem('agentwiki.language.v1'), 'en');
  storage.setItem('agentwiki.language.v1', 'zh-CN'); initializeLanguage(storage);
  assert.equal(storage.getItem('agentwiki.language.v1'), 'zh-CN');
});

test('initial opaque browser documents do not attempt to access localStorage', () => {
  assert.doesNotThrow(() => runInNewContext(`(${initializeLanguage.toString()})()`, {
    location: { protocol: 'about:' },
    get localStorage() { throw new Error('Opaque document storage is denied'); },
  }));
});

test('binding reads are allowed while credentials, saves, Runs, model and Agent execution are blocked', () => {
  const { state, owner } = fixture();
  assert.equal(noExecution('/spaces/s-own/pages/p-own/agent-binding'), true);
  for (const path of ['/agents/a-own/credentials', '/agents/a-own/credentials/c1', '/spaces/s-own/pages/p-own/collaboration-runs', '/assist', '/agent-sessions/x', '/mcp', '/models', '/chat/completions']) assert.equal(noExecution(path), false, path);
  assert.throws(() => assertFixtureMutation(state, owner, '/spaces/s-own/pages/p-own/agent-binding', 'PUT', { agentId: 'a-own' }));
  assert.throws(() => assertFixtureMutation(state, owner, '/pages', 'POST', { title: 'disposable', content: 'embedding must not run', spaceId: 's-own', expectedTreeRevision: '1' }));
  assert.throws(() => assertFixtureMutation(state, owner, '/pages/p-own', 'DELETE', { expectedUpdatedAt: '2026-11-09', expectedTreeRevision: '1' }));
});

test('only production and bare loopback origins are accepted', () => {
  assert.equal(validateOrigin('https://agentwiki.quukk.com').production, true);
  assert.equal(validateOrigin('http://127.0.0.1:5187').production, false);
  for (const origin of ['https://example.com', 'https://user:secret@agentwiki.quukk.com', 'https://agentwiki.quukk.com/api', 'https://agentwiki.quukk.com?token=value']) assert.throws(() => validateOrigin(origin));
});

test('public receipt strings redact fixture credentials and arbitrary emails', () => {
  assert.equal(redact('owner@example.test Bearer unlisted-token password-value', ['password-value']), '[redacted-email] Bearer [redacted] [redacted]');
});

test('production fixture requester retries throttled reads but sends every mutation only once', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    let count = 0;
    const request = createFixtureRequester({ fetchImpl: async () => { count++; return new Response('{}', { status: 429 }); }, waitImpl: async () => {} });
    assert.equal((await request('http://fixture.test', { method })).status, 429); assert.equal(count, 1);
  }
  let count = 0;
  const request = createFixtureRequester({ fetchImpl: async () => new Response('{}', { status: ++count === 1 ? 429 : 200, headers: { 'retry-after': '0' } }), waitImpl: async () => {} });
  assert.equal((await request('http://fixture.test', { method: 'GET' })).status, 200); assert.equal(count, 2);
});
