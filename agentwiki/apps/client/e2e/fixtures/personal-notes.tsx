import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/context/AuthContext';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { AgentSessionRegistryProvider } from '../../src/features/agent-session/AgentSessionRegistry';
import { PagePreview } from '../../src/features/page/PagePreview';
import { PageEditor } from '../../src/features/page/PageEditor';
import { captureAssistTarget } from '../../src/features/page/assistTargets';
import { addPersonalNote, savePersonalNotes, personalNotesKey } from '../../src/features/page/reviewComments';
import { fixturePage, fixtureSource } from './personal-notes-data.mjs';
import '../../src/index.css';

const scope = { userId: 'personal-notes-user', spaceId: fixturePage.spaceId, pageId: fixturePage.id };
// Only this localhost fixture origin and fixed synthetic identity are used.
localStorage.setItem('user', JSON.stringify({ id: scope.userId, name: '本地演示' }));
localStorage.setItem('agentwiki.language.v1', 'zh-CN');
if (!localStorage.getItem(personalNotesKey(scope))) {
  const examples = [
    ['待确认的业务边界', '请补充哪些操作需要人工确认，并提供一个具体例子。'],
    ['先经过人工确认', '这条规则已确认，后续开发保持一致。'],
    ['复核关键流程的测试结果', '回归报告中需要附上失败用例和修复后的截图。'],
    ['项目协作规范', '核对规范中的权限说明是否与当前实现一致。'],
  ];
  savePersonalNotes(scope, examples.map(([quote, body], index) => {
    const from = fixtureSource.indexOf(quote);
    const target = captureAssistTarget(fixtureSource, 'selection', from, from + quote.length, fixturePage.updatedAt)!;
    const note = addPersonalNote(scope, target, body, `fixture-note-${index + 1}`);
    return index === 1 ? { ...note, status: 'resolved' as const, taskId: 'historical-fixture-task' } : note;
  }));
}
function Fixture() {
  const { user, login } = useAuth();
  return <AgentSessionRegistryProvider userId={user.id}>
  <nav className="flex flex-wrap gap-4 border-b border-gray-200 bg-gray-50 px-6 py-3 text-sm"><span className="text-gray-500">本地合成数据 · 真实页面组件验收</span><Link to={`/pages/${fixturePage.id}`}>阅读页</Link><Link to={`/pages/${fixturePage.id}/edit`}>编辑页</Link><button onClick={() => login('', { id: user.id === scope.userId ? 'other-fixture-user' : scope.userId })}>切换演示账号</button><span>{user.id === scope.userId ? '笔记所属账号' : '另一账号'}</span></nav>
  <Routes><Route path="/pages/:id" element={<PagePreview />} /><Route path="/pages/:id/edit" element={<PageEditor />} /></Routes>
  </AgentSessionRegistryProvider>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/pages/${fixturePage.id}`]}><AuthProvider><LanguageProvider><Fixture /></LanguageProvider></AuthProvider></MemoryRouter>);
