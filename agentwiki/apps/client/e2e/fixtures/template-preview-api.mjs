/** Local-only in-memory HTTP API. This fixture does not implement or prove production authorization. */
import http from 'node:http';
const spaceId = 'template-preview-space';
const stamp = '2026-10-19T06:00:00.000Z';
const daily = '# 日报\n\n## 今日成果\n\n| 工作事项 | 进度 | 负责人 |\n| --- | --- | --- |\n| 模板预览修复 | 已完成 | 项目团队 |\n| 自定义模板入口 | 验证中 | 产品团队 |\n\n## 明日计划\n\n- [x] 核对模板实际内容\n- [ ] 完成用户验收\n\n## 风险与依赖\n\n记录阻塞事项、协作需求以及下一步安排。';
const custom = '# 团队复盘\n\n## 目标与结果\n\n这是团队自定义的复盘正文，与日报内容不同。\n\n| 改进事项 | 负责人 |\n| --- | --- |\n| 保留实际验收证据 | 测试团队 |\n\n## 行动计划\n\n- [ ] 下周复盘执行情况';
const source = { id: 'saved-report', spaceId, title: '已保存的项目周报', format: 'markdown', folderId: 'reports', path: '/项目报告/已保存的项目周报', updatedAt: stamp, createdAt: stamp, content: '# 项目周报\n\n## 本周交付\n\n从已保存页面复制的自定义正文。\n\n- [x] 完成模板修复\n- [ ] 记录真实用户反馈' };
const summary = (id, name, scope, kind = 'single_page') => ({ id, name, scope, kind, stableKey: id, category: 'reporting', description: `${name}：复用页面内容与组织结构`, defaultTitle: name, sourceLocale: scope === 'system' ? null : 'zh-CN', currentVersion: 1, archivedAt: null, updatedAt: stamp, storageKind: kind === 'single_page' ? 'legacy_content' : 'definition', supportsCollaboration: false, effectiveSupportsCollaboration: false, pageCount: kind === 'single_page' ? 1 : 2, folderCount: kind === 'single_page' ? 0 : 1, roleCount: 0 });
const seed = () => [
  { ...summary('system-daily', '日报', 'system'), content: daily, contentLocale: 'zh-CN', sourcePageId: null },
  { ...summary('custom-retro', '团队复盘模板', 'space'), content: custom, contentLocale: 'zh-CN', sourcePageId: source.id },
  { ...summary('project-group', '项目启动页面组', 'system', 'page_group'), content: '', contentLocale: 'zh-CN', sourcePageId: null },
];
let templates = seed();
let requests = [];
let created = [];
let sequence = 0;
const nextStamp = () => new Date(Date.parse(stamp) + ++sequence * 1000).toISOString();
const nodesFor = (template, input = {}) => template.kind === 'single_page'
  ? [{ nodeId: `${template.id}-page`, parentNodeId: null, kind: 'page', order: 0, title: input.rootName || template.defaultTitle, content: template.content }]
  : [
    { nodeId: 'project-root', parentNodeId: null, kind: 'folder', order: 0, name: input.rootName || '项目启动' },
    { nodeId: 'project-overview', parentNodeId: 'project-root', kind: 'page', order: 0, title: '项目概览', content: '# 项目概览\n\n## 项目目标\n\n这是页面组的第一篇内容。\n\n- [ ] 明确目标与范围' },
    { nodeId: 'project-risks', parentNodeId: 'project-root', kind: 'page', order: 1, title: '风险清单', content: '# 风险清单\n\n这是页面组的第二篇内容。\n\n| 风险 | 应对方案 |\n| --- | --- |\n| 资源不足 | 提前协调 |' },
  ];
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
  let input = {};
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { let raw = ''; for await (const part of request) raw += part; input = JSON.parse(raw || '{}'); }
    if (url.pathname === '/__fixture/reset') { templates = seed(); requests = []; created = []; sequence = 0; return send(200, { reset: true }); }
    if (url.pathname === '/__fixture/state') return send(200, { templates, requests, created });
    const role = request.headers.authorization === 'Bearer template-preview-editor' ? 'editor' : 'owner';
    const canManage = role === 'owner';
    requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), input, role });
    const root = `/api/spaces/${spaceId}`;
    if (url.pathname === root) return send(200, { id: spaceId, name: '模板验收空间', members: [{ userId: `template-preview-${role}`, role }] });
    if (url.pathname === `${root}/folders`) return send(200, { spaceId, treeRevision: '5', data: [{ id: 'reports', name: '项目报告', parentId: null }], nextCursor: null });
    if (url.pathname === `${root}/members`) return send(200, [{ type: 'human', userId: `template-preview-${role}`, role }]);
    if (url.pathname === `${root}/content-tree`) return send(200, { spaceId, treeRevision: '5', data: [], nextCursor: null });
    if (url.pathname === `${root}/page-templates/source-pages`) return send(200, { data: source.title.includes(url.searchParams.get('q') || '') ? [source] : [], total: source.title.includes(url.searchParams.get('q') || '') ? 1 : 0, skip: 0, take: 100 });
    if (url.pathname === `${root}/templates` || url.pathname === `${root}/page-templates` && request.method === 'GET') {
      const filtered = templates.filter(item => (!url.searchParams.get('kind') || item.kind === url.searchParams.get('kind'))
        && (!url.searchParams.get('scope') || url.searchParams.get('scope') === 'all' || item.scope === url.searchParams.get('scope'))
        && (url.searchParams.get('archived') === 'all' || url.searchParams.get('archived') === 'archived' ? url.searchParams.get('archived') !== 'archived' || !!item.archivedAt : !item.archivedAt)
        && (!url.searchParams.get('category') || item.category === url.searchParams.get('category'))
        && `${item.name} ${item.description}`.includes(url.searchParams.get('q') || ''));
      const skip = Number(url.searchParams.get('skip') || 0), take = Number(url.searchParams.get('take') || 50);
      if (url.pathname.endsWith('/templates')) return send(200, { data: filtered.slice(skip, skip + take), total: filtered.length, skip, take, capabilities: { canManage, canCreate: true, canManageDefinitions: canManage, canSaveFolderTemplate: canManage, canBindAgent: false, canStartPageCollaboration: false } });
      return send(200, { system: filtered.filter(item => item.scope === 'system'), space: filtered.filter(item => item.scope === 'space'), totalSpace: filtered.filter(item => item.scope === 'space').length, skip, take, capabilities: { canManage } });
    }
    if (url.pathname === `${root}/page-templates` && request.method === 'POST') {
      if (!canManage) return send(403, { message: 'Fixture management capability denied' });
      if (input.sourcePageId !== source.id || input.expectedSourceUpdatedAt !== source.updatedAt) return send(409, { message: 'Source page snapshot changed' });
      const template = { ...summary(`saved-template-${sequence + 1}`, input.name, 'space'), description: input.description || '', category: input.category, defaultTitle: input.defaultTitle, updatedAt: nextStamp(), sourcePageId: source.id, sourceLocale: input.locale, contentLocale: input.locale, content: source.content };
      templates.push(template); return send(201, template);
    }
    const match = url.pathname.match(new RegExp(`^${root}/(?:templates|page-templates)/([^/]+)(?:/(preview|instantiate|restore|versions))?$`));
    if (match) {
      const template = templates.find(item => item.id === match[1]);
      if (!template) return send(404, { message: 'Unknown synthetic template' });
      if (match[2] === 'preview') return send(200, { templateId: template.id, templateVersion: template.currentVersion, locale: input.locale, definitionHash: 'fixture-content-hash', treeRevision: '5', nodes: nodesFor(template, input), pageCount: template.pageCount, folderCount: template.folderCount, roleCount: 0, roles: [], inputs: [], inputValues: {}, tasks: [], assignments: [], participants: [], issues: [] });
      if (match[2] === 'instantiate') { const pageId = `created-page-${created.length + 1}`; created.push({ templateId: template.id, ...input, pageId, content: template.content }); return send(201, { instantiationId: `inst-${created.length}`, rootFolderId: template.kind === 'page_group' ? 'created-folder' : null, pageIds: [pageId], runId: null, treeRevision: '6' }); }
      if (request.method === 'GET') return send(200, template);
      if (!canManage) return send(403, { message: 'Fixture management capability denied' });
      if (input.expectedUpdatedAt !== template.updatedAt) return send(409, { message: 'Synthetic template version conflict' });
      if (request.method === 'PATCH') { for (const key of ['name', 'description', 'defaultTitle', 'category']) if (key in input) template[key] = input[key]; }
      if (request.method === 'DELETE') template.archivedAt = nextStamp();
      if (match[2] === 'restore') template.archivedAt = null;
      template.updatedAt = nextStamp(); return send(200, template);
    }
    return send(404, { message: `Unsupported synthetic request: ${request.method} ${url.pathname}` });
  } catch (error) { return send(500, { message: error.message }); }
});
server.listen(3424, '127.0.0.1', () => console.log('Template UI fixture API listening on http://127.0.0.1:3424 (synthetic data only)'));
