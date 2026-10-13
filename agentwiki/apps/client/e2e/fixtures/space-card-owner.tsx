import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import api from '../../src/api/client';
import { AuthProvider } from '../../src/context/AuthContext';
import { LanguageProvider, useLanguage } from '../../src/context/LanguageContext';
import { Dashboard } from '../../src/features/dashboard/Dashboard';
import '../../src/index.css';

// Synthetic data through the real Dashboard. No backend requests or production mutations.
const member = (id: string, name: string | null, email: string, role = 'owner') => ({
  type: 'human', role, user: { id, name, email },
});
const base = { updatedAt: new Date().toISOString(), pageCount: 17, memberCount: 4, approvalPolicy: 'always-review' };
const data = [
  { ...base, id: 'fixture-agentwiki', slug: 'agentwiki', name: 'AgentWiki 项目', description: '需求、项目计划和开发测试的协作资料。', members: [member('owner-a', '林晓', 'lin@example.test'), member('admin', '空间管理员', 'admin@example.test', 'admin')] },
  { ...base, id: 'fixture-shared', slug: 'shared', name: '团队项目管理', description: '多位所有者共同维护的项目知识空间。', members: [member('owner-b', '陈晨', 'chen@example.test'), member('owner-c', '王敏', 'wang@example.test')] },
  { ...base, id: 'fixture-long', slug: 'long', name: '跨团队研发协作', description: '长姓名和多 Owner 的卡片布局验收。', members: [member('owner-d', '国际产品研发与交付团队空间负责人', 'long@example.test'), member('owner-e', '联合项目负责人', 'second@example.test')] },
  { ...base, id: 'fixture-email', slug: 'email', name: '开发测试空间', description: '账号尚未设置显示姓名时使用邮箱。', members: [member('owner-f', '  ', 'qa-owner@example.test')] },
  { ...base, id: 'fixture-unknown', slug: 'unknown', name: '历史空间', description: '旧响应缺少所有者资料时明确提示，避免误认当前用户。' },
];
api.defaults.adapter = async (config) => {
  if (config.method !== 'get' || config.url !== '/spaces') throw new Error('This read-only fixture supports only the Space list');
  return { config, status: 200, statusText: 'OK', headers: {}, data: { data, total: data.length, page: 1, limit: 20, revision: 'fixture', nextCursor: null, hasMore: false, resetRequired: false } };
};
function Fixture() {
  const { language, setLanguage } = useLanguage();
  return <div className="mx-auto max-w-7xl p-4 sm:p-6">
    <div className="mb-6 flex items-center justify-between gap-4 border-b border-gray-200 pb-3 text-xs text-gray-500">
      <span>本地合成数据 · Space Owner 显示验收</span>
      <select aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value as 'en' | 'zh-CN')}><option value="zh-CN">中文</option><option value="en">English</option></select>
    </div>
    <Dashboard />
  </div>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<MemoryRouter><AuthProvider><LanguageProvider><Fixture /></LanguageProvider></AuthProvider></MemoryRouter>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
