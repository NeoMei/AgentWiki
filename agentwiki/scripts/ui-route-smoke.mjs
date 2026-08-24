import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const PREFIX = 'AGENTWIKI_UI_ROUTE_E2E';
const FATAL_TEXT = /Column does not exist|空间加载失败|添加页面失败|Application error|Something went wrong/i;

async function request(apiUrl, path, { method = 'GET', token, body } = {}) {
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
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
  return data;
}

async function assertRoute(page, webUrl, path, expectedText) {
  await page.goto(`${webUrl}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  const expectedPath = new URL(path, webUrl).pathname;
  assert.equal(new URL(page.url()).pathname, expectedPath, `${path} unexpectedly redirected to ${page.url()}`);
  const body = page.locator('body');
  await body.waitFor({ state: 'visible' });
  const text = (await body.innerText()).trim();
  assert.ok(text.length >= 10, `${path} rendered an empty shell`);
  assert.doesNotMatch(text, FATAL_TEXT, `${path} rendered a fatal error`);
  if (expectedText) assert.match(text, expectedText, `${path} did not render its expected content`);
}

async function assertNoHorizontalOverflow(page, path) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${path} overflows horizontally (${dimensions.scrollWidth} > ${dimensions.clientWidth})`);
}

export async function runUiRouteSmoke(environment = process.env) {
  const apiUrl = assertE2ETarget(environment.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api', environment, PREFIX);
  const webUrl = assertE2ETarget(environment.AGENTWIKI_WEB_URL ?? 'http://127.0.0.1:5173', environment, PREFIX);
  const suffix = `${Date.now()}-${process.pid}`;
  const email = `ui-routes-${suffix}@example.test`;
  const password = `UiRoutes-${suffix}!`;
  const fixture = { userId: '', spaceId: '', agentId: '' };
  const browserErrors = [];
  const failedResponses = [];
  let token = '';
  let pageId = '';
  let browser;

  try {
    const registration = await request(apiUrl, '/auth/register', {
      method: 'POST', body: { email, password, name: 'UI Route E2E' },
    });
    token = registration.access_token;
    fixture.userId = registration.user.id;
    const space = await request(apiUrl, '/spaces', {
      method: 'POST', token, body: { name: `UI Route Space ${suffix}` },
    });
    fixture.spaceId = space.id;
    const wikiPage = await request(apiUrl, '/pages', {
      method: 'POST', token, body: {
        title: `UI Route Page ${suffix}`,
        content: '# UI route validation\n\nThis disposable page validates the production route shell.',
        spaceId: space.id,
      },
    });
    pageId = wikiPage.id;
    const agent = await request(apiUrl, '/agents', {
      method: 'POST', token, body: { name: `UI Route Agent ${suffix}` },
    });
    fixture.agentId = agent.id;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 500) {
        failedResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    const publicRoutes = [
      ['/', /AgentWiki/i],
      ['/guide', /AgentWiki|Guide|使用指南|快速开始/i],
      ['/guide/agent-onboard', /AgentWiki|onboard|接入/i],
      ['/guide/obsidian', /Obsidian/i],
      ['/guide/docs', /AgentWiki|Documentation|详细文档/i],
    ];
    for (const [path, expected] of publicRoutes) await assertRoute(page, webUrl, path, expected);

    const legacyRedirects = [
      ['/onboard', '/guide/agent-onboard'],
      ['/settings/integrations', '/guide/obsidian'],
      ['/docs', '/guide/docs'],
      ['/docs/architecture', '/guide/docs/architecture'],
      ['/docs/features', '/guide/docs/features'],
      ['/docs/security', '/guide/docs/security'],
      ['/docs/sync', '/guide/docs/sync'],
    ];
    for (const [from, to] of legacyRedirects) {
      await page.goto(`${webUrl}${from}`, { waitUntil: 'networkidle', timeout: 30_000 });
      assert.equal(new URL(page.url()).pathname, to, `${from} should redirect to ${to}`);
    }

    await page.goto(`${webUrl}/?intent=workspace#login`, { waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('form').getByRole('button', { name: /Sign in|登录/i }).click();
    await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 15_000 });

    const authenticatedRoutes = [
      ['/dashboard', /UI Route Space/],
      [`/spaces/${space.id}`, /UI Route Space|UI Route Page/],
      [`/pages/${pageId}`, /UI route validation/],
      [`/pages/${pageId}/edit`, /UI route validation/],
      [`/pages/${pageId}/versions`, /Version|版本/i],
      [`/spaces/${space.id}/graph`, /Graph|图谱/i],
      [`/spaces/${space.id}/members`, /Member|成员/i],
      [`/spaces/${space.id}/settings`, /Setting|设置/i],
      [`/spaces/${space.id}/sources`, /Source|来源/i],
      [`/spaces/${space.id}/runs`, /Run|运行/i],
      ['/agents', /UI Route Agent/],
      [`/agents/${agent.id}`, /UI Route Agent/],
      ['/review', /Review|审核/i],
      ['/profile', /Profile|个人/i],
      ['/search?q=ui-route-no-match', /Search|搜索/i],
    ];
    for (const [path, expected] of authenticatedRoutes) await assertRoute(page, webUrl, path, expected);

    await assertRoute(page, webUrl, `/pages/${pageId}/edit`, /UI route validation/);
    await page.locator('[data-testid="md-editor-surface"] .cm-content[contenteditable="true"]').waitFor({ state: 'visible' });

    const screenshotDir = join(os.tmpdir(), 'agentwiki-qa');
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, 'ui-route-desktop-editor.png'), fullPage: false });

    const mobile = await context.newPage();
    mobile.on('pageerror', (error) => browserErrors.push(error.message));
    mobile.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()); });
    await mobile.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/', '/guide', '/guide/obsidian', '/guide/docs', '/dashboard', `/spaces/${space.id}`, `/pages/${pageId}`]) {
      await assertRoute(mobile, webUrl, path);
      await assertNoHorizontalOverflow(mobile, path);
    }
    await mobile.screenshot({ path: join(screenshotDir, 'ui-route-mobile-page.png'), fullPage: false });

    assert.deepEqual(browserErrors, [], `Browser page errors: ${browserErrors.join('; ')}`);
    assert.deepEqual(failedResponses, [], `Server failures observed in browser: ${failedResponses.join('; ')}`);
    return { status: 'passed', publicRoutes: publicRoutes.length, authenticatedRoutes: authenticatedRoutes.length, mobileRoutes: 6 };
  } finally {
    await browser?.close();
    if (token) {
      await cleanupFixture(fixture, async (kind, id) => {
        const endpoint = kind === 'agent' ? `/agents/${id}` : kind === 'space' ? `/spaces/${id}` : `/users/${id}`;
        await request(apiUrl, endpoint, { method: 'DELETE', token });
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runUiRouteSmoke()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
