#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTestRedisAvailable, resolveTestRedisTarget } from './e2e-safety.mjs';
import {
  runHistoricalPageBindingJourney,
  runSavedFolderTemplateJourney,
} from './composite-template-e2e-browser-journeys.mjs';
import { runConcurrentPageConflictJourney } from './composite-template-e2e-conflict-journey.mjs';
import {
  runEnabledCompatibilityJourney,
  runFeatureOffCompatibilityJourney,
} from './composite-template-e2e-compatibility-journey.mjs';
import {
  acceptanceChildEnvironment,
  acceptanceCompletionStatus,
  assertCollaborationOffPersistence,
  assertExternalAgentReceipt,
  assertPublishedPageVersionPair,
  partitionExpectedConsoleIssues,
  buildExternalAgentStagePrompt,
  collectContentTree,
  externalAgentClientArgs,
  externalAgentClientEnvironment,
  externalAgentGatewayFiles,
  extractCollaborationToolReceipt,
  selectExternalAgentStages,
  selectExternalAgentRoleAssignments,
  validateCompositeTemplateE2EDatabaseUrl,
  withCompositeTemplateE2EDatabase,
} from './composite-template-e2e-support.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromClient = createRequire(new URL('../apps/client/package.json', import.meta.url));
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

const command = process.argv[2] ?? 'run';
const databaseUrl = validateCompositeTemplateE2EDatabaseUrl(
  process.env.COMPOSITE_TEMPLATE_E2E_DATABASE_URL ?? process.env.PAGE_TEMPLATE_TEST_DATABASE_URL,
);
const redisTarget = resolveTestRedisTarget(
  process.env.COMPOSITE_TEMPLATE_E2E_REDIS_URL ?? process.env.TEST_REDIS_URL,
  { enabled: true },
);

if (command === 'plan') {
  process.stdout.write(`${JSON.stringify({
    status: 'ready',
    databaseIsolation: 'one random mac_e2e_* schema',
    browser: 'repo Playwright with installed Chrome',
    viewports: ['desktop', '390px'],
    locales: ['zh-CN', 'en'],
    scenarios: 6,
    externalAgents: ['codex', 'claude-or-opencode-fallback'],
  })}\n`);
} else if (command === 'startup' || command === 'run') {
  assertTestRedisAvailable(redisTarget);
  await runAcceptanceStartup(databaseUrl.toString(), redisTarget.url, { full: command === 'run' });
} else {
  throw new Error('Usage: node scripts/composite-template-e2e.mjs <plan|startup|run>');
}

