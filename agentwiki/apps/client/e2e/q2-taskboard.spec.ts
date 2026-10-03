import { expect, test } from '@playwright/test';
import type { TaskboardTask } from '../src/features/taskboard/types';
const task = (id: string, parent_id?: string, extra: Partial<TaskboardTask> = {}): TaskboardTask => ({ id, title: id, kind: 'task', status: 'todo', parent_id, ...extra });
const node = (page: import('@playwright/test').Page, id: string) => page.locator(`.graph .node[title="${id}"]`);
let tasks: TaskboardTask[];
test.beforeEach(async ({ page }) => {
  tasks = [task('root', undefined, { kind: 'phase' }), ...Array.from({ length: 9 }, (_, i) => task(`parent-${i}`, 'root', i === 5 ? { title: '长中文标题与LongEnglishWWWW'.repeat(12) } : {})),
    task('child', 'parent-8', { stages: { validation: 'unknown', implementation: 'todo', acceptance: 'unknown' } }),
    ...Array.from({ length: 10 }, (_, i) => task(`large-${i}`, 'parent-6')),
    ...Array.from({ length: 7 }, (_, i) => task(`deep-${i}`, i === 0 ? 'child' : `deep-${i - 1}`, { status: i === 6 ? 'in_progress' : 'todo', ...(i === 6 ? { stages: { implementation: 'todo', validation: 'unknown', acceptance: 'unknown' } } : {}) }))];
  await page.addInitScript(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    if (route.request().method() === 'POST') {
      const id = route.request().url().split('/').at(-2)!;
      const target = tasks.find(t => t.id === id)!;
      const patch = route.request().postDataJSON();
      target.status = patch.status;
      target.stages = { ...(target.stages as object || {}), implementation: patch.status };
      await route.fulfill({ json: { task: target } });
    } else await route.fulfill({ json: { board: { schema_version: 1, project: 'Original style taskboard', source_type: 'manual', sources: [], tasks, updated_at: null } } });
  });
  await page.goto('/e2e/fixtures/q2-taskboard.html');
  await expect(node(page, 'parent-8')).toBeVisible();
});
async function geometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const graph = document.querySelector<HTMLElement>('.graph')!;
    const rect = graph.getBoundingClientRect();
    const nodes = Array.from(graph.querySelectorAll<HTMLElement>('.node')).map(el => {
      const box = el.getBoundingClientRect();
      return { title: el.title, x: box.left - rect.left, y: box.top - rect.top, width: box.width, height: box.height };
    });
    const viewport = document.querySelector<HTMLElement>('.graphviewport')!;
    return { h: rect.height, width: rect.width, nodes, scrollWidth: viewport.scrollWidth, viewportWidth: viewport.clientWidth };
  });
}
async function assertGeometry(page: import('@playwright/test').Page) {
  const g = await geometry(page);
  for (const a of g.nodes) {
    expect(a.y).toBeGreaterThanOrEqual(24 - .01); expect(a.y + a.height).toBeLessThanOrEqual(g.h - 24 + .01);
    expect(a.x + a.width).toBeLessThanOrEqual(g.width - 24 + .01);
    for (const b of g.nodes) if (a !== b && a.x === b.x) expect(a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
  }
  return g;
}
test('real measured late-parent groups, overflow, mobile scrolling and arbitrary-depth path', async ({ page }) => {
  const receipts = [];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await node(page, 'parent-8').click();
    const g = await assertGeometry(page);
    const p = g.nodes.find(n => n.title === 'parent-8')!, c = g.nodes.find(n => n.title === 'child')!;
    expect(p.y + p.height / 2).toBeCloseTo(c.y + c.height / 2, 0);
    expect(g.scrollWidth).toBeGreaterThan(g.viewportWidth);
    receipts.push(g);
    // A font/content height change must be remeasured without a React state change.
    await page.addStyleTag({ content: '.tb-page .graph .node strong { font-size: 18px !important }' });
    await expect.poll(async () => {
      const resized = await geometry(page), p = resized.nodes.find(n => n.title === 'parent-8')!, c = resized.nodes.find(n => n.title === 'child')!;
      return Math.abs(p.y + p.height / 2 - c.y - c.height / 2);
    }).toBeLessThan(.5);
    await node(page, 'parent-6').click();
    const large = await assertGeometry(page), parent = large.nodes.find(n => n.title === 'parent-6')!;
    const children = large.nodes.filter(n => n.title.startsWith('large-'));
    expect(children).toHaveLength(10);
    expect(parent.y + parent.height / 2).toBeCloseTo((children[0].y + children.at(-1)!.y + children.at(-1)!.height) / 2, 0);
    await node(page, 'parent-8').click(); await node(page, 'child').click();
    for (let i = 0; i < 7; i++) await node(page, `deep-${i}`).click();
    const deep = await assertGeometry(page); expect(deep.width).toBeGreaterThan(2500);
    await page.getByRole('button', { name: '定位节点 ↗' }).click();
    await expect(node(page, 'deep-6')).toBeVisible();
    await page.locator('.crumb-button').filter({ hasText: /^root$/ }).click();
    await expect(node(page, 'child')).toHaveCount(0); await expect(node(page, 'parent-8')).toBeVisible();
  }
  await node(page, 'parent-8').click();
  await node(page, 'child').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/task7-taskboard-mobile.png' });
  await test.info().attach('geometry', { body: JSON.stringify(receipts), contentType: 'application/json' });
});
test('status saves update imported implementation, parent signals and actual purple CSS independently of evidence', async ({ page }) => {
  await node(page, 'parent-8').click(); await node(page, 'child').click();
  // Child has an execution descendant; use a terminal task to verify parent aggregation as well.
  for (let i = 0; i < 7; i++) await node(page, `deep-${i}`).click();
  for (const status of ['todo', 'in_progress', 'in_review', 'done']) {
    await page.getByLabel('状态', { exact: true }).selectOption(status);
    const reread = page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith('/taskboard'));
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await reread;
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await expect(page.getByLabel('状态', { exact: true })).toHaveValue(status);
    await expect(node(page, 'deep-6').locator(`.signals .dot.${status}`)).toHaveCount(1);
    await expect(node(page, 'parent-8').locator(`.signals .dot.${status}`)).toHaveCount(1);
    await expect(page.locator('.statusrow .pill.' + status)).toHaveCount(1);
    await expect(page.locator('.statusrow .pill').nth(0)).toHaveText('待核实');
    await expect(page.locator('.statusrow .pill').nth(2)).toHaveText('待核实');
    if (status === 'in_review') {
      for (const selector of ['.graph .node[title="deep-6"] .dot.in_review', '.legend .dot.in_review']) expect(await page.locator(selector).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(133, 100, 196)');
      expect(await page.locator('.statusrow .pill.in_review').evaluate(el => getComputedStyle(el).color)).toBe('rgb(133, 100, 196)');
    }
  }
});
