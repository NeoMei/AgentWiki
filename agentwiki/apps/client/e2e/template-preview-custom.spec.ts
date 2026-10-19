import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

// Real React routes + loopback HTTP fixture. These checks are not production or database acceptance.
const evidence = path.resolve(process.env.TEMPLATE_PREVIEW_EVIDENCE || '../../docs/verification/template-preview-custom-20261019');
const fixture = '/e2e/fixtures/template-preview.html';
const managerRoute = '/spaces/template-preview-space/settings/page-templates?folder=reports';
const problems = new WeakMap<Page, string[]>();

test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page, request }) => {
  await request.post('http://127.0.0.1:3424/__fixture/reset');
  await mkdir(evidence, { recursive: true });
  problems.set(page, []);
  page.on('pageerror', error => problems.get(page)!.push(error.message));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') problems.get(page)!.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
});
test.afterEach(async ({ page }) => {
  expect(problems.get(page), 'no relevant console errors or warnings').toEqual([]);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
});
const shot = async (page: Page, name: string) => page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: false });
const overflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const actionVisible = async (page: Page, label: string) => {
  const button = page.getByRole('button', { name: label, exact: true });
  await expect(button).toBeVisible();
  const bounds = await button.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
};

test('desktop selection renders real Markdown, expanded preview and multi-page switching', async ({ page }) => {
  await page.goto(fixture);
  await expect(page).toHaveTitle('模板内容预览与自定义管理 · 本地 UI 验证');
  await expect(page.getByRole('heading', { name: '新建内容', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^日报 系统/u }).click();
  const preview = page.locator('.template-content-preview');
  await expect(preview.getByRole('heading', { name: '今日成果' })).toBeVisible();
  await expect(preview.getByRole('table')).toBeVisible();
  await expect(preview.getByRole('checkbox')).toHaveCount(2);
  await expect(preview.getByRole('checkbox').first()).toBeDisabled();
  await actionVisible(page, '下一步'); await overflow(page); await shot(page, 'desktop-daily-thumbnail');
  await page.getByRole('button', { name: '放大预览' }).click();
  const modal = page.getByRole('dialog', { name: '日报 · 内容预览' });
  await expect(modal.getByRole('heading', { name: '明日计划' })).toBeVisible();
  await expect(modal.getByRole('table')).toBeVisible();
  await shot(page, 'desktop-daily-expanded');
  await modal.getByRole('button', { name: '关闭预览' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '放大预览' })).toBeFocused();
  await page.getByRole('navigation', { name: '创建方式' }).getByRole('button', { name: '页面组', exact: true }).click();
  await page.getByRole('button', { name: /^项目启动页面组 系统/u }).click();
  await expect(preview.getByText('这是页面组的第一篇内容。')).toBeVisible();
  await page.getByLabel('预览页面').selectOption('project-risks');
  await expect(preview.getByText('这是页面组的第二篇内容。')).toBeVisible();
  await expect(preview.getByText('这是页面组的第一篇内容。')).toHaveCount(0);
  await shot(page, 'desktop-page-group-second-page');
  await page.getByRole('navigation', { name: '创建方式' }).getByRole('button', { name: '自定义模板', exact: true }).click();
  await expect(page.getByRole('button', { name: /^日报 系统/u })).toHaveCount(0);
  await page.getByRole('button', { name: /^团队复盘模板 空间自定义/u }).click();
  await expect(preview.getByText('这是团队自定义的复盘正文，与日报内容不同。')).toBeVisible();
  await shot(page, 'desktop-custom-template');
});