async function runAcceptanceStartup(baseDatabaseUrl, redisUrl, { full }) {
  await withCompositeTemplateE2EDatabase(baseDatabaseUrl, async ({
    databaseUrl: generatedDatabaseUrl,
    schemaName,
    migrationTreeDigest,
    publicInventoryDigest,
  }) => {
    const apiPort = await availablePort();
    const webPort = await availablePort();
    const webOrigin = `http://127.0.0.1:${webPort}`;
    const baseEnvironment = acceptanceChildEnvironment({
      parent: process.env,
      databaseUrl: generatedDatabaseUrl,
      redisUrl,
      apiPort,
      webOrigin,
      spaceId: '',
    });
    let api = startProcess('api', process.execPath, [resolve(root, 'apps/server/dist/main.js')], baseEnvironment);
    let worker;
    let vite;
    try {
      await waitForHealth(`http://127.0.0.1:${apiPort}/api`, api);
      const fixture = await prepareFixture(`http://127.0.0.1:${apiPort}/api`);
      await stopProcess(api);
      const environment = { ...baseEnvironment, COMPOSITE_TEMPLATE_SPACE_ALLOWLIST: fixture.space.id };
      api = startProcess('api', process.execPath, [resolve(root, 'apps/server/dist/main.js')], environment);
      await waitForHealth(`http://127.0.0.1:${apiPort}/api`, api);
      worker = startProcess('worker', process.execPath, [resolve(root, 'apps/server/dist/worker.js')], {
        ...environment,
        PROCESS_ROLE: 'worker',
      });
      await waitForOutput(worker, /AgentWiki ingestion worker started/u, 30_000);
      vite = startProcess('vite', process.execPath, [
        resolve(root, 'apps/client/node_modules/vite/bin/vite.js'), '--config', 'vite.config.ts',
        '--host', '127.0.0.1', '--port', String(webPort), '--strictPort',
      ], { ...process.env, AGENTWIKI_DEV_API_ORIGIN: `http://127.0.0.1:${apiPort}` }, resolve(root, 'apps/client'));
      await waitForWeb(webOrigin, vite);
      const proxyHealth = await fetch(`${webOrigin}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (!proxyHealth.ok || (await proxyHealth.json()).status !== 'ok') {
        throw new Error('Vite API proxy did not reach the isolated API');
      }
      const artifactsDirectory = await acceptanceArtifactsDirectory();
      let browserEvidence = full
        ? await runChromeAcceptance({
          webOrigin,
          apiUrl: `http://127.0.0.1:${apiPort}/api`,
          databaseUrl: generatedDatabaseUrl,
          fixture,
          artifactsDirectory,
        })
        : undefined;
      if (browserEvidence) {
        await stopProcess(worker);
        worker = undefined;
        await stopProcess(api);
        api = undefined;
        const featureOffEnvironment = { ...baseEnvironment, COMPOSITE_TEMPLATE_SPACE_ALLOWLIST: '' };
        api = startProcess('api', process.execPath, [resolve(root, 'apps/server/dist/main.js')], featureOffEnvironment);
        await waitForHealth(`http://127.0.0.1:${apiPort}/api`, api);
        const featureOff = await runFeatureOffCompatibilityJourney({
          webOrigin,
          apiUrl: `http://127.0.0.1:${apiPort}/api`,
          databaseUrl: generatedDatabaseUrl,
          fixture,
          artifactsDirectory,
          enabledCompatibility: browserEvidence.compatibility,
        });
        browserEvidence = {
          ...browserEvidence,
          scenariosPassed: 6,
          compatibility: { ...browserEvidence.compatibility, featureOff },
        };
      }
      process.stdout.write(`${JSON.stringify({
        status: acceptanceCompletionStatus(full, browserEvidence), schemaName, apiPort, webPort,
        spaceId: fixture.space.id,
        migrationTreeDigest, publicInventoryDigest,
        ...(browserEvidence ? { browserEvidence, artifactsDirectory } : {}),
      })}\n`);
    } finally {
      await stopProcess(vite);
      await stopProcess(worker);
      await stopProcess(api);
      await assertPortReleased(apiPort, 'API');
      await assertPortReleased(webPort, 'Vite');
    }
  });
  process.stdout.write(`${JSON.stringify({ status: 'CLEANED' })}\n`);
}

async function prepareFixture(apiUrl) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const owner = await request(apiUrl, '/auth/register', {
    method: 'POST',
    body: {
      email: `composite-owner-${suffix}@example.test`,
      password: `Acceptance-${suffix}!`,
      name: 'Composite acceptance owner',
    },
  });
  const space = await request(apiUrl, '/spaces', {
    method: 'POST', token: owner.access_token,
    body: { name: `Composite acceptance ${suffix}` },
  });
  const agents = {
    codex: await createConnectedAgent(apiUrl, owner.access_token, space.id, `Codex composite ${suffix}`),
    opencode: await createConnectedAgent(apiUrl, owner.access_token, space.id, `OpenCode composite ${suffix}`),
  };
  return { owner, space, agents, suffix };
}

async function createConnectedAgent(apiUrl, token, spaceId, name) {
  const agent = await request(apiUrl, '/agents', { method: 'POST', token, body: { name } });
  const installation = await request(apiUrl, `/agents/${agent.id}/local-sync-installations`, {
    method: 'POST', token, body: { spaceId, role: 'publisher', pluginVersion: '0.7.0' },
  });
  const exchange = await request(apiUrl, '/integrations/local-sync/exchange', {
    method: 'POST', body: { code: installation.code },
  });
  return { id: agent.id, name, credentialId: exchange.credentialId, apiKey: exchange.apiKey };
}

