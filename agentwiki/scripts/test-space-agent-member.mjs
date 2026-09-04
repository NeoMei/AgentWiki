import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { assertE2ETarget, cleanupFixture } from './e2e-safety.mjs';

const PREFIX = 'AGENTWIKI_SPACE_AGENT_UI_E2E';

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
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}`);
  return data;
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.scrollWidth <= dimensions.clientWidth + 1,
    `${label} overflows horizontally (${dimensions.scrollWidth} > ${dimensions.clientWidth})`,
  );
}

export async function runSpaceAgentMemberUI(environment = process.env) {
  const apiUrl = assertE2ETarget(
    environment.AGENTWIKI_API_URL ?? 'http://127.0.0.1:3000/api',
    environment,
    PREFIX,
  );
  const webUrl = assertE2ETarget(
    environment.AGENTWIKI_WEB_URL ?? 'http://127.0.0.1:5173',
    environment,
    PREFIX,
  );
  const suffix = `${Date.now()}-${process.pid}`;
  const email = `space-agent-ui-${suffix}@example.test`;
  const password = `SpaceAgent-${suffix}!`;
  const fixture = { userId: '', spaceId: '', agentId: '' };
  const pageErrors = [];
  let token = '';
  let browser;

  try {
    const registration = await request(apiUrl, '/auth/register', {
      method: 'POST',
      body: { email, password, name: 'Space Agent UI E2E' },
    });
    token = registration.access_token;
    fixture.userId = registration.user.id;

    const space = await request(apiUrl, '/spaces', {
      method: 'POST', token, body: { name: `Space Agent UI ${suffix}` },
    });
    fixture.spaceId = space.id;
    const agent = await request(apiUrl, '/agents', {
      method: 'POST', token, body: { name: `UI Agent ${suffix}` },
    });
    fixture.agentId = agent.id;

    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`${webUrl}/?intent=workspace#login`, { waitUntil: 'networkidle' });
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/dashboard(?:$|[?#])/, { timeout: 15_000 });

    await page.goto(`${webUrl}/spaces/${space.id}/members`, { waitUntil: 'networkidle' });
    const addMember = page.getByRole('button', { name: /Add member|添加成员/i });
    await assert.doesNotReject(() => addMember.waitFor({ state: 'visible', timeout: 10_000 }));
    await addMember.click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /Agent|智能体/i }).click();
    await dialog.locator('#space-agent').selectOption(agent.id);
    assert.deepEqual(
      await dialog.locator('#space-agent-role option').evaluateAll((options) => (
        options.map((option) => option.value)
      )),
      ['reader', 'editor', 'publisher'],
    );
    await dialog.locator('#space-agent-role').selectOption('editor');
    await dialog.getByText(/Read and edit Space content|可读取并编辑 Space 内容/i)
      .waitFor({ state: 'visible' });
    for (const scope of ['pages:read', 'pages:write', 'sources:read', 'graph:read', 'graph:write']) {
      assert.equal(await dialog.getByText(scope, { exact: true }).count(), 0);
    }
    await dialog.getByRole('button', { name: /Add agent|添加智能体/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await assert.doesNotReject(() => page.getByText(agent.name, { exact: true }).waitFor({ state: 'visible' }));
    await assertNoHorizontalOverflow(page, 'desktop member view');

    const mobile = await context.newPage();
    mobile.on('pageerror', (error) => pageErrors.push(error.message));
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(`${webUrl}/spaces/${space.id}/members`, { waitUntil: 'networkidle' });
    await assert.doesNotReject(() => mobile.getByText(agent.name, { exact: true }).waitFor({ state: 'visible' }));
    await assertNoHorizontalOverflow(mobile, 'mobile member view');

    assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('; ')}`);
    return { status: 'passed', desktop: true, mobile: true };
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
  runSpaceAgentMemberUI()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
