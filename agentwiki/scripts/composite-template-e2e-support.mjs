import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { assertLoopbackDatabaseHost } from './test-database-url-safety.mjs';
import {
  assertFolderDatabaseSafetyPreflight,
  captureFolderDatabaseSafetyInventory,
  folderDatabaseSafetyInventoryDigest,
  withFolderMigrationBundle,
} from './folder-test-database.mjs';
import { boundedMigrationOptions, spawnPnpmSync } from './package-manager-process.mjs';
import { withTestDatabaseCleanup } from './test-database-lifecycle.mjs';

const SAFE_SCHEMA = /^mac_e2e_[A-Za-z0-9_]+$/u;
const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');

export function validateCompositeTemplateE2EDatabaseUrl(value) {
  if (!value) throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL must be a valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL must use PostgreSQL');
  }
  assertLoopbackDatabaseHost(parsed, 'COMPOSITE_TEMPLATE_E2E_DATABASE_URL');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!databaseName || !databaseName.toLowerCase().includes('test')) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL database name must contain test');
  }
  const schemas = parsed.searchParams.getAll('schema');
  if (schemas.length > 1 || (schemas.length === 1 && !SAFE_SCHEMA.test(schemas[0]))) {
    throw new Error('COMPOSITE_TEMPLATE_E2E_DATABASE_URL schema must use mac_e2e_*');
  }
  return parsed;
}

export function acceptanceChildEnvironment({
  parent,
  databaseUrl,
  redisUrl,
  apiPort,
  webOrigin,
  spaceId,
}) {
  return {
    ...parent,
    NODE_ENV: 'test',
    PROCESS_ROLE: 'api',
    AGENTWIKI_LISTEN_HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    COLLABORATION_TEST_DATABASE_URL: databaseUrl,
    SYNC_V3_TEST_DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    TEST_REDIS_URL: redisUrl,
    COLLABORATION_TEST_REDIS_URL: redisUrl,
    JWT_SECRET: `composite-e2e-jwt-${randomUUID()}-${randomUUID()}`,
    AGENTWIKI_SERVER_PEPPER: `composite-e2e-pepper-${randomUUID()}`,
    AGENTWIKI_DEPLOYMENT_SEED: randomBytes(32).toString('base64'),
    LOCAL_SYNC_PACKAGE_VERSION: '0.7.0',
    PUBLIC_API_URL: `http://127.0.0.1:${apiPort}/api`,
    MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
    CORS_ORIGINS: webOrigin,
    AGENTWIKI_E2E_API_RATE_LIMIT: '10000',
    COMPOSITE_TEMPLATE_SPACE_ALLOWLIST: spaceId,
    OPENROUTER_API_KEY: '',
    LLM_GATEWAY: 'openrouter',
  };
}

export async function collectContentTree(loadChildren) {
  const nodes = [];
  const pendingFolders = [null];
  while (pendingFolders.length) {
    const parentFolderId = pendingFolders.shift();
    let cursor;
    do {
      const response = await loadChildren(parentFolderId, cursor);
      if (!response || !Array.isArray(response.data)) {
        throw new Error('Content-tree response must contain a data array');
      }
      nodes.push(...response.data);
      for (const node of response.data) {
        if (node?.kind === 'folder' && typeof node.id === 'string') pendingFolders.push(node.id);
      }
      cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : undefined;
    } while (cursor);
  }
  return nodes;
}

export function assertCollaborationOffPersistence({
  beforeTreeRevision,
  afterTreeRevision,
  instantiation,
  bindingCount,
}) {
  if (afterTreeRevision !== beforeTreeRevision + 1n) {
    throw new Error('Collaboration-off instantiation must advance contentTreeRevision exactly one');
  }
  if (instantiation.treeRevision !== afterTreeRevision) {
    throw new Error('Collaboration-off instantiation treeRevision does not match the Space revision');
  }
  const stored = instantiation.result;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
    || typeof stored.treeRevision !== 'string' || !Array.isArray(stored.pageIds)) {
    throw new Error('Collaboration-off instantiation result is invalid');
  }
  if (BigInt(stored.treeRevision) !== afterTreeRevision) {
    throw new Error('Collaboration-off result treeRevision does not match the Space revision');
  }
  const nodePageIds = instantiation.nodes
    .map((node) => node.pageId)
    .filter((pageId) => typeof pageId === 'string')
    .sort();
  const resultPageIds = stored.pageIds
    .filter((pageId) => typeof pageId === 'string')
    .sort();
  if (!isDeepStrictEqual(nodePageIds, resultPageIds)) {
    throw new Error('Collaboration-off created Page scope does not match its instantiation result');
  }
  if (bindingCount !== 0) {
    throw new Error('Collaboration-off created Page scope must have zero PageAgentBinding rows');
  }
  return {
    instantiationId: instantiation.id,
    treeRevisionBefore: beforeTreeRevision.toString(),
    treeRevisionAfter: afterTreeRevision.toString(),
    createdPageCount: resultPageIds.length,
    bindingCount,
  };
}

