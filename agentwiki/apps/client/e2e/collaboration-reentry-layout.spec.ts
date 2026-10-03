import { test, expect } from '@playwright/test';

/** Local response fixtures exercise the real route and CSS without writing remote data. */
test('returning owner reads continuation instructions with bounded desktop cards and mobile flow', async ({ page }) => {
  const now = '2026-10-01T00:00:00Z';
  const run: any = {
    id: 'run-layout', spaceId: 'space-layout', name: 'Crowded collaboration run', templateId: 'template-layout',
    templateVersion: 1, snapshotHash: 'a'.repeat(64), version: 4, status: 'running', eventSequence: 50,
    startedById: 'owner-layout', updatedAt: now, createdAt: now, startedAt: now, finishedAt: null,
    roleBindings: [{ roleSlotId: 'writer', roleSlotName: 'Writer', agentId: 'agent-layout' }],
    joinInstructions: [{ agentId: 'agent-layout', roleSlotIds: ['writer'], taskIds: ['task-0'] }],
    tasks: Array.from({ length: 15 }, (_, index) => ({
      id: `task-${index}`, nodeId: `node-${index}`, name: `Task ${index + 1}`, ordinal: index,
      objectivePreview: 'Preserve the execution scope and inspect the complete current progress.',
      roleSlotId: 'writer', assigneeAgentId: 'agent-layout', status: 'running', generation: 1, skippable: false,
      todos: Array.from({ length: 4 }, (_, n) => ({ id: `todo-${index}-${n}`, ordinal: n, name: `Required work ${n + 1}`, status: 'pending', required: true, generation: 1 })),
      attempts: [], artifacts: [{ id: `artifact-${index}`, kind: 'markdown', version: 1, status: 'pending', preview: `Artifact ${index + 1}`, createdAt: now }],
    })),
    reviews: Array.from({ length: 6 }, (_, index) => ({ id: `review-${index}`, nodeId: `review-node-${index}`, status: 'pending', minimumRole: 'editor', reviewerUserIds: [], canDecide: true, approvalCriteria: ['Inspect complete evidence'], artifactId: `artifact-${index}`, createdAt: now })),
    events: Array.from({ length: 50 }, (_, index) => ({ id: `event-${index}`, sequence: index, operation: 'next_action', actorKind: 'agent', createdAt: now })),
  };
  const members = [{ type: 'human', userId: 'owner-layout', role: 'owner' }];
  const requests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('token', 'fixture-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner-layout', name: 'Layout Owner' }));
    localStorage.setItem('agentwiki.language.v1', 'en');
  });
  await page.route('**/api/spaces/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    let data: unknown = {};
    if (url.pathname.endsWith('/members')) data = members;
    else if (url.pathname === '/api/spaces/space-layout') data = { id: 'space-layout', name: 'Layout test Space', members };
    else if (url.pathname.endsWith('/runs/run-layout')) data = run;
    else if (url.pathname.includes('/history/')) data = { items: [{ id: 'old-event', sequence: 1 }], nextCursor: null };
    else if (url.pathname.includes('/artifacts/')) data = { id: url.pathname.split('/').at(-1), taskId: 'task-0', generation: 1, version: 1, kind: 'markdown', status: 'pending', payload: { markdown: '# Complete review evidence\n'.repeat(10) }, createdAt: now };
    else if (url.pathname.includes('/templates/')) { await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); return; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/spaces/space-layout/collaboration/runs/run-layout');
  await expect(page.getByRole('button', { name: 'Get continuation instructions' })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('desktop.png'), fullPage: true });
  const desktop = await page.evaluate(() => {
    const geometry = (id: string) => { const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement; const rect = el.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height, client: el.clientHeight, scroll: el.scrollHeight, overflowY: getComputedStyle(el).overflowY }; };
    return { viewport: innerHeight, width: innerWidth, documentWidth: document.documentElement.scrollWidth, dashboard: geometry('collaboration-dashboard'), summary: geometry('dashboard-section-summary'), cards: ['current-task', 'reviews', 'artifacts', 'activity'].map(id => geometry(`dashboard-section-${id}`)) };
  });
  expect(desktop.documentWidth).toBeLessThanOrEqual(desktop.width);
  expect(desktop.dashboard.bottom).toBeLessThanOrEqual(desktop.viewport);
  expect(desktop.summary.height).toBeLessThan(desktop.cards[0].height);
  for (const card of desktop.cards) { expect(card.overflowY).toBe('auto'); expect(card.scroll).toBeGreaterThan(card.client); }
  const activity = page.getByTestId('dashboard-section-activity');
  await activity.evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect(await activity.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.getByTestId('dashboard-section-current-task').evaluate(el => el.scrollTop)).toBe(0);
  await activity.getByRole('button', { name: 'View all activity' }).click();
  await expect(page.getByRole('dialog')).toContainText('old-event');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Get continuation instructions' })).toBeEnabled();
  await page.getByRole('button', { name: 'Get continuation instructions' }).click();
  await expect(page.getByText(/wiki_collaboration_join_run/u)).toBeVisible();
  expect(requests.filter(value => value.startsWith('POST'))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('desktop-instructions.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath('mobile.png') });
  const mobile = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, cards: ['summary', 'current-task', 'reviews', 'artifacts', 'activity'].map(id => { const el = document.querySelector(`[data-testid="dashboard-section-${id}"]`) as HTMLElement; return { id, top: el.getBoundingClientRect().top, overflowY: getComputedStyle(el).overflowY }; }) }));
  expect(mobile.documentWidth).toBeLessThanOrEqual(mobile.width);
  expect(mobile.cards.map(item => item.top)).toEqual([...mobile.cards.map(item => item.top)].sort((a, b) => a - b));
  for (const card of mobile.cards) expect(card.overflowY).toBe('visible');
  await test.info().attach('geometry', { body: JSON.stringify({ desktop, mobile }, null, 2), contentType: 'application/json' });
});
