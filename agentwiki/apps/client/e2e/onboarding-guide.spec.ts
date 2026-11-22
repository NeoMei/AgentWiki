import { expect, test } from '@playwright/test';
import { expectPinnedRuntimePreparation, localSyncPackage } from './fixtures/local-sync-runtime';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });
});

test('public Agent onboarding guide copies the executable prompt and switches language', async ({
  context,
  page,
  request,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/onboard');

  await expect(page).toHaveURL(/\/guide\/agent-onboard$/);
  await expect(page.getByRole('heading', { level: 1, name: '连接你的 Agent' })).toBeVisible();
  await page.locator('summary').filter({ hasText: '查看完整提示词' }).click();
  const prompt = page.locator('pre');
  await expect(prompt).toBeVisible();
  const apiOrigin = new URL('/api', page.url()).href;
  const displayedPrompt = await prompt.innerText();
  expect(displayedPrompt).toContain(`${apiOrigin}/onboard/runtime?client=<actual-client>&packageVersion=${localSyncPackage.version}`);
  expect(displayedPrompt.split('\n')).toEqual(expect.arrayContaining([
    `<nodePath> <cliPath> onboard start --server '${apiOrigin}' --client <actual-client> --protocol json`,
    '<nodePath> <cliPath> onboard status --session <sessionId> --protocol json',
    '<nodePath> <cliPath> onboard continue --session <sessionId> --protocol json',
    '<nodePath> <cliPath> onboard continue --session <sessionId> --reply-file <absolute-json-file> --protocol json',
  ]));
  expect(displayedPrompt).not.toMatch(/^\s*(?:npx|npm exec)\b/mu);

  await page.getByRole('button', { name: '复制提示词' }).click();
  await expect(page.getByRole('status')).toHaveText('已复制，粘贴到所选客户端即可开始。');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe(displayedPrompt);
  expect(clipboardText).toContain('请帮我完成 AgentWiki 接入，并在当前客户端实际读取一篇已知页面来验证。');

  await page.getByRole('button', { name: '切换语言' }).click();
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'Connect your Agent',
  })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await expectPinnedRuntimePreparation(request, apiOrigin);
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
