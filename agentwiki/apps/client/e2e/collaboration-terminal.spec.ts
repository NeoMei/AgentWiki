import { test, expect } from '@playwright/test';

test('cancelled task snapshots have no actions and paused runs retain explicit recovery', async ({ page }) => {
  const now = '2026-10-23T00:00:00Z';
  const run = { id: 'run1', name: 'Lifecycle fixture', spaceId: 'space1', templateId: 'template1', templateVersion: 1,
    snapshotHash: 'a'.repeat(64), status: 'cancelled', version: 1, eventSequence: 1, startedById: 'owner1',
    createdAt: now, updatedAt: now, startedAt: now, finishedAt: now, roleBindings: [], reviews: [], events: [], joinInstructions: [],
    tasks: [{ id: 'task1', nodeId: 'write', ordinal: 0, name: 'Write page', roleSlotId: 'writer', assigneeAgentId: 'a1',
      status: 'ready', generation: 1, skippable: true, todos: [], attempts: [], artifacts: [] }] };
  await page.addInitScript(() => {
    localStorage.setItem('token', 'fixture-token');
    localStorage.setItem('user', JSON.stringify({ id: 'owner1', name: 'Fixture owner' }));
    localStorage.setItem('agentwiki.language.v1', 'en');
  });
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\//, async route => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === '/api/users/me') data = { id: 'owner1', name: 'Fixture owner', mustChangePassword: false };
    else if (path === '/api/notifications') data = { unreadCount: 0, notifications: [] };
    else if (path === '/api/review/count') data = { pending: 0 };
    else if (path === '/api/spaces/space1') data = { id: 'space1', name: 'Fixture Space', members: [{ type: 'human', userId: 'owner1', role: 'owner' }] };
    else if (path.endsWith('/members')) data = [{ type: 'human', userId: 'owner1', role: 'owner' }];
    else if (path.endsWith('/runs/run1/actions/resume')) { run.status = 'running'; data = run; }
    else if (path.endsWith('/runs/run1')) data = run;
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: data });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/spaces/space1/collaboration/runs/run1');
  const task = page.getByTestId('dashboard-section-current-task');
  await expect(task.getByText('Run: Cancelled', { exact: true })).toBeVisible();
  await expect(task.getByText('Last task state: Ready')).toBeVisible();
  await expect(task.getByRole('button', { name: 'Reassign' })).toHaveCount(0);
  await expect(task.getByRole('button', { name: 'Skip task' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('cancelled-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(task.getByText('Run: Cancelled', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath('cancelled-mobile.png') });
  run.status = 'paused';
  await page.reload();
  await expect(task.getByText('Run: Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume run', exact: true }).click();
  await page.getByLabel('Reason').fill('Resume fixture');
  await page.getByRole('button', { name: 'Confirm resume run' }).click();
  await expect(task.getByText('Ready', { exact: true })).toBeVisible();
  await expect(task.getByText('Last task state: Ready')).toHaveCount(0);
  await expect(task.getByRole('button', { name: 'Reassign' })).toBeVisible();
});