test('manager creates from saved page, edits, archives, restores and directly uses template in original folder', async ({ page, request }) => {
  await page.goto(`${fixture}?entry=${encodeURIComponent(managerRoute)}`);
  await page.getByRole('button', { name: '从页面创建模板' }).click();
  await page.getByRole('button', { name: /^已保存的项目周报 \/项目报告/u }).click();
  await page.getByRole('button', { name: '保存为 Space 模板' }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('本地验收周报模板');
  await page.getByLabel('模板说明', { exact: true }).fill('从已保存页面建立的可复用内容');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '模板已保存' })).toBeVisible();
  await page.getByRole('button', { name: '编辑 本地验收周报模板', exact: true }).click();
  await page.getByRole('dialog').getByLabel('模板名称', { exact: true }).fill('本地验收周报模板 v2');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本地验收周报模板 v2', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '归档 本地验收周报模板 v2', exact: true }).click();
  await expect(page.getByRole('heading', { name: '本地验收周报模板 v2', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '显示已归档模板' }).check();
  await expect(page.getByRole('heading', { name: '本地验收周报模板 v2', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '恢复 本地验收周报模板 v2', exact: true }).click();
  await expect(page.getByRole('link', { name: '使用模板 本地验收周报模板 v2', exact: true })).toBeVisible();
  await shot(page, 'desktop-manager-created-restored');
  await page.getByRole('link', { name: '使用模板 本地验收周报模板 v2', exact: true }).click();
  await expect(page.getByTestId('fixture-route')).toContainText('folder=reports');
  await expect(page.getByTestId('fixture-route')).toContainText('template=saved-template-');
  await expect(page.locator('.template-content-preview')).toContainText('从已保存页面复制的自定义正文。');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('已保存的项目周报');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('heading', { name: '创建完成', exact: true })).toBeVisible();
  const state = await (await request.get('http://127.0.0.1:3424/__fixture/state')).json();
  await writeFile(path.join(evidence, 'manager-http-receipt.json'), JSON.stringify(state, null, 2));
  expect(state.created).toHaveLength(1);
  expect(state.created[0].targetParentFolderId).toBe('reports');
  expect(state.created[0].content).toContain('从已保存页面复制的自定义正文。');
  const snapshotCreate = state.requests.find((value: { method: string; path: string }) => value.method === 'POST' && value.path.endsWith('/page-templates'));
  expect(snapshotCreate.input.expectedSourceUpdatedAt).toBe('2026-10-19T06:00:00.000Z');
  await shot(page, 'desktop-template-use-result');
});

test('390px preview, modal and manager remain inside viewport with visible bottom actions', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture);
  for (const name of ['空白页面', '单页模板', '页面组', '自定义模板']) {
    const method = page.getByRole('navigation', { name: '创建方式' }).getByRole('button', { name, exact: true });
    await expect(method).toBeVisible();
    const bounds = await method.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: /^日报 系统/u }).click();
  await expect(page.locator('.template-content-preview').getByRole('table')).toBeVisible();
  await actionVisible(page, '下一步'); await overflow(page); await shot(page, 'mobile-daily-thumbnail');
  await page.getByRole('button', { name: '放大预览' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await overflow(page); await shot(page, 'mobile-daily-expanded');
  await page.getByRole('button', { name: '关闭预览' }).click();
  await page.getByRole('link', { name: '管理自定义模板' }).click();
  await expect(page.getByRole('heading', { name: 'Space 页面模板' })).toBeVisible();
  await overflow(page); await shot(page, 'mobile-template-manager');
  await page.getByRole('button', { name: '从页面创建模板' }).click();
  await overflow(page); await shot(page, 'mobile-source-page-picker');
  await page.getByRole('button', { name: '取消', exact: true }).click();
});

test('editor can discover and use custom templates without management actions', async ({ page }) => {
  await page.goto(`${fixture}?role=editor`);
  await expect(page.getByRole('heading', { name: '新建内容', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '管理自定义模板' })).toHaveCount(0);
  await page.getByRole('navigation', { name: '创建方式' }).getByRole('button', { name: '自定义模板', exact: true }).click();
  await page.getByRole('button', { name: /^团队复盘模板 空间自定义/u }).click();
  await expect(page.locator('.template-content-preview')).toContainText('这是团队自定义的复盘正文，与日报内容不同。');
  await actionVisible(page, '下一步'); await shot(page, 'desktop-editor-custom-use');
  await page.getByRole('link', { name: '管理测试路由' }).click();
  await expect(page.getByRole('heading', { name: 'Space 页面模板' })).toBeVisible();
  await expect(page.getByRole('button', { name: '从页面创建模板' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^编辑 /u })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^归档 /u })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '使用模板 团队复盘模板' })).toBeVisible();
});

test('English labels and mobile expanded preview stay translated and usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixture}?locale=en`);
  await expect(page.getByRole('heading', { name: 'New content', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage custom templates' })).toBeVisible();
  await page.getByRole('button', { name: /^日报 System/u }).click();
  await page.getByRole('button', { name: 'Expand preview' }).click();
  await expect(page.getByRole('dialog', { name: '日报 · Content preview' })).toContainText('Read-only preview');
  await overflow(page); await shot(page, 'mobile-english-expanded');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await actionVisible(page, 'Next');
  await page.getByRole('link', { name: 'Manage custom templates' }).click();
  await expect(page.getByRole('button', { name: 'Create template from page' })).toBeVisible();
  await overflow(page); await shot(page, 'mobile-english-manager');
});
