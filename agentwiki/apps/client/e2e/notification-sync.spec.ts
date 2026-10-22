import { test, expect } from '@playwright/test';

// The application and browser storage are real; account and HTTP data are
// isolated fixtures. This does not certify production delivery or permissions.
test('notification reads synchronize the page, bell, dropdown and another tab', async ({ context, page }) => {
  let read = false;
  const notification = { id: 'n1', type: 'page_note_mention', title: 'Review fixture page', body: 'Test notification',
    pageId: 'p1', pageNoteId: 'note1', href: '/notifications', createdAt: '2026-10-22T00:00:00Z', readAt: null };
  await context.addInitScript(() => {
    localStorage.setItem('token', 'fixture-token');
    localStorage.setItem('user', JSON.stringify({ id: 'fixture-user', name: 'Fixture user' }));
    localStorage.setItem('agentwiki.language.v1', 'en');
  });
  await context.route(/^http:\/\/127\.0\.0\.1:\d+\/api\//, async route => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === '/api/users/me') data = { id: 'fixture-user', name: 'Fixture user', mustChangePassword: false };
    else if (url.pathname === '/api/review/count') data = { pending: 0 };
    else if (url.pathname === '/api/notifications') data = { unreadCount: read ? 0 : 1,
      notifications: read && url.searchParams.get('unreadOnly') === 'true' ? [] : [{ ...notification, readAt: read ? '2026-10-23T00:00:00Z' : null }] };
    else if (/^\/api\/notifications\/(read-all|n1\/read)$/.test(url.pathname)) read = true;
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/notifications');
  await expect(page.getByLabel('1 unread', { exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/notifications');
  await expect(other.getByLabel('1 unread', { exact: true })).toBeVisible();
  await other.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(other.getByLabel('Unread', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible({ timeout: 2000 });
  await expect(page.getByLabel('1 unread', { exact: true })).toHaveCount(0);
  await expect(other.getByLabel('1 unread', { exact: true })).toHaveCount(0, { timeout: 2000 });
  await expect(other.getByLabel('Unread', { exact: true })).toHaveCount(0);
  await expect(other.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.getByText('Review fixture page')).toBeVisible();
  await other.screenshot({ path: test.info().outputPath('notification-cross-tab-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByText('0 unread', { exact: true })).toBeVisible();
  await expect(page.getByLabel('1 unread', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('notification-mobile.png') });
  await other.close();
});
