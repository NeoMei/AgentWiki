import { expect, test } from '@playwright/test';

// Actual application routes; every API operation uses isolated in-browser fixtures.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'task5-fixture-token');
    localStorage.setItem('user', JSON.stringify({ id: 'task5-user', name: 'Task 5 fixture' }));
    localStorage.setItem('agentwiki.language.v1', 'en');
  });
});

for (const legacy of ['/spaces/task5/runs?run=failed-run', '/spaces/task5/runs/failed-run']) {
  test(`preserves detail and actions through ${legacy}`, async ({ page }) => {
    const requests: string[] = [];
    const members = [{ userId: 'task5-user', role: 'editor', type: 'human' }];
    const runs = [
      { id: 'failed-run', spaceId: 'task5', status: 'failed', stage: 'failed', attempts: 1, maxAttempts: 3, createdAt: '2026-10-08T00:00:00Z', source: { id: 'source-a', name: 'Fixture failed source' } },
      { id: 'active-run', spaceId: 'task5', status: 'fetching', stage: 'fetching', attempts: 1, maxAttempts: 3, createdAt: '2026-10-08T00:00:00Z', source: { id: 'source-b', name: 'Fixture active source' } },
    ];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname.startsWith('/socket.io/')) return route.fulfill({ status: 404, body: '' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push(`${route.request().method()} ${url.pathname}`);
      let json: unknown = [];
      if (url.pathname === '/api/users/me') json = { id: 'task5-user', name: 'Task 5 fixture', platformRole: 'user' };
      else if (url.pathname === '/api/review/count') json = { pending: 0 };
      else if (url.pathname === '/api/spaces/task5') json = { id: 'task5', name: 'Task 5 fixture space', members, pages: [] };
      else if (url.pathname === '/api/spaces/task5/sources') json = [{ id: 'source-a', type: 'text', name: 'Fixture source', _count: { versions: 1, runs: 2 } }];
      else if (url.pathname === '/api/spaces/task5/runs') json = runs;
      else if (url.pathname === '/api/runs/failed-run') json = { ...runs[0], artifacts: [{ id: 'artifact', type: 'compiled_page', content: 'Fixture run detail evidence' }] };
      else if (url.pathname === '/api/runs/failed-run/retry') json = { ...runs[0], status: 'queued' };
      else if (url.pathname === '/api/runs/active-run/cancel') { runs[1].status = 'cancelled'; runs[1].stage = 'cancelled'; json = runs[1]; }
      return route.fulfill({ json });
    });
    await page.goto(legacy);
    await expect(page).toHaveURL(url => url.pathname === '/spaces/task5/sources' && url.searchParams.get('view') === 'runs' && url.searchParams.get('run') === 'failed-run');
    const tabs = page.getByRole('tablist');
    await expect(tabs.getByRole('tab', { name: 'Runs', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.locator('summary').filter({ hasText: 'Compiled page' }).click();
    await expect(page.getByText('Fixture run detail evidence')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Space navigation' });
    await expect(nav.getByRole('link', { name: 'Runs', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Sources', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByTitle('Retry run', { exact: true }).click();
    await expect.poll(() => requests.filter(r => r === 'POST /api/runs/failed-run/retry').length).toBe(1);
    await page.getByTitle('Cancel run', { exact: true }).click();
    await expect.poll(() => requests.filter(r => r === 'POST /api/runs/active-run/cancel').length).toBe(1);
    await page.screenshot({ path: test.info().outputPath('sources-runs-detail.png'), fullPage: true });
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({ path: test.info().outputPath('sources-runs-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await tabs.getByRole('tab', { name: 'Sources', exact: true }).click();
    await expect(page.getByText('Fixture source', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add source' })).toBeEnabled();
    await tabs.getByRole('tab', { name: 'Runs', exact: true }).click();
    await expect(page.getByText('Fixture failed source', { exact: true })).toBeVisible();
    await page.goto('/spaces/task5/sources?view=runs&run=foreign-run');
    await expect(page.getByText('Fixture failed source', { exact: true })).toBeVisible();
    expect(requests).not.toContain('GET /api/runs/foreign-run');
  });
}