export function assertHistoricalBindingPersistence({
  targetPageId,
  outsidePageId,
  initialAgentId,
  replacementAgentId,
  grantVersionsBefore,
  grantVersionsAfter,
  runTasks,
  runParticipantAgentIds,
  events,
  bindings,
}) {
  const expectedEvents = [
    { pageId: targetPageId, beforeAgentId: null, afterAgentId: initialAgentId },
    { pageId: outsidePageId, beforeAgentId: null, afterAgentId: replacementAgentId },
    { pageId: targetPageId, beforeAgentId: initialAgentId, afterAgentId: replacementAgentId },
    { pageId: targetPageId, beforeAgentId: replacementAgentId, afterAgentId: null },
  ];
  const actualEvents = events.map(({ pageId, beforeAgentId, afterAgentId }) => ({
    pageId, beforeAgentId, afterAgentId,
  }));
  if (!isDeepStrictEqual(actualEvents, expectedEvents)) {
    throw new Error('Historical binding audit must preserve the exact bind/outside-bind/replace/unbind chain');
  }
  const targetTasks = runTasks.filter((task) => task.targetPageId === targetPageId);
  if (targetTasks.length !== 1 || targetTasks[0].assigneeAgentId !== initialAgentId) {
    throw new Error('Historical binding Run must retain its frozen assignee');
  }
  const participants = [...new Set(runParticipantAgentIds)].sort();
  if (!isDeepStrictEqual(participants, [initialAgentId])) {
    throw new Error('Historical binding outside binding must not become a participant');
  }
  const remaining = bindings.map(({ pageId, agentId }) => ({ pageId, agentId }));
  if (!isDeepStrictEqual(remaining, [{ pageId: outsidePageId, agentId: replacementAgentId }])) {
    throw new Error('Historical binding final state must retain only the outside Page binding');
  }
  const grantKey = (items) => items
    .map(({ agentId, updatedAt }) => ({ agentId, updatedAt }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  if (!isDeepStrictEqual(grantKey(grantVersionsBefore), grantKey(grantVersionsAfter))) {
    throw new Error('Historical Page binding must not mutate AgentGrant rows');
  }
  return {
    auditEventCount: actualEvents.length,
    frozenAssigneeAgentId: initialAgentId,
    participantAgentIds: participants,
    remainingBindingPageIds: remaining.map((binding) => binding.pageId),
    grantMutationCount: 0,
  };
}

export function assertSavedFolderTemplatePersistence({
  sourceNodes,
  excludedFolderIds,
  excludedPageIds,
  definition,
  instantiatedRootName,
  instantiatedNodes,
  concreteAgentIds,
}) {
  const byId = new Map(sourceNodes.map((node) => [node.sourceNodeId, node]));
  const excludedFolders = new Set(excludedFolderIds);
  const excludedPages = new Set(excludedPageIds);
  const hasExcludedAncestor = (node) => {
    let parentId = node.parentSourceNodeId;
    while (parentId !== null) {
      if (excludedFolders.has(parentId)) return true;
      parentId = byId.get(parentId)?.parentSourceNodeId ?? null;
    }
    return false;
  };
  const retained = sourceNodes.filter((node) => !excludedPages.has(node.sourceNodeId)
    && !excludedFolders.has(node.sourceNodeId) && !hasExcludedAncestor(node));
  const serialized = JSON.stringify(definition);
  if (concreteAgentIds.some((agentId) => serialized.includes(agentId))) {
    throw new Error('Saved Folder template must not retain a concrete Agent ID');
  }
  if (!Array.isArray(definition?.nodes) || definition.nodes.length !== retained.length) {
    throw new Error('Saved Folder template definition must exactly match the pruned source tree');
  }
  const logicalPaths = (nodes) => {
    const byParent = new Map();
    for (const node of nodes) {
      const siblings = byParent.get(node.parentNodeId) ?? [];
      siblings.push(node);
      byParent.set(node.parentNodeId, siblings);
    }
    const paths = [];
    const visit = (parentNodeId, parentPath) => {
      for (const node of byParent.get(parentNodeId) ?? []) {
        const path = `${parentPath}/${node.kind}:${node.label}`;
        paths.push(path);
        visit(node.nodeId, path);
      }
    };
    visit(null, '');
    return paths.sort();
  };
  const compareTreeOrder = (left, right) => left.order - right.order
    || (left.kind === right.kind ? 0 : left.kind === 'folder' ? 1 : -1)
    || left.nodeId.localeCompare(right.nodeId);
  const logicalSiblingOrder = (nodes) => {
    const byParent = new Map();
    for (const node of nodes) {
      const siblings = byParent.get(node.parentNodeId) ?? [];
      siblings.push(node);
      byParent.set(node.parentNodeId, siblings);
    }
    const rows = [];
    const visit = (parentNodeId, parentPath) => {
      const siblings = [...(byParent.get(parentNodeId) ?? [])].sort(compareTreeOrder);
      rows.push({
        parentPath,
        children: siblings.map((node) => `${node.kind}:${node.label}`),
      });
      for (const node of siblings) {
        visit(node.nodeId, `${parentPath}/${node.kind}:${node.label}`);
      }
    };
    visit(null, '');
    return rows.sort((left, right) => left.parentPath.localeCompare(right.parentPath));
  };
  const expectedTree = retained.map((node) => ({
    nodeId: node.sourceNodeId,
    parentNodeId: node.parentSourceNodeId,
    kind: node.kind,
    order: node.order,
    label: node.kind === 'folder' ? node.name : node.title,
  }));
  const sortTree = (nodes) => [...nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const definitionTree = sortTree(definition.nodes.map((node) => ({
    nodeId: node.nodeId,
    parentNodeId: node.parentNodeId,
    kind: node.kind,
    order: node.order,
    label: node.kind === 'folder'
      ? node.nameI18n?.['zh-CN'] ?? node.nameI18n?.en
      : node.titleI18n?.['zh-CN'] ?? node.titleI18n?.en,
    content: node.kind === 'page'
      ? node.contentI18n?.['zh-CN'] ?? node.contentI18n?.en
      : undefined,
  })));
  if (!isDeepStrictEqual(logicalPaths(definitionTree), logicalPaths(expectedTree))) {
    throw new Error('Saved Folder template must preserve the exact pruned tree structure');
  }
  if (!isDeepStrictEqual(logicalSiblingOrder(definitionTree), logicalSiblingOrder(expectedTree))) {
    throw new Error('Saved Folder template must preserve source sibling order after pruning');
  }
  const instantiatedTree = sortTree(instantiatedNodes.map((node) => ({
    nodeId: node.nodeId,
    parentNodeId: node.parentNodeId,
    kind: node.kind,
    order: node.order,
    label: node.kind === 'folder' ? node.name : node.title,
    content: node.kind === 'page' ? node.content : undefined,
  })));
  const rankSiblingOrder = (nodes) => {
    const ranked = new Map();
    const byParent = new Map();
    for (const node of nodes) {
      const siblings = byParent.get(node.parentNodeId) ?? [];
      siblings.push(node);
      byParent.set(node.parentNodeId, siblings);
    }
    for (const siblings of byParent.values()) {
      siblings.sort(compareTreeOrder);
      siblings.forEach((node, index) => ranked.set(node.nodeId, index));
    }
    return sortTree(nodes.map((node) => ({ ...node, order: ranked.get(node.nodeId) })));
  };
  const expectedInstantiationTree = rankSiblingOrder(definitionTree).map((node) => node.parentNodeId === null
    && node.kind === 'folder' && instantiatedRootName
    ? { ...node, label: instantiatedRootName }
    : node);
  if (!isDeepStrictEqual(rankSiblingOrder(instantiatedTree), expectedInstantiationTree)) {
    throw new Error('Saved Folder re-instantiation must reproduce the exact tree structure');
  }
  const retainedPages = retained.filter((node) => node.kind === 'page');
  const definitionPages = definition.nodes.filter((node) => node.kind === 'page');
  const expectedPages = retainedPages.map((page) => ({ title: page.title, content: page.content }));
  const actualPages = definitionPages.map((page) => ({
    title: page.titleI18n?.['zh-CN'] ?? page.titleI18n?.en,
    content: page.contentI18n?.['zh-CN'] ?? page.contentI18n?.en,
  }));
  if (!isDeepStrictEqual(actualPages, expectedPages)) {
    throw new Error('Saved Folder template must preserve the retained Page titles and Markdown');
  }
  const instantiatedPages = instantiatedNodes.filter((node) => node.kind === 'page')
    .map(({ title, content }) => ({ title, content }));
  if (!isDeepStrictEqual(instantiatedPages, expectedPages)) {
    throw new Error('Saved Folder re-instantiation must reproduce retained Page titles and Markdown');
  }
  const collaboration = definition.collaboration;
  const roleSlots = collaboration?.workflow?.roleSlots ?? [];
  const agentTasks = collaboration?.workflow?.nodes?.filter((node) => node.kind === 'agent_task') ?? [];
  const taskTargets = collaboration?.taskTargets ?? [];
  const roleIds = roleSlots.map((role) => role.id);
  const pageRoleIds = definitionPages.map((page) => page.roleSlotKey);
  const taskById = new Map(agentTasks.map((task) => [task.id, task]));
  const targetsByPage = new Map();
  for (const target of taskTargets) {
    const targets = targetsByPage.get(target.pageNodeId) ?? [];
    targets.push(target);
    targetsByPage.set(target.pageNodeId, targets);
  }
  const pageRoleTaskValid = roleIds.length === definitionPages.length
    && new Set(roleIds).size === roleIds.length
    && pageRoleIds.every((roleId) => typeof roleId === 'string' && roleIds.includes(roleId))
    && new Set(pageRoleIds).size === definitionPages.length
    && roleIds.every((roleId) => pageRoleIds.includes(roleId))
    && agentTasks.length === definitionPages.length
    && taskTargets.length === definitionPages.length
    && new Set(taskTargets.map((target) => target.taskNodeId)).size === definitionPages.length
    && definitionPages.every((page) => {
      const targets = targetsByPage.get(page.nodeId) ?? [];
      const task = targets.length === 1 ? taskById.get(targets[0].taskNodeId) : undefined;
      return task?.roleSlotId === page.roleSlotKey;
    });
  if (!pageRoleTaskValid) {
    throw new Error('Saved Folder Page-role-task abstraction must cover each retained Page exactly once');
  }
  const roleCount = roleSlots.length;
  return {
    retainedNodeCount: retained.length,
    retainedPageCount: retainedPages.length,
    roleCount,
    instantiatedNodeCount: instantiatedNodes.length,
  };
}

export function assertConcurrentPageConflictPersistence({
  humanFirst,
  humanChosen,
  firstConflict,
  regenerated,
  secondConflict,
  adopted,
}) {
  const assertConflict = (conflict, content, label) => {
    if (conflict.runStatus !== 'paused' || conflict.pauseReason !== 'page_version_conflict'
      || conflict.reviewStatus !== 'pending') {
      throw new Error(`${label} must persist a paused Run and pending review`);
    }
    if (conflict.pageContent !== content) throw new Error(`${label} must preserve the human edit`);
  };
  assertConflict(firstConflict, humanFirst, 'first conflict');
  if (regenerated.generation !== 2
    || regenerated.baseContentHash !== regenerated.expectedBaseContentHash
    || regenerated.changeSetStatus !== 'superseded'
    || regenerated.artifactStatus !== 'rejected') {
    throw new Error('regenerate must use the latest Page baseline and supersede the stale candidate');
  }
  assertConflict(secondConflict, humanChosen, 'second conflict');
  if (adopted.pageContent !== humanChosen || adopted.adoptedMarkdown !== humanChosen
    || adopted.reviewStatus !== 'approved' || adopted.adoptedArtifactStatus !== 'accepted'
    || !adopted.adoptedPageVersionId
    || adopted.adoptedPageVersionId !== adopted.currentPageVersionId
    || adopted.staleArtifactStatus !== 'superseded'
    || adopted.staleChangeSetStatus !== 'superseded') {
    throw new Error('adopt_current must preserve the chosen human Page version and supersede the stale candidate');
  }
  return {
    conflictCount: 2,
    regeneration: regenerated.generation,
    adoptedPageVersionId: adopted.adoptedPageVersionId,
    staleCandidateCount: 2,
  };
}

export function assertCompatibilityPersistence({ oldPage, legacy, folder, featureOff }) {
  if (!oldPage?.id || !oldPage.title || !oldPage.content) {
    throw new Error('Compatibility must preserve an old single-Page creation');
  }
  if (!legacy?.runId || legacy.status !== 'cancelled'
    || !legacy.historyRunIds.includes(legacy.runId)) {
    throw new Error('Compatibility must preserve legacy Run start and history');
  }
  const discovered = [...folder.discoveredPageIds].sort();
  const scoped = [...folder.selectedBindingPageIds].sort();
  const bindings = [...folder.bindingPageIds].sort();
  if (scoped.length === 0 || discovered.length <= scoped.length
    || scoped.some((pageId) => !discovered.includes(pageId))) {
    throw new Error('Folder bulk binding must use an explicit non-empty Page subset');
  }
  if (bindings.includes(folder.folderId) || !isDeepStrictEqual(bindings, scoped)) {
    throw new Error('Folder bulk binding must bind exactly the selected Pages and never the Folder');
  }
  if (!discovered.includes(folder.outsidePageId) || scoped.includes(folder.outsidePageId)
    || folder.outsideBindingAgentId !== folder.outsideAgentId || folder.outsideBindingUnchanged !== true) {
    throw new Error('Folder outside Page binding and audit must remain unchanged');
  }
  if (folder.selectedTaskPageIds.length === 0
    || folder.selectedTaskPageIds.some((pageId) => !scoped.includes(pageId))) {
    throw new Error('Folder Run must retain an explicit Page task selection');
  }
  if (folder.runParticipantAgentIds.includes(folder.outsideAgentId)) {
    throw new Error('Folder outside binding must not become a Run participant');
  }
  if (featureOff.canCreate !== false || featureOff.compositeWriteStatus !== 409
    || featureOff.compositeWriteCode !== 'COMPOSITE_TEMPLATE_FEATURE_DISABLED') {
    throw new Error('Feature-off compatibility must block only new composite creation');
  }
  if (featureOff.readableRunId !== featureOff.existingRunId
    || featureOff.taskCount === 0 || featureOff.reviewCount === 0) {
    throw new Error('Feature-off compatibility must keep the existing composite Run readable and reviewable');
  }
  if (!isDeepStrictEqual(featureOff.beforeCounts, featureOff.afterCounts)) {
    throw new Error('Feature-off compatibility must not delete existing data');
  }
  const execution = featureOff.execution;
  if (execution?.transport !== 'protocol fixture APIs; no model execution'
    || execution.submittedRunStatus !== 'waiting_review'
    || execution.reviewStatus !== 'approved'
    || execution.finalRunStatus !== 'completed'
    || !execution.pageId
    || execution.submittedMarkdown !== execution.pageContent
    || execution.pageVersionCount !== 1) {
    throw new Error('Feature-off compatibility must execute the existing Run and publish exactly one PageVersion');
  }
  return {
    legacyRunId: legacy.runId,
    bulkBindingCount: bindings.length,
    selectedTaskCount: folder.selectedTaskPageIds.length,
    existingCompositeRunId: featureOff.existingRunId,
    featureOffNoDeletion: true,
    featureOffPublishedPageId: execution.pageId,
  };
}

export function partitionExpectedConsoleIssues(consoleIssues, failedResponses, expectedResponses = failedResponses) {
  const exactConflict = 'Failed to load resource: the server responded with a status of 409 (Conflict)';
  const expectedDomainConflict = (response) => response.method === 'POST' && response.status === 409 && (
    (response.action === 'saved-folder-source-change' && response.code === 'SOURCE_CHANGED'
      && /^\/api\/spaces\/[^/]+\/templates\/from-folder$/u.test(response.pathname))
    || (response.action === 'review-decision-page-conflict' && response.code === 'PAGE_VERSION_CONFLICT'
      && /^\/api\/spaces\/[^/]+\/collaboration\/runs\/[^/]+\/reviews\/[^/]+\/decision$/u.test(response.pathname))
  );
  const sameFailure = (actual, expectedResponse) => actual.action === expectedResponse.action
    && actual.pageId === expectedResponse.pageId
    && actual.method === expectedResponse.method
    && actual.pathname === expectedResponse.pathname
    && actual.url === expectedResponse.url
    && actual.status === expectedResponse.status
    && actual.code === expectedResponse.code;
  const remainingFailures = [...failedResponses];
  for (const expectedResponse of expectedResponses) {
    if (!expectedDomainConflict(expectedResponse)) {
      throw new Error(`Expected browser failure is not an allowed domain conflict: ${JSON.stringify(expectedResponse)}`);
    }
    const index = remainingFailures.findIndex((actual) => sameFailure(actual, expectedResponse));
    if (index < 0) {
      throw new Error(`Expected browser failure was not centrally observed: ${JSON.stringify(expectedResponse)}`);
    }
    remainingFailures.splice(index, 1);
  }
  const matchedResponses = [...expectedResponses];
  const expected = [];
  const unexpected = [];
  for (const issue of consoleIssues) {
    const responseIndex = matchedResponses.findIndex((response) => response !== null
      && issue.type === 'error'
      && issue.text === exactConflict
      && issue.action === response.action
      && issue.pageId === response.pageId
      && issue.locationUrl === response.url);
    if (responseIndex < 0) unexpected.push(issue);
    else {
      expected.push(issue);
      matchedResponses[responseIndex] = null;
    }
  }
  return { expected, unexpected, unexpectedResponses: remainingFailures };
}

export function createBrowserFailureCollector(context) {
  const pageIds = new WeakMap();
  const pages = [];
  const consoleIssues = [];
  const pageErrors = [];
  const failedResponses = [];
  const pendingResponseReads = new Set();
  const activeActions = new WeakMap();
  const pageId = (page) => pageIds.get(page);
  const register = (page) => {
    if (pageIds.has(page)) return;
    pageIds.set(page, `page-${pages.length + 1}`);
    pages.push(page);
    page.on('console', (message) => {
      if (!['error', 'warning'].includes(message.type())) return;
      consoleIssues.push({
        action: activeActions.get(page) ?? null,
        pageId: pageId(page),
        type: message.type(),
        text: message.text(),
        locationUrl: message.location()?.url ?? '',
        pageUrl: page.url(),
      });
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ pageId: pageId(page), pageUrl: page.url(), message: error.message });
    });
  };
  for (const page of context.pages?.() ?? []) register(page);
  context.on('page', register);
  context.on('response', (response) => {
    if (response.status() < 400) return;
    let responsePage;
    try {
      responsePage = response.request().frame().page();
    } catch {
      responsePage = undefined;
    }
    const responseAction = responsePage ? activeActions.get(responsePage) ?? null : null;
    const read = (async () => {
      let code = null;
      try {
        const body = await response.json();
        code = typeof body?.code === 'string' ? body.code : null;
      } catch {
        // Non-JSON failures remain observable and therefore fail closed.
      }
      const url = response.url();
      failedResponses.push({
        action: responseAction,
        pageId: responsePage ? pageId(responsePage) ?? null : null,
        method: response.request().method(),
        pathname: new URL(url).pathname,
        url,
        status: response.status(),
        code,
      });
    })();
    pendingResponseReads.add(read);
    void read.finally(() => pendingResponseReads.delete(read));
  });
  return {
    consoleIssues,
    pageErrors,
    failedResponses,
    pageId,
    pages,
    labelPage(page, label) {
      if (!pageIds.has(page)) register(page);
      pageIds.set(page, label);
    },
    async runAction(page, action, callback) {
      if (activeActions.has(page)) throw new Error(`Browser action already active for ${pageId(page)}`);
      activeActions.set(page, action);
      try {
        const result = await callback();
        await new Promise((resolve) => setImmediate(resolve));
        return result;
      } finally {
        activeActions.delete(page);
      }
    },
    async settleResponses() {
      await Promise.all([...pendingResponseReads]);
    },
    assertNoPageErrors() {
      if (pageErrors.length > 0) {
        throw new Error(`Browser page errors: ${pageErrors.map((error) => (
          `${error.pageId} ${error.pageUrl} ${error.message}`
        )).join('; ')}`);
      }
    },
    async assertPageNoFrameworkOverlay(page) {
      if (page.isClosed()) return;
      const overlaySelectors = [
        '#webpack-dev-server-client-overlay',
        'vite-error-overlay',
        '[data-nextjs-dialog-overlay]',
      ];
      for (const selector of overlaySelectors) {
        if (await page.locator(selector).count() > 0) {
          throw new Error(`Framework error overlay found on ${pageId(page) ?? 'unregistered-page'}: ${selector}`);
        }
      }
    },
    async assertAllOpenPagesNoFrameworkOverlay() {
      for (const page of pages) await this.assertPageNoFrameworkOverlay(page);
    },
  };
}

export function buildExternalAgentStagePrompt({ client, runId, stage }) {
  if (!client || !runId || !stage) throw new Error('External Agent prompt requires client, runId, and stage');
  return `${client} isolated AgentWiki acceptance stage ${stage}.

This is a bounded test fixture. Use only the AgentWiki MCP tools named below. Do not use shell, files, browser, generic network tools, subagents, or human-review tools.

Run ID: ${runId}

1. Call wiki_collaboration_join_run with that Run ID.
2. Call wiki_collaboration_next_action with that Run ID, waitSeconds 0, and a fresh idempotency key beginning acceptance-${stage}-next-.
   If the initial action is not execute_task, report it and stop; do not poll.
3. If the action is execute_task, handle exactly one task. For each returned Todo in ordinal order, call wiki_collaboration_update_todo first with doing and then with done, using the returned attempt ID and lease token, empty evidence, a concise summary, and a fresh idempotency key for every write.
4. Submit exactly one Markdown result with wiki_collaboration_submit_result. The Markdown must truthfully address the returned task objective and project input, be concise, include the literal marker "External Agent acceptance: ${stage}", and use empty evidence. Use the returned attempt ID and lease token and a fresh idempotency key.
5. Call wiki_collaboration_next_action once more with waitSeconds 0 and a fresh idempotency key. If it returns waiting_human, paused, or any terminal action, report that status and stop safely. On waiting_human do not poll and do not attempt human approval.

Never reveal an API key or lease token in the final response. Return only a concise receipt naming the tool sequence, task ID, submit action/status, and final next-action kind.`;
}

export function externalAgentGatewayFiles({
  client,
  apiUrl,
  agent,
  fixtureHome,
  cliPath,
  nodePath,
  connectionId,
}) {
  const wrapperPath = join(fixtureHome, `gateway-${client}.mjs`);
  const wrapperSource = `import { runCli } from ${JSON.stringify(cliPath)};\nawait runCli(['gateway','--connection',${JSON.stringify(connectionId)}], ${JSON.stringify(fixtureHome)});\n`;
  return {
    wrapperPath,
    wrapperSource,
    localSync: {
      version: 1,
      defaultConnectionId: connectionId,
      connections: {
        [connectionId]: {
          id: connectionId,
          serverUrl: apiUrl,
          agentId: agent.id,
          credentialId: agent.credentialId,
          pluginVersion: '0.7.0',
          client,
          mcpName: 'agentwiki',
        },
      },
    },
    credentials: { version: 2, credentials: { [agent.credentialId]: { apiKey: agent.apiKey } } },
    mcpConfig: { mcpServers: { agentwiki: { command: nodePath, args: [wrapperPath] } } },
    openCodeConfig: {
      $schema: 'https://opencode.ai/config.json',
      permission: { '*': 'deny', 'agentwiki_*': 'allow' },
      mcp: { agentwiki: { type: 'local', command: [nodePath, wrapperPath], enabled: true, timeout: 300_000 } },
    },
  };
}

function collaborationToolName(value) {
  if (typeof value !== 'string') return undefined;
  return value.match(/(wiki_collaboration_[a-z_]+)$/u)?.[1];
}

function parsedToolPayload(value) {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return undefined; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parsedToolPayload(item);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value.content)) return parsedToolPayload(value.content);
  if (typeof value.text === 'string') return parsedToolPayload(value.text);
  return value;
}

