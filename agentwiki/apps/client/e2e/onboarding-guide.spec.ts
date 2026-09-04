import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });
});

test('public Agent onboarding guide copies the executable prompt and switches language', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/onboard');

  await expect(page).toHaveURL(/\/guide\/agent-onboard$/);
  await expect(page.getByRole('heading', { level: 1, name: '让本地 Agent 帮你完成接入' })).toBeVisible();
  await expect(page.locator('pre')).toContainText('@neomei/agentwiki-local-sync@0.7.0');
  await expect(page.locator('pre')).toContainText('--protocol ndjson');

  await page.getByRole('button', { name: '复制提示词' }).click();
  await expect(page.getByRole('button', { name: '已复制提示词' })).toBeVisible();
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toContain('请帮我完成 AgentWiki 自助接入。');
  expect(clipboardText).toMatch(/--protocol ndjson$/);

  await page.getByRole('button', { name: '切换语言' }).click();
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Let your local Agent handle onboarding',
  })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('390px guide drawer overlays the page without squeezing the onboarding content', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guide/agent-onboard');

  const main = page.locator('main');
  const widthBeforeOpening = (await main.boundingBox())?.width;
  expect(widthBeforeOpening).toBeGreaterThan(350);

  await page.getByRole('button', { name: '切换目录' }).click();
  await expect(page.getByRole('link', { name: 'Agent 自助接入' })).toBeVisible();

  const widthAfterOpening = (await main.boundingBox())?.width;
  expect(widthAfterOpening).toBe(widthBeforeOpening);
  await expect(page.locator('aside')).toHaveCSS('position', 'fixed');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
