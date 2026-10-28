/** Opt-in release QA. Mutations are single-attempt and confined to disposable fixtures. */
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixtureRequester } from '../notes-release-v01264-20261028/browser-request-policy.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = createRequire(new URL('../../../apps/client/package.json', import.meta.url))('@playwright/test');
const version = '0.12.65';
const suppliedOrigin = new URL(process.env.localQA_ORIGIN || process.env.QA_ORIGIN || 'https://agentwiki.quukk.com');
if (suppliedOrigin.username || suppliedOrigin.password || suppliedOrigin.pathname !== '/' || suppliedOrigin.search || suppliedOrigin.hash) throw new Error('QA origin must be a bare origin');
const origin = suppliedOrigin.origin;
const production = origin === 'https://agentwiki.quukk.com';
const local = suppliedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(suppliedOrigin.hostname);
if (process.env.RELEASE_APPROVED !== version || (!production && !local)) throw new Error('Requires explicit RELEASE_APPROVED=0.12.65 and an allowed origin');
if (production && process.env.CONFIRM_REMOTE_E2E_HOST !== 'agentwiki.quukk.com') throw new Error('Requires CONFIRM_REMOTE_E2E_HOST=agentwiki.quukk.com');
if (local && process.env.CONFIRM_LOCAL_E2E_HOST !== suppliedOrigin.host) throw new Error('Requires CONFIRM_LOCAL_E2E_HOST matching the local QA origin');
const localAllowlistStage = process.env.QA_LOCAL_ALLOWLIST_STAGE === '1';
if (localAllowlistStage && !local) throw new Error('QA_LOCAL_ALLOWLIST_STAGE is allowed only for loopback QA origins');
const out = process.env.QA_OUTPUT || '/tmp/agentwiki-v01265-browser';
await mkdir(out, { recursive: true });
const prefix = `aw65-${randomUUID().slice(0, 8)}`;
const accounts = [], spaces = [], pages = [], agents = [], grants = [], runs = [], secrets = [], requests = [];
const allowedSpaceNames = new Set(['default', 'explicit', 'existing'].map(label => `${prefix} ${label}`));
const receipt = { version, origin, prefix, startedAt: new Date().toISOString(), isolatedChromeProfile: true,
  tests: [], rateLimitReadRetries: [], blockedMutations: [], cleanup: { runs: [], bindings: [], grants: [], agents: [], pages: [], spaces: [], users: [] },
  boundaries: ['Existing always-review retention uses a disposable pre-existing fixture, not an unrelated business Space.',
    'RunController has no DELETE endpoint: Runs are cancelled, then verified inaccessible after fixture Space removal. Agent deletion revokes; Space/User deletion is soft deletion.',
    'NewPageDialog creation-completion and clipboard rejection feedback are component-test boundaries, not browser claims. Real binding-dialog clipboard success is tested only when the existing exact-Space rollout is enabled.',
    'No Agent credential, model configuration, model call, MCP join, or execution claim is created. The Run waits for an external Agent.'] };