function safeRequestedInput(tool, input) {
  const value = input && typeof input === 'object' ? input : {};
  if (tool === 'wiki_collaboration_join_run') return { ...(typeof value.runId === 'string' ? { runId: value.runId } : {}) };
  if (tool === 'wiki_collaboration_next_action') return {
    ...(typeof value.runId === 'string' ? { runId: value.runId } : {}),
    ...(Number.isInteger(value.waitSeconds) ? { waitSeconds: value.waitSeconds } : {}),
  };
  if (tool === 'wiki_collaboration_update_todo') return {
    ...(typeof value.todoId === 'string' ? { todoId: value.todoId } : {}),
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  };
  if (tool === 'wiki_collaboration_submit_result') return {
    ...(typeof value.artifact?.kind === 'string' ? { artifactKind: value.artifact.kind } : {}),
  };
  return {};
}

function safeResultSummary(tool, rawResult) {
  const value = parsedToolPayload(rawResult);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  if (tool === 'wiki_collaboration_join_run') return {
    ...(typeof value.status === 'string' ? { status: value.status } : {}),
  };
  if (tool === 'wiki_collaboration_next_action') return {
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.task?.id === 'string' ? { taskId: value.task.id } : {}),
    ...(Array.isArray(value.task?.todos) ? {
      todos: value.task.todos.flatMap((todo) => typeof todo?.id === 'string' && Number.isInteger(todo.ordinal)
        ? [{ id: todo.id, ordinal: todo.ordinal }]
        : []),
    } : {}),
  };
  if (tool === 'wiki_collaboration_update_todo') return {
    ...(typeof value.todo?.id === 'string' ? { todoId: value.todo.id } : {}),
    ...(typeof value.todo?.status === 'string' ? { todoStatus: value.todo.status } : {}),
    ...(typeof value.taskStatus === 'string' ? { taskStatus: value.taskStatus } : {}),
  };
  if (tool === 'wiki_collaboration_submit_result') return {
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(typeof value.artifactStatus === 'string' ? { artifactStatus: value.artifactStatus } : {}),
    ...(typeof value.taskStatus === 'string' ? { taskStatus: value.taskStatus } : {}),
    ...(typeof value.runStatus === 'string' ? { runStatus: value.runStatus } : {}),
  };
  return {};
}

