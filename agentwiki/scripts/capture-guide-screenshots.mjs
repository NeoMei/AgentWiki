/**
 * Capture the English guide's fictional examples in real product components.
 * Start the client dev server, then run:
 *   node scripts/capture-guide-screenshots.mjs http://127.0.0.1:5194
 * Uses an isolated browser context; no production data, models, or API writes.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.argv[2] || 'http://127.0.0.1:5194');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Capture only on localhost');
const output = fileURLToPath(new URL('../apps/client/public/screenshots/', import.meta.url));
const report = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1120, height: 860 }, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
  });
  // Fail closed if a fixture accidentally attempts a real API or remote request.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin.origin || url.pathname.startsWith('/api/')) {
      throw new Error(`Unexpected network request from screenshot fixture: ${url.pathname}`);
    }
    return route.continue();
  });
  for (const [view, filename, ready] of [
    ['agents', 'step1-agent-list-en.png', 'Handbook Assistant'],
    ['members', 'step2-space-members-en.png', 'Alex Morgan'],
    ['publish', 'step5-agent-publish-en.png', 'Publishing follows the Space review policy.'],
    ['result', 'step6-agent-success-en.png', 'Connection and publishing result'],
    ['page', 'step6-published-page-en.png', 'Use this checklist to prepare a product release'],
    ['activity', 'step6-activity-log-en.png', 'Handbook Assistant'],
    ['local-preview', 'local-sync-preview-en.png', 'Local knowledge preview'],
    ['local-result', 'local-sync-result-en.png', 'Synchronization result'],
  ]) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL(`/e2e/fixtures/guide-screenshots.html?view=${view}`, origin).href);
    await page.getByText(ready, { exact: false }).first().waitFor();
    if (view === 'activity') {
      await page.getByRole('button', { name: 'Activity', exact: true }).click();
      await page.getByText(/tool.propose_page/).waitFor();
    }
    if (view === 'page') {
      await page.getByRole('tab', { name: 'Page information', exact: true }).click();
      await page.getByRole('heading', { name: 'Source and changes' }).waitFor();
    }
    // eslint-disable-next-line no-undef -- evaluated in the browser
    await page.evaluate(() => document.fonts.ready);
    const capture = page.locator('[data-guide-capture]');
    const text = await capture.innerText();
    assert(!/[\u3400-\u9fff]/u.test(text), `Chinese text remains in ${filename}`);
    assert.deepEqual(errors, [], `${filename} browser errors`);
    await capture.screenshot({ path: path.join(output, filename), animations: 'disabled' });
    report.push({ filename, view, bounds: await capture.boundingBox(), text, errors });
    await page.close();
  }
  const receipts = '/tmp/agentwiki-guide-english';
  await mkdir(receipts, { recursive: true });
  await writeFile(path.join(receipts, 'capture.json'), JSON.stringify(report, null, 2));
  console.log(`Captured ${report.length} English examples. Receipt: ${receipts}/capture.json`);
} finally {
  await browser.close();
}
