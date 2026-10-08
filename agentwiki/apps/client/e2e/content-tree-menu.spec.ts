import { expect, test } from '@playwright/test';

for (const width of [1912, 390]) {
  test(`row menu leaves adjacent triggers clickable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 948 });
    await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'en'));
    await page.goto('/e2e/fixtures/content-tree-menu.html');
    const exercise = async (surface: ReturnType<typeof page.getByRole>) => {
      const triggers = surface.locator('button[aria-haspopup="menu"]');
      const first = triggers.nth(0); const second = triggers.nth(1);
      await first.click(); await expect(first).toHaveAttribute('aria-expanded', 'true');
      // Ordinary center click must reach the next row's trigger, never the old menu's action.
      const hit = await second.evaluate((trigger) => {
        const rect = trigger.getBoundingClientRect();
        return trigger.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      });
      expect(hit).toBe(true);
      const allReachable = await triggers.evaluateAll((buttons) => buttons.every((trigger) => {
        const rect = trigger.getBoundingClientRect();
        return trigger.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }));
      expect(allReachable).toBe(true);
      await second.click();
      await expect(first).toHaveAttribute('aria-expanded', 'false');
      await expect(second).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('menu')).toHaveCount(1);
      await expect(page.getByTestId('action-log')).toHaveText('');
      const menu = await page.getByRole('menu').boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape'); await expect(second).toBeFocused();
    };
    await exercise(page.getByRole('region', { name: 'Right tree fixture' }));
    if (width === 390) {
      await page.getByRole('button', { name: 'Open directory' }).click();
      await exercise(page.getByRole('dialog', { name: 'Directory' }));
      await page.keyboard.press('Escape');
    } else {
      await exercise(page.getByRole('region', { name: 'Left directory fixture' }));
    }
  });
}
