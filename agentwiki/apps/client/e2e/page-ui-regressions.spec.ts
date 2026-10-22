import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`cleared Space description survives reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));
    await page.goto('/e2e/fixtures/space-settings.html');
    await expect(page.getByLabel('描述', { exact: true })).toHaveValue('Original description');
    for (const value of ['', '   ']) {
      await page.getByLabel('描述', { exact: true }).fill(value);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.getByText('已保存', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-space-settings-last-patch')!))).toMatchObject({ description: '' });
      await page.reload();
      await expect(page.getByLabel('描述', { exact: true })).toHaveValue('');
    }
  });

  test(`directory empty filter is visible and clearing restores items at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));
    await page.goto('/e2e/fixtures/directory-navigation.html');
    if (width < 1024) await page.getByRole('button', { name: '打开目录', exact: true }).click();
    const surface = width < 1024 ? page.getByRole('dialog') : page.getByRole('complementary', { name: '目录切换验收空间 目录' });
    const filter = surface.getByRole('searchbox');
    await expect(surface.getByTestId('content-node-fixture-page-one')).toBeVisible();
    const originalRequests = await page.getByTestId('directory-requests').textContent();
    await filter.fill('does-not-exist');
    await expect(surface.getByRole('status')).toHaveText('已加载项目中没有匹配结果。');
    await expect(surface.getByRole('status')).toBeVisible();
    const screenshot = testInfo.outputPath(`empty-filter-${width}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach(`empty-filter-${width}.png`, { path: screenshot, contentType: 'image/png' });
    await surface.getByRole('button', { name: '清空过滤', exact: true }).click();
    await expect(filter).toHaveValue('');
    await expect(filter).toBeFocused();
    await expect(surface.getByTestId('content-node-fixture-page-one')).toBeVisible();
    await expect(page.getByTestId('directory-requests')).toHaveText(originalRequests!);
  });
}
