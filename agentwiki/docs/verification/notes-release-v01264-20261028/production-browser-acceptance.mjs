/** Opt-in acceptance using only this run's disposable accounts and resources. */
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createFixtureRequester } from './browser-request-policy.mjs';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { chromium } = require('playwright');
const { expect } = createRequire(new URL('../../../apps/client/package.json', import.meta.url))('@playwright/test');
const version = '0.12.64';
const suppliedOrigin = new URL(process.env.QA_ORIGIN || 'https://agentwiki.quukk.com');
if (suppliedOrigin.username || suppliedOrigin.password || suppliedOrigin.pathname !== '/' || suppliedOrigin.search || suppliedOrigin.hash) throw new Error('QA_ORIGIN must be a bare origin without credentials');
const origin = suppliedOrigin.origin;
const production = origin === 'https://agentwiki.quukk.com';
const local = suppliedOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(suppliedOrigin.hostname);
if (process.env.RELEASE_APPROVED !== version || (!production && !local)) throw new Error('Requires explicit v0.12.64 approval and an allowed origin');
if (production && process.env.CONFIRM_REMOTE_E2E_HOST !== 'agentwiki.quukk.com') throw new Error('Requires CONFIRM_REMOTE_E2E_HOST=agentwiki.quukk.com');
if (local && process.env.CONFIRM_LOCAL_E2E_HOST !== suppliedOrigin.host) throw new Error('Requires CONFIRM_LOCAL_E2E_HOST matching QA_ORIGIN host and port');
const out = process.env.QA_OUTPUT || '/tmp/agentwiki-v01264-browser';
await mkdir(out, { recursive: true });
const prefix = `aw64-${randomUUID().slice(0, 8)}`;
const accounts = [], spaces = [], pages = [], notes = [], secrets = [];
const receipt = { version, origin, startedAt: new Date().toISOString(), prefix, isolatedProfile: true, existingUserProfileUntouched: true,
  setupVia: 'Normal authenticated API, task-created accounts and resources only; normal UI sign-in', tests: [], cleanup: { notes: [], pages: [], spaces: [], users: [] }, resources: {} };