export function extractCollaborationToolReceipt(output) {
  const requestedCalls = [];
  const successfulCalls = [];
  const claudeRequests = new Map();
  const codexRequestIds = new Set();
  const request = (tool, input, id) => {
    if (!tool || (id && codexRequestIds.has(id))) return;
    requestedCalls.push({ tool, input: safeRequestedInput(tool, input) });
    if (id) codexRequestIds.add(id);
  };
  const succeed = (tool, input, result) => {
    if (!tool) return;
    successfulCalls.push({
      tool,
      input: safeRequestedInput(tool, input),
      result: safeResultSummary(tool, result),
    });
  };
  for (const line of output.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const item = event?.item;
    if (item?.type === 'mcp_tool_call') {
      const name = collaborationToolName(item.tool);
      request(name, item.arguments, item.id);
      const resultFailed = item.result?.isError === true || item.result?.is_error === true;
      if (event.type === 'item.completed' && item.status === 'completed' && !item.error && item.result && !resultFailed) {
        succeed(name, item.arguments, item.result);
      }
    }
    const claudeContent = event?.message?.content;
    if (Array.isArray(claudeContent)) {
      for (const block of claudeContent) {
        if (block?.type === 'tool_use') {
          const name = collaborationToolName(block.name);
          request(name, block.input);
          if (name && typeof block.id === 'string') claudeRequests.set(block.id, { tool: name, input: block.input });
        } else if (block?.type === 'tool_result') {
          const pending = claudeRequests.get(block.tool_use_id);
          if (pending && block.is_error !== true && block.isError !== true) {
            succeed(pending.tool, pending.input, block.content);
          }
        }
      }
    }
    const part = event?.part;
    if (part?.type === 'tool') {
      const name = collaborationToolName(part.tool);
      request(name, part.state?.input);
      if (part.state?.status === 'completed' && part.state?.error == null) {
        succeed(name, part.state?.input, part.state?.output);
      }
    }
  }
  return { requestedCalls, successfulCalls };
}

