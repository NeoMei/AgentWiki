import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  assertCompatibilityPersistence,
  createBrowserFailureCollector,
} from './composite-template-e2e-support.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { Client } = requireFromServer('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = requireFromServer('@modelcontextprotocol/sdk/client/streamableHttp.js');

export async function runEnabledCompatibilityJourney({
  page,
  webOrigin,
  apiUrl,
  databaseUrl,
  fixture,
  artifactsDirectory,
  existingCompositeRunId,
  featureOffExecutableRunId,
}) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const oldPage = await createOldSinglePage({ page, webOrigin, apiUrl, fixture });
    const collaborationEntry = await createFromCollaborationEntry({
      page, webOrigin, fixture, artifactsDirectory,
    });
    const instantiation = await prisma.templateInstantiation.findFirstOrThrow({
      where: { nodes: { some: { pageId: collaborationEntry.firstPageId } } },
      include: { nodes: true },
    });
    const rootFolderId = instantiation.nodes.find((node) => node.kind === 'folder' && node.folderId)?.folderId;
    assert.ok(rootFolderId, 'Collaboration entry needs a persisted root Folder');
    const scopedPageIds = instantiation.nodes.flatMap((node) => node.pageId ? [node.pageId] : []);
    assert.ok(scopedPageIds.length > 1, 'Folder compatibility needs multiple scoped Pages');
    const folder = await exerciseFolderBulkBinding({
      page, webOrigin, apiUrl, fixture, prisma, rootFolderId, scopedPageIds, artifactsDirectory,
    });
    const legacy = await startAndArchiveLegacyRun({
      page, webOrigin, apiUrl, fixture, artifactsDirectory,
    });
    const beforeCounts = await persistedCounts(prisma, fixture.space.id);
    const responsive = await exerciseEnglishMobileMatrix({
      page, webOrigin, fixture, existingCompositeRunId, artifactsDirectory,
    });
    return {
      oldPage,
      collaborationEntry,
      folder,
      legacy,
      existingCompositeRunId,
      featureOffExecutableRunId,
      beforeCounts,
      responsive,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function runFeatureOffCompatibilityJourney({
  webOrigin,
  apiUrl,
  databaseUrl,
  fixture,
  artifactsDirectory,
  enabledCompatibility,
}) {
  const requireFromClient = createRequire(new URL('../apps/client/package.json', import.meta.url));
  const { chromium } = requireFromClient('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const browserFailures = createBrowserFailureCollector(context);
  const page = await context.newPage();
  browserFailures.labelPage(page, 'feature-off-primary');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await authenticate(page, fixture, 'en');
    const run = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${enabledCompatibility.existingCompositeRunId}`, {
      token: fixture.owner.access_token,
    });
    assert.equal(run.id, enabledCompatibility.existingCompositeRunId);
    assert.equal(run.tasks.some((task) => ['ready', 'claimed', 'running'].includes(task.status)), true,
      'feature-off existing composite Run needs an executable task');

    await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration/runs/${run.id}`);
    await page.getByRole('heading', { name: run.name }).waitFor();
    await page.getByTestId('dashboard-section-reviews').waitFor();
    assert.equal(await page.title(), 'AgentWiki');
    assert.equal((await page.locator('body').innerText()).trim().length > 50, true);
    await browserFailures.assertPageNoFrameworkOverlay(page);

    const execution = await executeExistingRunWhileFeatureOff({
      page,
      webOrigin,
      apiUrl,
      prisma,
      fixture,
      runId: enabledCompatibility.featureOffExecutableRunId,
      artifactsDirectory,
    });
    await browserFailures.assertPageNoFrameworkOverlay(page);

    const catalog = await request(apiUrl, `/spaces/${fixture.space.id}/templates?locale=en&scope=all&archived=active&skip=0&take=100`, {
      token: fixture.owner.access_token,
    });
    assert.equal(catalog.capabilities.canCreate, false);
    const templateId = catalog.data.find((item) => item.kind === 'page_group')?.id;
    assert.ok(templateId, 'feature-off read catalog must retain built-in composite templates');
    const blocked = await requestResponse(apiUrl, `/spaces/${fixture.space.id}/templates/${templateId}/instantiate`, {
      method: 'POST',
      token: fixture.owner.access_token,
      body: {
        templateVersion: 1,
        locale: 'en',
        variables: {},
        collaborationEnabled: false,
        expectedTreeRevision: '0',
        idempotencyKey: 'feature-off-acceptance-0001',
      },
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, 'COMPOSITE_TEMPLATE_FEATURE_DISABLED');

    await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration`);
    await page.getByRole('heading', { name: 'Agent collaboration' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Create page group collaboration' }).count(), 0);
    await page.getByRole('link', { name: 'Start run' }).first().waitFor();
    await browserFailures.assertPageNoFrameworkOverlay(page);
    await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
    const newPage = page.getByRole('button', { name: 'New page' });
    await newPage.click();
    const dialog = page.getByRole('dialog', { name: 'Create new page' });
    await dialog.getByText(/Composite page groups are not enabled/u).waitFor();
    await dialog.getByRole('button', { name: /Blank page/u }).waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '24-feature-off-existing-state.png'), fullPage: true });
    await browserFailures.assertPageNoFrameworkOverlay(page);
    await page.keyboard.press('Escape');

    const afterCounts = await persistedCounts(prisma, fixture.space.id);
    const featureOff = {
      canCreate: catalog.capabilities.canCreate,
      compositeWriteStatus: blocked.status,
      compositeWriteCode: blocked.body.code,
      existingRunId: enabledCompatibility.existingCompositeRunId,
      readableRunId: run.id,
      taskCount: run.tasks.length,
      reviewCount: run.reviews.length,
      execution,
      beforeCounts: enabledCompatibility.beforeCounts,
      afterCounts,
    };
    const proof = assertCompatibilityPersistence({
      oldPage: enabledCompatibility.oldPage,
      legacy: enabledCompatibility.legacy,
      folder: enabledCompatibility.folder,
      featureOff,
    });
    await browserFailures.settleResponses();
    browserFailures.assertNoPageErrors();
    await browserFailures.assertAllOpenPagesNoFrameworkOverlay();
    assert.deepEqual(browserFailures.consoleIssues, []);
    assert.deepEqual(browserFailures.failedResponses, []);
    return {
      ...featureOff,
      ...proof,
      consoleIssues: 0,
      pagesObservedForBrowserFailures: browserFailures.pages.length,
      pageErrors: browserFailures.pageErrors.length,
    };
  } finally {
    await context.tracing.stop({ path: join(artifactsDirectory, 'feature-off-chrome-trace.zip') }).catch(() => undefined);
    await context.close();
    await browser.close();
    await prisma.$disconnect();
  }
}

async function createOldSinglePage({ page, webOrigin, apiUrl, fixture }) {
  await authenticate(page, fixture, 'zh-CN');
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
  await page.getByRole('button', { name: '新建页面' }).click();
  const dialog = page.getByRole('dialog', { name: '创建新页面' });
  await dialog.getByRole('button', { name: /空白页面/u }).waitFor();
  await dialog.getByRole('button', { name: '下一步' }).click();
  const title = `旧单页兼容-${fixture.suffix}`;
  await dialog.getByLabel('标题').fill(title);
  await dialog.getByRole('button', { name: '创建' }).click();
  await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
  const pageId = new URL(page.url()).pathname.split('/')[2];
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.waitFor();
  const content = '# 旧单页兼容\n\n通过真实旧入口创建并编辑。';
  await editor.fill(content);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '保存成功' }).waitFor();
  const persisted = await request(apiUrl, `/pages/${pageId}`, { token: fixture.owner.access_token });
  assert.equal(persisted.title, title);
  assert.equal(persisted.content, content);
  return { id: pageId, title, content };
}

async function executeExistingRunWhileFeatureOff({
  page, webOrigin, apiUrl, prisma, fixture, runId, artifactsDirectory,
}) {
  assert.ok(runId, 'feature-off compatibility needs a pre-existing single-Page Run');
  const before = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
    token: fixture.owner.access_token,
  });
  const readyTask = before.tasks.find((task) => task.status === 'ready'
    && task.targetPageId && task.assigneeAgentId);
  assert.ok(readyTask?.targetPageId && readyTask.assigneeAgentId,
    'feature-off existing Run needs one executable Page task');
  const agent = Object.values(fixture.agents).find((candidate) => candidate.id === readyTask.assigneeAgentId);
  assert.ok(agent, 'feature-off executable task must belong to a fixture Agent');
  const client = await connectMcp(apiUrl, agent.apiKey, fixture.suffix);
  const submittedMarkdown = `# Feature-off existing Run\n\nPublished through protocol fixture transport ${fixture.suffix}`;
  let submitted;
  try {
    const joined = await callJsonTool(client, 'collaboration_join_run', { runId });
    assert.equal(joined.status, 'running');
    const claim = await callJsonTool(client, 'collaboration_next_action', {
      runId, waitSeconds: 0, idempotencyKey: `feature-off-claim-${randomUUID()}`,
    });
    assert.equal(claim.action, 'execute_task');
    assert.equal(claim.task.id, readyTask.id);
    for (const todo of claim.task.todos) {
      const updated = await callJsonTool(client, 'collaboration_update_todo', {
        runId, attemptId: claim.attemptId, todoId: todo.id, leaseToken: claim.leaseToken,
        status: 'done', evidence: [], idempotencyKey: `feature-off-todo-${randomUUID()}`,
      });
      assert.equal(updated.todo.status, 'done');
    }
    submitted = await callJsonTool(client, 'collaboration_submit_result', {
      runId, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
      artifact: { kind: 'markdown', markdown: submittedMarkdown, evidence: [] },
      idempotencyKey: `feature-off-submit-${randomUUID()}`,
    });
    assert.equal(submitted.action, 'submitted');
    assert.equal(submitted.runStatus, 'waiting_review');
  } finally {
    await client.close().catch(() => undefined);
  }

  const review = await prisma.collaborationReview.findFirstOrThrow({
    where: { runId, status: 'pending' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration/runs/${runId}`);
  await page.getByRole('heading', { name: 'Collaboration run' }).waitFor();
  await page.getByRole('button', { name: 'Load page comparison' }).click();
  await page.getByText('Proposed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Approve' });
  await dialog.getByLabel('Reason').fill('Publish an existing Run while new composite creation is disabled');
  await dialog.getByRole('button', { name: 'Confirm approve' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const finalRun = await poll(
    () => request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
      token: fixture.owner.access_token,
    }),
    (candidate) => candidate.status === 'completed',
  );
  await page.getByText('Run created from an existing Page group', { exact: true }).waitFor();
  assert.equal((await page.locator('body').innerText()).includes('collaboration.event.'), false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(artifactsDirectory, '25-feature-off-existing-run-published.png'), fullPage: true });
  const [publishedPage, approvedReview, pageVersionCount] = await Promise.all([
    prisma.page.findUniqueOrThrow({ where: { id: readyTask.targetPageId } }),
    prisma.collaborationReview.findUniqueOrThrow({ where: { id: review.id } }),
    prisma.pageVersion.count({ where: { pageId: readyTask.targetPageId, content: submittedMarkdown } }),
  ]);
  return {
    transport: 'protocol fixture APIs; no model execution',
    runId,
    taskId: readyTask.id,
    pageId: readyTask.targetPageId,
    submittedRunStatus: submitted.runStatus,
    reviewStatus: approvedReview.status,
    finalRunStatus: finalRun.status,
    submittedMarkdown,
    pageContent: publishedPage.content,
    pageVersionCount,
  };
}

async function connectMcp(apiUrl, apiKey, suffix) {
  const client = new Client({ name: `feature-off-compatibility-${suffix}`, version: '0.7.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  });
  await client.connect(transport);
  return client;
}

async function callJsonTool(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content?.find((item) => item.type === 'text')?.text;
  assert.notEqual(result.isError, true, `${name} failed: ${text ?? 'no text result'}`);
  assert.equal(typeof text, 'string');
  return JSON.parse(text);
}

async function createFromCollaborationEntry({ page, webOrigin, fixture, artifactsDirectory }) {
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration`);
  await page.getByRole('heading', { name: 'Agent 协作' }).waitFor();
  await page.getByRole('button', { name: '创建页面组协作' }).click();
  const dialog = page.getByRole('dialog', { name: '创建新页面' });
  await dialog.getByRole('button', { name: /项目管理工作区/u }).click();
  await dialog.getByRole('button', { name: '下一步' }).click();
  const rootName = dialog.getByLabel('根名称');
  await rootName.fill(`协作入口页面组-${fixture.suffix}`);
  await rootName.blur();
  const collaboration = dialog.getByRole('checkbox', { name: '启用 Agent 协作' });
  await waitForEnabled(collaboration);
  await collaboration.check();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await dialog.getByLabel(/项目目标/u).fill('验证协作入口的页面组与 Run 目的地相互独立。');
  for (const select of await dialog.getByRole('combobox').all()) await select.selectOption(fixture.agents.codex.id);
  await dialog.getByRole('button', { name: '刷新参与范围' }).click();
  await dialog.getByRole('button', { name: '创建并启动协作' }).click();
  await dialog.getByText('协作 Run 已创建。', { exact: true }).waitFor();
  const runHref = await dialog.getByRole('link', { name: '打开运行看板' }).getAttribute('href');
  assert.match(runHref ?? '', /\/collaboration\/runs\//u);
  await page.screenshot({ path: join(artifactsDirectory, '20-collaboration-entry-destinations.png'), fullPage: true });
  await dialog.getByRole('button', { name: '打开页面组' }).click();
  await page.waitForURL(/\/pages\/[^/]+\/edit$/u);
  assert.equal(page.url().includes('/collaboration/runs/'), false);
  return {
    runId: runHref.split('/').at(-1),
    runHref,
    groupHref: new URL(page.url()).pathname,
    firstPageId: new URL(page.url()).pathname.split('/')[2],
  };
}

async function exerciseFolderBulkBinding({
  page, webOrigin, apiUrl, fixture, prisma, rootFolderId, scopedPageIds, artifactsDirectory,
}) {
  const pageRecords = await prisma.page.findMany({
    where: { id: { in: scopedPageIds }, spaceId: fixture.space.id },
    select: { id: true, title: true },
  });
  const pageTitles = new Map(pageRecords.map((record) => [record.id, record.title]));
  const outsidePageId = scopedPageIds.at(-1);
  assert.ok(outsidePageId, 'Folder subset needs one Page outside the selected binding scope');
  const outsidePageTitle = pageTitles.get(outsidePageId);
  assert.ok(outsidePageTitle, 'Folder outside Page needs its persisted title');
  const selectedBindingPageIds = scopedPageIds.filter((pageId) => pageId !== outsidePageId);
  assert.ok(selectedBindingPageIds.length > 0, 'Folder subset needs at least one selected Page');

  await savePageBinding({
    page, webOrigin, pageId: outsidePageId, agentId: fixture.agents.opencode.id,
  });
  const [outsideBindingBefore, outsideAuditBefore] = await Promise.all([
    prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: outsidePageId } }),
    prisma.pageAgentBindingEvent.count({ where: { spaceId: fixture.space.id, pageId: outsidePageId } }),
  ]);

  await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
  await page.getByTestId(`content-agent-${rootFolderId}`).click();
  let dialog = page.getByRole('dialog', { name: 'Agent 绑定与协作设置' });
  await dialog.getByTestId('binding-page-scope').locator('li').first().waitFor();
  assert.equal(await dialog.getByTestId('binding-page-scope').locator('li').count(), scopedPageIds.length);
  await dialog.getByRole('checkbox', { name: `将 ${outsidePageTitle} 纳入绑定范围` }).uncheck();
  await dialog.getByRole('radio', { name: '批量替换所选页面的默认绑定' }).check();
  await dialog.getByLabel('批量替换为 Agent').selectOption(fixture.agents.codex.id);
  await dialog.getByRole('button', { name: '保存绑定' }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [bindings, outsideBindingAfter, outsideAuditAfter, folderBindingCount] = await Promise.all([
    prisma.pageAgentBinding.findMany({
      where: { spaceId: fixture.space.id, pageId: { in: selectedBindingPageIds } },
      select: { pageId: true, agentId: true },
    }),
    prisma.pageAgentBinding.findUniqueOrThrow({ where: { pageId: outsidePageId } }),
    prisma.pageAgentBindingEvent.count({ where: { spaceId: fixture.space.id, pageId: outsidePageId } }),
    prisma.pageAgentBinding.count({ where: { spaceId: fixture.space.id, pageId: rootFolderId } }),
  ]);
  assert.equal(bindings.length, selectedBindingPageIds.length);
  assert.equal(bindings.every((binding) => binding.agentId === fixture.agents.codex.id), true);
  assert.equal(folderBindingCount, 0, 'Folder itself must never receive a Page binding');
  assert.equal(outsideBindingAfter.agentId, fixture.agents.opencode.id);
  assert.equal(outsideBindingAfter.updatedAt.toISOString(), outsideBindingBefore.updatedAt.toISOString());
  assert.equal(outsideAuditAfter, outsideAuditBefore);

  await page.getByTestId(`content-agent-${rootFolderId}`).click();
  dialog = page.getByRole('dialog', { name: 'Agent 绑定与协作设置' });
  await dialog.getByRole('checkbox', { name: `将 ${outsidePageTitle} 纳入绑定范围` }).uncheck();
  await dialog.getByRole('radio', { name: /改用显式的简单页面职责/u }).check();
  await dialog.getByRole('checkbox', { name: '保存后立即启动协作' }).check();
  await dialog.getByRole('button', { name: '预览本次协作' }).click();
  const preview = dialog.locator('section').filter({ hasText: '本次 Run 权威预览' });
  const tasks = preview.getByRole('checkbox');
  await tasks.first().waitFor();
  const taskCount = await tasks.count();
  assert.equal(taskCount, selectedBindingPageIds.length);
  await tasks.last().uncheck();
  await dialog.getByRole('button', { name: '预览本次协作' }).click();
  await waitForEnabled(dialog.getByRole('button', { name: '保存绑定并启动' }));
  await page.screenshot({ path: join(artifactsDirectory, '21-folder-bulk-explicit-selection.png'), fullPage: true });
  await dialog.getByRole('button', { name: '保存绑定并启动' }).click();
  await dialog.getByRole('heading', { name: '绑定已保存，Run 已启动' }).waitFor();
  const runHref = await dialog.getByRole('link', { name: '打开运行看板' }).getAttribute('href');
  const runId = runHref?.split('/').at(-1);
  assert.ok(runId);
  const run = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
    token: fixture.owner.access_token,
  });
  const selectedTaskPageIds = run.tasks.flatMap((task) => task.targetPageId ? [task.targetPageId] : []);
  assert.equal(selectedTaskPageIds.length, selectedBindingPageIds.length - 1);
  const runParticipantAgentIds = run.joinInstructions.map((instruction) => instruction.agentId);
  assert.equal(runParticipantAgentIds.includes(fixture.agents.opencode.id), false,
    'the outside Page binding must not become a participant or join instruction');
  await page.keyboard.press('Escape');
  return {
    folderId: rootFolderId,
    discoveredPageIds: scopedPageIds,
    selectedBindingPageIds,
    bindingPageIds: bindings.map((binding) => binding.pageId),
    selectedTaskPageIds,
    outsidePageId,
    outsideAgentId: fixture.agents.opencode.id,
    outsideBindingAgentId: outsideBindingAfter.agentId,
    outsideBindingUnchanged: outsideBindingAfter.updatedAt.toISOString() === outsideBindingBefore.updatedAt.toISOString()
      && outsideAuditAfter === outsideAuditBefore,
    runParticipantAgentIds,
    runId,
  };
}

async function savePageBinding({ page, webOrigin, pageId, agentId }) {
  await page.goto(`${webOrigin}/pages/${pageId}/edit`);
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  await page.getByRole('button', { name: 'Agent / 协作设置' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 绑定与协作设置' });
  await dialog.getByLabel('主责 Agent').selectOption(agentId);
  await dialog.getByRole('button', { name: '保存绑定' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('status').filter({ hasText: 'Agent 绑定已保存' }).waitFor();
}

async function startAndArchiveLegacyRun({ page, webOrigin, apiUrl, fixture, artifactsDirectory }) {
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration`);
  const systemCard = page.locator('article').filter({ hasText: '系统模板' }).first();
  await systemCard.getByRole('link', { name: '启动协作' }).click();
  await page.getByRole('heading', { name: '1. 工作输入' }).waitFor();
  const name = `旧协作历史-${fixture.suffix}`;
  await page.getByLabel('运行名称').fill(name);
  for (const control of await page.locator('main input[aria-label], main textarea[aria-label]').all()) {
    const type = await control.getAttribute('type');
    const label = await control.getAttribute('aria-label');
    if (label === '运行名称') continue;
    if (type === 'checkbox') await control.check();
    else if (type === 'number') await control.fill('1');
    else if (type === 'url') await control.fill('https://example.test/legacy');
    else await control.fill('旧协作兼容输入');
  }
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByRole('heading', { name: '2. 映射 Agent' }).waitFor();
  for (const select of await page.getByRole('combobox').all()) await select.selectOption(fixture.agents.codex.id);
  await page.getByRole('button', { name: '下一页' }).click();
  await page.getByRole('heading', { name: '3. 确认并启动' }).waitFor();
  const separation = page.getByRole('checkbox', { name: /职责分离风险/u });
  if (await separation.count()) await separation.check();
  await page.getByRole('button', { name: '启动协作' }).click();
  await page.getByRole('heading', { name: '协作已启动' }).waitFor();
  const runLink = page.getByRole('link', { name: '打开运行看板' });
  const runId = (await runLink.getAttribute('href')).split('/').at(-1);
  await runLink.click();
  await page.getByRole('heading', { name }).waitFor();
  await page.getByRole('button', { name: '取消运行' }).click();
  await page.getByLabel('原因').fill('兼容性历史验收');
  await page.getByRole('button', { name: /确认.*取消运行/u }).click();
  await poll(async () => request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
    token: fixture.owner.access_token,
  }), (run) => run.status === 'cancelled');
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration`);
  await page.getByRole('tab', { name: '历史记录' }).click();
  await page.getByRole('link', { name }).waitFor();
  await page.screenshot({ path: join(artifactsDirectory, '22-legacy-run-history.png'), fullPage: true });
  return { runId, status: 'cancelled', historyRunIds: [runId] };
}

async function exerciseEnglishMobileMatrix({ page, webOrigin, fixture, existingCompositeRunId, artifactsDirectory }) {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, fixture, 'en');
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration/runs/${existingCompositeRunId}`);
  await page.getByText('Current Page adopted to resolve conflict', { exact: true }).waitFor();
  await page.getByText('Page conflict regenerated from the current Page', { exact: true }).waitFor();
  assert.equal((await page.locator('body').innerText()).includes('collaboration.event.'), false);
  await assertNoOverflow(page);
  assert.equal(await page.title(), 'AgentWiki');
  assert.equal((await page.locator('body').innerText()).trim().length > 50, true);

  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration`);
  const trigger = page.getByRole('button', { name: 'Create page group collaboration' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create new page' });
  await dialog.waitFor();
  await assertDialogFitsViewport(dialog);
  await page.screenshot({ path: join(artifactsDirectory, '26-mobile-en-select.png'), fullPage: true });
  await page.keyboard.press('Tab');
  assert.equal(await dialog.locator(':focus').count(), 1);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await assertNoOverflow(page);
  await page.screenshot({ path: join(artifactsDirectory, '23-mobile-en-keyboard.png'), fullPage: true });

  await trigger.focus();
  await page.keyboard.press('Enter');
  await dialog.waitFor();
  const projectTemplate = dialog.getByRole('button', { name: /Project management workspace/u });
  await projectTemplate.focus();
  await page.keyboard.press('Enter');
  const next = dialog.getByRole('button', { name: 'Next', exact: true });
  await next.focus();
  await page.keyboard.press('Enter');
  const tree = dialog.getByRole('tree');
  await tree.waitFor();
  assert.equal(await tree.getByRole('treeitem').count() > 1, true, '390px preview must render the nested project tree');
  await assertNoOverflow(page);
  await assertDialogFitsViewport(dialog);
  await page.screenshot({ path: join(artifactsDirectory, '27-mobile-en-preview.png'), fullPage: true });

  const collaboration = dialog.getByRole('checkbox', { name: 'Enable Agent collaboration' });
  await collaboration.focus();
  await page.keyboard.press('Space');
  await waitForEnabled(next);
  await next.focus();
  await page.keyboard.press('Enter');
  await dialog.getByText('Configure collaboration', { exact: true }).waitFor();
  const projectBrief = 'Validate the narrow-screen preview, roles, and task scope.';
  await dialog.getByLabel(/Project brief/u).fill(projectBrief);
  const roleSelectors = await dialog.getByRole('combobox').all();
  assert.equal(roleSelectors.length, 3, '390px configuration must expose all project roles');
  for (const select of roleSelectors) await select.selectOption(fixture.agents.codex.id);
  const taskScope = dialog.getByRole('group', { name: 'Tasks included in this run' });
  assert.equal(await taskScope.getByRole('checkbox').count(), 7, '390px configuration must expose all project Page tasks');
  await dialog.getByRole('button', { name: 'Refresh participant scope' }).click();
  await dialog.getByTestId('participant-preview').getByText(fixture.agents.codex.name, { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel(/Project brief/u).inputValue(), projectBrief,
    'participant refresh must retain the configured workflow input');
  for (const select of roleSelectors) assert.equal(await select.inputValue(), fixture.agents.codex.id,
    'participant refresh must retain every configured role');
  assert.equal(await taskScope.getByRole('checkbox', { checked: true }).count(), 7,
    'participant refresh must retain the configured Page task scope');
  await assertNoOverflow(page);
  await assertDialogFitsViewport(dialog);
  await page.screenshot({ path: join(artifactsDirectory, '28-mobile-en-configured.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await authenticate(page, fixture, 'zh-CN');
  return {
    width: 390,
    locale: 'en',
    keyboardEscapeFocusRestored: true,
    horizontalOverflow: false,
    projectPreviewTree: true,
    collaborationRoleCount: roleSelectors.length,
    taskSelectionVisible: true,
  };
}

async function persistedCounts(prisma, spaceId) {
  const [pages, runs, instantiations] = await Promise.all([
    prisma.page.count({ where: { spaceId } }),
    prisma.collaborationRun.count({ where: { spaceId } }),
    prisma.templateInstantiation.count({ where: { spaceId } }),
  ]);
  return { pages, runs, instantiations };
}

async function authenticate(page, fixture, locale) {
  await page.addInitScript(({ token, user, locale: language }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', language);
  }, { token: fixture.owner.access_token, user: fixture.owner.user, locale });
  await page.evaluate(({ token, user, locale: language }) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('agentwiki.language.v1', language);
  }, { token: fixture.owner.access_token, user: fixture.owner.user, locale }).catch(() => undefined);
}

async function assertNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `expected no horizontal overflow, got ${overflow}px`);
}

async function assertDialogFitsViewport(dialog) {
  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      horizontalOverflow: element.scrollWidth - element.clientWidth,
      left: rect.left,
      right: rect.right,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(geometry.horizontalOverflow <= 0, true, `dialog horizontal overflow: ${geometry.horizontalOverflow}px`);
  assert.equal(geometry.left >= 0 && geometry.right <= geometry.viewportWidth, true,
    `dialog bounds ${geometry.left}..${geometry.right} exceed viewport ${geometry.viewportWidth}`);
}

async function waitForEnabled(locator) {
  await poll(() => locator.isEnabled(), Boolean);
}

async function poll(read, done, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Compatibility journey timed out waiting for authoritative state');
}

async function request(apiUrl, path, { method = 'GET', token, body } = {}) {
  const response = await requestResponse(apiUrl, path, { method, token, body });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path} failed with ${response.status}`);
  }
  return response.body;
}

async function requestResponse(apiUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  let parsed;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
}
