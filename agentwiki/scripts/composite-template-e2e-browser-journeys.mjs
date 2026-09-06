import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  assertHistoricalBindingPersistence,
  assertSavedFolderTemplatePersistence,
  waitForExpectedConflictEvents,
} from './composite-template-e2e-support.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

export async function runHistoricalPageBindingJourney({
  page,
  webOrigin,
  apiUrl,
  databaseUrl,
  fixture,
  artifactsDirectory,
}) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const instantiation = await prisma.templateInstantiation.findFirstOrThrow({
      where: { spaceId: fixture.space.id },
      include: { nodes: { where: { kind: 'page' }, select: { pageId: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const pageIds = instantiation.nodes.flatMap((node) => node.pageId ? [node.pageId] : []);
    assert.ok(pageIds.length >= 2, 'historical binding journey needs two collaboration-off Pages');
    const [targetPageId, outsidePageId] = pageIds;
    const records = await prisma.page.findMany({
      where: { id: { in: [targetPageId, outsidePageId] } },
      select: { id: true, title: true },
    });
    const titles = new Map(records.map((record) => [record.id, record.title]));
    const grantVersionsBefore = await grantVersions(prisma, fixture);

    await savePageBinding({
      page, webOrigin, pageId: targetPageId, agentId: fixture.agents.codex.id,
    });
    await savePageBinding({
      page, webOrigin, pageId: outsidePageId, agentId: fixture.agents.opencode.id,
    });

    await openPageBinding(page, webOrigin, targetPageId);
    const agent = page.getByLabel('主责 Agent');
    assert.equal(await agent.inputValue(), fixture.agents.codex.id);
    await page.getByRole('checkbox', { name: '保存后立即启动协作' }).check();
    await page.getByRole('button', { name: '保存绑定并启动' }).click();
    await page.getByRole('heading', { name: '绑定已保存，Run 已启动' }).waitFor();
    const openRun = page.getByRole('link', { name: '打开运行看板' });
    const runHref = await openRun.getAttribute('href');
    const runId = runHref?.match(/\/runs\/([^/?#]+)/u)?.[1];
    assert.ok(runId, 'single-Page Run result needs a stable Run destination');
    await page.screenshot({
      path: join(artifactsDirectory, '13-historical-page-run-started.png'), fullPage: true,
    });

    const startedRun = await request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
      token: fixture.owner.access_token,
    });
    assert.equal(startedRun.tasks.length, 1);
    assert.equal(startedRun.tasks[0].targetPageId, targetPageId);
    assert.equal(startedRun.tasks[0].assigneeAgentId, fixture.agents.codex.id);
    assert.deepEqual(startedRun.joinInstructions.map((instruction) => instruction.agentId), [fixture.agents.codex.id]);

    await savePageBinding({
      page, webOrigin, pageId: targetPageId, agentId: fixture.agents.opencode.id,
    });
    await savePageBinding({ page, webOrigin, pageId: targetPageId, agentId: '' });
    await openPageBinding(page, webOrigin, targetPageId);
    assert.equal(await page.getByLabel('主责 Agent').inputValue(), '');
    const targetTitle = titles.get(targetPageId);
    assert.ok(targetTitle, 'historical target needs a Page title');
    const scope = page.getByTestId('binding-page-scope');
    await scope.getByText(targetTitle, { exact: true }).waitFor();
    assert.equal(await scope.getByText(targetPageId, { exact: true }).count(), 1);
    await page.screenshot({
      path: join(artifactsDirectory, '14-historical-page-unbound.png'), fullPage: true,
    });
    await page.keyboard.press('Escape');

    const [runAfterRebind, events, bindings, grantVersionsAfter] = await Promise.all([
      request(apiUrl, `/spaces/${fixture.space.id}/collaboration/runs/${runId}`, {
        token: fixture.owner.access_token,
      }),
      prisma.pageAgentBindingEvent.findMany({
        where: { spaceId: fixture.space.id, pageId: { in: [targetPageId, outsidePageId] } },
        select: { pageId: true, beforeAgentId: true, afterAgentId: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      prisma.pageAgentBinding.findMany({
        where: { spaceId: fixture.space.id, pageId: { in: [targetPageId, outsidePageId] } },
        select: { pageId: true, agentId: true },
        orderBy: { pageId: 'asc' },
      }),
      grantVersions(prisma, fixture),
    ]);
    const proof = assertHistoricalBindingPersistence({
      targetPageId,
      outsidePageId,
      initialAgentId: fixture.agents.codex.id,
      replacementAgentId: fixture.agents.opencode.id,
      grantVersionsBefore,
      grantVersionsAfter,
      runTasks: runAfterRebind.tasks,
      runParticipantAgentIds: runAfterRebind.joinInstructions.map((instruction) => instruction.agentId),
      events,
      bindings,
    });
    return {
      runId,
      targetPageId,
      targetPageTitle: targetTitle,
      outsidePageId,
      outsidePageTitle: titles.get(outsidePageId),
      ...proof,
    };
  } finally {
    await prisma.$disconnect();
  }
}

export async function runSavedFolderTemplateJourney({
  page,
  webOrigin,
  apiUrl,
  databaseUrl,
  fixture,
  artifactsDirectory,
  browserFailures,
}) {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const sourceInstantiation = await prisma.templateInstantiation.findFirstOrThrow({
      where: { spaceId: fixture.space.id },
      include: { nodes: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const rootFolderId = sourceInstantiation.nodes.find((node) => node.kind === 'folder'
      && node.templateNodeId === 'root')?.folderId;
    assert.ok(rootFolderId, 'saved Folder journey needs the collaboration-off root Folder');
    const initialPreview = await request(apiUrl, `/spaces/${fixture.space.id}/templates/from-folder/preview`, {
      method: 'POST', token: fixture.owner.access_token,
      body: {
        rootFolderId,
        selection: {
          excludedFolderIds: [], excludedPageIds: [], locale: 'zh-CN', source: { kind: 'structure_only' },
        },
      },
    });
    const sourceNodes = initialPreview.sourceNodes;
    const folderToExclude = sourceNodes.find((node) => node.kind === 'folder'
      && node.sourceNodeId !== rootFolderId && sourceNodes.some((candidate) => candidate.parentSourceNodeId === node.sourceNodeId));
    assert.ok(folderToExclude, 'saved Folder journey needs a non-empty descendant Folder to prune');
    const hasAncestor = (node, ancestorId) => {
      const byId = new Map(sourceNodes.map((item) => [item.sourceNodeId, item]));
      let parentId = node.parentSourceNodeId;
      while (parentId !== null) {
        if (parentId === ancestorId) return true;
        parentId = byId.get(parentId)?.parentSourceNodeId ?? null;
      }
      return false;
    };
    const pageToExclude = sourceNodes.find((node) => node.kind === 'page'
      && !hasAncestor(node, folderToExclude.sourceNodeId));
    assert.ok(pageToExclude, 'saved Folder journey needs an independent Page to prune explicitly');

    await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
    await page.getByTestId(`content-save-template-${rootFolderId}`).click();
    const dialog = page.getByRole('dialog', { name: '将目录保存为 Space 模板' });
    await dialog.waitFor();
    await dialog.locator('label').filter({ hasText: rootFolderId }).getByRole('checkbox').waitFor();
    await dialog.getByRole('radio', { name: '各页面独立职责' }).check();
    // Enter every draft before pruning, including the two hidden-after-prune cases.
    for (const node of sourceNodes.filter((item) => item.kind === 'page')) {
      await dialog.getByLabel(`${node.title}（${node.sourceNodeId}）的职责`).fill('裁剪前职责');
    }
    const folderCheckbox = dialog.locator('label').filter({ hasText: folderToExclude.sourceNodeId }).getByRole('checkbox');
    await folderCheckbox.waitFor();
    await folderCheckbox.uncheck();
    const pageCheckbox = dialog.locator('label').filter({ hasText: pageToExclude.sourceNodeId }).getByRole('checkbox');
    await pageCheckbox.uncheck();

    const retainedPageNodes = sourceNodes.filter((node) => node.kind === 'page'
      && node.sourceNodeId !== pageToExclude.sourceNodeId
      && !hasAncestor(node, folderToExclude.sourceNodeId));
    assert.ok(retainedPageNodes.length > 0);
    const templateName = `可复用项目模板-${fixture.suffix}`;
    await dialog.getByLabel('模板名称').fill(templateName);
    await dialog.getByLabel('默认页面标题').fill('保存模板再实例化');
    for (const [index, node] of retainedPageNodes.entries()) {
      if (index === 0) await dialog.getByLabel(`${node.title}（${node.sourceNodeId}）的职责`).fill('职责-1');
      else await dialog.getByRole('button', { name: `${node.title}（${node.sourceNodeId}）不分配职责`, exact: true }).click();
    }
    const saveTemplate = dialog.getByRole('button', { name: '保存模板' });
    await saveTemplate.waitFor({ state: 'visible' });
    await expectEnabled(saveTemplate);

    const changedPageNode = retainedPageNodes[0];
    const changedPage = await request(apiUrl, `/pages/${changedPageNode.sourceNodeId}`, {
      token: fixture.owner.access_token,
    });
    const bodyMarker = `保存源正文变化-${fixture.suffix}`;
    const editorPage = await page.context().newPage();
    await editorPage.goto(`${webOrigin}/pages/${changedPageNode.sourceNodeId}/edit`);
    const editor = editorPage.locator('.cm-content[contenteditable="true"]');
    await editor.waitFor();
    await editor.fill(`${changedPage.content.trimEnd()}\n\n${bodyMarker}`);
    await editorPage.getByRole('button', { name: '保存', exact: true }).click();
    await editorPage.getByRole('status').filter({ hasText: '保存成功' }).waitFor();
    await browserFailures.assertPageNoFrameworkOverlay(editorPage);
    await editorPage.close();

    const sourceChangedResponsePromise = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === `/api/spaces/${fixture.space.id}/templates/from-folder`);
    const sourceChangedResponse = await browserFailures.runAction(
      page,
      'saved-folder-source-change',
      () => waitForExpectedConflictEvents(page, `${webOrigin}/api/spaces/${fixture.space.id}/templates/from-folder`,
        sourceChangedResponsePromise, () => saveTemplate.click()),
    );
    const sourceChangedBody = await sourceChangedResponse.json();
    assert.equal(sourceChangedResponse.status(), 409);
    assert.equal(sourceChangedBody.code, 'SOURCE_CHANGED');
    const refreshChanged = dialog.getByRole('button', { name: '刷新已变化来源' });
    await refreshChanged.waitFor();
    assert.equal(await folderCheckbox.isChecked(), false);
    assert.equal(await pageCheckbox.isChecked(), false);
    for (const [index, node] of retainedPageNodes.entries()) {
      assert.equal(await dialog.getByLabel(`${node.title}（${node.sourceNodeId}）的职责`).inputValue(), index === 0 ? '职责-1' : '');
    }
    await refreshChanged.click();
    await expectEnabled(saveTemplate);
    assert.equal(await folderCheckbox.isChecked(), false);
    assert.equal(await pageCheckbox.isChecked(), false);
    await page.screenshot({ path: join(artifactsDirectory, '15-folder-source-change-recovered.png'), fullPage: true });
    await saveTemplate.click();
    await dialog.waitFor({ state: 'hidden' });

    const saved = await prisma.pageTemplate.findFirstOrThrow({
      where: { spaceId: fixture.space.id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const definition = saved.versions[0]?.definition;
    assert.ok(definition && typeof definition === 'object' && !Array.isArray(definition));

    await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
    await page.getByRole('button', { name: '新建页面' }).click();
    const createDialog = page.getByRole('dialog', { name: '创建新页面' });
    await createDialog.waitFor();
    await createDialog.getByRole('button').filter({ hasText: templateName }).click();
    await createDialog.getByRole('button', { name: '下一步' }).click();
    await createDialog.getByLabel('根名称').fill('保存模板再实例化');
    assert.equal(await createDialog.getByRole('checkbox', { name: '启用 Agent 协作' }).isChecked(), false);
    await createDialog.getByRole('button', { name: '创建页面组' }).click();
    await createDialog.getByRole('heading', { name: '创建完成' }).waitFor();
    await createDialog.getByRole('button', { name: '打开页面组' }).click();
    await page.getByTestId('content-tree').waitFor();
    await page.screenshot({ path: join(artifactsDirectory, '16-saved-folder-reinstantiated.png'), fullPage: true });

    const reInstantiation = await prisma.templateInstantiation.findFirstOrThrow({
      where: { spaceId: fixture.space.id, compositeTemplateVersionId: saved.versions[0].id },
      include: { nodes: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const folderIds = reInstantiation.nodes.flatMap((node) => node.folderId ? [node.folderId] : []);
    const pageIds = reInstantiation.nodes.flatMap((node) => node.pageId ? [node.pageId] : []);
    const [instantiatedFolders, instantiatedPages] = await Promise.all([
      prisma.folder.findMany({
        where: { id: { in: folderIds } },
        select: { id: true, parentId: true, name: true, sortOrder: true },
      }),
      prisma.page.findMany({
        where: { id: { in: pageIds } },
        select: { id: true, folderId: true, title: true, content: true, sortOrder: true },
      }),
    ]);
    const foldersById = new Map(instantiatedFolders.map((item) => [item.id, item]));
    const pagesById = new Map(instantiatedPages.map((item) => [item.id, item]));
    const mappingByTemplateNodeId = new Map(reInstantiation.nodes.map((node) => [node.templateNodeId, node]));
    const templateNodeIdByFolderId = new Map(reInstantiation.nodes.flatMap((node) => (
      node.folderId ? [[node.folderId, node.templateNodeId]] : []
    )));
    const instantiatedNodes = definition.nodes.map((definitionNode) => {
      const mapping = mappingByTemplateNodeId.get(definitionNode.nodeId);
      assert.ok(mapping, `instantiation needs a persisted mapping for ${definitionNode.nodeId}`);
      if (mapping.kind === 'folder') {
        const actualFolder = mapping.folderId ? foldersById.get(mapping.folderId) : undefined;
        return {
          nodeId: mapping.templateNodeId,
          parentNodeId: actualFolder?.parentId
            ? templateNodeIdByFolderId.get(actualFolder.parentId) ?? null
            : null,
          kind: 'folder',
          order: actualFolder?.sortOrder,
          name: actualFolder?.name,
        };
      }
      const actualPage = mapping.pageId ? pagesById.get(mapping.pageId) : undefined;
      return {
        nodeId: mapping.templateNodeId,
        parentNodeId: actualPage?.folderId
          ? templateNodeIdByFolderId.get(actualPage.folderId) ?? null
          : null,
        kind: 'page',
        order: actualPage?.sortOrder,
        title: actualPage?.title,
        content: actualPage?.content,
      };
    });
    const [currentSourceFolders, currentSourcePages] = await Promise.all([
      prisma.folder.findMany({
        where: { id: { in: sourceNodes.filter((node) => node.kind === 'folder').map((node) => node.sourceNodeId) } },
        select: { id: true, sortOrder: true, createdAt: true },
      }),
      prisma.page.findMany({
        where: { id: { in: sourceNodes.filter((node) => node.kind === 'page').map((node) => node.sourceNodeId) } },
        select: { id: true, content: true, sortOrder: true, createdAt: true },
      }),
    ]);
    const contents = new Map(currentSourcePages.map((item) => [item.id, item.content]));
    const sourceOrder = new Map([
      ...currentSourceFolders.map((item) => [item.id, item.sortOrder]),
      ...currentSourcePages.map((item) => [item.id, item.sortOrder]),
    ]);
    const sourceCreatedAt = new Map([...currentSourceFolders, ...currentSourcePages].map((item) => [item.id, item.createdAt]));
    const proof = assertSavedFolderTemplatePersistence({
      sourceNodes: sourceNodes.map((node) => {
        const order = sourceOrder.get(node.sourceNodeId);
        assert.equal(Number.isInteger(order), true, `source node ${node.sourceNodeId} needs its real database order`);
        return node.kind === 'page'
          ? { ...node, content: contents.get(node.sourceNodeId), order, createdAt: sourceCreatedAt.get(node.sourceNodeId) }
          : { ...node, order, createdAt: sourceCreatedAt.get(node.sourceNodeId) };
      }),
      excludedFolderIds: [folderToExclude.sourceNodeId],
      excludedPageIds: [pageToExclude.sourceNodeId],
      definition,
      instantiatedRootName: '保存模板再实例化',
      instantiatedNodes,
      concreteAgentIds: [fixture.agents.codex.id, fixture.agents.opencode.id],
      unassignedPageSourceIds: retainedPageNodes.slice(1).map((node) => node.sourceNodeId),
    });
    assert.match(JSON.stringify(definition), new RegExp(bodyMarker, 'u'));
    const singlePageCompatibility = await verifySinglePageCompatibility({ page, prisma, webOrigin, apiUrl, fixture, artifactsDirectory });
    return {
      singlePageCompatibility,
      templateId: saved.id,
      templateVersionId: saved.versions[0].id,
      excludedFolderId: folderToExclude.sourceNodeId,
      excludedPageId: pageToExclude.sourceNodeId,
      sourceChangeMarker: bodyMarker,
      sourceChangedResponse: {
        action: 'saved-folder-source-change',
        pageId: browserFailures.pageId(page),
        method: sourceChangedResponse.request().method(),
        pathname: new URL(sourceChangedResponse.url()).pathname,
        url: sourceChangedResponse.url(),
        status: sourceChangedResponse.status(),
        code: sourceChangedBody.code,
      },
      attachmentWarning: false,
      ...proof,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function verifySinglePageCompatibility({ page, prisma, webOrigin, apiUrl, fixture, artifactsDirectory }) {
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}`);
  await page.getByRole('button', { name: '新建页面' }).click();
  const creation = page.getByRole('dialog', { name: '创建新页面' });
  await creation.getByRole('button').filter({ hasText: '日报' }).click();
  await creation.getByRole('button', { name: '下一步' }).click();
  const title = await creation.getByLabel('根名称').inputValue();
  assert.match(title, /^日报 \d{4}-\d{2}-\d{2}$/u);
  await page.screenshot({ path: join(artifactsDirectory, '29-system-single-title.png'), fullPage: true });
  const name = `JSON单页-${fixture.suffix}`;
  const created = await request(apiUrl, `/spaces/${fixture.space.id}/templates`, {
    method: 'POST', token: fixture.owner.access_token,
    body: { name, defaultTitle: name, category: 'knowledge', locale: 'zh-CN', definition: {
      schemaVersion: 1, kind: 'single_page', nodes: [{ nodeId: 'page', parentNodeId: null,
        kind: 'page', order: 0, titleI18n: { 'zh-CN': '单页内容' }, contentI18n: { 'zh-CN': '# 内容' }, roleSlotKey: null }], collaboration: null,
    } },
  });
  await page.goto(`${webOrigin}/spaces/${fixture.space.id}/settings/page-templates`);
  await page.getByRole('button', { name: `编辑 ${name}`, exact: true }).click();
  const metadata = page.getByRole('dialog');
  await metadata.getByLabel('模板名称').fill(`${name}-已编辑`);
  await metadata.getByRole('button', { name: '保存', exact: true }).click();
  await metadata.waitFor({ state: 'hidden' });
  assert.equal((await prisma.pageTemplate.findUniqueOrThrow({ where: { id: created.id } })).nameI18n['zh-CN'], `${name}-已编辑`);
  await page.getByRole('button', { name: `编辑结构 ${name}-已编辑`, exact: true }).click();
  const versionDialog = page.getByRole('dialog');
  await versionDialog.getByRole('button', { name: /单页内容 page/u }).click();
  await versionDialog.getByLabel('页面标题 page').fill('单页内容已更新');
  await versionDialog.getByRole('button', { name: '创建新版本' }).click();
  await versionDialog.waitFor({ state: 'hidden' });
  const version = await prisma.pageTemplateVersion.findUniqueOrThrow({ where: { templateId_version: { templateId: created.id, version: 2 } } });
  assert.equal(version.definition.kind, 'single_page');
  assert.equal(version.definition.nodes[0].titleI18n['zh-CN'], '单页内容已更新');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: `归档 ${name}-已编辑`, exact: true }).click();
  await page.getByRole('button', { name: `归档 ${name}-已编辑`, exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await prisma.pageTemplate.findUniqueOrThrow({ where: { id: created.id } })).archivedAt);
  await page.getByLabel('显示已归档模板').check();
  await page.getByText(`${name}-已编辑`, { exact: true }).waitFor();
  await page.screenshot({ path: join(artifactsDirectory, '30-json-single-managed.png'), fullPage: true });
  return { title, jsonTemplateId: created.id, currentVersion: 2, metadataEdited: true, archived: true };
}

async function openPageBinding(page, webOrigin, pageId) {
  await page.goto(`${webOrigin}/pages/${pageId}/edit`);
  await page.locator('.cm-content[contenteditable="true"]').waitFor();
  await page.getByRole('button', { name: 'Agent / 协作设置' }).click();
  await page.getByRole('dialog', { name: 'Agent 绑定与协作设置' }).waitFor();
}

async function savePageBinding({ page, webOrigin, pageId, agentId }) {
  await openPageBinding(page, webOrigin, pageId);
  await page.getByLabel('主责 Agent').selectOption(agentId);
  await page.getByRole('button', { name: '保存绑定' }).click();
  await page.getByRole('dialog', { name: 'Agent 绑定与协作设置' }).waitFor({ state: 'hidden' });
  await page.getByRole('status').filter({ hasText: 'Agent 绑定已保存' }).waitFor();
}

async function grantVersions(prisma, fixture) {
  const rows = await prisma.agentGrant.findMany({
    where: {
      spaceId: fixture.space.id,
      agentId: { in: [fixture.agents.codex.id, fixture.agents.opencode.id] },
    },
    select: { agentId: true, updatedAt: true },
    orderBy: { agentId: 'asc' },
  });
  return rows.map((row) => ({ agentId: row.agentId, updatedAt: row.updatedAt.toISOString() }));
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

async function expectEnabled(locator) {
  await locator.waitFor({ state: 'visible' });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('expected control to become enabled');
}
