import { expect, test } from '@playwright/test';

// Browser rendering against isolated API fixtures, not production acceptance.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'search-regression-fixture');
    localStorage.setItem('user', JSON.stringify({ id: 'fixture-user', name: 'Fixture user' }));
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });
});

test('shows same-title paths, expands the search window and navigates by page ID on mobile', async ({ page }) => {
  const requestedLimits: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/socket.io/')) return route.fulfill({ status: 404, body: '' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json: unknown = [];
    if (url.pathname === '/api/users/me') json = { id: 'fixture-user', name: 'Fixture user', platformRole: 'user' };
    else if (url.pathname === '/api/review/count') json = { pending: 0 };
    else if (url.pathname === '/api/search') {
      const limit = Number(url.searchParams.get('limit'));
      requestedLimits.push(String(limit));
      json = {
        results: Array.from({ length: Math.min(limit, 12) }, (_, index) => ({
          page: { id: `weekly-${index}`, title: '项目周报', spaceId: 'fixture', space: { id: 'fixture', name: '同一空间' }, path: `pages/${index === 0 ? '设计' : index === 1 ? '研发' : `目录${index}`}/项目周报.md` },
          matchType: 'text',
        })),
        limit, maxLimit: 100, hasMore: limit < 12, total: Math.min(limit, 12),
      };
    }
    return route.fulfill({ json });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/search');
  await page.getByRole('textbox').fill('项目周报');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('第 1–10 条');
  await expect(page.getByRole('status')).toContainText('未统计匹配总数');
  const design = page.locator('article').filter({ hasText: 'pages/设计/项目周报.md' });
  const engineering = page.locator('article').filter({ hasText: 'pages/研发/项目周报.md' });
  await expect(design.getByRole('link', { name: '项目周报', exact: true })).toHaveAttribute('href', '/pages/weekly-0');
  await expect(engineering.getByRole('link', { name: '项目周报', exact: true })).toHaveAttribute('href', '/pages/weekly-1');
  await page.getByRole('button', { name: '继续加载结果' }).click();
  await expect(page.getByRole('status')).toContainText('第 1–12 条');
  await expect(page.getByText('本次搜索没有更多结果。')).toBeVisible();
  expect(requestedLimits).toEqual(['10', '20']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('search-paths-mobile.png'), fullPage: true });
  await engineering.getByRole('link', { name: '项目周报', exact: true }).click();
  await expect(page).toHaveURL(/\/pages\/weekly-1$/);
});

test('searches visible Chinese run status, failure stage and diagnostics with combined filters', async ({ page }) => {
  const failure = { stage: 'fetching', code: 'REMOTE_URL_REJECTED' };
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname.startsWith('/socket.io/')) return route.fulfill({ status: 404, body: '' });
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json: unknown = [];
    if (url.pathname === '/api/users/me') json = { id: 'fixture-user', name: 'Fixture user', platformRole: 'user' };
    else if (url.pathname === '/api/review/count') json = { pending: 0 };
    else if (url.pathname === '/api/spaces/fixture') json = { id: 'fixture', name: 'Fixture space', pages: [], members: [{ userId: 'fixture-user', type: 'human', role: 'editor' }] };
    else if (url.pathname === '/api/spaces/fixture/runs') json = [
      { id: 'failed-a', status: 'failed', stage: 'failed', source: { id: 'source-a', name: '来源甲' }, result: { failure }, createdAt: '2026-10-23T00:00:00Z' },
      { id: 'failed-b', status: 'failed', stage: 'failed', source: { id: 'source-b', name: '来源乙' }, result: { failure }, createdAt: '2026-10-23T00:00:00Z' },
      { id: 'completed-a', status: 'completed', stage: 'completed', source: { id: 'source-a', name: '来源甲' }, createdAt: '2026-10-23T00:00:00Z' },
    ];
    return route.fulfill({ json });
  });
  await page.goto('/spaces/fixture/sources?view=runs');
  await page.getByLabel('按来源筛选').selectOption('source-a');
  await page.getByLabel('按状态筛选').selectOption('failed');
  for (const term of ['失败', '抓取来源', '安全检查']) {
    await page.getByLabel('搜索运行记录').fill(term);
    await expect(page.getByText('匹配 1 条运行记录')).toBeVisible();
    await expect(page.getByText('来源甲', { exact: true })).toHaveCount(1);
    await expect(page.getByText('来源乙', { exact: true })).toHaveCount(0);
    await expect(page.getByText('来源地址被安全检查拒绝，或域名无法解析。')).toBeVisible();
  }
  await page.screenshot({ path: test.info().outputPath('run-localized-filter.png'), fullPage: true });
});