export function extractExecutedCollaborationTools(output) {
  return extractCollaborationToolReceipt(output).successfulCalls.map((call) => call.tool);
}

export function assertExternalAgentSuccessfulSequence(calls) {
  const expectTool = (index, tool) => {
    if (calls[index]?.tool !== tool) throw new Error(`External Agent receipt expected ${tool} at successful call ${index + 1}`);
  };
  expectTool(0, 'wiki_collaboration_join_run');
  if (calls[0].result?.status !== 'running') throw new Error('External Agent join must return running');
  expectTool(1, 'wiki_collaboration_next_action');
  const execute = calls[1];
  const todos = execute?.result?.todos;
  const todoCount = Array.isArray(todos) ? todos.length : 0;
  if (execute.result?.action !== 'execute_task' || typeof execute.result?.taskId !== 'string' || todoCount < 1) {
    throw new Error('External Agent initial next_action must return execute_task with Todos');
  }
  const expectedCount = 4 + (todoCount * 2);
  if (calls.length !== expectedCount) {
    throw new Error(`External Agent receipt needs exact successful call count ${expectedCount}, got ${calls.length}`);
  }
  const orderedTodos = [...todos].sort((left, right) => left.ordinal - right.ordinal);
  for (const [ordinalIndex, todo] of orderedTodos.entries()) {
    const doingIndex = 2 + (ordinalIndex * 2);
    const doneIndex = doingIndex + 1;
    expectTool(doingIndex, 'wiki_collaboration_update_todo');
    if (calls[doingIndex].input?.todoId !== todo.id || calls[doingIndex].input?.status !== 'doing'
      || calls[doingIndex].result?.todoId !== todo.id || calls[doingIndex].result?.todoStatus !== 'doing') {
      throw new Error(`External Agent Todo doing transition is invalid for ordinal ${todo.ordinal}`);
    }
    expectTool(doneIndex, 'wiki_collaboration_update_todo');
    if (calls[doneIndex].input?.todoId !== todo.id || calls[doneIndex].input?.status !== 'done'
      || calls[doneIndex].result?.todoId !== todo.id || calls[doneIndex].result?.todoStatus !== 'done') {
      throw new Error(`External Agent Todo done transition is invalid for ordinal ${todo.ordinal}`);
    }
  }
  const submitIndex = 2 + (todoCount * 2);
  expectTool(submitIndex, 'wiki_collaboration_submit_result');
  const submit = calls[submitIndex];
  if (submit.input?.artifactKind !== 'markdown' || submit.result?.action !== 'submitted'
    || submit.result?.artifactStatus !== 'pending' || submit.result?.taskStatus !== 'submitted'
    || submit.result?.runStatus !== 'waiting_review') {
    throw new Error('External Agent submit must return submitted/pending waiting_review state');
  }
  expectTool(submitIndex + 1, 'wiki_collaboration_next_action');
  if (calls[submitIndex + 1].result?.action !== 'waiting_human') {
    throw new Error('External Agent final next_action must return waiting_human');
  }
  return { taskId: execute.result.taskId, todoCount, finalAction: 'waiting_human' };
}

