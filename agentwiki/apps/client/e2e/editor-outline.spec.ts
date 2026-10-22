import { expect, test } from '@playwright/test';
import type { OutlineMetrics } from './fixtures/editor-outline';

const fixtureURL = '/e2e/fixtures/editor-outline.html';
const metrics = (page: import('@playwright/test').Page): Promise<OutlineMetrics> => page.evaluate(() => window.outlineFixture.metrics());
const settle = (page: import('@playwright/test').Page) => page.evaluate(async () => {
  for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
});

for (const width of [1440, 390]) {
  test(`editor outline keeps the clicked heading after scrolling at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixtureURL);
    await page.waitForFunction(() => window.outlineFixture);
    const original = (await metrics(page)).source;
    const target = page.getByRole('button', { name: 'Chapter 12', exact: true });
    await target.click();
    await settle(page);
    await testInfo.attach('clicked-heading.json', { body: JSON.stringify(await metrics(page), null, 2), contentType: 'application/json' });
    await expect(target).toHaveAttribute('aria-current', 'location');
    const after = await metrics(page);
    expect(after.selection).toBe(original.indexOf('# Chapter 12'));
    const top = after.headings.find((heading) => heading.label === 'Chapter 12')!.top;
    expect(top).toBeGreaterThan(after.toolbarBottom);
    expect(top).toBeLessThan(after.toolbarBottom + 24);

    // Scroll far enough into the wrapped body to virtualize the heading itself.
    await page.mouse.move(60, 450);
    await page.mouse.wheel(0, 500);
    await settle(page);
    await expect(target).toHaveAttribute('aria-current', 'location');
    await page.mouse.wheel(0, -700);
    await settle(page);
    await expect(page.getByRole('button', { name: 'Chapter 11', exact: true })).toHaveAttribute('aria-current', 'location');
    expect((await metrics(page)).source).toBe(original);

    const duplicate = page.getByRole('button', { name: 'Repeated heading', exact: true }).nth(1);
    await duplicate.click();
    await settle(page);
    await expect(duplicate).toHaveAttribute('aria-current', 'location');
    expect((await metrics(page)).selection).toBe(original.indexOf('# Repeated heading', original.indexOf('# Repeated heading') + 1));
    await page.getByRole('button', { name: 'Chapter 0', exact: true }).scrollIntoViewIfNeeded();
    await settle(page);
    await expect(duplicate).toHaveAttribute('aria-current', 'location');
    // Even a scroll without a wheel/key gesture must release the clicked target.
    await page.getByTestId('outline-scroll').evaluate((element) => { element.scrollTop -= 200; });
    await settle(page);
    await expect(page.getByRole('button', { name: 'Repeated heading', exact: true }).nth(0)).toHaveAttribute('aria-current', 'location');
  });

  test(`editor outline handles the last folded heading and short documents at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixtureURL);
    await page.waitForFunction(() => window.outlineFixture);
    await page.evaluate(() => window.outlineFixture.fold());
    expect((await metrics(page)).folds).toBe(1);
    const last = page.getByRole('button', { name: 'Final child', exact: true });
    await last.click();
    await settle(page);
    await expect(last).toHaveAttribute('aria-current', 'location');
    expect((await metrics(page)).folds).toBe(0);
    await page.mouse.move(60, 450);
    await page.mouse.wheel(0, -350);
    await settle(page);
    await expect(last).not.toHaveAttribute('aria-current', 'location');

    await last.click();
    await settle(page);
    await page.keyboard.press('PageUp');
    await settle(page);
    await expect(last).not.toHaveAttribute('aria-current', 'location');

    await page.evaluate(() => window.outlineFixture.short());
    await page.getByRole('button', { name: 'Short end', exact: true }).click();
    await settle(page);
    await expect(page.getByRole('button', { name: 'Short end', exact: true })).toHaveAttribute('aria-current', 'location');
  });
}

for (const width of [1440, 390]) {
  test(`preview outline keeps ordinary, duplicate and final headings active at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${fixtureURL}?preview`);
    await page.waitForFunction(() => window.outlineFixture);
    await page.getByRole('navigation', { name: 'Contents' }).evaluate((nav) => {
      const buttons = [...nav.querySelectorAll('button')];
      buttons.find((button) => button.textContent === 'Chapter 3')!.click();
      buttons.find((button) => button.textContent === 'Chapter 12')!.click();
    });
    await settle(page);
    await expect(page.getByRole('button', { name: 'Chapter 12', exact: true })).toHaveAttribute('aria-current', 'location');
    for (const [label, index] of [['Chapter 12', 0], ['Repeated heading', 1], ['Final child', 0]] as const) {
      const target = page.getByRole('button', { name: label, exact: true }).nth(index);
      await target.click();
      await settle(page);
      await testInfo.attach(`${label}-${index}.json`, { body: JSON.stringify(await metrics(page), null, 2), contentType: 'application/json' });
      await expect(target).toHaveAttribute('aria-current', 'location');
      const heading = (await metrics(page)).headings.filter((item) => item.label === label)[index];
      expect(heading.top).toBeGreaterThan((await metrics(page)).toolbarBottom);
      expect(heading.top).toBeLessThan(800);
    }
    await page.getByTestId('outline-scroll').evaluate((element) => { element.scrollTop -= 600; });
    await settle(page);
    await expect(page.getByRole('button', { name: 'Final child', exact: true })).not.toHaveAttribute('aria-current');
    await page.evaluate(() => window.outlineFixture.short());
    const end = page.getByRole('button', { name: 'Short end', exact: true });
    await end.click();
    await settle(page);
    await expect(end).toHaveAttribute('aria-current', 'location');
  });
}
