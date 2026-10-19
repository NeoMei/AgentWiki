import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import api from '../../src/api/client';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider, useLanguage } from '../../src/context/LanguageContext';
import { AgentSessionRegistryProvider } from '../../src/features/agent-session/AgentSessionRegistry';
import type { AgentSessionDetail, AgentTurn } from '../../src/features/agent-session/agentSessionTypes';
import { PagePreview } from '../../src/features/page/PagePreview';
import { SpaceWorkspace } from '../../src/features/space-workspace/SpaceWorkspace';
import { SpaceWorkspaceProvider } from '../../src/features/space-workspace/SpaceWorkspaceContext';
import { defaultWorkspacePreferences, writeWorkspacePreferences } from '../../src/features/space-workspace/workspacePreferences';
import '../../src/index.css';

// Synthetic UI transport only: this fixture never contacts a backend or model.
const user = { id: 'directory-fixture-viewer', name: 'UI 验收用户', email: 'fixture@example.test', platformRole: 'user' };
const spaceId = 'directory-fixture-space';
const timestamp = '2026-10-19T00:00:00.000Z';
const folders = [
  { id: 'research', name: '研发资料', parentId: null, path: '/研发资料' },
  { id: 'research-child', name: '验收记录', parentId: 'research', path: '/研发资料/验收记录' },
].map((folder) => ({ ...folder, kind: 'folder' as const, sortOrder: 0, hasChildren: true, createdAt: timestamp, updatedAt: timestamp }));
const pages = Array.from({ length: 9 }, (_, index) => ({ id: `directory-page-${index}`, title: index ? `研发文档 ${index}` : '空间说明',
  folderId: index === 0 ? null : index > 6 ? 'research-child' : 'research', kind: 'page' as const, spaceId,
  path: `/研发资料/研发文档${index}`, sortOrder: index, createdAt: timestamp, updatedAt: timestamp,
  format: 'markdown', capabilities: { canEdit: false },
  content: `# ${index ? `研发文档 ${index}` : '空间说明'}\n\n这是本地合成内容，仅用于页面入口、目录上下文提示、请求和响应式布局验收。\n\n## 验收条件\n\n在 Agent 中要求汇总当前目录。目录包含子目录，读取数量来自服务端回执；本 fixture 的回执为合成数据。`,
}));
const sessions = new Map<string, AgentSessionDetail>();
let lastRequest = '';
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

api.defaults.adapter = async (config) => {
  const url = config.url ?? '', method = config.method ?? 'get';
  const input = typeof config.data === 'string' ? JSON.parse(config.data) : config.data ?? {};
  let data: unknown;
  if (url === `/spaces/${spaceId}`) data = { id: spaceId, name: '目录问答验收空间', members: [{ userId: user.id, role: 'viewer' }] };
  else if (url === `/spaces/${spaceId}/content-tree`) {
    const parentFolderId = config.params?.parentFolderId ?? null;
    data = { spaceId, treeRevision: '7', parentFolderId, data: [...folders.filter((folder) => folder.parentId === parentFolderId), ...pages.filter((page) => page.folderId === parentFolderId)], nextCursor: null };
  } else if (url === `/spaces/${spaceId}/folders`) data = { spaceId, treeRevision: '7', data: folders, nextCursor: null };
  else if (url === '/assist/sessions') {
    if (method === 'post') {
      const session = { id: crypto.randomUUID(), spaceId, title: '新会话', createdAt: timestamp, updatedAt: timestamp, turns: [] };
      sessions.set(session.id, session); data = session;
    } else data = [...sessions.values()].map(({ turns: _turns, ...summary }) => summary);
  } else if (url.startsWith('/assist/sessions/')) {
    const session = sessions.get(url.split('/')[3]);
    if (!session) throw new Error('Unknown synthetic conversation');
    if (method === 'post' && url.endsWith('/turns')) {
      const page = pages.find((item) => item.id === input.pageId);
      if (!page && (!input.directory || input.mode !== 'question' || input.snapshot)) throw new Error('Invalid directory request');
      const folderId = input.directory?.folderId ?? page?.folderId ?? null;
      const selectedPages = pages.filter((item) => folderId === null || item.folderId === folderId || folderId === 'research' && item.folderId === 'research-child');
      const directory = { folderId, title: folders.find((folder) => folder.id === folderId)?.name ?? '目录问答验收空间', recursive: true, pageCount: selectedPages.length };
      lastRequest = JSON.stringify({ pageId: input.pageId ?? null, directory: input.directory ?? '由文章推导', snapshot: !!input.snapshot }); listeners.forEach((listener) => listener());
      const turn: AgentTurn = { id: crypto.randomUUID(), sessionId: session.id, pageId: page?.id ?? null, mode: 'question', intent: input.intent, status: 'done', createdAt: timestamp,
        pageSnapshot: input.snapshot ?? null, references: [], noteIds: [], progressText: '', directory, error: null,
        result: { summary: `本地合成回执：已读取 **${directory.title}** 中的 ${directory.pageCount} 篇文档（含子目录）。\n\n${selectedPages.map((item) => `- ${item.title}`).join('\n')}` } };
      session.turns.push(turn); data = turn;
    } else data = session;
  } else if (url.startsWith('/pages/')) data = pages.find((page) => url === `/pages/${page.id}`);
  else if (url.endsWith('/notes')) data = { notes: [], canCreate: false };
  else if (url.startsWith('/knowledge/related/')) data = [];
  else if (url === '/search') data = { results: pages.map((page) => ({ page })) };
  else if (url.endsWith('/page-templates/composite')) data = { templates: [], total: 0, capabilities: { canCreate: false } };
  else throw new Error(`Unsupported synthetic request: ${method} ${url}`);
  return { config, status: 200, statusText: 'OK', headers: {}, data: structuredClone(data) };
};

function PageRoute() {
  const { id } = useParams();
  return <SpaceWorkspace mode="read" pageId={id} spaceId={spaceId} showDirectory><PagePreview /></SpaceWorkspace>;
}
function Fixture() {
  const request = useSyncExternalStore(subscribe, () => lastRequest);
  const { language, setLanguage } = useLanguage();
  return <>
    <nav aria-label="本地验收导航" className="flex flex-wrap items-center gap-4 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm">
      <strong>本地合成数据 · 仅 UI 验收 · 非真实模型</strong>
      <Link to={`/spaces/${spaceId}`}>根目录</Link><Link to={`/spaces/${spaceId}?folder=research`}>研发资料</Link><Link to="/pages/directory-page-1">文章阅读页</Link>
      <button onClick={() => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN')}>中文 / English</button>
      <output data-testid="last-request" className="w-full break-all text-xs">{request}</output>
    </nav>
    <Routes><Route path="/spaces/:id" element={<SpaceWorkspace mode="directory" spaceId={spaceId} showDirectory><></></SpaceWorkspace>} /><Route path="/pages/:id" element={<PageRoute />} /></Routes>
  </>;
}
localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('token', user.id); localStorage.setItem('agentwiki.language.v1', 'zh-CN');
writeWorkspacePreferences(user.id, spaceId, { ...defaultWorkspacePreferences(), collaborationOpen: true, collaborationTab: 'assist' });
const root = createRoot(document.getElementById('root')!);
root.render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={[`/spaces/${spaceId}`]}><AgentSessionRegistryProvider userId={user.id}><SpaceWorkspaceProvider userId={user.id}><Fixture /></SpaceWorkspaceProvider></AgentSessionRegistryProvider></MemoryRouter></LanguageProvider></AuthProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
