import { expect, test } from '@playwright/test';

// Real graph components with the existing local synthetic transport; no production data.
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'en'));
});

test('reset restores the initial centered 100% graph after real pointer pan and zoom', async ({ page }) => {
  await page.goto('/e2e/fixtures/graph-reference.html');
  await expect(page.getByLabel('Graph zoom')).toHaveText('100%');
  const boxes = () => page.locator('.graph-folder-box').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  const initial = await boxes();
  expect(initial.length).toBe(3);
  const canvas = await page.locator('canvas').boundingBox();
  await page.mouse.move(canvas!.x + 8, canvas!.y + 8);
  await page.mouse.down();
  await page.mouse.move(canvas!.x + 88, canvas!.y + 48, { steps: 6 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await boxes()).not.toEqual(initial);

  await page.getByRole('button', { name: 'Reset view', exact: true }).click();

  await expect(page.getByLabel('Graph zoom')).toHaveText('100%');
  await expect.poll(boxes).toEqual(initial);
  await page.screenshot({ path: test.info().outputPath('graph-reset-centered.png') });
});

test('same-title page choices show distinct paths in both real native selects', async ({ page }) => {
  await page.goto('/e2e/fixtures/graph-reference.html?scenario=many');
  const browser = page.getByRole('combobox', { name: 'Browse graph nodes' });
  await expect(browser.locator('option[value="many-0-1"]')).toHaveText('关联资料 2 · 验收/工作目录1/资料2.md');
  await expect(browser.locator('option[value="many-1-1"]')).toHaveText('关联资料 2 · 验收/工作目录2/资料2.md');
  await browser.selectOption('many-17-9');
  await page.getByRole('button', { name: 'Link to…', exact: true }).click();
  const target = page.getByRole('dialog').getByRole('combobox');
  await expect(target.locator('option[value="many-0-1"]')).toHaveText('关联资料 2 · 验收/工作目录1/资料2.md');
  await expect(target.locator('option[value="many-1-1"]')).toHaveText('关联资料 2 · 验收/工作目录2/资料2.md');
  await target.selectOption('many-1-1');
  await page.screenshot({ path: test.info().outputPath('graph-distinct-page-paths.png') });
});

test('relation target availability follows the entered type and refreshes after creation', async ({ page }) => {
  await page.goto('/e2e/fixtures/graph-reference.html');
  await page.getByRole('combobox', { name: 'Browse graph nodes' }).selectOption('fiction-0');
  await page.getByRole('button', { name: 'Link to…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const target = dialog.getByRole('combobox');
  const type = dialog.getByRole('textbox');
  await expect(target.locator('option[value="fiction-1"]')).toHaveCount(0);
  await type.fill('depends_on');
  await target.selectOption('fiction-1');
  await type.fill(' related_to ');
  await expect(target).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Create link', exact: true })).toBeDisabled();
  await type.fill('depends_on');
  await target.selectOption('fiction-1');
  await dialog.getByRole('button', { name: 'Create link', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Link to…', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('depends_on');
  await expect(page.getByRole('dialog').getByRole('combobox').locator('option[value="fiction-1"]')).toHaveCount(0);
});
