/** Opt-in v0.12.66 QA: disposable identities only; writes are sent once; no Agent/model execution. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixtureRequester } from '../notes-release-v01264-20261028/browser-request-policy.mjs';

export const VERSION = '0.12.66';
export const noExecution = path => !/(?:\/assist(?:\/|$)|\/turns(?:\/|$)|\/chat\/completions|\/responses(?:\/|$)|\/agent-sessions|\/embedded|\/model(?:s)?(?:\/|$)|\/gateway|\/mcp(?:\/|$)|\/collaboration-runs(?:\/|$)|\/actions(?:\/|$)|\/credentials(?:\/|$))/i.test(path);
const keysOnly = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => keys.includes(key));

export function assertFixtureMutation(state, account, path, method, body) {
  if (['GET', 'HEAD'].includes(method)) return;
  if (!state.accounts.includes(account)) throw new Error('Mutation actor is not owned by this run');
  if (['/auth/register', '/auth/login'].includes(path) && method === 'POST'
    && keysOnly(body, ['email', 'password', 'name']) && body.email === account.email && body.password === account.password
    && (path.endsWith('/login') || (body.name === state.ownerName && !/\s/u.test(body.name)))) return;
  if (!account.id || !account.token) throw new Error('Mutation actor has no confirmed fixture identity');
  if (path === '/spaces' && method === 'POST' && account === state.owner && keysOnly(body, ['name', 'description', 'approvalPolicy'])
    && body.name === state.spaceName && body.approvalPolicy === 'no-review') return;
  for (const space of state.spaces.filter(item => item.owner === account)) {
    if (path === `/spaces/${space.id}` && method === 'DELETE' && body === undefined) return;
    if (path === `/spaces/${space.id}/members` && method === 'POST' && keysOnly(body, ['email', 'role'])
      && body.email === state.peer?.email && body.role === 'editor') return;
  }
  if (path === '/agents' && method === 'POST' && keysOnly(body, ['name', 'description', 'idempotencyKey'])
    && body.name === state.agentName && body.description === 'Disconnected release QA Agent; no credential is issued.'
    && body.idempotencyKey === `${state.prefix}-${account.label}-agent`) return;
  for (const item of state.agents.filter(item => item.owner === account)) {
    if (path === `/agents/${item.id}` && method === 'DELETE' && body === undefined) return;
    for (const space of state.spaces) {
      if (path === `/agents/${item.id}/grants/${space.id}` && method === 'PUT' && keysOnly(body, ['role']) && body.role === 'editor') return;
      if (path === `/agents/${item.id}/grants/${space.id}` && method === 'DELETE' && body === undefined
        && state.grants.some(grant => grant.agentId === item.id && grant.spaceId === space.id && grant.owner === account)) return;
    }
  }
  if (path === `/users/${account.id}` && method === 'DELETE' && body === undefined) return;
  throw new Error('Mutation is outside the exact run-owned resource/method/body allowlist');
}

export function redact(value, secrets = []) {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 2000);
}

export function validateOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('QA origin must be a bare origin');
  const production = url.origin === 'https://agentwiki.quukk.com';
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!production && !local) throw new Error('QA origin must be production AgentWiki or loopback');
  return { origin: url.origin, host: url.host, production };
}

export function initializeLanguage(storage = localStorage) {
  if (!storage.getItem('agentwiki.language.v1')) storage.setItem('agentwiki.language.v1', 'en');
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  if (argv.includes('--help')) {
    console.log('Usage: RELEASE_APPROVED=0.12.66 CONFIRM_REMOTE_E2E_HOST=agentwiki.quukk.com node production-owner-acceptance.mjs --out /absolute/new-directory\nUse --check for an offline policy preflight. QA_ORIGIN may be a loopback origin with CONFIRM_LOCAL_E2E_HOST matching its host.');
    return;
  }
  if (argv.includes('--check')) {
    assert.equal(noExecution('/spaces/x/pages/p/agent-binding'), true);
    assert.equal(noExecution('/spaces/x/pages/p/collaboration-runs'), false);
    assert.equal(noExecution('/agents/a/credentials'), false);
    console.log(JSON.stringify({ version: VERSION, offlinePolicyCheck: 'pass', writesRetried: false, agentCredentialsOrExecutionAllowed: false }));
    return;
  }
  const outIndex = argv.indexOf('--out');
  if (outIndex < 0 || !argv[outIndex + 1] || argv.length !== 2 || !argv[outIndex + 1].startsWith('/')) throw new Error('A new absolute --out directory is required');
  const out = resolve(argv[outIndex + 1]);
  const { origin, host, production } = validateOrigin(environment.QA_ORIGIN || 'https://agentwiki.quukk.com');
  if (environment.RELEASE_APPROVED !== VERSION) throw new Error('Requires RELEASE_APPROVED=0.12.66');
  if (production ? environment.CONFIRM_REMOTE_E2E_HOST !== host : environment.CONFIRM_LOCAL_E2E_HOST !== host) throw new Error('Explicit QA host confirmation is missing');
  await mkdir(out, { recursive: false, mode: 0o700 });
  const require = createRequire(new URL('../../../package.json', import.meta.url));
  const { chromium } = require('playwright');
  const { expect } = createRequire(new URL('../../../apps/client/package.json', import.meta.url))('@playwright/test');
  const prefix = `aw66-${randomUUID().slice(0, 8)}`;
  const state = { prefix, ownerName: `${prefix}-same-owner`, agentName: `${prefix} same-agent`, spaceName: `${prefix} owner-qa`, accounts: [], spaces: [], agents: [], grants: [] };
  const secrets = [], requests = [], abort = new AbortController();
  const receipt = { version: VERSION, origin, prefix, startedAt: new Date().toISOString(), isolatedChromeProfile: true,
    checks: [], blockedRequests: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], rateLimitReadRetries: [], cleanup: [],
    boundaries: ['Only disposable accounts and their new Space/Agents are touched.', 'No Page create/write, Agent credential, binding save, collaboration Run, model configuration or model execution is requested. Page binding and collaboration selectors remain local/component-test evidence because Page creation may invoke embedding through search indexing.', 'API cleanup revokes Agents and soft-deletes Space/users, preserving the existing audit history. Screenshot email text is redacted after real DOM assertions.'] };
  let browser, page, interrupted = false, cleaning = false;
  const safe = value => redact(value, secrets);
  const check = (name, detail = {}) => receipt.checks.push({ name, passed: true, ...detail });
  const fetchFixture = createFixtureRequester({ waitImpl: (ms, signal) => delay(ms, undefined, { signal }), onRetry: detail => receipt.rateLimitReadRetries.push(detail) });
  async function request(account, path, method = 'GET', body) {
    if (!path.startsWith('/') || path.includes('://') || !noExecution(path)) throw new Error('Relative non-execution API path required');
    if (interrupted && !cleaning) throw new Error('Acceptance interrupted');
    assertFixtureMutation(state, account, path.split('?')[0], method, body);
    requests.push({ transport: 'fixture', method, path: path.split('?')[0] });
    const response = await fetchFixture(`${origin}/api${path}`, { method,
      headers: { 'content-type': 'application/json', ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: cleaning ? undefined : abort.signal, timeoutMs: 25000 });
    const text = await response.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, ok: response.ok, data };
  }
  async function api(account, path, method = 'GET', body) {
    const result = await request(account, path, method, body);
    if (!result.ok) throw new Error(`Fixture ${method} ${path.split('?')[0]} returned ${result.status}`);
    return result.data;
  }
  async function register(label) {
    const account = { label, email: `${prefix}-${label}@example.test`, password: `OwnerQa9-${randomUUID()}`, id: null, token: null };
    state.accounts.push(account); secrets.push(account.email, account.password);
    const data = await api(account, '/auth/register', 'POST', { email: account.email, password: account.password, name: state.ownerName });
    if (!data?.user?.id || !data.access_token) throw new Error('Registration did not confirm fixture identity');
    account.id = data.user.id; account.token = data.access_token; secrets.push(account.token); return account;
  }
  function assertOwner(actual, account) {
    assert.deepEqual(Object.keys(actual ?? {}).sort(), ['email', 'id', 'name']);
    assert.deepEqual(actual, { id: account.id, name: state.ownerName, email: account.email });
  }
  const ownerText = (account, zh = false) => zh ? `所有者：${state.ownerName}（${account.email}）` : `Owner: ${state.ownerName} (${account.email})`;
  async function screenshot(tab, name) {
    const accounts = state.accounts.map(account => ({ email: account.email, label: account.label }));
    await tab.evaluate(values => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), patches = [];
      while (walker.nextNode()) {
        const node = walker.currentNode, before = node.textContent;
        let after = before; for (const account of values) after = after.split(account.email).join(`[fixture ${account.label} account]`);
        if (after !== before) { patches.push([node, before]); node.textContent = after; }
      }
      window.__aw66ScreenshotPatches = patches;
    }, accounts);
    try { await tab.screenshot({ path: `${out}/${name}.png`, fullPage: true, mask: [tab.locator('#product-auth-email'), tab.locator('#product-auth-password')] }); }
    finally { await tab.evaluate(() => { for (const [node, before] of window.__aw66ScreenshotPatches ?? []) node.textContent = before; delete window.__aw66ScreenshotPatches; }); }
  }
  async function verifyPage(tab, path, name) {
    assert.equal(new URL(tab.url()).pathname, path);
    assert.ok(['AgentWiki', '天枢'].includes(await tab.title()));
    assert.ok((await tab.locator('body').innerText()).length > 100);
    assert.equal(await tab.locator('vite-error-overlay').count(), 0);
    const dimensions = await tab.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1, 'Page overflows horizontally');
    await screenshot(tab, name); check(name, { dimensions });
  }
  async function newContext(account) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(initializeLanguage);
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      try {
        if (url.origin !== origin) { if (!['GET', 'HEAD'].includes(method)) throw new Error('External mutation blocked'); return route.continue(); }
        if (!url.pathname.startsWith('/api/')) { if (!['GET', 'HEAD'].includes(method)) throw new Error('Non-API mutation blocked'); return route.continue(); }
        const path = url.pathname.slice(4); requests.push({ transport: 'browser', method, path });
        if (!noExecution(path)) throw new Error('Agent credential/model/execution endpoint blocked');
        assertFixtureMutation(state, account, path, method, req.postData() ? JSON.parse(req.postData()) : undefined);
        return route.continue();
      } catch (error) { receipt.blockedRequests.push({ method, path: url.origin === origin ? url.pathname : '[external]', error: safe(error) }); return route.abort(); }
    });
    context.on('page', tab => {
      tab.setDefaultTimeout(20000);
      tab.on('pageerror', error => receipt.pageErrors.push(safe(error)));
      tab.on('console', message => { if (message.type() === 'error') receipt.consoleErrors.push(safe(message.text())); if (message.type() === 'warning') receipt.consoleWarnings.push(safe(message.text())); });
    });
    return context;
  }
  async function signIn(tab, account) {
    await tab.goto(origin + '/login');
    await tab.locator('#product-auth-tab-login').click();
    await tab.locator('#product-auth-email').fill(account.email);
    await tab.locator('#product-auth-password').fill(account.password);
    await tab.locator('#product-auth-panel form button[type=submit]').click();
    await tab.waitForURL('**/dashboard');
  }
  const interrupt = () => { interrupted = true; abort.abort(); void browser?.close().catch(() => {}); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    state.owner = await register('owner'); state.peer = await register('peer');
    const owner = state.owner, peer = state.peer;
    const space = { ...await api(owner, '/spaces', 'POST', { name: state.spaceName, description: 'Disposable owner visibility release QA', approvalPolicy: 'no-review' }), owner };
    state.spaces.push(space);
    await api(owner, `/spaces/${space.id}/members`, 'POST', { email: peer.email, role: 'editor' });
    for (const account of [owner, peer]) {
      const agent = { ...await api(account, '/agents', 'POST', { name: state.agentName, description: 'Disconnected release QA Agent; no credential is issued.', idempotencyKey: `${prefix}-${account.label}-agent` }), owner: account };
      state.agents.push(agent);
      await api(account, `/agents/${agent.id}/grants/${space.id}`, 'PUT', { role: 'editor' });
      state.grants.push({ agentId: agent.id, spaceId: space.id, owner: account });
      const listed = await api(account, '/agents?includeArchived=true');
      assertOwner(listed.find(item => item.id === agent.id)?.owner, account);
      const detail = await api(account, `/agents/${agent.id}`); assertOwner(detail.owner, account); assert.equal(detail.credentials.length, 0);
    }
    const [ownerAgent, peerAgent] = state.agents;
    const members = await api(owner, `/spaces/${space.id}/members`);
    for (const agent of state.agents) {
      const member = members.find(item => item.agentId === agent.id);
      assertOwner(member?.agent?.owner, agent.owner);
      assert.equal(member.canManageRole, agent.owner === owner);
      assert.equal(Object.hasOwn(member.agent, 'ownerId'), false); assert.equal(Object.hasOwn(member.agent, 'credentials'), false);
    }
    assert.equal((await request(owner, `/agents/${peerAgent.id}`)).status, 403);
    check('Real API returns exact safe owner summaries for same-name Agents; other-owner detail remains forbidden and management is unchanged');
    browser = await chromium.launch({ channel: 'chrome', headless: true }); receipt.browser = browser.version();
    const context = await newContext(owner); page = await context.newPage(); await signIn(page, owner);
    check('Isolated Chrome signs in through normal login UI');
    await page.goto(origin + '/agents');
    const agentLink = page.getByRole('link', { name: new RegExp(state.agentName) });
    await expect(agentLink).toContainText(owner.email);
    await expect(page.getByText(ownerText(owner), { exact: true })).toBeVisible();
    await verifyPage(page, '/agents', 'agents-desktop');
    await agentLink.click(); await page.waitForURL(`**/agents/${ownerAgent.id}`);
    await expect(page.getByText(ownerText(owner), { exact: true })).toBeVisible();
    await verifyPage(page, `/agents/${ownerAgent.id}`, 'agent-detail-desktop');
    await page.goto(`${origin}/spaces/${space.id}/members`);
    const ownRow = page.getByTestId(`member-agent-${ownerAgent.id}`), peerRow = page.getByTestId(`member-agent-${peerAgent.id}`);
    await expect(ownRow).toContainText(ownerText(owner)); await expect(peerRow).toContainText(ownerText(peer));
    await expect(ownRow.locator('select')).toHaveCount(1); await expect(peerRow.locator('select,button')).toHaveCount(0);
    await verifyPage(page, `/spaces/${space.id}/members`, 'members-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await verifyPage(page, `/spaces/${space.id}/members`, 'members-mobile-en');
    await page.evaluate(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN')); await page.reload();
    await expect(page.getByText(ownerText(owner, true), { exact: true })).toBeVisible();
    await expect(page.getByText(ownerText(peer, true), { exact: true })).toBeVisible();
    await verifyPage(page, `/spaces/${space.id}/members`, 'members-mobile-zh');
    const peerContext = await newContext(peer), peerPage = await peerContext.newPage(); await signIn(peerPage, peer);
    await peerPage.goto(`${origin}/spaces/${space.id}/members`);
    await expect(peerPage.getByTestId(`member-agent-${peerAgent.id}`).locator('select')).toHaveCount(1);
    await expect(peerPage.getByTestId(`member-agent-${ownerAgent.id}`).locator('select,button')).toHaveCount(0);
    check('Peer sees both owners but may manage only its own Agent');
    assert.equal(receipt.blockedRequests.length, 0); assert.equal(receipt.consoleErrors.length, 0); assert.equal(receipt.pageErrors.length, 0);
    receipt.passed = true;
  } catch (error) {
    receipt.passed = false; receipt.error = safe(error);
    if (page && !page.isClosed()) await screenshot(page, 'failure').catch(() => {});
  } finally {
    cleaning = true; await browser?.close().catch(() => {}); receipt.browserClosed = true;
    const cleanupStep = async (kind, id, action) => {
      try { receipt.cleanup.push({ kind, id, ...await action() }); }
      catch (error) { receipt.cleanup.push({ kind, id, cleaned: false, error: safe(error) }); receipt.passed = false; }
    };
    // Recover uncertain registration/create results using reads, never by replaying a create write.
    for (const account of state.accounts.filter(item => !item.id || !item.token)) {
      try { const data = await api(account, '/auth/login', 'POST', { email: account.email, password: account.password }); account.id = data.user.id; account.token = data.access_token; secrets.push(account.token); }
      catch (error) { receipt.cleanup.push({ kind: 'identity-recovery', cleaned: false, error: safe(error) }); receipt.passed = false; }
    }
    state.owner ||= state.accounts.find(item => item.label === 'owner'); state.peer ||= state.accounts.find(item => item.label === 'peer');
    try {
      if (state.owner?.token) for (const data of (await api(state.owner, '/spaces?take=100')).data ?? []) {
        if (data.name === state.spaceName && data.members?.some(member => member.userId === state.owner.id && member.role === 'owner') && !state.spaces.some(item => item.id === data.id)) state.spaces.push({ ...data, owner: state.owner });
      }
      for (const account of state.accounts.filter(item => item.token)) for (const data of await api(account, '/agents?includeArchived=true')) {
        if (data.name === state.agentName && data.ownerId === account.id && !state.agents.some(item => item.id === data.id)) state.agents.push({ ...data, owner: account });
      }
      for (const agent of state.agents) for (const grant of (await api(agent.owner, `/agents/${agent.id}`)).grants) {
        if (state.spaces.some(space => space.id === grant.spaceId) && !state.grants.some(item => item.agentId === agent.id && item.spaceId === grant.spaceId)) state.grants.push({ agentId: agent.id, spaceId: grant.spaceId, owner: agent.owner });
      }
    } catch (error) { receipt.cleanup.push({ kind: 'read-only-discovery', cleaned: false, error: safe(error) }); receipt.passed = false; }
    for (const grant of [...state.grants].reverse()) await cleanupStep('grant', `${grant.agentId}/${grant.spaceId}`, async () => {
      await api(grant.owner, `/agents/${grant.agentId}/grants/${grant.spaceId}`, 'DELETE');
      assert.equal((await api(grant.owner, `/agents/${grant.agentId}`)).grants.some(item => item.spaceId === grant.spaceId), false);
      return { cleaned: true, readbackAbsent: true };
    });
    for (const agent of [...state.agents].reverse()) await cleanupStep('agent', agent.id, async () => {
      await api(agent.owner, `/agents/${agent.id}`, 'DELETE'); const after = await request(agent.owner, `/agents/${agent.id}`); assert.equal(after.status, 404);
      return { cleaned: true, revoked: true, readbackStatus: after.status };
    });
    for (const space of [...state.spaces].reverse()) await cleanupStep('space', space.id, async () => {
      await api(space.owner, `/spaces/${space.id}`, 'DELETE'); const after = await request(space.owner, `/spaces/${space.id}`); assert.ok([403, 404].includes(after.status)); return { cleaned: true, softDeleted: true, readbackStatus: after.status };
    });
    for (const account of [...state.accounts].reverse()) await cleanupStep('user', account.id ?? account.label, async () => {
      if (!account.id || !account.token) throw new Error('Unknown registration outcome remains; no registration write was replayed');
      await api(account, `/users/${account.id}`, 'DELETE'); const after = await request(account, '/users/me'); assert.equal(after.status, 401); return { cleaned: true, softDeleted: true, readbackStatus: after.status };
    });
    receipt.resources = { userIds: state.accounts.map(item => item.id), spaceIds: state.spaces.map(item => item.id), agentIds: state.agents.map(item => item.id) };
    receipt.requests = requests; receipt.noCredentialsOrExecutionRequested = requests.every(item => noExecution(item.path));
    if (interrupted || !receipt.noCredentialsOrExecutionRequested || receipt.blockedRequests.length) receipt.passed = false;
    receipt.interrupted = interrupted; receipt.completedAt = new Date().toISOString();
    await writeFile(`${out}/production-owner.json`, JSON.stringify(receipt, (key, value) => typeof value === 'string' ? safe(value) : value, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.checks.length, output: `${out}/production-owner.json`, error: receipt.error }));
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (!receipt.passed) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(redact(error)); process.exitCode = 1; });