export function assertExternalAgentReceipt({ requestedCalls, successfulCalls }) {
  if (requestedCalls.length !== successfulCalls.length) {
    throw new Error(`External Agent receipt requires every requested call to succeed; requested ${requestedCalls.length}, succeeded ${successfulCalls.length}`);
  }
  for (const [index, requested] of requestedCalls.entries()) {
    const successful = successfulCalls[index];
    if (!isDeepStrictEqual(requested, { tool: successful?.tool, input: successful?.input })) {
      throw new Error(`External Agent receipt request/success mismatch at call ${index + 1}`);
    }
  }
  return {
    ...assertExternalAgentSuccessfulSequence(successfulCalls),
    requestedCount: requestedCalls.length,
    successfulCount: successfulCalls.length,
  };
}

export function externalAgentClientArgs({
  client,
  fixtureHome,
  wrapperPath,
  mcpConfigPath,
  prompt,
  lastMessagePath,
  nodePath,
}) {
  if (client === 'codex') return [
    'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--approve-for-me', '-C', fixtureHome,
    '--model', 'gpt-5.4-mini',
    '-c', `mcp_servers.agentwiki.command=${JSON.stringify(nodePath)}`,
    '-c', `mcp_servers.agentwiki.args=${JSON.stringify([wrapperPath])}`,
    '--json', '--output-last-message', lastMessagePath, prompt,
  ];
  if (client === 'opencode') return [
    'run', '--pure', '--model', 'deepseek/deepseek-v4-flash', '--variant', 'low',
    '--format', 'json', '--dir', fixtureHome, prompt,
  ];
  return [
    '--print', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--no-chrome',
    '--model', 'haiku', '--effort', 'low', '--setting-sources', '', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', mcpConfigPath,
    '--tools', '', '--allowedTools', [
      'mcp__agentwiki__wiki_collaboration_join_run',
      'mcp__agentwiki__wiki_collaboration_next_action',
      'mcp__agentwiki__wiki_collaboration_heartbeat',
      'mcp__agentwiki__wiki_collaboration_update_todo',
      'mcp__agentwiki__wiki_collaboration_submit_result',
      'mcp__agentwiki__wiki_collaboration_get_run',
    ].join(','),
    '--permission-mode', 'dontAsk', '--max-budget-usd', '1', prompt,
  ];
}

