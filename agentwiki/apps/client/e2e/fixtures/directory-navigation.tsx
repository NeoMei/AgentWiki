import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import api from '../../src/api/client';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { PagePreview } from '../../src/features/page/PagePreview';
import { SpaceWorkspace } from '../../src/features/space-workspace/SpaceWorkspace';
import { SpaceWorkspaceProvider } from '../../src/features/space-workspace/SpaceWorkspaceContext';
import type { ContentTreeFolderNode, ContentTreePageNode } from '../../src/features/content-tree/contentTreeTypes';
import '../../src/index.css';

// Synthetic read-only responses through the real route, workspace, reader and
// directory. The adapter rejects all mutations and never contacts a backend.
const spaceId = 'fixture-navigation-space';
const userId = 'fixture-navigation-reader';
const timestamp = '2026-10-15T00:00:00.000Z';
const folders = [
  { id: 'fixture-reports', name: '合成周报' },
  { id: 'fixture-tasks', name: '合成任务' },
].map(({ id, name }, index): ContentTreeFolderNode => ({
  kind: 'folder', id, name, path: `/${name}`, sortOrder: index,
  hasChildren: true, createdAt: timestamp, updatedAt: timestamp,
}));
const pages: ContentTreePageNode[] = [
  { id: 'fixture-page-one', title: '合成周报一', folderId: 'fixture-reports' },
  { id: 'fixture-page-two', title: '合成周报二', folderId: 'fixture-reports' },
  { id: 'fixture-page-three', title: '合成任务安排', folderId: 'fixture-tasks' },
].map((page, index) => ({ ...page, kind: 'page', path: `/${page.id}`, sortOrder: index, createdAt: timestamp, updatedAt: timestamp }));

let counts = { directory: 0, pages: 0, pendingPages: 0 };
const subscribers = new Set<() => void>();
const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
const snapshot = () => counts;
const updateCounts = (change: Partial<typeof counts>) => {
  counts = { ...counts, ...change };
  subscribers.forEach((listener) => listener());
};
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

api.defaults.adapter = async (config) => {
  if (config.method !== 'get') throw new Error('This fixture permits only synthetic reads');
  const url = config.url ?? '';
  let data: unknown;
  if (url === `/spaces/${spaceId}`) {
    data = { id: spaceId, name: '目录切换验收空间', description: '全部内容均为本地合成数据', members: [] };
  } else if (url === `/spaces/${spaceId}/content-tree`) {
    updateCounts({ directory: counts.directory + 1 });
    await delay(250);
    const parentFolderId = config.params?.parentFolderId ?? null;
    data = { spaceId, treeRevision: '7', parentFolderId, nextCursor: null,
      data: parentFolderId ? pages.filter((page) => page.folderId === parentFolderId) : folders };
  } else if (url === `/spaces/${spaceId}/folders`) {
    updateCounts({ directory: counts.directory + 1 });
    await delay(250);
    data = { spaceId, treeRevision: '7', data: folders.map((folder) => ({ ...folder, parentId: null })), nextCursor: null };
  } else if (url.startsWith('/pages/')) {
    const page = pages.find((item) => url === `/pages/${item.id}`);
    if (!page) throw new Error(`Unknown synthetic document: ${url}`);
    updateCounts({ pages: counts.pages + 1, pendingPages: counts.pendingPages + 1 });
    await delay(600);
    updateCounts({ pendingPages: counts.pendingPages - 1 });
    data = { ...page, spaceId, format: 'markdown', capabilities: { canEdit: false },
      content: '## 验收说明\n\n这是一篇合成文档，用于验证切换文档时目录持续可见。\n\n在左侧切换同文件夹的两篇周报，再切换到任务安排。右侧文档有 600 毫秒模拟延迟；已加载目录不应消失，请求计数也不应增加。' };
  } else if (url.startsWith('/knowledge/related/')) {
    data = [];
  } else if (url === `/spaces/${spaceId}/page-templates/composite`) {
    data = { templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false } };
  } else {
    throw new Error(`Unsupported synthetic request: ${url}`);
  }
  return { config, status: 200, statusText: 'OK', headers: {}, data };
};

function PageRoute() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  return <SpaceWorkspace mode="read" pageId={id} spaceId={state?.workspaceSpaceId} showDirectory><PagePreview /></SpaceWorkspace>;
}

function Fixture() {
  const requests = useSyncExternalStore(subscribe, snapshot);
  const location = useLocation();
  return <>
    <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-gray-800">
      <strong>本地合成数据 · 目录切换回归验收</strong>
      <p>目录延迟 250 ms，文档延迟 600 ms。切换左侧文档时，目录应始终可见，目录请求数保持不变。</p>
      <div className="flex flex-wrap gap-x-6 font-mono">
        <output data-testid="directory-requests">目录请求：{requests.directory}</output>
        <output data-testid="page-requests">文档请求：{requests.pages}</output>
        <output data-testid="pending-page-requests">文档加载中：{requests.pendingPages}</output>
        <output data-testid="fixture-route">{location.pathname}</output>
      </div>
    </div>
    <Routes><Route path="/pages/:id" element={<PageRoute />} /></Routes>
  </>;
}

localStorage.setItem(`agentwiki.workspace.v1:${userId}:${spaceId}`, JSON.stringify({ schemaVersion: 1, expandedFolderIds: folders.map((folder) => folder.id) }));
const root = createRoot(document.getElementById('root')!);
root.render(<LanguageProvider><MemoryRouter initialEntries={[{ pathname: '/pages/fixture-page-one', state: { workspaceSpaceId: spaceId } }]}>
  <SpaceWorkspaceProvider userId={userId}><Fixture /></SpaceWorkspaceProvider>
</MemoryRouter></LanguageProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
