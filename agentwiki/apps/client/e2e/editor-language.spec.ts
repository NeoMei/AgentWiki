import { test, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

const apiBaseUrl = process.env.AGENTWIKI_API_URL || 'http://100.64.35.78:3000/api/';
const artifacts = path.join(os.tmpdir(), 'agentwiki-qa');

let api: APIRequestContext;
let token = '';
let user: { id: string; name: string; email: string };
let spaceId = '';
let pageId = '';

test.beforeAll(async () => {
  api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registration = await api.post('auth/register', { data: { email: `ui-qa-${suffix}@example.com`, password: 'AgentWiki9Test', name: 'UI QA' } });
  expect(registration.ok()).toBeTruthy();
  const auth = await registration.json();
  token = auth.access_token;
  user = auth.user;
  const headers = { Authorization: `Bearer ${token}` };

  const createdSpace = await api.post('spaces', { headers, data: { name: 'UI QA Space', description: 'Temporary browser validation' } });
  expect(createdSpace.ok()).toBeTruthy();
  spaceId = (await createdSpace.json()).id;
  const createdPage = await api.post('pages', { headers, data: { title: 'Editor QA', content: '# Preview heading\n\nA bilingual Markdown workspace.', spaceId } });
  expect(createdPage.ok()).toBeTruthy();
  pageId = (await createdPage.json()).id;
});

test.afterAll(async () => {
  if (api && token) {
    const headers = { Authorization: `Bearer ${token}` };
    if (spaceId) await api.delete(`spaces/${spaceId}`, { headers });
    if (user?.id) await api.delete(`users/${user.id}`, { headers });
    await api.dispose();
  }
});

const authenticate = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(({ authToken, authUser }) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('user', JSON.stringify(authUser));
    if (!localStorage.getItem('agentwiki.language.v1')) localStorage.setItem('agentwiki.language.v1', 'en');
  }, { authToken: token, authUser: user });
};

test('desktop editor uses one surface and persists language selection', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/pages/${pageId}/edit`);

  await expect(page.getByRole('textbox', { name: 'Edit mode' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Preview heading' })).toHaveCount(0);
  await page.screenshot({ path: path.join(artifacts, 'editor-desktop-edit.png'), fullPage: true });

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('textbox', { name: 'Edit mode' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Preview heading' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.getByRole('button', { name: '编辑' })).toBeVisible();
  await expect(page.getByRole('button', { name: '预览' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('mobile editor controls fit without a two-column workspace', async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/pages/${pageId}/edit`);
  await expect(page.getByRole('textbox', { name: 'Edit mode' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByRole('heading', { name: 'Preview heading' })).toBeVisible();
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflows).toBeFalsy();
  await page.screenshot({ path: path.join(artifacts, 'editor-mobile-preview.png'), fullPage: true });
});