async function acceptanceArtifactsDirectory() {
  const configured = process.env.COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR;
  if (configured) {
    if (!isAbsolute(configured)) throw new Error('COMPOSITE_TEMPLATE_E2E_ARTIFACTS_DIR must be absolute');
    await mkdir(configured, { recursive: true, mode: 0o700 });
    return configured;
  }
  return mkdtemp(join(tmpdir(), 'agentwiki-composite-template-e2e-evidence-'));
}

async function runChromeAcceptance({ webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory }) {
  const { chromium } = requireFromClient('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const consoleIssues = [];
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) consoleIssues.push(`${message.type()}: ${message.text()}`);
  });
  try {
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    }, { token: fixture.owner.access_token, user: fixture.owner.user });
    await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
    await page.getByRole('heading', { name: fixture.space.name }).waitFor();
    assert.equal(await page.title(), 'AgentWiki');
    assert.equal(await page.locator('body').innerText().then((text) => text.trim().length > 50), true);

    const newPage = page.getByRole('button', { name: '新建页面' });
    await newPage.click();
    await page.getByRole('dialog', { name: '创建新页面' }).waitFor();
    await page.keyboard.press('Escape');
    await newPage.waitFor();
    assert.equal(await newPage.evaluate((element) => element === document.activeElement), true);
    await newPage.click();
    await page.getByRole('button', { name: /项目管理工作区/u }).click();
    await page.getByRole('button', { name: '下一步' }).click();
    const treeRevisionBefore = (await prisma.space.findUniqueOrThrow({
      where: { id: fixture.space.id }, select: { contentTreeRevision: true },
    })).contentTreeRevision;
    const rootName = page.getByLabel('根名称');
    await rootName.fill('离线项目验收工作区');
    await rootName.blur();
    const collaboration = page.getByRole('checkbox', { name: '启用 Agent 协作' });
    assert.equal(await collaboration.isChecked(), false);
    await page.getByRole('button', { name: '创建页面组' }).click();
    await page.getByRole('heading', { name: '创建完成' }).waitFor();
    assert.equal(await page.getByText(/运行已启动/u).count(), 0);
    const openGroup = page.getByRole('button', { name: '打开页面组' });
    await openGroup.waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '01-collaboration-off-desktop.png'), fullPage: true });
    await openGroup.click();
    await page.getByTestId('content-tree').waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '02-collaboration-off-tree.png'), fullPage: true });

    const nodes = await collectContentTree(async (parentFolderId, cursor) => {
      const query = new URLSearchParams({ take: '200' });
      if (parentFolderId) query.set('parentFolderId', parentFolderId);
      if (cursor) query.set('cursor', cursor);
      return request(apiUrl, `/spaces/${fixture.space.id}/content-tree?${query}`, { token: fixture.owner.access_token });
    });
    assert.equal(nodes.length, 11, `expected complete nested tree, got ${nodes.length}`);
    assert.equal(nodes.some((node) => node.kind === 'folder' && node.name === '离线项目验收工作区'), true);
    const activeRuns = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs?status=active&limit=100`, { token: fixture.owner.access_token });
    const historicRuns = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs?status=history&limit=100`, { token: fixture.owner.access_token });
    assert.equal(activeRuns.items.length + historicRuns.items.length, 0);
    const instantiations = await prisma.templateInstantiation.findMany({
      where: { spaceId: fixture.space.id }, include: { nodes: { select: { pageId: true } } },
    });
    assert.equal(instantiations.length, 1, 'collaboration-off flow needs exactly one TemplateInstantiation before ordinary editing');
    const createdPageIds = instantiations[0].nodes.flatMap((node) => node.pageId ? [node.pageId] : []);
    const bindingCount = await prisma.pageAgentBinding.count({
      where: { spaceId: fixture.space.id, pageId: { in: createdPageIds } },
    });
    const treeRevisionAfter = (await prisma.space.findUniqueOrThrow({
      where: { id: fixture.space.id }, select: { contentTreeRevision: true },
    })).contentTreeRevision;
    const collaborationOffPersistence = assertCollaborationOffPersistence({
      beforeTreeRevision: treeRevisionBefore,
      afterTreeRevision: treeRevisionAfter,
      instantiation: instantiations[0],
      bindingCount,
    });
    const editablePage = nodes.find((node) => node.kind === 'page' || typeof node.title === 'string');
    assert.ok(editablePage?.id, 'created tree needs an editable Page');
    await page.goto(`${webOrigin}/pages/${editablePage.id}/edit`);
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await editor.waitFor();
    await editor.fill('# 浏览器持久化编辑\n\n协作关闭时仍可正常编辑。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '保存成功' }).waitFor();
    const persistedPage = await request(apiUrl, `/pages/${editablePage.id}`, { token: fixture.owner.access_token });
    assert.match(persistedPage.content, /浏览器持久化编辑/u);
    await page.screenshot({ path: join(artifactsDirectory, '03-collaboration-off-edit-saved.png'), fullPage: true });
    await page.reload();
    await editor.waitFor();
    assert.match(await editor.innerText(), /浏览器持久化编辑/u);
    await page.screenshot({ path: join(artifactsDirectory, '04-collaboration-off-edit-reloaded.png'), fullPage: true });
    const externalStageSelection = process.env.COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES ?? 'all';
    const collaborationOn = await runCollaborationOnJourney({
      page, webOrigin, apiUrl, fixture, artifactsDirectory, externalStageSelection,
    });
    const externalAgents = await runRealExternalAgentJourney({
      page,
      webOrigin,
      apiUrl,
      databaseUrl,
      fixture,
      artifactsDirectory,
      runId: collaborationOn.runId,
    });
    const historicalPageBinding = await runHistoricalPageBindingJourney({
      page, webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory,
    });
    const savedFolderTemplate = await runSavedFolderTemplateJourney({
      page, webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory,
    });
    const concurrentPageConflict = await runConcurrentPageConflictJourney({
      page, webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory,
    });
    const compatibility = await runEnabledCompatibilityJourney({
      page, webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory,
      existingCompositeRunId: concurrentPageConflict.runId,
      featureOffExecutableRunId: historicalPageBinding.runId,
    });
    const classifiedConsole = partitionExpectedConsoleIssues(
      consoleIssues, [
        savedFolderTemplate.sourceChangedResponse,
        ...concurrentPageConflict.expectedConflictResponses,
      ],
    );
    assert.equal(classifiedConsole.expected.length, 3);
    assert.deepEqual(classifiedConsole.unexpected, []);
    await assertNoOverflow(page);
    return {
      browser: 'Chrome',
      desktop: { width: 1440, height: 900 },
      scenariosPassed: 5,
      collaborationOff: {
        nodes: nodes.length,
        runs: 0,
        editedPageId: editablePage.id,
        openGroupLabel: '打开页面组',
        ...collaborationOffPersistence,
      },
      collaborationOn,
      historicalPageBinding,
      savedFolderTemplate,
      concurrentPageConflict,
      compatibility,
      externalAgents,
      consoleIssues: classifiedConsole.unexpected.length,
      expectedSourceChangedConsoleIssues: classifiedConsole.expected.length,
    };
  } finally {
    await context.tracing.stop({ path: join(artifactsDirectory, 'chrome-trace.zip') }).catch(() => undefined);
    await context.close();
    await browser.close();
    await prisma.$disconnect();
  }
}

