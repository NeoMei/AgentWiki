import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'en'));
});

test('sidebar page drag inserts after, appends, and moves across folders', async ({ page }) => {
  await page.goto('/e2e/fixtures/content-tree-reorder.html');
  const row = (id: string) => page.getByTestId(`content-row-${id}`);
  await row('p0').dragTo(row('p1'), { targetPosition: { x: 60, y: 25 } });
  await expect(page.getByTestId('move-request')).toHaveText(JSON.stringify({ kind: 'page', id: 'p0', targetFolderId: 'a', beforeId: 'p2', position: 'after' }));
  await expect(page.getByTestId('content-item-a').locator('[data-tree-focus]').filter({ hasText: /First|Second|Third/ })).toHaveText(['Second', 'First', 'Third']);
  await row('p0').dragTo(row('p2'), { targetPosition: { x: 60, y: 30 } });
  await expect(page.getByTestId('content-item-a').locator('[data-tree-focus]').filter({ hasText: /First|Second|Third/ })).toHaveText(['Second', 'Third', 'First']);
  await row('p0').dragTo(row('b'));
  await expect(page.getByTestId('content-item-b').getByTestId('content-node-p0')).toBeVisible();
  await expect(page.getByTestId('move-request')).toContainText('"targetFolderId":"b"');
});

test('keyboard menu supports up/down and filtering disables sorting', async ({ page }) => {
  await page.goto('/e2e/fixtures/content-tree-reorder.html');
  await page.getByLabel('Actions: First', { exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Move down', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('content-item-a').locator('[data-tree-focus]').filter({ hasText: /First|Second|Third/ })).toHaveText(['Second', 'First', 'Third']);
  await page.getByRole('searchbox').fill('First');
  await expect(page.getByTestId('content-row-p0')).toHaveAttribute('draggable', 'false');
  await page.getByLabel('Actions: First', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Move down', exact: true })).toBeDisabled();
});

test('folder rows support after, before, and moving into another folder', async ({ page }) => {
  await page.goto('/e2e/fixtures/content-tree-reorder.html');
  const row = (id: string) => page.getByTestId(`content-row-${id}`);
  const rootIds = () => page.getByTestId('content-tree').locator(':scope > li').evaluateAll((items) => items.map((item) => item.getAttribute('data-testid')));
  await row('a').dragTo(row('b'), { targetPosition: { x: 60, y: 30 } });
  await expect.poll(rootIds).toEqual(['content-item-b', 'content-item-a']);
  await row('a').dragTo(row('b'), { targetPosition: { x: 60, y: 2 } });
  await expect.poll(rootIds).toEqual(['content-item-a', 'content-item-b']);
  await row('a').dragTo(row('b'));
  await expect(page.getByTestId('content-item-b').getByTestId('content-item-a')).toBeVisible();
  await expect(page.getByTestId('content-item-a').getByTestId('content-node-p0')).toBeVisible();
});

test('readonly sidebar has no move actions or draggable rows', async ({ page }) => {
  await page.goto('/e2e/fixtures/content-tree-reorder.html?readonly');
  await expect(page.getByTestId('content-row-p0')).toHaveAttribute('draggable', 'false');
  await expect(page.getByRole('button', { name: 'Actions: First' })).toHaveCount(0);
});
