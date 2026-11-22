import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

/** Local-only synthetic API fixture; this does not exercise production authentication or authorization. */
test('system composite presentation, page comparison decisions and bounded long-text cards', async ({ page }) => {
  const now = '2026-10-08T00:00:00Z';
  const long = 'LongUnbrokenUserArtifact'.repeat(60);
  const run = {
    id: 'run-system-layout', name: '用户运行 / User run', status: 'waiting_review', pauseReason: null, templateId: null,
    systemTemplateSource: { slug: 'novel-writing' }, version: 1, eventSequence: 1, updatedAt: now, roleBindings: [],
    tasks: [{ id: 'task', nodeId: 'world-bible', name: '世界观设定 / World bible', ordinal: 0,
      objectivePreview: 'Define setting rules, locations, factions, chronology, constraints, and unresolved world questions.',
      assigneeAgentId: 'a', generation: 1, status: 'submitted', todos: [{ id: 'todo', ordinal: 0, name: 'Define world rules', status: 'done' }], attempts: [],
      artifacts: [{ id: 'a', kind: 'markdown', version: 1, status: 'pending', preview: long, createdAt: now }] }],
    reviews: [
      { id: 'approved', status: 'approved', artifactId: 'old', approvalCriteria: ['Human accepts the manuscript'], createdAt: now },
      { id: 'pending', status: 'pending', artifactId: 'a', approvalCriteria: ['Evidence is complete', long], canDecide: true, allowTerminate: true, sourceTaskId: 'task', pagePublication: { pageId: 'p', changeSetId: 'c' }, createdAt: now },
    ],
    events: Array.from({ length: 20 }, (_, i) => ({ id: String(i), sequence: i, operation: 'update_todo', actorKind: 'agent', createdAt: now })),
  };
  const requests: string[] = [];
  let conflict = false;
  await page.addInitScript(() => { localStorage.setItem('token', 'local-fixture'); localStorage.setItem('user', JSON.stringify({ id: 'owner' })); localStorage.setItem('agentwiki.language.v1', 'zh-CN'); });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) { await route.continue(); return; }
    requests.push(`${route.request().method()} ${path}`);
    let data: unknown = {};
    if (path === '/api/users/me') data = { id: 'owner', name: 'Owner', email: 'owner@example.test', platformRole: 'user' };
    else if (path.endsWith('/members')) data = [{ type: 'human', userId: 'owner', role: 'owner' }, { type: 'agent', agentId: 'a', agent: { id: 'a', name: 'Define world rules', status: 'active' }, role: 'editor' }];
    else if (path.endsWith('/runs/run-system-layout')) data = run;
    else if (path.endsWith('/page-comparison')) data = { mode: 'candidate', reviewId: 'pending', artifactId: 'a', canDecide: true, conflict,
      target: { pageId: 'p', title: long }, baseline: { available: true, pageVersionId: 'v1', contentHash: 'a'.repeat(64), markdown: '# Old' }, candidate: { changeSetId: 'c', markdown: long }, current: { pageVersionId: 'v1', contentHash: 'a'.repeat(64), markdown: long } };
    else if (path === '/api/spaces/space-layout') data = { id: 'space-layout', name: '本地 Fixture', members: [{ type: 'human', userId: 'owner', role: 'owner' }] };
    else if (path === '/api/review/count') data = { pending: 1 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  const geometries: unknown[] = [];
  for (const width of [1912, 1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/spaces/space-layout/collaboration/runs/run-system-layout');
    const reviews = page.getByTestId('dashboard-section-reviews');
    const pending = reviews.locator('article').first();
    await expect(pending).toHaveAttribute('data-review-id', 'pending');
    await expect(page.getByRole('heading', { name: '世界观设定', exact: true })).toBeVisible();
    await expect(page.getByText('1. 定义世界规则', { exact: true })).toBeVisible();
    await expect(page.getByText('本次运行冻结负责人: Define world rules')).toBeVisible();
    const header = pending.getByTestId('review-card-header');
    const loadComparison = header.getByRole('button', { name: '加载页面对比', exact: true });
    await expect(pending.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
    await loadComparison.click();
    const comparison = page.getByRole('dialog', { name: '页面对比', exact: true });
    const approve = comparison.getByRole('button', { name: '通过', exact: true });
    await expect(comparison).toBeVisible();
    await expect(approve).toBeEnabled();
    await expect(comparison.getByText('证据完整', { exact: true })).toBeVisible();
    await approve.scrollIntoViewIfNeeded();
    const dialogBox = (await comparison.boundingBox())!;
    const approveBox = (await approve.boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width);
    expect(dialogBox.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(900);
    expect(approveBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(approveBox.y + approveBox.height).toBeLessThanOrEqual(dialogBox.y + dialogBox.height);
    await expect(comparison.getByRole('link', { name: '关联 ChangeSet: c', exact: true })).toHaveAttribute('href', '/review?spaceId=space-layout&changeSet=c');
    await comparison.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(comparison).toHaveCount(0);
    await expect(loadComparison).toBeFocused();
    if (width < 1000) await page.evaluate(() => window.scrollTo(0, 0));
    const geometry = await page.evaluate(() => {
      const ids = ['summary', 'current-task', 'reviews', 'artifacts', 'activity'];
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, cards: ids.map(id => {
        const el = document.querySelector(`[data-testid="dashboard-section-${id}"]`) as HTMLElement; const r = el.getBoundingClientRect();
        return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth, clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: getComputedStyle(el).overflowY };
      }) };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(width);
    for (const card of geometry.cards) { expect(card.left).toBeGreaterThanOrEqual(0); expect(card.right).toBeLessThanOrEqual(width); expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth); }
    if (width > 1000) {
      for (const card of geometry.cards.filter(c => c.id !== 'summary')) { expect(card.overflowY).toBe('auto'); expect(card.bottom).toBeLessThanOrEqual(900); }
      const headerBox = await header.boundingBox(); const reviewBox = await reviews.boundingBox();
      expect(headerBox!.y + headerBox!.height).toBeLessThanOrEqual(reviewBox!.y + reviewBox!.height);
    } else for (const card of geometry.cards) expect(card.overflowY).toBe('visible');
    geometries.push(geometry);
    await page.screenshot({ path: test.info().outputPath(`system-layout-${width}.png`), fullPage: true });
  }
  expect(requests.some(r => r.startsWith('POST'))).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  // The stored-source lookup is route-local; both locales must still resolve it
  // when the already-loaded Run changes language, without changing custom text.
  await page.getByRole('button', { name: '切换语言', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'World bible', exact: true })).toBeVisible();
  await expect(page.getByText('1. Define world rules', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load page comparison', exact: true }).click();
  const englishComparison = page.getByRole('dialog', { name: 'Page comparison', exact: true });
  await expect(englishComparison.getByText('Evidence is complete', { exact: true })).toBeVisible();
  await englishComparison.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Frozen assignee: Define world rules')).toBeVisible();
  await page.getByRole('button', { name: 'Switch language', exact: true }).click();
  await expect(page.getByRole('heading', { name: '世界观设定', exact: true })).toBeVisible();
  conflict = true;
  await page.reload();
  const pending = page.getByTestId('dashboard-section-reviews').locator('article').first();
  await pending.getByRole('button', { name: '加载页面对比' }).click();
  const comparison = page.getByRole('dialog', { name: '页面对比', exact: true });
  await expect(comparison.getByText('证据完整', { exact: true })).toBeVisible();
  await expect(comparison.getByRole('button', { name: '驳回返工' })).toBeVisible();
  await expect(comparison.getByRole('button', { name: '终止运行' })).toBeVisible();
  await expect(comparison.getByRole('button', { name: '通过', exact: true })).toHaveCount(0);
  await expect(comparison.getByRole('button', { name: '采纳当前页面' })).toBeVisible();
  const regenerate = comparison.getByRole('button', { name: '基于当前页面重新生成' });
  await regenerate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('pre-detected-conflict.png'), fullPage: true });
  await regenerate.click();
  await expect.poll(() => requests.filter(r => r.startsWith('POST'))).toEqual(['POST /api/spaces/space-layout/collaboration/runs/run-system-layout/tasks/task/page-conflict']);
  await writeFile(test.info().outputPath('geometry.json'), JSON.stringify(geometries, null, 2));
  await test.info().attach('geometry', { body: JSON.stringify(geometries, null, 2), contentType: 'application/json' });
});