async function runCollaborationOnJourney({ page, webOrigin, apiUrl, fixture, artifactsDirectory, externalStageSelection }) {
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
  await page.getByRole('heading', { name: fixture.space.name }).waitFor();
  await page.getByRole('button', { name: '新建页面' }).click();
  await page.getByRole('dialog', { name: '创建新页面' }).waitFor();
  await page.getByRole('button', { name: /项目管理工作区/u }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  const rootName = page.getByLabel('根名称');
  await rootName.fill('协作项目验收工作区');
  await rootName.blur();
  const collaboration = page.getByRole('checkbox', { name: '启用 Agent 协作' });
  await collaboration.waitFor();
  await collaboration.check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel(/项目目标/u).fill('验收两名真实外部 Agent 的页面发布与人工审核。');
  const roles = selectExternalAgentRoleAssignments(externalStageSelection, {
    codex: fixture.agents.codex.id, opencode: fixture.agents.opencode.id,
  });
  await page.getByRole('combobox', { name: '项目负责人 / Project owner', exact: true }).selectOption(roles.projectOwner);
  await page.getByRole('combobox', { name: '执行负责人 / Execution owner', exact: true }).selectOption(roles.executionOwner);
  await page.getByRole('combobox', { name: '风险审查 / Risk reviewer', exact: true }).selectOption(roles.riskReviewer);
  await page.getByRole('button', { name: '刷新参与范围' }).click();
  const participants = page.getByTestId('participant-preview');
  await participants.getByText(fixture.agents.codex.name, { exact: true }).waitFor();
  await participants.getByText(fixture.agents.opencode.name, { exact: true }).waitFor();
  assert.equal(await participants.getByText(fixture.agents.codex.name, { exact: true }).count(), 1);
  assert.equal(await participants.getByText(fixture.agents.opencode.name, { exact: true }).count(), 1);
  await page.screenshot({ path: join(artifactsDirectory, '05-collaboration-on-configured.png'), fullPage: true });
  await page.getByRole('button', { name: '创建并启动协作' }).click();
  await page.getByText('协作 Run 已创建。', { exact: true }).waitFor();
  await page.getByRole('link', { name: '打开运行看板' }).waitFor();
  await page.getByRole('button', { name: '打开页面组' }).waitFor();
  assert.match(await page.locator('pre').first().innerText(), /wiki_collaboration_join_run/u);
  await page.screenshot({ path: join(artifactsDirectory, '06-collaboration-on-created.png'), fullPage: true });
  const activeRuns = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs?status=active&limit=100`, { token: fixture.owner.access_token });
  assert.equal(activeRuns.items.length, 1);
  const run = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${activeRuns.items[0].id}`, { token: fixture.owner.access_token });
  assert.equal(run.tasks.length, 7);
  assert.equal(new Set(run.joinInstructions.map((item) => item.agentId)).size, 2);
  assert.equal(run.tasks.some((task) => task.assigneeAgentId === fixture.agents.codex.id), true);
  assert.equal(run.tasks.some((task) => task.assigneeAgentId === fixture.agents.opencode.id), true);
  return { runId: run.id, taskCount: run.tasks.length, participantCount: run.joinInstructions.length };
}

