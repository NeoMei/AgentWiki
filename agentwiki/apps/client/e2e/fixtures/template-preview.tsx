import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider, useLanguage } from '../../src/context/LanguageContext';
import { NewContentPage } from '../../src/features/page-templates/NewContentPage';
import { PageTemplateManager } from '../../src/features/page-templates/PageTemplateManager';
import '../../src/index.css';

// Real production React components and HTTP transport; all API data and identity are synthetic.
const params = new URLSearchParams(window.location.search);
const role = params.get('role') === 'editor' ? 'editor' : 'owner';
const spaceId = 'template-preview-space';
const user = { id: `template-preview-${role}`, name: `本地 ${role}`, email: `${role}@template-preview.test`, platformRole: 'user' };
localStorage.setItem('token', user.id);
localStorage.setItem('user', JSON.stringify(user));
localStorage.setItem('agentwiki.language.v1', params.get('locale') === 'en' ? 'en' : 'zh-CN');
function Fixture() {
  const location = useLocation();
  const { language, setLanguage } = useLanguage();
  return <>
    <nav aria-label="本地验收导航" className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs">
      <strong>本地内存 API · 仅 UI 验证 · {role}</strong>
      <Link to={`/spaces/${spaceId}/new?kind=single_page&folder=reports`}>新建内容</Link>
      <Link to={`/spaces/${spaceId}/settings/page-templates?folder=reports`}>管理测试路由</Link>
      <button onClick={() => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN')}>中文 / English</button>
      <output data-testid="fixture-route" className="break-all">{location.pathname}{location.search}</output>
    </nav>
    <Routes>
      <Route path="/spaces/:id/new" element={<NewContentPage />} />
      <Route path="/spaces/:id/settings/page-templates" element={<main><PageTemplateManager /></main>} />
      <Route path="*" element={<main className="p-8"><h1>本地创建结果路由</h1><p>页面创建结果与目录参数由内存 API 记录。</p></main>} />
    </Routes>
  </>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<AuthProvider><LanguageProvider><MemoryRouter initialEntries={[params.get('entry') || `/spaces/${spaceId}/new?kind=single_page&folder=reports`]}><Fixture /></MemoryRouter></LanguageProvider></AuthProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