let browser, context, page, peerContext, owner, peer, existing, defaultSpace, explicitSpace, bindingPage, agent;
let interrupted = false, cleaning = false, injectPolicyFailure = false;
const runAbort = new AbortController();
const safeError = value => {
  let text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(?:sk-|AW-INSTALL-)[A-Za-z0-9_-]+/g, '[redacted-secret]').slice(0, 1500);
};
const check = (name, details = {}) => receipt.tests.push({ name, passed: true, ...details });
const ownSpace = (account, id) => spaces.find(space => space.id === id && space.owner === account);
const keysOnly = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(key => keys.includes(key));
const noModels = path => !/(?:\/assist(?:\/|$)|\/turns(?:\/|$)|\/chat\/completions|\/responses(?:\/|$)|\/agent-sessions|\/embedded|\/model(?:s)?(?:\/|$)|\/gateway|\/mcp(?:\/|$))/i.test(path);
function assertMutation(account, path, method, body) {
  if (['GET', 'HEAD'].includes(method)) return;
  if (!accounts.includes(account)) throw new Error('Mutation actor is not owned by this run');
  if (['/auth/register', '/auth/login'].includes(path) && method === 'POST' && keysOnly(body, ['email', 'password', 'name'])
    && body.email === account.email && body.password === account.password && (path.endsWith('/login') || body.name === `${prefix}-${account.label}`)) return;
  if (!account.id || !account.token) throw new Error('Mutation actor has no confirmed fixture identity');
  if (path === '/spaces' && method === 'POST' && account === owner && allowedSpaceNames.has(body?.name)
    && keysOnly(body, ['name', 'description', 'approvalPolicy']) && [undefined, 'no-review', 'always-review'].includes(body.approvalPolicy)) return;
  for (const space of spaces.filter(item => item.owner === account)) {
    if (path === `/spaces/${space.id}` && method === 'DELETE') return;
    if (path === `/spaces/${space.id}` && method === 'PATCH' && keysOnly(body, ['approvalPolicy']) && ['no-review', 'always-review'].includes(body.approvalPolicy)) return;
    if (path === `/spaces/${space.id}/members` && method === 'POST' && keysOnly(body, ['email', 'role']) && body.email === peer?.email && body.role === 'viewer') return;
    if (path === '/pages' && method === 'POST' && keysOnly(body, ['title', 'content', 'spaceId', 'expectedTreeRevision'])
      && body.spaceId === space.id && body.title === `${prefix} binding-page`) return;
  }
  for (const item of pages.filter(item => item.owner === account)) {
    if (path === `/pages/${item.id}` && method === 'DELETE' && keysOnly(body, ['expectedUpdatedAt', 'expectedTreeRevision'])) return;
    if (path === `/spaces/${item.spaceId}/pages/${item.id}/agent-binding` && method === 'PUT'
      && keysOnly(body, ['agentId', 'roleSlotKey', 'expectedUpdatedAt', 'expectedTreeRevision']) && body.agentId === agent?.id && body.roleSlotKey === 'owner') return;
    if (path === `/spaces/${item.spaceId}/pages/${item.id}/agent-binding` && method === 'DELETE' && keysOnly(body, ['expectedUpdatedAt', 'expectedTreeRevision'])) return;
    if (path === `/spaces/${item.spaceId}/pages/${item.id}/collaboration-runs` && method === 'POST'
      && keysOnly(body, ['name', 'collaborationInputs', 'bindings', 'bindingEdits', 'roleSlotKey', 'expectedTreeRevision', 'idempotencyKey'])
      && body.name === item.title && body.roleSlotKey === 'owner' && keysOnly(body.collaborationInputs, []) && Array.isArray(body.bindings) && body.bindings.length === 0
      && Array.isArray(body.bindingEdits) && body.bindingEdits.length === 1
      && body.bindingEdits.every(edit => keysOnly(edit, ['pageId', 'agentId', 'roleSlotKey', 'expectedUpdatedAt']) && edit.pageId === item.id && edit.agentId === agent?.id && edit.roleSlotKey === 'owner')) return;
  }
  if (path === '/agents' && method === 'POST' && account === owner && keysOnly(body, ['name', 'description', 'idempotencyKey']) && body.name === `${prefix} external-agent`) return;
  for (const item of agents.filter(item => item.owner === account)) {
    if (path === `/agents/${item.id}` && method === 'DELETE') return;
    for (const space of spaces.filter(space => space.owner === account)) {
      if (path === `/agents/${item.id}/grants/${space.id}` && method === 'PUT' && keysOnly(body, ['role']) && body.role === 'editor') return;
      if (path === `/agents/${item.id}/grants/${space.id}` && method === 'DELETE' && grants.some(grant => grant.agentId === item.id && grant.spaceId === space.id)) return;
    }
  }
  if (runs.some(run => run.owner === account && path === `/spaces/${run.spaceId}/collaboration/runs/${run.id}/actions/cancel`)
    && method === 'POST' && keysOnly(body, ['reason', 'idempotencyKey']) && body.reason === `${prefix} acceptance cleanup`) return;
  if (path === `/users/${account.id}` && method === 'DELETE') return;
  throw new Error('Mutation is outside the run-owned resource/method/body allowlist');
}
const explicitFetch = createFixtureRequester({ waitImpl: (ms, signal) => delay(ms, undefined, { signal }), onRetry: detail => receipt.rateLimitReadRetries.push(detail) });
async function request(account, path, method = 'GET', body) {
  if (!path.startsWith('/') || path.includes('://')) throw new Error('Relative API path required');
  if (interrupted && !cleaning) throw new Error('Acceptance interrupted');
  assertMutation(account, path.split('?')[0], method, body);
  if (!noModels(path)) throw new Error('Model/agent execution endpoint is excluded');
  requests.push({ transport: 'fixture', method, path: path.split('?')[0] });
  const response = await explicitFetch(origin + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: cleaning ? undefined : runAbort.signal, timeoutMs: 25000 });
  const raw = await response.text(); let data; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { status: response.status, ok: response.ok, data };
}
async function api(account, path, method = 'GET', body) {
  const result = await request(account, path, method, body);
  if (!result.ok) throw new Error(`Fixture ${method} ${path.split('?')[0]} returned ${result.status}`);
  return result.data;
}
async function register(label) {
  const account = { label, id: null, token: null, email: `${prefix}-${label}@example.test`, password: `ReleaseQa9-${randomUUID()}` };
  accounts.push(account); secrets.push(account.email, account.password);
  const result = await api(account, '/auth/register', 'POST', { email: account.email, password: account.password, name: `${prefix}-${label}` });
  if (!result?.user?.id || !result.access_token) throw new Error('Registration did not confirm fixture identity');
  account.id = result.user.id; account.token = result.access_token; secrets.push(account.token); return account;
}
function rememberSpace(data, account = owner) {
  if (!data?.id || !allowedSpaceNames.has(data.name)) throw new Error('Unexpected Space create/discovery result');
  let space = spaces.find(item => item.id === data.id);
  if (!space) { space = { ...data, owner: account }; spaces.push(space); }
  return space;
}
const tree = space => api(space.owner, `/spaces/${space.id}/content-tree?take=50`);
const runPath = run => `/spaces/${run.spaceId}/collaboration/runs/${run.id}`;
async function newContext(account) {
  const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await isolated.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'en'));
  // Installed before the first tab/navigation. All browser mutations cross this fence.
  await isolated.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin !== origin) { if (!['GET', 'HEAD'].includes(method)) { receipt.blockedMutations.push({ method, path: '[external]' }); return route.abort(); } return route.continue(); }
    if (!url.pathname.startsWith('/api/')) {
      if (['GET', 'HEAD'].includes(method)) return route.continue();
      receipt.blockedMutations.push({ method, path: url.pathname, error: 'Non-API mutations are outside the fixture allowlist' }); return route.abort();
    }
    const path = url.pathname.slice(4); requests.push({ transport: 'browser', method, path });
    try {
      if (!noModels(path)) throw new Error('Model/agent execution request is excluded');
      assertMutation(account, path, method, req.postData() ? JSON.parse(req.postData()) : undefined);
      if (injectPolicyFailure && method === 'PATCH' && path === `/spaces/${defaultSpace?.id}`) {
        injectPolicyFailure = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary QA policy failure' }) });
      }
      return route.continue();
    } catch (error) { receipt.blockedMutations.push({ method, path, error: safeError(error) }); return route.abort(); }
  });
  return isolated;
}
async function signIn(tab, account) {
  await tab.goto(origin + '/login');
  await tab.locator('#product-auth-tab-login').click();
  await tab.locator('#product-auth-email').fill(account.email); await tab.locator('#product-auth-password').fill(account.password);
  await tab.locator('#product-auth-panel form button[type=submit]').click(); await tab.waitForURL('**/dashboard');
}
async function createSpaceInDashboard(label, policy) {
  await page.goto(origin + '/dashboard');
  await page.getByRole('button', { name: /^(New space|Create space)$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create new space', exact: true });
  await expect(dialog.getByRole('radio', { name: 'No review', exact: true })).toBeChecked();
  await dialog.locator('#create-space-name').fill(`${prefix} ${label}`);
  await dialog.locator('#create-space-description').fill('Disposable release acceptance Space');
  if (policy === 'always-review') await dialog.getByRole('radio', { name: 'Always review', exact: true }).check();
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/spaces');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  const response = await responsePromise; if (!response.ok()) throw new Error(`Dashboard create returned ${response.status()}`);
  const space = rememberSpace(await response.json()); await expect(dialog).toHaveCount(0);
  expect((await api(owner, `/spaces/${space.id}`)).approvalPolicy).toBe(policy); return space;
}
async function noOverflow(tab, name) {
  const metrics = await tab.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport + 1); expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1); check(name, metrics);
}
const interrupt = () => { interrupted = true; runAbort.abort(); void browser?.close().catch(() => {}); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
async function waitForLocalAllowlist(space) {
  const requestPath = '/tmp/agentwiki-v01265-allowlist-request.json', readyPath = '/tmp/agentwiki-v01265-allowlist-ready.json';
  const ids = [space.id];
  await writeFile(requestPath, JSON.stringify({ spaceIds: ids }) + '\n');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    runAbort.signal.throwIfAborted();
    let ready; try { ready = JSON.parse(await readFile(readyPath, 'utf8')); } catch {}
    if (Array.isArray(ready?.spaceIds) && ready.spaceIds.length === 1 && ready.spaceIds[0] === ids[0]) {
      try {
        const response = await explicitFetch(origin + '/api/health', { method: 'GET', signal: runAbort.signal, timeoutMs: Math.max(1, Math.min(2500, deadline - Date.now())) });
        if (response.ok && (await response.json()).status === 'ok') {
          receipt.localAllowlistStage = { spaceIds: ids, exactIdsConfirmed: true, healthReady: true }; return;
        }
      } catch (error) { if (runAbort.signal.aborted) throw error; }
    }
    await delay(Math.min(500, Math.max(0, deadline - Date.now())), undefined, { signal: runAbort.signal });
  }
  throw new Error('Local exact-Space allowlist stage did not confirm readiness within 90 seconds');
}
try {
  owner = await register('owner'); peer = await register('viewer');
  existing = rememberSpace(await api(owner, '/spaces', 'POST', { name: `${prefix} existing`, approvalPolicy: 'always-review' }));
  browser = await chromium.launch({ channel: 'chrome', headless: true }); receipt.browser = browser.version();
  context = await newContext(owner); page = await context.newPage(); page.setDefaultTimeout(20000); await signIn(page, owner);
  check('Isolated system Chrome signs in through normal login UI');
  defaultSpace = await createSpaceInDashboard('default', 'no-review'); explicitSpace = await createSpaceInDashboard('explicit', 'always-review');
  if (localAllowlistStage) await waitForLocalAllowlist(defaultSpace);
  check('Dashboard creates default no-review and explicitly selected always-review Spaces with persisted API readback');
  await page.goto(`${origin}/spaces/${existing.id}/settings`);
  await expect(page.getByRole('button', { name: 'Content review：Always review', exact: true })).toBeVisible();
  expect((await api(owner, `/spaces/${existing.id}`)).approvalPolicy).toBe('always-review'); check('Pre-existing always-review fixture retains its policy');
  await page.goto(`${origin}/spaces/${defaultSpace.id}/settings`);
  const card = page.getByRole('region', { name: 'Content review', exact: true });
  await expect(card.getByRole('radio', { name: 'No review', exact: true })).toBeChecked();
  await page.locator('#space-name').fill(`${prefix} unsaved-name`); await page.locator('#space-description').fill(`${prefix} unsaved-description`);
  const badge = page.getByRole('button', { name: 'Content review：No review', exact: true }); await badge.click();
  let policyDialog = page.getByRole('dialog', { name: 'Content review', exact: true });
  await expect(policyDialog.getByRole('radio', { name: 'No review', exact: true })).toBeFocused();
  await policyDialog.getByRole('radio', { name: 'Always review', exact: true }).check();
  await policyDialog.getByRole('button', { name: 'Save review policy', exact: true }).click(); await expect(policyDialog).toHaveCount(0);
  await expect(card.getByRole('radio', { name: 'Always review', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Content review：Always review', exact: true })).toBeFocused();
  await expect(page.locator('#space-name')).toHaveValue(`${prefix} unsaved-name`); await expect(page.locator('#space-description')).toHaveValue(`${prefix} unsaved-description`);
  expect((await api(owner, `/spaces/${defaultSpace.id}`)).name).toBe(defaultSpace.name);
  check('Header policy save synchronizes Settings immediately, restores focus and preserves unsaved name/description');
  await card.getByRole('radio', { name: 'No review', exact: true }).check(); injectPolicyFailure = true;
  await card.getByRole('button', { name: 'Save review policy', exact: true }).click(); await expect(card.getByRole('alert')).toBeVisible();
  expect((await api(owner, `/spaces/${defaultSpace.id}`)).approvalPolicy).toBe('always-review');
  await expect(page.getByRole('button', { name: 'Content review：Always review', exact: true })).toBeVisible();
  check('Injected one-shot policy HTTP 503 shows error and preserves the persisted policy; mutation was not sent to server');
  await card.getByRole('button', { name: 'Save review policy', exact: true }).click(); await expect(card.getByRole('status')).toHaveText('Review policy saved');
  expect((await api(owner, `/spaces/${defaultSpace.id}`)).approvalPolicy).toBe('no-review');
  check('A subsequent explicit user save succeeds and synchronizes header');
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page, '390px Settings has no horizontal overflow');
  await page.getByRole('button', { name: 'Content review：No review', exact: true }).click();
  policyDialog = page.getByRole('dialog', { name: 'Content review', exact: true }); await expect(policyDialog.getByRole('radio', { name: 'No review', exact: true })).toBeFocused();
  await noOverflow(page, '390px policy dialog has no horizontal overflow'); await page.keyboard.press('Escape');
  await expect(policyDialog).toHaveCount(0); await expect(page.getByRole('button', { name: 'Content review：No review', exact: true })).toBeFocused();
  await page.screenshot({ path: out + '/mobile-policy.png', fullPage: true });
  await api(owner, `/spaces/${defaultSpace.id}/members`, 'POST', { email: peer.email, role: 'viewer' });
  peerContext = await newContext(peer); const peerPage = await peerContext.newPage(); await signIn(peerPage, peer);
  await peerPage.goto(`${origin}/spaces/${defaultSpace.id}/settings`); const readOnlyCard = peerPage.getByRole('region', { name: 'Content review', exact: true });
  await expect(readOnlyCard.getByText('Only the Space owner can change the review policy.', { exact: true })).toBeVisible();
  await expect(readOnlyCard.getByRole('radio')).toHaveCount(0); await expect(peerPage.getByRole('button', { name: /^Content review：/ })).toHaveCount(0);
  check('Viewer sees the current policy and owner-only explanation with no policy mutation controls');
  const createdPage = await api(owner, '/pages', 'POST', { title: `${prefix} binding-page`, content: '# Disposable release QA\nNo model work is requested.', spaceId: defaultSpace.id, expectedTreeRevision: (await tree(defaultSpace)).treeRevision });
  bindingPage = { ...createdPage, owner, spaceId: defaultSpace.id, title: `${prefix} binding-page` }; pages.push(bindingPage);
  agent = { ...await api(owner, '/agents', 'POST', { name: `${prefix} external-agent`, description: 'External disconnected QA Agent; never issue a credential.', idempotencyKey: `${prefix}-agent` }), owner }; agents.push(agent);
  await api(owner, `/agents/${agent.id}/grants/${defaultSpace.id}`, 'PUT', { role: 'editor' }); grants.push({ agentId: agent.id, spaceId: defaultSpace.id, owner });
  expect((await api(owner, `/agents/${agent.id}/credentials`)).length).toBe(0);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${origin}/pages/${bindingPage.id}/edit`);
  await page.getByRole('button', { name: 'Agent / collaboration settings', exact: true }).click();
  const bindingDialog = page.getByRole('dialog', { name: 'Agent binding and collaboration', exact: true });
  await bindingDialog.getByRole('combobox', { name: 'Primary Agent', exact: true }).selectOption(agent.id);
  const catalog = await api(owner, `/spaces/${defaultSpace.id}/templates?locale=en&scope=all&skip=0&take=1`);
  const canStart = catalog.capabilities?.canStartPageCollaboration === true;
  receipt.authoritativeBindingCapabilities = { canBindAgent: catalog.capabilities?.canBindAgent === true, canStartPageCollaboration: canStart };
  if (!canStart) {
    if (localAllowlistStage) throw new Error('Local exact-Space rollout stage completed but the authoritative start capability remains disabled');
    await expect(bindingDialog.getByRole('checkbox', { name: 'Start collaboration after saving', exact: true })).toBeDisabled();
    await expect(bindingDialog.getByText('Starting collaboration on existing pages is not enabled for this Space. You can still save Agent bindings.', { exact: true })).toBeVisible();
    await bindingDialog.getByRole('button', { name: 'Save binding', exact: true }).click();
    await expect(bindingDialog).toHaveCount(0);
    const binding = await api(owner, `/spaces/${defaultSpace.id}/pages/${bindingPage.id}/agent-binding`); expect(binding.agentId).toBe(agent.id);
    check('Authoritative rollout gate disables Run creation while normal UI binding still saves and persists');
    receipt.notRun = [{ name: 'Real clipboard success / 3-second feedback / binding result mobile', reason: 'canStartPageCollaboration=false for the disposable Space; existing rollout configuration was preserved.' }];
    receipt.clipboardBrowserVerified = false;
  } else {
    await bindingDialog.getByRole('checkbox', { name: 'Start collaboration after saving', exact: true }).check();
    const runResponsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/spaces/${defaultSpace.id}/pages/${bindingPage.id}/collaboration-runs`);
    await bindingDialog.getByRole('button', { name: 'Save binding and start', exact: true }).click();
    const runResponse = await runResponsePromise; if (!runResponse.ok()) throw new Error(`Binding Run start returned ${runResponse.status()}`);
    const runResult = await runResponse.json(); const run = { id: runResult.runId, owner, spaceId: defaultSpace.id }; if (!run.id) throw new Error('Missing run ID'); runs.push(run);
    const instruction = bindingDialog.locator('article').filter({ has: page.locator('pre') }).first(); await expect(instruction).toBeVisible();
    const fullInstruction = await instruction.locator('pre').innerText();
    expect(fullInstruction).toContain(run.id); expect(fullInstruction).toContain('wiki_collaboration_join_run'); expect(fullInstruction).toContain('wiki_collaboration_next_action');
    const copy = instruction.locator('.instruction-copy-button'); await expect(copy).toHaveText('Copy'); const copiedAt = Date.now(); await copy.click();
    await expect(copy).toHaveText('Copied'); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullInstruction);
    await delay(1800); await expect(copy).toHaveText('Copied'); await expect(copy).toHaveText('Copy', { timeout: 2500 });
    const resetAfterMs = Date.now() - copiedAt; expect(resetAfterMs).toBeGreaterThanOrEqual(2800);
    check('Real binding dialog starts a Run and copies the complete displayed instruction to the real clipboard; Copied returns to Copy after 3 seconds', { runId: run.id, instructionSha256: createHash('sha256').update(fullInstruction).digest('hex'), resetAfterMs });
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(page, '390px binding result and copy control have no horizontal overflow');
    await page.screenshot({ path: out + '/mobile-binding-copy.png', fullPage: true });
    receipt.clipboardBrowserVerified = true;
  }
  expect((await api(owner, `/agents/${agent.id}/credentials`)).length).toBe(0); check('Agent remains disconnected with zero credentials and no Agent execution is requested');
  receipt.passed = true;
} catch (error) {
  receipt.passed = false; receipt.error = safeError(error);
  if (page && !page.isClosed()) await page.screenshot({ path: out + '/failure.png', fullPage: true, mask: [page.locator('#product-auth-email'), page.locator('#product-auth-password')] }).catch(() => {});
} finally {
  cleaning = true; if (browser) await browser.close().catch(() => {}); receipt.cleanup.browserClosed = true;
  const cleanupStep = async (group, id, action) => { try { receipt.cleanup[group].push({ id, ...await action() }); } catch (error) { receipt.cleanup[group].push({ id, cleaned: false, error: safeError(error) }); receipt.passed = false; } };
  for (const account of accounts.filter(item => !item.id || !item.token)) {
    try {
      const recovered = await api(account, '/auth/login', 'POST', { email: account.email, password: account.password });
      account.id = recovered.user.id; account.token = recovered.access_token; secrets.push(account.token);
    } catch (error) { receipt.cleanup.identityRecoveryError = safeError(error); receipt.passed = false; }
  }
  owner ||= accounts.find(item => item.label === 'owner'); peer ||= accounts.find(item => item.label === 'viewer');
  // Recover unknown-outcome UI Space/Run creates by read-only discovery. Never resend a write.
  if (owner?.token) {
    try {
      const listed = await api(owner, '/spaces?take=100'); for (const data of listed.data ?? []) if (allowedSpaceNames.has(data.name) && data.members?.some(member => member.userId === owner.id && member.role === 'owner')) rememberSpace(data);
      for (const data of await api(owner, '/agents?includeArchived=true')) {
        if (data.name === `${prefix} external-agent` && data.ownerId === owner.id && !agents.some(item => item.id === data.id)) agents.push({ ...data, owner });
      }
      for (const space of spaces) {
        const detail = await api(owner, `/spaces/${space.id}`);
        for (const data of detail.pages ?? []) if (data.title === `${prefix} binding-page` && !pages.some(item => item.id === data.id)) pages.push({ ...data, spaceId: space.id, owner });
        for (const status of ['active', 'history']) {
          const listedRuns = await api(owner, `/spaces/${space.id}/collaboration/runs?status=${status}&limit=100`);
          for (const data of listedRuns.items) if (data.name === `${prefix} binding-page` && !runs.some(item => item.id === data.id)) runs.push({ id: data.id, spaceId: space.id, owner });
        }
      }
      for (const item of agents) {
        const detail = await api(owner, `/agents/${item.id}`);
        for (const grant of detail.grants) if (ownSpace(owner, grant.spaceId) && !grants.some(entry => entry.agentId === item.id && entry.spaceId === grant.spaceId)) grants.push({ agentId: item.id, spaceId: grant.spaceId, owner });
      }
    } catch (error) { receipt.cleanup.discoveryError = safeError(error); receipt.passed = false; }
  }
  for (const run of [...runs].reverse()) await cleanupStep('runs', run.id, async () => {
    const current = await api(run.owner, runPath(run));
    if (!['completed', 'failed', 'cancelled'].includes(current.status)) await api(run.owner, `${runPath(run)}/actions/cancel`, 'POST', { reason: `${prefix} acceptance cleanup`, idempotencyKey: `${prefix}-cancel-${run.id}` });
    const after = await api(run.owner, runPath(run)); expect(['completed', 'failed', 'cancelled']).toContain(after.status);
    return { terminal: true, status: after.status, physicalDeleteUnavailable: true };
  });
  for (const item of [...pages].reverse()) await cleanupStep('bindings', item.id, async () => {
    const path = `/spaces/${item.spaceId}/pages/${item.id}/agent-binding`, binding = await api(item.owner, path);
    if (binding.agentId) await api(item.owner, path, 'DELETE', { expectedUpdatedAt: binding.updatedAt, expectedTreeRevision: (await tree(ownSpace(item.owner, item.spaceId))).treeRevision });
    expect((await api(item.owner, path)).agentId).toBeNull(); return { unbound: true, readbackConfirmed: true };
  });
  for (const grant of [...grants].reverse()) await cleanupStep('grants', `${grant.agentId}/${grant.spaceId}`, async () => {
    await api(grant.owner, `/agents/${grant.agentId}/grants/${grant.spaceId}`, 'DELETE');
    expect((await api(grant.owner, `/agents/${grant.agentId}`)).grants.some(item => item.spaceId === grant.spaceId)).toBe(false); return { deleted: true, readbackAbsent: true };
  });
  for (const item of [...agents].reverse()) await cleanupStep('agents', item.id, async () => {
    await api(item.owner, `/agents/${item.id}`, 'DELETE'); const after = await request(item.owner, `/agents/${item.id}`); expect(after.status).toBe(404); return { revoked: true, readbackStatus: after.status };
  });
  for (const item of [...pages].reverse()) await cleanupStep('pages', item.id, async () => {
    const current = await request(item.owner, `/pages/${item.id}`); if (current.ok) await api(item.owner, `/pages/${item.id}`, 'DELETE', { expectedUpdatedAt: current.data.updatedAt, expectedTreeRevision: (await tree(ownSpace(item.owner, item.spaceId))).treeRevision });
    const after = await request(item.owner, `/pages/${item.id}`); expect([403, 404]).toContain(after.status); return { deleted: true, readbackStatus: after.status };
  });
  for (const space of [...spaces].reverse()) await cleanupStep('spaces', space.id, async () => {
    await api(space.owner, `/spaces/${space.id}`, 'DELETE'); const after = await request(space.owner, `/spaces/${space.id}`); expect([403, 404]).toContain(after.status);
    for (const run of runs.filter(run => run.spaceId === space.id)) { const runAfter = await request(space.owner, runPath(run)); expect([403, 404]).toContain(runAfter.status); }
    return { deleted: true, readbackStatus: after.status, ownedRunsInaccessible: true };
  });
  for (const account of [...accounts].reverse()) await cleanupStep('users', account.id || account.label, async () => {
    if (!account.id || !account.token) throw new Error('Disposable registration outcome could not be recovered; no registration write was replayed');
    await api(account, `/users/${account.id}`, 'DELETE'); const after = await request(account, '/users/me'); expect(after.status).toBe(401); return { deleted: true, readbackStatus: after.status };
  });
  receipt.resources = { userIds: accounts.map(item => item.id), spaceIds: spaces.map(item => item.id), pageIds: pages.map(item => item.id), agentIds: agents.map(item => item.id), runIds: runs.map(item => item.id) };
  receipt.requests = requests; receipt.noModelOrAgentExecutionRequests = requests.every(item => noModels(item.path));
  if (!receipt.noModelOrAgentExecutionRequests || receipt.blockedMutations.length || interrupted) receipt.passed = false;
  receipt.completedAt = new Date().toISOString(); receipt.interrupted = interrupted;
  await writeFile(out + '/production-browser.json', JSON.stringify(receipt, (key, value) => typeof value === 'string' ? safeError(value) : value, 2) + '\n');
  console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.tests.length, output: out + '/production-browser.json', error: receipt.error }));
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); if (!receipt.passed) process.exitCode = 1;
}