async function runRealExternalAgentJourney({ page, webOrigin, apiUrl, databaseUrl, fixture, artifactsDirectory, runId }) {
  const stages = selectExternalAgentStages(process.env.COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES ?? 'all');
  const receipts = [];
  const publications = [];
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    for (const item of stages) {
      const result = await runExternalAgentClient({
      client: item.key,
      label: item.label,
      agent: fixture.agents[item.agentKey ?? item.key],
      apiUrl,
      runId,
      stage: item.stage,
      artifactsDirectory,
    });
      receipts.push(result);
      assert.equal(result.exitCode, 0, `${item.label} model execution failed; see ${result.receiptPath}`);
      const sequence = assertExternalAgentReceipt(result);
      publications.push({
        sequence,
        ...(await approveExternalPageReview({
        page,
        webOrigin,
        apiUrl,
        prisma,
        fixture,
        runId,
        stage: item.stage,
        expectedAgentId: fixture.agents[item.agentKey ?? item.key].id,
        beforeEvidence: item.evidence,
        afterEvidence: item.evidence + 1,
        artifactsDirectory,
        })),
      });
    }
  } finally {
    await prisma.$disconnect();
  }
  return {
    clients: receipts.map(({ client, exitCode, requestedCalls, successfulCalls, receiptPath, lastMessagePath }) => ({
      client, exitCode, requestedCalls, successfulCalls, receiptPath, ...(lastMessagePath ? { lastMessagePath } : {}),
    })),
    publications,
  };
}

