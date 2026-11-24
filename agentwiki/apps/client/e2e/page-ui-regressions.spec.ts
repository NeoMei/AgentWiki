import { expect, test } from '@playwright/test';
import { markdownWikiHeadingAnchorId } from '../src/components/markdown/obsidian';

for (const width of [1440, 390]) {
  test(`heading anchors clear the sticky reading toolbar at ${width}px`, async ({ page }) => {
    const pageId = 'fixture-heading-links';
    const spaceId = 'fixture-heading-space';
    const wikiAnchor = markdownWikiHeadingAnchorId('部署检查');
    const paragraphs = Array.from({ length: 25 }, (_, index) => `Paragraph ${index + 1} for scrolling.`).join('\n\n');
    const content = [
      '[Standard heading](#release-check) · [Wiki heading](#' + wikiAnchor + ')',
      paragraphs,
      '## Release check',
      paragraphs,
      '## 部署检查',
      paragraphs,
    ].join('\n\n');

    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      localStorage.setItem('agentwiki.auth.session', JSON.stringify({
        token: 'heading-links-fixture',
        user: { id: 'heading-links-reader', name: 'Reader' },
      }));
    });
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/pages/' + pageId) {
        return route.fulfill({ json: {
          id: pageId, title: 'Heading link fixture', content, spaceId, format: 'markdown',
          updatedAt: '2026-11-24T01:00:00Z', capabilities: { canEdit: true },
        } });
      }
      if (path === '/api/spaces/' + spaceId) {
        return route.fulfill({ json: { id: spaceId, name: 'Fixture space', members: [] } });
      }
      if (path.endsWith('/content-tree')) {
        return route.fulfill({ json: { spaceId, treeRevision: '1', parentFolderId: null, data: [], nextCursor: null } });
      }
      if (path.endsWith('/notes')) return route.fulfill({ json: { notes: [], canCreate: false } });
      if (path.endsWith('/count')) return route.fulfill({ json: { count: 0 } });
      return route.fulfill({ json: [] });
    });

    const readingToolbar = page.locator('[data-reading-toolbar]');
    const pagePath = '/pages/' + pageId;
    const assertHeadingUncovered = async (name: string) => {
      const heading = page.getByRole('heading', { name, exact: true });
      await expect(heading).toBeInViewport();
      await expect.poll(async () => {
        const [headingBox, toolbarBox] = await Promise.all([heading.boundingBox(), readingToolbar.boundingBox()]);
        return headingBox!.y - (toolbarBox!.y + toolbarBox!.height);
      }, { message: `${name} should be below the sticky reading toolbar` }).toBeGreaterThanOrEqual(0);
    };

    await page.goto(pagePath);
    await page.getByRole('link', { name: 'Standard heading', exact: true }).click();
    await expect(page).toHaveURL(/#release-check$/);
    await assertHeadingUncovered('Release check');
    await page.getByRole('link', { name: 'Wiki heading', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('#' + wikiAnchor + '$'));
    await assertHeadingUncovered('部署检查');
    await page.getByRole('link', { name: 'Wiki heading', exact: true }).click();
    await assertHeadingUncovered('部署检查');
    await page.reload();
    await assertHeadingUncovered('部署检查');
  });

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
