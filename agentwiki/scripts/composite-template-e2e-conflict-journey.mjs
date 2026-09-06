import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { assertConcurrentPageConflictPersistence, waitForExpectedConflictEvents } from './composite-template-e2e-support.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { Client } = requireFromServer('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = requireFromServer('@modelcontextprotocol/sdk/client/streamableHttp.js');

export async function runConcurrentPageConflictJourney({
  page,
  webOrigin,
  apiUrl,
  databaseUrl,
  fixture,
  artifactsDirectory,
  browserFailures,
}) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let client;
  try {
    const runs = await prisma.collaborationRun.findMany({
      where: { spaceId: fixture.space.id, status: 'running' },
      include: { tasks: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const run = runs.find((candidate) => candidate.tasks.length > 1);
    assert.ok(run, 'concurrent conflict journey needs the collaboration-on composite Run');
    const readyTask = run.tasks.find((task) => task.status === 'ready' && task.targetPageId && task.assigneeAgentId);
    assert.ok(readyTask?.targetPageId && readyTask.assigneeAgentId,
      'concurrent conflict journey needs one ready Page task');
    const agent = Object.values(fixture.agents).find((candidate) => candidate.id === readyTask.assigneeAgentId);
    assert.ok(agent, 'ready task assignee must use a fixture Agent credential');

    client = await connectMcp(apiUrl, agent.apiKey, fixture.suffix);
    const joined = await callJsonTool(client, 'collaboration_join_run', { runId: run.id });
    assert.equal(joined.status, 'running');
    const firstCandidate = `# Fixture candidate one\n\nProtocol fixture transport ${fixture.suffix}`;
    const first = await submitFixtureCandidate({ client, prisma, runId: run.id, markdown: firstCandidate, key: 'first' });
    assert.equal(first.targetPageId, readyTask.targetPageId);

    const humanFirst = `# Human edit one\n\nBrowser-authoritative ${fixture.suffix}`;
    await editPageThroughBrowser(page, webOrigin, readyTask.targetPageId, humanFirst);
    const firstConflictResponse = await attemptApprovalConflict({
      page, webOrigin, fixture, runId: run.id, reviewId: first.reviewId,
      reason: '验证并发修改不被候选覆盖',
      browserFailures,
    });
    const firstConflictRows = await conflictRows(prisma, run.id, first);
    assert.equal(firstConflictRows.page.content, humanFirst);
    await closeApprovalDialogWithEscape(page);
    await loadLatestPageComparison(page);
    await page.getByText('页面在本次执行基线后发生了变化，通过操作不会覆盖它。', { exact: true }).waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '17-page-conflict-persisted.png'), fullPage: true });
    await browserFailures.assertPageNoFrameworkOverlay(page);

    const regenerateResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/spaces/${fixture.space.id}/collaboration/runs/${run.id}/tasks/${readyTask.id}/page-conflict`);
    await page.getByRole('button', { name: '基于当前页面重新生成' }).click();
    const regenerateResponse = await regenerateResponsePromise;
    assert.equal(regenerateResponse.ok(), true);
    const regenerateResult = await regenerateResponse.json();
    assert.deepEqual({ kind: regenerateResult.kind, taskId: regenerateResult.taskId, generation: regenerateResult.generation }, {
      kind: 'regenerate', taskId: readyTask.id, generation: 2,
    });

    const regeneratedTask = await prisma.collaborationRunTask.findUniqueOrThrow({ where: { id: readyTask.id } });
    const regeneratedAttempt = await submitFixtureCandidate({
      client, prisma, runId: run.id,
      markdown: `# Fixture candidate two\n\nRegenerated fixture transport ${fixture.suffix}`,
      key: 'second',
    });
    assert.equal(regeneratedAttempt.generation, 2);
    const firstAfterRegenerate = await conflictRows(prisma, run.id, first);

    const humanChosen = `# Human chosen version\n\nAdopt this browser edit ${fixture.suffix}`;
    await editPageThroughBrowser(page, webOrigin, readyTask.targetPageId, humanChosen);
    const secondConflictResponse = await attemptApprovalConflict({
      page, webOrigin, fixture, runId: run.id, reviewId: regeneratedAttempt.reviewId,
      reason: '再次验证并发修改并采纳人工版本',
      browserFailures,
    });
    const secondConflictRows = await conflictRows(prisma, run.id, regeneratedAttempt);
    assert.equal(secondConflictRows.page.content, humanChosen);
    await closeApprovalDialogWithEscape(page);
    await loadLatestPageComparison(page);
    await page.getByText('页面在本次执行基线后发生了变化，通过操作不会覆盖它。', { exact: true }).waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '18-page-conflict-before-adopt.png'), fullPage: true });
    await browserFailures.assertPageNoFrameworkOverlay(page);

    const adoptResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/spaces/${fixture.space.id}/collaboration/runs/${run.id}/tasks/${readyTask.id}/page-conflict`);
    await page.getByRole('button', { name: '采纳当前页面' }).click();
    const adoptResponse = await adoptResponsePromise;
    assert.equal(adoptResponse.ok(), true);
    const adoptResult = await adoptResponse.json();
    assert.equal(adoptResult.kind, 'adopt_current');
    assert.equal(adoptResult.taskId, readyTask.id);
    assert.equal(typeof adoptResult.pageVersionId, 'string');
    await page.getByText('页面冲突已解决；若工作恢复，请复制新的 Agent 指令。', { exact: true }).waitFor();

    const pageAfterAdopt = await prisma.page.findUniqueOrThrow({ where: { id: readyTask.targetPageId } });
    const adoptedReview = await prisma.collaborationReview.findUniqueOrThrow({
      where: { id: regeneratedAttempt.reviewId }, include: { artifact: true },
    });
    const staleSecondArtifact = await prisma.collaborationTaskArtifact.findUniqueOrThrow({
      where: { id: regeneratedAttempt.artifactId },
    });
    const staleSecondChangeSet = await prisma.changeSet.findUniqueOrThrow({
      where: { id: regeneratedAttempt.changeSetId },
    });
    const adoptedPayload = adoptedReview.artifact.payload;
    const proof = assertConcurrentPageConflictPersistence({
      humanFirst,
      humanChosen,
      firstConflict: {
        runStatus: firstConflictRows.run.status,
        pauseReason: firstConflictRows.run.pauseReason,
        reviewStatus: firstConflictRows.review.status,
        pageContent: firstConflictRows.page.content,
      },
      regenerated: {
        generation: regeneratedTask.generation,
        baseContentHash: regeneratedAttempt.baseContentHash,
        expectedBaseContentHash: hash(humanFirst),
        changeSetStatus: firstAfterRegenerate.changeSet.status,
        artifactStatus: firstAfterRegenerate.artifact.status,
      },
      secondConflict: {
        runStatus: secondConflictRows.run.status,
        pauseReason: secondConflictRows.run.pauseReason,
        reviewStatus: secondConflictRows.review.status,
        pageContent: secondConflictRows.page.content,
      },
      adopted: {
        pageContent: pageAfterAdopt.content,
        reviewStatus: adoptedReview.status,
        adoptedArtifactStatus: adoptedReview.artifact.status,
        adoptedMarkdown: adoptedPayload.markdown,
        adoptedPageVersionId: adoptedPayload.adoptedCurrentPage?.pageVersionId,
        currentPageVersionId: adoptResult.pageVersionId,
        staleArtifactStatus: staleSecondArtifact.status,
        staleChangeSetStatus: staleSecondChangeSet.status,
      },
    });
    await page.screenshot({ path: join(artifactsDirectory, '19-page-conflict-adopted.png'), fullPage: true });
    await browserFailures.assertPageNoFrameworkOverlay(page);
    return {
      transport: 'protocol fixture APIs; no model execution',
      runId: run.id,
      taskId: readyTask.id,
      targetPageId: readyTask.targetPageId,
      firstChangeSetId: first.changeSetId,
      secondChangeSetId: regeneratedAttempt.changeSetId,
      expectedConflictResponses: [firstConflictResponse, secondConflictResponse],
      ...proof,
    };
  } finally {
    await client?.close().catch(() => undefined);
    await prisma.$disconnect();
  }
}

async function connectMcp(apiUrl, apiKey, suffix) {
  const client = new Client({ name: `composite-conflict-fixture-${suffix}`, version: '0.7.0' });
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

async function submitFixtureCandidate({ client, prisma, runId, markdown, key }) {
  const claim = await callJsonTool(client, 'collaboration_next_action', {
    runId, waitSeconds: 0, idempotencyKey: `conflict-${key}-claim`,
  });
  assert.equal(claim.action, 'execute_task');
  for (const todo of claim.task.todos) {
    const updated = await callJsonTool(client, 'collaboration_update_todo', {
      runId, attemptId: claim.attemptId, todoId: todo.id, leaseToken: claim.leaseToken,
      status: 'done', evidence: [], idempotencyKey: `conflict-${key}-todo-${todo.ordinal}`,
    });
    assert.equal(updated.todo.status, 'done');
  }
  const submitted = await callJsonTool(client, 'collaboration_submit_result', {
    runId, attemptId: claim.attemptId, leaseToken: claim.leaseToken,
    artifact: { kind: 'markdown', markdown, evidence: [] },
    idempotencyKey: `conflict-${key}-submit`,
  });
  assert.equal(submitted.action, 'submitted');
  assert.equal(submitted.runStatus, 'waiting_review');
  const [attempt, review, link] = await Promise.all([
    prisma.collaborationTaskAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } }),
    prisma.collaborationReview.findFirstOrThrow({ where: { artifactId: submitted.artifactId } }),
    prisma.collaborationArtifactChangeSetLink.findUniqueOrThrow({ where: { artifactId: submitted.artifactId } }),
  ]);
  return {
    artifactId: submitted.artifactId,
    reviewId: review.id,
    changeSetId: link.changeSetId,
    targetPageId: claim.task.outputRequirements.targetPageId,
    generation: attempt.generation,
    baseContentHash: attempt.baseContentHash,
  };
}

async function editPageThroughBrowser(page, webOrigin, pageId, content) {
  await page.goto(`${webOrigin}/pages/${pageId}/edit`);
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await editor.waitFor();
  await editor.fill(content);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '保存成功' }).waitFor();
}

async function attemptApprovalConflict({
  page, webOrigin, fixture, runId, reviewId, reason, browserFailures,
}) {
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration/runs/${runId}`);
  await page.getByRole('heading', { name: '协作运行' }).waitFor();
  await loadLatestPageComparison(page);
  await page.getByRole('button', { name: '通过', exact: true }).click();
  const actionDialog = page.getByRole('dialog', { name: '通过' });
  await actionDialog.getByLabel('原因').fill(reason);
  const pathname = `/api/spaces/${fixture.space.id}/collaboration/runs/${runId}/reviews/${reviewId}/decision`;
  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
    && new URL(response.url()).pathname === pathname);
  const response = await browserFailures.runAction(
    page,
    'review-decision-page-conflict',
    () => waitForExpectedConflictEvents(page, `${webOrigin}${pathname}`, responsePromise,
      () => actionDialog.getByRole('button', { name: '确认 通过' }).click()),
  );
  const body = await response.json();
  assert.equal(response.status(), 409);
  assert.equal(body.code, 'PAGE_VERSION_CONFLICT');
  await poll(async () => {
    const run = await request(`http://${new URL(response.url()).host}/api`,
      `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, { token: fixture.owner.access_token });
    return run.status === 'paused' && run.pauseReason === 'page_version_conflict';
  });
  await waitForEnabled(actionDialog.getByRole('button', { name: '确认 通过' }));
  return {
    action: 'review-decision-page-conflict',
    pageId: browserFailures.pageId(page),
    method: response.request().method(),
    pathname,
    url: response.url(),
    status: response.status(),
    code: body.code,
  };
}

async function loadLatestPageComparison(page) {
  const buttons = page.getByRole('button', { name: '加载页面对比' });
  await buttons.last().click();
  await page.getByText('建议修改', { exact: true }).last().waitFor();
}

async function closeApprovalDialogWithEscape(page) {
  const dialog = page.getByRole('dialog', { name: '通过' });
  const reason = dialog.getByLabel('原因');
  await waitForFocused(reason);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}

async function conflictRows(prisma, runId, submission) {
  const [run, review, page, artifact, changeSet] = await Promise.all([
    prisma.collaborationRun.findUniqueOrThrow({ where: { id: runId } }),
    prisma.collaborationReview.findUniqueOrThrow({ where: { id: submission.reviewId } }),
    prisma.page.findUniqueOrThrow({ where: { id: submission.targetPageId } }),
    prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: submission.artifactId } }),
    prisma.changeSet.findUniqueOrThrow({ where: { id: submission.changeSetId } }),
  ]);
  return { run, review, page, artifact, changeSet };
}

async function request(apiUrl, path, { token } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`);
  return body;
}

async function poll(predicate) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('timed out waiting for authoritative conflict state');
}

async function waitForEnabled(locator) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('timed out waiting for the approval dialog to leave submitting state');
}

async function waitForFocused(locator) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await locator.evaluate((element) => element === document.activeElement)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('approval conflict refresh must naturally restore focus inside the dialog');
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