async function approveExternalPageReview({
  page,
  webOrigin,
  apiUrl,
  prisma,
  fixture,
  runId,
  stage,
  expectedAgentId,
  beforeEvidence,
  afterEvidence,
  artifactsDirectory,
}) {
  const submitted = await waitForRun(apiUrl, fixture, runId, (run) =>
    run.reviews?.some((review) => review.status === 'pending'), 30_000);
  const review = submitted.reviews.find((candidate) => candidate.status === 'pending');
  const task = submitted.tasks.find((candidate) => candidate.id === review?.sourceTaskId);
  assert.ok(review && task?.targetPageId, `stage ${stage} needs one pending target-Page review`);
  assert.equal(task.assigneeAgentId, expectedAgentId, `stage ${stage} was claimed by the wrong Agent`);
  const beforeVersions = await request(apiUrl, `/pages/${task.targetPageId}/versions`, { token: fixture.owner.access_token });
  const priorPage = await request(apiUrl, `/pages/${task.targetPageId}`, { token: fixture.owner.access_token });
  const comparison = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}/reviews/${review.id}/page-comparison`, { token: fixture.owner.access_token });

  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/collaboration/runs/${runId}`);
  await page.getByRole('heading', { name: '协作运行' }).waitFor();
  const reviewCard = page.getByTestId('dashboard-section-reviews').locator('article').filter({ hasText: '待审核' }).first();
  await reviewCard.waitFor();
  await reviewCard.getByRole('button', { name: '加载页面对比' }).click();
  await reviewCard.getByText(`External Agent acceptance: ${stage}`, { exact: false }).waitFor();
  await page.screenshot({ path: join(artifactsDirectory, `${String(beforeEvidence).padStart(2, '0')}-${stage}-pending-review.png`), fullPage: true });
  await reviewCard.getByRole('button', { name: '通过', exact: true }).click();
  await page.getByLabel('原因').fill(`真实外部 Agent 阶段 ${stage} 产物已核验。`);
  await page.getByRole('button', { name: /确认.*通过/u }).click();
  await page.getByText('运行已更新', { exact: true }).waitFor();
  await page.getByText('Agent 恢复指令', { exact: true }).waitFor();
  await page.screenshot({ path: join(artifactsDirectory, `${String(afterEvidence).padStart(2, '0')}-${stage}-approved.png`), fullPage: true });

  const after = await waitForRun(apiUrl, fixture, runId, (run) =>
    run.reviews?.some((candidate) => candidate.id === review.id && candidate.status === 'approved'), 30_000);
  const pageRecord = await request(apiUrl, `/pages/${task.targetPageId}`, { token: fixture.owner.access_token });
  const afterVersions = await request(apiUrl, `/pages/${task.targetPageId}/versions`, { token: fixture.owner.access_token });
  assert.match(pageRecord.content, new RegExp(`External Agent acceptance: ${stage}`, 'u'));
  assertPublishedPageVersionPair({
    beforeVersions,
    afterVersions,
    priorContent: priorPage.content,
    publishedContent: pageRecord.content,
  });
  const links = await prisma.collaborationArtifactChangeSetLink.findMany({ where: { artifactId: review.artifactId } });
  assert.equal(links.length, 1);
  assert.equal(links[0].changeSetId, comparison.candidate.changeSetId);
  const approvals = await prisma.approval.findMany({ where: { changeSetId: links[0].changeSetId } });
  assert.equal(approvals.length, 1);
  const artifact = await prisma.collaborationTaskArtifact.findUniqueOrThrow({ where: { id: review.artifactId } });
  assert.equal(artifact.status, 'accepted');
  return {
    stage,
    taskId: task.id,
    reviewId: review.id,
    reviewStatus: after.reviews.find((candidate) => candidate.id === review.id)?.status,
    pageId: task.targetPageId,
    pageVersionsBefore: beforeVersions.length,
    pageVersionsAfter: afterVersions.length,
    changeSetId: links[0].changeSetId,
    approvalCount: approvals.length,
  };
}

