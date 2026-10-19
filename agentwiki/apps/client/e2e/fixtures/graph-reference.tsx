// Synthetic transport for exercising the real graph UI without production writes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link, useParams } from 'react-router-dom';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import api from '../../src/api/client';
import { LanguageProvider, useLanguage } from '../../src/context/LanguageContext';
import { KnowledgeGraph } from '../../src/features/knowledge/KnowledgeGraph';
import '../../src/index.css';

const folders = [
  { id: 'fiction', name: '小说工作区1', path: '小说工作区1', parentId: null },
  { id: 'project', name: '项目管理', path: '项目管理', parentId: null },
  { id: 'templates', name: '模板源目录', path: '模板源目录', parentId: null },
];
const names = [
  ['世界观设定', '人物设定', '故事大纲', '章节规划', '世界地图'],
  ['测试计划', '需求分析', '版本规划', '任务拆解', '发布流程'],
  ['通用模板', '角色模板', '世界观模板', '大纲模板', '写作规范'],
];
const nodes = folders.flatMap((folder, group) => Array.from({ length: [18, 12, 8][group] }, (_, index) => ({
  id: `${folder.id}-${index}`, title: names[group][index] ?? `${folder.name}资料 ${index + 1}`,
  folderId: folder.id, path: `${folder.path}/${names[group][index] ?? `资料 ${index + 1}`}.md`,
  x: 100 + index * 40, y: 100 + group * 120, radius: 14,
})));
const edge = (id: string, source: string, target: string, origin = 'manual', relation = 'related_to') => ({
  id, source, target, origin, relation, strength: 0.8, confidence: 0.92,
  evidence: { quote: '本地验收关系样例', confidence: 0.92 }, approvalStatus: 'approved',
});
const manyFolders = Array.from({ length: 18 }, (_, group) => ({
  id: `many-${group}`, name: group === 2 ? '用于验证长标题的多层级知识库目录' : `工作目录 ${group + 1}`,
  path: `验收/工作目录${group + 1}`, parentId: null,
}));
const manyNodes = manyFolders.flatMap((folder, group) => Array.from({ length: group === 17 ? 10 : 5 }, (_, index) => ({
  id: `${folder.id}-${index}`, title: index === 0 ? `工作区${group + 1}概览` : `关联资料 ${index + 1}`,
  folderId: folder.id, path: `${folder.path}/资料${index + 1}.md`, x: 100 + index * 50, y: 100, radius: 14,
})));
const manyEdges = manyFolders.flatMap((folder, group) => [
  ...[1, 2, 3].map(index => edge(`many-edge-${group}-${index}`, `${folder.id}-0`, `${folder.id}-${index}`)),
  ...(group ? [edge(`many-cross-${group}`, `many-${group - 1}-0`, `${folder.id}-0`, 'auto_similar', 'similar_to')] : []),
]);
const projectFolders = [
  { id: 'project-requirements', name: '01 需求分析', path: '01 需求分析', parentId: null },
  { id: 'project-management', name: '02 项目管理', path: '02 项目管理', parentId: null },
  { id: 'project-development', name: '03 开发测试', path: '03 开发测试', parentId: null },
  { id: 'project-guidelines', name: '04 模板使用与协作规范', path: '04 模板使用与协作规范', parentId: null },
  { id: 'project-archive', name: '05 资料与归档', path: '05 资料与归档', parentId: null },
];
const projectNames = [
  ['01 功能表', '02 需求规格与验收标准', '03 使用场景与协作角色'],
  ['01 路线图与里程碑', '02 任务计划表', '03 风险与决策记录'],
  ['01 架构与开发指南', '02 测试计划与用例', '03 测试报告', '04 问题与修复反馈', '05 开发日志', '06 版本与发布记录'],
  ['01 复制到新项目', '02 字段与状态规范', '03 任务交接模板'],
  ['01 资料索引与维护规则'],
];
const projectNodes = [
  ...projectFolders.flatMap((folder, group) => projectNames[group].map((title, index) => ({
    id: `${folder.id}-${index}`, title, folderId: folder.id, path: `${folder.path}/${title}.md`,
    x: 100 + index * 40, y: 100 + group * 120, radius: 14,
  }))),
  { id: 'project-overview', title: '00 项目总览｜模板案例导航', folderId: null, path: '00 项目总览｜模板案例导航.md', x: 100, y: 700, radius: 14 },
];
let edges = [
  edge('e1', 'fiction-0', 'fiction-1'), edge('e2', 'fiction-0', 'fiction-2'),
  edge('e3', 'fiction-0', 'fiction-4'), edge('e4', 'fiction-0', 'project-0'),
  edge('e5', 'fiction-4', 'fiction-3', 'auto_similar', 'similar_to'),
  ...[1, 2, 3, 4].map(i => edge(`p${i}`, 'project-0', `project-${i}`)),
  ...[1, 2, 3, 4].map(i => edge(`t${i}`, 'templates-0', `templates-${i}`, i === 2 ? 'auto_similar' : 'manual')),
  edge('cross1', 'templates-0', 'project-0', 'auto_wikilink', 'references'),
  edge('cross2', 'templates-1', 'fiction-1'),
];
api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? '';
  let data: unknown;
  if (config.method === 'get' && url.startsWith('/knowledge/graph/')) {
    if (url.endsWith('/empty')) data = { nodes: [], edges: [], folders: [] };
    else if (url.endsWith('/many')) data = { nodes: manyNodes, edges: manyEdges, folders: manyFolders };
    else if (url.endsWith('/project')) data = { nodes: projectNodes, edges: [], folders: projectFolders };
    else if (url.endsWith('/edge-cases')) data = {
      nodes: [{ ...nodes[0], id: 'root', folderId: null }, { ...nodes[1], id: 'missing', folderId: 'missing' }],
      edges: [], folders: [{ id: 'empty-folder', name: '空目录', path: '空目录', parentId: null }],
    };
    else data = { nodes, edges, folders };
  } else if (config.method === 'get' && url.startsWith('/spaces/')) data = url.endsWith('/project')
    ? { id: 'project', name: '项目模板' } : { id: 'reference', name: '黄金书屋' };
  else if (config.method === 'post' && url === '/knowledge/relations') {
    const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    data = edge(`created-${edges.length}`, input.sourcePageId, input.targetPageId, 'manual', input.relation);
    edges = [...edges, data as ReturnType<typeof edge>];
  } else if (config.method === 'delete' && url.startsWith('/knowledge/relations/')) {
    edges = edges.filter(item => item.id !== url.split('/').pop()); data = { success: true };
  } else throw new AxiosError(`Unsupported graph fixture request: ${config.method} ${url}`, 'ERR_BAD_REQUEST', config);
  return { data, status: 200, statusText: 'OK', headers: {}, config };
};
function FixtureTools() {
  const { language, setLanguage } = useLanguage();
  return <details className="mt-6 border-t pt-3 text-xs text-gray-500"><summary>本地验收工具 · 合成数据</summary>
    <div className="mt-2 flex flex-wrap gap-4"><button onClick={() => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN')}>Language</button>
      <Link to="/spaces/reference/graph">Reference</Link><Link to="/spaces/project/graph">Project</Link><Link to="/spaces/many/graph">95 pages</Link><Link to="/spaces/empty/graph">Empty</Link><Link to="/spaces/edge-cases/graph">Edge cases</Link>
    </div></details>;
}
function OpenedPage() { return <><h1>已打开页面</h1><output>{useParams().pageId}</output><Link to="/spaces/reference/graph">返回图谱</Link></>; }
const requestedScenario = new URLSearchParams(window.location.search).get('scenario');
const initialScenario = requestedScenario && ['reference', 'project', 'many', 'empty', 'edge-cases'].includes(requestedScenario)
  ? requestedScenario : 'reference';
createRoot(document.getElementById('root')!).render(<LanguageProvider><MemoryRouter initialEntries={[`/spaces/${initialScenario}/graph`]}>
  <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
    <Routes><Route path="/spaces/:spaceId/graph" element={<KnowledgeGraph />} /><Route path="/pages/:pageId" element={<OpenedPage />} /></Routes>
    <FixtureTools />
  </main>
</MemoryRouter></LanguageProvider>);