export function externalAgentClientEnvironment({ client, parent, openCodeConfig }) {
  if (client === 'claude') {
    return Object.fromEntries(Object.entries(parent).filter(([name]) => name !== 'ANTHROPIC_AUTH_TOKEN'));
  }
  if (client === 'opencode') {
    return { ...parent, OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig) };
  }
  return parent;
}

export function selectExternalAgentStages(selection = 'all') {
  if (selection === 'none') return [];
  if (selection === 'opencode') {
    return [{ key: 'opencode', label: 'OpenCode', stage: 'opencode-initial', evidence: 11 }];
  }
  if (selection !== 'all') {
    throw new Error('COMPOSITE_TEMPLATE_E2E_EXTERNAL_STAGES must be all, opencode, or none');
  }
  return [
    { key: 'codex', label: 'Codex', stage: 'codex-initial', evidence: 7 },
    { key: 'codex', label: 'Codex', stage: 'codex-resume-after-review-1', evidence: 9 },
    { key: 'opencode', label: 'OpenCode', stage: 'opencode-initial-after-review-2', evidence: 11 },
  ];
}

export function selectExternalAgentRoleAssignments(selection, agents) {
  return {
    projectOwner: selection === 'opencode' ? agents.opencode : agents.codex,
    executionOwner: agents.opencode,
    riskReviewer: agents.codex,
  };
}