async function runExternalAgentClient({ client, label, agent, apiUrl, runId, stage, artifactsDirectory }) {
  const fixtureHome = await mkdtemp(join(artifactsDirectory, `${client}-gateway-`));
  await chmod(fixtureHome, 0o700);
  const connectionId = `acceptance-${client}`;
  const files = externalAgentGatewayFiles({
    client,
    apiUrl,
    agent: { ...agent, credentialId: connectionId },
    fixtureHome,
    cliPath: resolve(root, 'packages/local-sync/dist/cli.js'),
    nodePath: process.execPath,
    connectionId,
  });
  await mkdir(join(fixtureHome, '.agentwiki'), { recursive: true, mode: 0o700 });
  await writePrivate(join(fixtureHome, '.agentwiki/local-sync.json'), files.localSync);
  await writePrivate(join(fixtureHome, '.agentwiki/credentials.json'), files.credentials);
  await writeFile(files.wrapperPath, files.wrapperSource, { mode: 0o600 });
  const mcpConfigPath = join(fixtureHome, 'mcp.json');
  await writePrivate(mcpConfigPath, files.mcpConfig);
  if (client === 'opencode') await writePrivate(join(fixtureHome, 'opencode.json'), files.openCodeConfig);
  const prompt = buildExternalAgentStagePrompt({ client: label, runId, stage });
  const receiptPath = join(artifactsDirectory, `${client}-${stage}-receipt.jsonl`);
  const lastMessagePath = client === 'codex'
    ? join(artifactsDirectory, `${client}-${stage}-last.txt`)
    : undefined;
  const args = externalAgentClientArgs({
    client,
    fixtureHome,
    wrapperPath: files.wrapperPath,
    mcpConfigPath,
    prompt,
    lastMessagePath,
    nodePath: process.execPath,
  });
  const child = spawn(client, args, {
    cwd: fixtureHome,
    env: externalAgentClientEnvironment({ client, parent: process.env, openCodeConfig: files.openCodeConfig }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exitCode = await waitForChild(child, 180_000);
  await writeFile(receiptPath, output, { mode: 0o600 });
  await chmod(receiptPath, 0o600);
  const toolReceipt = extractCollaborationToolReceipt(output);
  return {
    client, exitCode,
    requestedCalls: toolReceipt.requestedCalls, successfulCalls: toolReceipt.successfulCalls,
    receiptPath, lastMessagePath,
  };
}

async function writePrivate(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

async function waitForChild(child, timeoutMs) {
  const exit = new Promise((resolveExit) => child.once('exit', (code) => resolveExit(code ?? 1)));
  const timedOut = await Promise.race([exit.then(() => false), delay(timeoutMs).then(() => true)]);
  if (!timedOut) return child.exitCode ?? 1;
  child.kill('SIGTERM');
  const graceful = await Promise.race([exit.then(() => true), delay(5_000).then(() => false)]);
  if (!graceful && child.exitCode === null) {
    child.kill('SIGKILL');
    await exit;
  }
  return 124;
}

async function waitForRun(apiUrl, fixture, runId, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, { token: fixture.owner.access_token });
    if (predicate(run)) return run;
    await delay(300);
  }
  throw new Error(`Run ${runId} did not reach the expected persisted state`);
}

async function assertNoOverflow(page) {
  const result = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  assert.equal(result.scrollWidth, result.clientWidth);
}

async function request(apiUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
  if (!response.ok) throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 1_000)}`);
  return data;
}

function startProcess(label, commandName, args, env, cwd = root) {
  const child = spawn(commandName, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.label = label;
  child.output = '';
  const append = (chunk) => { child.output = `${child.output}${chunk}`.slice(-40_000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  return child;
}

async function waitForHealth(apiUrl, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    assertRunning(child);
    try {
      const response = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).status === 'ok') return;
    } catch { /* startup race */ }
    await delay(250);
  }
  throw new Error(`API health timed out:\n${child.output}`);
}

async function waitForWeb(webOrigin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    assertRunning(child);
    try {
      const response = await fetch(webOrigin, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch { /* startup race */ }
    await delay(200);
  }
  throw new Error(`Vite startup timed out:\n${child.output}`);
}

async function waitForOutput(child, pattern, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(child.output)) return;
    assertRunning(child);
    await delay(100);
  }
  throw new Error(`${child.label} startup timed out:\n${child.output}`);
}

function assertRunning(child) {
  if (child.exitCode !== null) throw new Error(`${child.label} exited early (${child.exitCode}):\n${child.output}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  const graceful = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
  if (!graceful && child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function assertPortReleased(port, label) {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', resolveListen);
  }).catch((error) => {
    throw new Error(`${label} port ${port} was not released before schema cleanup: ${error instanceof Error ? error.message : String(error)}`);
  });
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