let browser, context, page, secondaryContext, secondaryPage, main, other, spaceA, spaceB, secretSpace, alpha, beta, stalePage, primaryNote, resolvedNote, staleNote, sharedNote, secretNote;
let membershipRevoked = false, interrupted = false, cleaning = false;
const runAbort = new AbortController(), requests = [];
receipt.rateLimitReadRetries = [];
const explicitFetch = createFixtureRequester({
  waitImpl: (milliseconds, signal) => delay(milliseconds, undefined, { signal }),
  onRetry: detail => receipt.rateLimitReadRetries.push(detail),
});
const check = (name, details = {}) => receipt.tests.push({ name, passed: true, ...details });
const safeError = error => {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  for (const value of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(value).join('[redacted]');
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 1500);
};
const sha = value => createHash('sha256').update(value).digest('hex');
const notePath = notePage => `/spaces/${notePage.spaceId}/pages/${notePage.id}/notes`;
function assertFixtureMutation(account, path, method, body) {
  if (['GET', 'HEAD'].includes(method)) return;
  if (path === '/auth/register' && method === 'POST' && body?.email?.startsWith(prefix + '-') && secrets.includes(body.password)) return;
  if (!accounts.includes(account)) throw new Error('Mutation principal is not owned by this run');
  if (path === '/spaces' && method === 'POST' && body?.name?.startsWith(prefix + ' ')) return;
  if (path === '/pages' && method === 'POST' && spaces.some(space => space.id === body?.spaceId && space.owner === account) && body?.title?.startsWith(prefix + ' ')) return;
  if (spaces.some(space => path === `/spaces/${space.id}` && space.owner === account && method === 'DELETE')) return;
  if (spaces.some(space => path === `/spaces/${space.id}/members` && space.owner === account && method === 'POST' && accounts.some(member => member.email === body?.email) && body?.role === 'viewer')) return;
  if (spaces.some(space => space.owner === account && accounts.some(member => path === `/spaces/${space.id}/members/${member.id}` && method === 'DELETE'))) return;
  if (pages.some(notePage => path === `/pages/${notePage.id}` && notePage.owner === account && ['PATCH', 'DELETE'].includes(method))) return;
  if (pages.some(notePage => path === notePath(notePage) && method === 'POST' && body?.body?.startsWith(prefix + ' ') && notePage.title.startsWith(prefix + ' '))) return;
  if (notes.some(note => path === `${notePath(note.page)}/${note.id}` && note.author === account && ['PATCH', 'DELETE'].includes(method))) return;
  if (path === `/users/${account.id}` && method === 'DELETE') return;
  throw new Error('Mutation is outside the run-owned fixture allowlist');
}
async function request(account, path, method = 'GET', body) {
  if (!path.startsWith('/') || path.includes('://')) throw new Error('Expected relative API path');
  if (interrupted && !cleaning) throw new Error('Acceptance interrupted');
  assertFixtureMutation(account, path, method, body);
  const response = await explicitFetch(origin + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: cleaning ? undefined : runAbort.signal, timeoutMs: 25000 });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: response.status, ok: response.ok, data };
}
async function api(account, path, method = 'GET', body) {
  const response = await request(account, path, method, body);
  if (!response.ok) throw new Error(`Fixture API ${method} ${path.split('?')[0]} returned ${response.status}`);
  return response.data;
}
async function register(label) {
  const password = `ReleaseQa9-${randomUUID()}`, email = `${prefix}-${label}@example.test`;
  secrets.push(password, email);
  const auth = await api(null, '/auth/register', 'POST', { email, password, name: `${prefix}-${label}` });
  if (!auth?.access_token || !auth?.user?.id) throw new Error('Registration response lacks fixture identity');
  secrets.push(auth.access_token);
  const account = { id: auth.user.id, email, password, token: auth.access_token, label };
  accounts.push(account); return account;
}
async function createSpace(owner, label) {
  const created = await api(owner, '/spaces', 'POST', { name: `${prefix} ${label}`, description: 'Temporary v0.12.64 acceptance fixtures; remove after this run.' });
  const space = { ...created, owner }; spaces.push(space); return space;
}
const tree = space => api(space.owner, `/spaces/${space.id}/content-tree?take=200`);
async function createPage(space, label, quote) {
  const title = `${prefix} ${label}`, content = `# ${title}\n\n${quote}\n\n${prefix} filler-passage\n\n${prefix} resolved-passage\n`;
  const created = await api(space.owner, '/pages', 'POST', { title, content, spaceId: space.id, expectedTreeRevision: (await tree(space)).treeRevision });
  const notePage = { ...created, title, content, owner: space.owner, space }; pages.push(notePage); return notePage;
}
async function createNote(author, notePage, label, quote, extra = {}) {
  const from = notePage.content.indexOf(quote);
  if (from < 0) throw new Error('Fixture quote missing from source');
  const target = { kind: 'selection', from, to: from + quote.length, quote, prefix: notePage.content.slice(Math.max(0, from - 256), from), suffix: notePage.content.slice(from + quote.length, from + quote.length + 256), baseUpdatedAt: notePage.updatedAt };
  const created = await api(author, notePath(notePage), 'POST', { clientNoteId: randomUUID(), body: `${prefix} ${label}`, target, ...extra });
  const note = { ...created, page: notePage, author, label }; notes.push(note); return note;
}
async function discover(account, input = {}) {
  return api(account, '/page-notes?' + new URLSearchParams({ query: prefix, author: 'all', status: 'all', limit: '20', ...input }));
}
const notesUrl = (space, filters = {}) => `${origin}/spaces/${space.id}/notes?${new URLSearchParams({ scope: 'space', author: 'all', status: 'all', query: prefix, ...filters })}`;
async function newContext() {
  const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await isolated.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'en'));
  isolated.on('request', request => { if (request.url().startsWith(origin + '/api/')) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
  return isolated;
}
async function signIn(tab, account) {
  await tab.goto(origin + '/login');
  await expect(tab.locator('#product-auth-email')).toBeVisible();
  await tab.locator('#product-auth-tab-login').click();
  await tab.locator('#product-auth-email').fill(account.email);
  await tab.locator('#product-auth-password').fill(account.password);
  await tab.locator('#product-auth-panel form button[type=submit]').click();
  await tab.waitForURL('**/dashboard');
}
const library = (tab = page) => tab.getByRole('region', { name: 'All notes', exact: true });
const card = (region, note, tab = page) => region.locator('li').filter({ has: tab.getByText(note.body, { exact: true }) });
async function expectTotal(count, tab = page) { await expect(library(tab).getByText(`${count} notes found`, { exact: true })).toBeVisible(); }
async function search(query, expectedCount) {
  await library().getByRole('searchbox', { name: 'Search notes, quotes or page titles' }).fill(query);
  await library().getByRole('button', { name: 'Search', exact: true }).click();
  await expectTotal(expectedCount);
}
async function loadAll(region, count) {
  for (let attempt = 0; attempt < 4 && await region.getByRole('button', { name: 'Load more', exact: true }).count(); attempt++) {
    const before = await region.locator('li').count();
    await region.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect.poll(() => region.locator('li').count()).toBeGreaterThan(before);
  }
  await expect(region.locator('li')).toHaveCount(count);
  await expect(region.getByText('All results shown', { exact: true })).toBeVisible();
}
async function assertNoOverflow(label) {
  const measured = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(measured.document).toBeLessThanOrEqual(measured.viewport + 1);
  expect(measured.body).toBeLessThanOrEqual(measured.viewport + 1);
  check(label, measured);
}
const interrupt = () => { interrupted = true; runAbort.abort(); void browser?.close().catch(() => {}); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  receipt.browser = browser.version();
  main = await register('owner'); other = await register('peer');
  spaceA = await createSpace(main, 'space-A'); spaceB = await createSpace(main, 'space-B'); secretSpace = await createSpace(other, 'secret-space');
  await api(main, `/spaces/${spaceA.id}/members`, 'POST', { email: other.email, role: 'viewer' });
  alpha = await createPage(spaceA, 'title-alpha', `${prefix} quote-primary`);
  beta = await createPage(spaceB, 'title-beta', `${prefix} quote-beta`);
  stalePage = await createPage(spaceA, 'title-stale', `${prefix} stale-original`);
  const privatePage = await createPage(secretSpace, 'title-secret', `${prefix} secret-passage`);
  const fillers = [];
  for (let index = 0; index < 21; index++) fillers.push(await createNote(main, alpha, `pagination-${String(index).padStart(2, '0')}`, `${prefix} filler-passage`));
  primaryNote = await createNote(main, alpha, 'primary-body', `${prefix} quote-primary`);
  resolvedNote = await createNote(main, alpha, 'resolved-body', `${prefix} resolved-passage`, { status: 'resolved' });
  staleNote = await createNote(main, stalePage, 'stale-body', `${prefix} stale-original`);
  sharedNote = await createNote(other, alpha, 'shared-body', `${prefix} filler-passage`, { recipientUserIds: [main.id] });
  const betaNote = await createNote(main, beta, 'beta-body', `${prefix} quote-beta`);
  secretNote = await createNote(other, privatePage, 'secret-body', `${prefix} secret-passage`);
  const replacement = `# ${stalePage.title}\n\n${prefix} replacement with no prior source passage.\n`;
  const staleChanged = await api(main, `/pages/${stalePage.id}`, 'PATCH', { content: replacement, expectedUpdatedAt: stalePage.updatedAt });
  stalePage.content = replacement; stalePage.updatedAt = staleChanged.updatedAt;
  receipt.resources = { userIds: accounts.map(account => account.id), spaceIds: spaces.map(space => space.id), pageIds: pages.map(notePage => notePage.id), noteIds: notes.map(note => note.id) };
  const first = await discover(main), next = await discover(main, { cursor: first.nextCursor });
  expect(first.notes).toHaveLength(20); expect(first.total).toBe(26); expect(next.notes).toHaveLength(6);
  expect(new Set([...first.notes, ...next.notes].map(note => note.id)).size).toBe(26);
  expect([...first.notes, ...next.notes].some(note => note.id === secretNote.id)).toBe(false);
  check('Authenticated discovery paginates 26 readable notes without disclosing the other owner secret Space');
  context = await newContext(); page = await context.newPage(); page.setDefaultTimeout(20000);
  await signIn(page, main); check('Fresh system Chrome context signs in through the normal UI');
  await page.goto(`${origin}/pages/${alpha.id}`); await page.locator('#reading-document-tab-notes').click();
  await expect(page.getByRole('tab', { name: /^Current page \(24\)$/ })).toBeVisible();
  await page.getByRole('tab', { name: 'All notes', exact: true }).click(); await expectTotal(25);
  await expect(library().getByText(`${alpha.title}`, { exact: true }).first()).toBeVisible();
  await expect(library().getByRole('button', { name: 'Return to this page', exact: true })).toBeVisible();
  await library().getByRole('button', { name: 'Return to this page', exact: true }).click();
  await expect(page.getByRole('tab', { name: /^Current page \(24\)$/ })).toHaveAttribute('aria-selected', 'true');
  check('Reading sidebar switches between Current page and All notes and can return to the current page');
  await page.goto(notesUrl(spaceA)); await expectTotal(25); await expect(library().locator('li')).toHaveCount(20);
  await library().getByLabel('Note scope', { exact: true }).selectOption('all'); await expectTotal(26);
  await library().getByLabel('Note author', { exact: true }).selectOption('me'); await expectTotal(25);
  await library().getByLabel('Note author', { exact: true }).selectOption('mentioned'); await expectTotal(1); await expect(card(library(), sharedNote)).toBeVisible();
  await library().getByLabel('Note author', { exact: true }).selectOption('all'); await expectTotal(26);
  await library().getByLabel('Note status', { exact: true }).selectOption('resolved'); await expectTotal(1); await expect(card(library(), resolvedNote)).toBeVisible();
  await library().getByLabel('Note status', { exact: true }).selectOption('open'); await expectTotal(25); await expect(card(library(), resolvedNote)).toHaveCount(0);
  await library().getByLabel('Note status', { exact: true }).selectOption('all'); await expectTotal(26);
  check('This-space/all-spaces, written-by-me/mentioning-me and open/resolved filters reflect shared authors and mentions');
  await search(`${prefix} shared-body`, 1); await expect(card(library(), sharedNote)).toBeVisible();
  await search(`${prefix} quote-primary`, 1); await expect(card(library(), primaryNote)).toBeVisible();
  await search(beta.title, 1); await expect(card(library(), betaNote)).toBeVisible();
  check('Search matches note body, quoted source and source-page title across Spaces');
  await search(prefix, 26); await expect(library().locator('li')).toHaveCount(20); await loadAll(library(), 26);
  const older = fillers[0]; await card(library(), older).scrollIntoViewIfNeeded();
  const returnHref = new URL(page.url()).pathname + new URL(page.url()).search;
  await card(library(), older).getByRole('link', { name: `Open source page: ${alpha.title}`, exact: true }).click();
  await page.waitForURL(url => url.pathname === `/pages/${alpha.id}`);
  await expect(page.locator('[data-active-note="true"]').filter({ has: page.getByText(older.body, { exact: true }) })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to notes', exact: true })).toHaveAttribute('href', returnHref);
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); await page.waitForURL(url => url.pathname === `/pages/${alpha.id}/edit`);
  await expect(page.getByRole('link', { name: 'Back to notes', exact: true })).toHaveAttribute('href', returnHref);
  await page.getByRole('button', { name: 'Return to reading', exact: true }).click(); await page.waitForURL(url => url.pathname === `/pages/${alpha.id}`);
  await expect(page.getByRole('link', { name: 'Back to notes', exact: true })).toHaveAttribute('href', returnHref);
  await page.getByRole('link', { name: 'Back to notes', exact: true }).click(); await expectTotal(26);
  await expect(library().locator('li')).toHaveCount(26); await expect(card(library(), older)).toBeInViewport();
  check('Source deep link activates an older note; read/edit/read preserves return filters and restores two pages and card position');
  await page.goto(notesUrl(spaceA, { scope: 'all', query: staleNote.body })); await expectTotal(1);
  await card(library(), staleNote).getByRole('link', { name: `Open source page: ${stalePage.title}`, exact: true }).click();
  const staleCard = page.locator('[data-active-note="true"]').filter({ has: page.getByText(staleNote.body, { exact: true }) });
  await expect(staleCard).toBeVisible(); await expect(staleCard.getByText('Original passage changed or anchor is ambiguous', { exact: true })).toBeVisible();
  await expect(staleCard.getByRole('button', { name: 'Locate passage', exact: true })).toBeDisabled();
  const sourceAfter = await api(main, `/pages/${stalePage.id}`); expect(sourceAfter.content).toBe(replacement); expect(sourceAfter.updatedAt).toBe(stalePage.updatedAt);
  check('Changed source retains the selected stale note with an explicit disabled-anchor fallback and no page mutation');
  await page.goto(notesUrl(spaceA, { scope: 'all', status: 'resolved' })); await expectTotal(1);
  await card(library(), resolvedNote).getByRole('link', { name: `Open source page: ${alpha.title}`, exact: true }).click();
  await expect(page.locator('[data-active-note="true"]').filter({ has: page.getByText(resolvedNote.body, { exact: true }) })).toBeVisible();
  check('Resolved-note source deep link reveals the selected resolved card');
  await page.goto(`${origin}/pages/${alpha.id}`); await page.locator('#reading-document-tab-notes').click();
  const mark = page.locator(`.personal-note-highlight[data-note-ids*="${primaryNote.id}"]`).first();
  for (let iteration = 0; iteration < 2; iteration++) {
    await page.getByRole('tab', { name: 'All notes', exact: true }).click(); await expect(library()).toBeVisible();
    await mark.click(); await expect(page.getByRole('tab', { name: /^Current page \(24\)$/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-active-note="true"]').filter({ has: page.getByText(primaryNote.body, { exact: true }) })).toBeVisible();
  }
  check('Clicking the same source highlight repeatedly reopens Current page from All notes');
  await page.goto(notesUrl(spaceA, { scope: 'all' })); await expectTotal(26);
  const logoPath = '/brand/agentwiki-knot-v2.png', localLogo = await readFile(new URL('../../../apps/client/public' + logoPath, import.meta.url));
  const logoResponse = await fetch(origin + logoPath, { signal: AbortSignal.timeout(15000) }); expect(logoResponse.ok).toBe(true);
  const deployedHash = sha(Buffer.from(await logoResponse.arrayBuffer())); expect(deployedHash).toBe(sha(localLogo));
  await expect(page.locator(`img[src="${logoPath}"]`).first()).toBeVisible();
  const logoPixels = await page.evaluate(async path => {
    const img = new Image(); img.src = path; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let opaque = 0, wrong = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255) { opaque++; if (pixels[i] !== 21 || pixels[i + 1] !== 93 || pixels[i + 2] !== 252) wrong++; }
    return { width: canvas.width, height: canvas.height, opaquePixels: opaque, wrongBluePixels: wrong };
  }, logoPath);
  expect(logoPixels.opaquePixels).toBeGreaterThan(0); expect(logoPixels.wrongBluePixels).toBe(0);
  check('Displayed Chinese-knot logo matches the release resource hash and Quukk blue #155DFC', { sha256: deployedHash, ...logoPixels });
  await page.screenshot({ path: out + '/desktop-notes.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await assertNoOverflow('390px note-library layout has no horizontal overflow');
  await search(staleNote.body, 1); await card(library(), staleNote).getByRole('link', { name: `Open source page: ${stalePage.title}`, exact: true }).click();
  await expect(page.locator('[data-active-note="true"]')).toBeVisible(); await assertNoOverflow('390px stale-note source and open notes sidebar have no horizontal overflow');
  await page.screenshot({ path: out + '/mobile-stale-note.png', fullPage: true });
  secondaryContext = await newContext(); secondaryPage = await secondaryContext.newPage(); secondaryPage.setDefaultTimeout(20000); await signIn(secondaryPage, other);
  await secondaryPage.goto(notesUrl(spaceA, { scope: 'all' })); await expectTotal(26, secondaryPage); await expect(library(secondaryPage).locator('li')).toHaveCount(20);
  const beforeRevoke = await discover(other); expect(beforeRevoke.nextCursor).toBeTruthy(); expect(beforeRevoke.accessRevision).toMatch(/^[a-f0-9]{32}$/);
  await api(main, `/spaces/${spaceA.id}/members/${other.id}`, 'DELETE'); membershipRevoked = true;
  const afterRevoke = await discover(other, { cursor: beforeRevoke.nextCursor }); expect(afterRevoke.total).toBe(1); expect(afterRevoke.accessRevision).not.toBe(beforeRevoke.accessRevision);
  expect(afterRevoke.notes.every(note => note.spaceId === secretSpace.id)).toBe(true);
  await library(secondaryPage).getByRole('button', { name: 'Load more', exact: true }).click(); await expectTotal(1, secondaryPage);
  await expect(library(secondaryPage).locator('li')).toHaveCount(1); await expect(card(library(secondaryPage), secretNote, secondaryPage)).toBeVisible();
  expect([403, 404]).toContain((await request(other, `/pages/${alpha.id}`)).status);
  check('Revoking only the temporary viewer membership changes accessRevision; next-page discovery/UI removes accumulated inaccessible cards', { beforeTotal: beforeRevoke.total, afterTotal: afterRevoke.total });
  receipt.passed = true;
} catch (error) {
  receipt.passed = false; receipt.error = safeError(error);
  if (page && !page.isClosed()) await page.screenshot({ path: out + '/failure.png', fullPage: true, mask: [page.locator('#product-auth-email'), page.locator('#product-auth-password')] }).catch(() => {});
} finally {
  receipt.resources = { userIds: accounts.map(account => account.id), spaceIds: spaces.map(space => space.id), pageIds: pages.map(notePage => notePage.id), noteIds: notes.map(note => note.id) };
  cleaning = true;
  if (browser) await browser.close().catch(() => {});
  receipt.cleanup.browserClosed = true;
  const cleanupStep = async (group, id, action) => {
    try { receipt.cleanup[group].push({ id, ...await action() }); } catch (error) { receipt.cleanup[group].push({ id, deleted: false, error: safeError(error) }); receipt.passed = false; }
  };
  if (membershipRevoked && main && other && spaceA) {
    try { await api(main, `/spaces/${spaceA.id}/members`, 'POST', { email: other.email, role: 'viewer' }); membershipRevoked = false; }
    catch (error) { receipt.cleanup.membershipRestoration = { failed: true, error: safeError(error), note: 'Space deletion below remains the final cleanup boundary.' }; }
  }
  for (const note of [...notes].reverse()) await cleanupStep('notes', note.id, async () => {
    const listed = await api(note.author, notePath(note.page)); const current = listed.notes.find(candidate => candidate.id === note.id);
    if (current) await api(note.author, `${notePath(note.page)}/${note.id}`, 'DELETE', { expectedUpdatedAt: current.updatedAt });
    expect((await api(note.author, notePath(note.page))).notes.some(candidate => candidate.id === note.id)).toBe(false);
    return { deleted: true, readbackAbsent: true };
  });
  for (const notePage of [...pages].reverse()) await cleanupStep('pages', notePage.id, async () => {
    const current = await request(notePage.owner, `/pages/${notePage.id}`);
    if (current.ok) await api(notePage.owner, `/pages/${notePage.id}`, 'DELETE', { expectedUpdatedAt: current.data.updatedAt, expectedTreeRevision: (await tree(notePage.space)).treeRevision });
    const readback = await request(notePage.owner, `/pages/${notePage.id}`); expect([403, 404]).toContain(readback.status);
    return { deleted: true, readbackStatus: readback.status };
  });
  for (const space of [...spaces].reverse()) await cleanupStep('spaces', space.id, async () => {
    await api(space.owner, `/spaces/${space.id}`, 'DELETE'); const readback = await request(space.owner, `/spaces/${space.id}`); expect([403, 404]).toContain(readback.status);
    return { deleted: true, readbackStatus: readback.status };
  });
  for (const account of [...accounts].reverse()) await cleanupStep('users', account.id, async () => {
    await api(account, `/users/${account.id}`, 'DELETE'); const readback = await request(account, '/users/me'); expect(readback.status).toBe(401);
    return { deleted: true, readbackStatus: readback.status };
  });
  receipt.noModelRequests = requests.every(request => !(request.method === 'POST' && /(?:\/turns|\/assist\/tasks)$/.test(request.path)));
  if (!receipt.noModelRequests) receipt.passed = false;
  receipt.interrupted = interrupted; receipt.completedAt = new Date().toISOString();
  // A final redaction pass protects receipts from assertion messages containing fixture credentials.
  await writeFile(out + '/production-browser.json', JSON.stringify(receipt, (key, value) => typeof value === 'string' ? safeError(value) : value, 2) + '\n');
  console.log(JSON.stringify({ passed: receipt.passed, checks: receipt.tests.length, output: out + '/production-browser.json', cleanup: { notes: receipt.cleanup.notes.length, pages: receipt.cleanup.pages.length, spaces: receipt.cleanup.spaces.length, users: receipt.cleanup.users.length }, error: receipt.error }));
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  if (!receipt.passed) process.exitCode = 1;
}
