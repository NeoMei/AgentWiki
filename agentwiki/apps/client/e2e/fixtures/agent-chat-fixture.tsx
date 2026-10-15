import { useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { AgentSessionRegistryProvider } from '../../src/features/agent-session/AgentSessionRegistry';
import { SpaceWorkspaceProvider } from '../../src/features/space-workspace/SpaceWorkspaceContext';
import { SpaceWorkspaceScope } from '../../src/features/space-workspace/SpaceWorkspaceScope';
import { defaultWorkspacePreferences, writeWorkspacePreferences } from '../../src/features/space-workspace/workspacePreferences';
import { PagePreview } from '../../src/features/page/PagePreview';
import { PageEditor } from '../../src/features/page/PageEditor';
import { fixturePage, fixtureUser } from './agent-chat-data.mjs';
import '../../src/index.css';

// This origin is dedicated to the local fixture. Authentication is synthetic.
localStorage.setItem('user', JSON.stringify(fixtureUser));
localStorage.setItem('token', fixtureUser.id);
localStorage.setItem('agentwiki.language.v1', 'zh-CN');
writeWorkspacePreferences(fixtureUser.id, fixturePage.spaceId, {
  ...defaultWorkspacePreferences(), collaborationOpen: true, collaborationTab: 'assist', collaborationWidth: 520,
});

function DocumentRoute() {
  const { id } = useParams();
  const location = useLocation();
  const editing = location.pathname.endsWith('/edit');
  const ignore = useCallback(() => {}, []);
  return <SpaceWorkspaceScope mode={editing ? 'edit' : 'read'} spaceId={fixturePage.spaceId} activeSection="pages"
    selectedFolderId={null} selectedPageId={id ?? null} selectedPageFolderId={null} pageRefreshRequest={0}
    selectFolder={ignore} reportPageIdentity={ignore} requestPageRefresh={ignore}>
    {editing ? <PageEditor /> : <PagePreview />}
  </SpaceWorkspaceScope>;
}

function Fixture() {
  const { user } = useAuth();
  return <AgentSessionRegistryProvider userId={user.id}><SpaceWorkspaceProvider userId={user.id}>
    <nav className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-gray-50 px-6 py-3 text-xs text-gray-600" aria-label="本地验收导航">
      <span>本地合成数据 · Agent 对话验收</span>
      <Link className="text-blue-700" to={`/pages/${fixturePage.id}`}>阅读页</Link>
      <Link className="text-blue-700" to={`/pages/${fixturePage.id}/edit`}>编辑页</Link>
      <span className="ml-auto">不连接真实模型或生产服务</span>
    </nav>
    <Routes><Route path="/pages/:id" element={<DocumentRoute />} /><Route path="/pages/:id/edit" element={<DocumentRoute />} /></Routes>
  </SpaceWorkspaceProvider></AgentSessionRegistryProvider>;
}

const edit = new URLSearchParams(location.search).get('mode') === 'edit';
const root = createRoot(document.getElementById('root')!);
root.render(<MemoryRouter initialEntries={[`/pages/${fixturePage.id}${edit ? '/edit' : ''}`]}>
  <AuthProvider><LanguageProvider><Fixture /></LanguageProvider></AuthProvider>
</MemoryRouter>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