export function acceptanceCompletionStatus(full, evidence) {
  if (!full) return 'STARTUP_READY';
  const successfulClients = new Set((evidence?.externalAgents?.clients ?? [])
    .filter((client) => client.exitCode === 0)
    .map((client) => client.client));
  return evidence?.scenariosPassed === 6
    && successfulClients.has('codex')
    && (successfulClients.has('claude') || successfulClients.has('opencode'))
    ? 'ACCEPTANCE_COMPLETE'
    : 'ACCEPTANCE_PARTIAL';
}

export function assertPublishedPageVersionPair({ beforeVersions, afterVersions, priorContent, publishedContent }) {
  const priorIds = new Set(beforeVersions.map((version) => version.id));
  const created = afterVersions.filter((version) => !priorIds.has(version.id));
  if (created.length !== 2) throw new Error(`Expected exactly two PageVersions for one reviewed publication, got ${created.length}`);
  const contents = created.map((version) => version.content);
  if (!contents.includes(priorContent)) throw new Error('Reviewed publication is missing its immutable before-image PageVersion');
  if (!contents.includes(publishedContent)) throw new Error('Reviewed publication is missing its immutable after-image PageVersion');
}

function quoteIdentifier(value) {
  if (!SAFE_SCHEMA.test(value)) throw new Error('Refusing unsafe composite E2E schema identifier');
  return `"${value.replaceAll('"', '""')}"`;
}

export async function withCompositeTemplateE2EDatabase(baseDatabaseUrl, callback) {
  const parsed = validateCompositeTemplateE2EDatabaseUrl(baseDatabaseUrl);
  parsed.searchParams.delete('schema');
  const administrativeUrl = parsed.toString();
  return withFolderMigrationBundle({}, async (preparedMigrations) => {
    const schemaName = `mac_e2e_${randomUUID().replaceAll('-', '')}`;
    const schemaSql = quoteIdentifier(schemaName);
    const testUrl = new URL(administrativeUrl);
    testUrl.searchParams.set('schema', schemaName);
    const databaseUrl = testUrl.toString();
    const prisma = new PrismaClient({ datasources: { db: { url: administrativeUrl } } });
    let schemaCreated = false;
    let safetyInventory;
    return withTestDatabaseCleanup(
      'Composite template E2E database',
      async () => {
        await assertFolderDatabaseSafetyPreflight(prisma);
        safetyInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
        await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schemaSql}`);
        schemaCreated = true;
        const migration = spawnPnpmSync([
          '--filter', '@agentwiki/server', 'exec', 'prisma', 'migrate', 'deploy',
          '--schema', preparedMigrations.schemaPath,
        ], boundedMigrationOptions({
          cwd: new URL('..', import.meta.url),
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: databaseUrl },
        }));
        if (migration.error || migration.status !== 0) {
          const details = [migration.error?.message, migration.stdout, migration.stderr].filter(Boolean).join('\n');
          throw new Error(`Composite E2E migration failed:\n${details}`);
        }
        const afterMigration = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
        if (!isDeepStrictEqual(afterMigration, safetyInventory)) {
          throw new Error('Composite E2E migration changed protected public inventory');
        }
        return callback({
          databaseUrl,
          schemaName,
          migrationTreeDigest: preparedMigrations.treeDigest,
          publicInventoryDigest: folderDatabaseSafetyInventoryDigest(safetyInventory),
        });
      },
      [
        async () => {
          if (safetyInventory) {
            const finalInventory = await captureFolderDatabaseSafetyInventory(administrativeUrl, prisma);
            if (!isDeepStrictEqual(finalInventory, safetyInventory)) {
              throw new Error('Composite E2E test changed protected public inventory');
            }
          }
        },
        async () => { if (schemaCreated) await prisma.$executeRawUnsafe(`DROP SCHEMA ${schemaSql} CASCADE`); },
        async () => prisma.$disconnect(),
      ],
    );
  });
}
