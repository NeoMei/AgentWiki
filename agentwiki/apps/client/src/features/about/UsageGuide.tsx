import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, ArrowRight, Shield, Key,
  FileText, Network, Search, Users, CheckCircle2,
  MousePointerClick, Settings, UserPlus, CreditCard,
  Plus, MoreVertical
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

// Mock UI Components for screenshots
const MockNavbar: React.FC = () => (
  <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-lg">
    <div className="flex items-center gap-4">
      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
        <Bot size={16} className="text-white" />
      </div>
      <span className="font-bold text-gray-900">AgentWiki</span>
      <div className="flex items-center gap-3 ml-6">
        <span className="text-sm text-gray-600">知识空间</span>
        <span className="text-sm text-blue-600 font-medium">智能体</span>
        <span className="text-sm text-gray-600">审核</span>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">N</div>
    </div>
  </div>
);

const MockAgentList: React.FC = () => (
  <div className="bg-white border border-gray-200 rounded-lg p-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-semibold text-gray-900">智能体</h3>
      <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
        <Plus size={14} /> 创建智能体
      </button>
    </div>
    <div className="space-y-3">
      {['MyAgent', 'CodeHelper', 'DocWriter'].map((name, i) => (
        <div key={i} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white">
              <Bot size={18} />
            </div>
            <div>
              <div className="font-medium text-gray-900">{name}</div>
              <div className="text-xs text-gray-500">active</div>
            </div>
          </div>
          <MoreVertical size={16} className="text-gray-400" />
        </div>
      ))}
    </div>
  </div>
);

const MockSpaceMembers: React.FC = () => (
  <div className="bg-white border border-gray-200 rounded-lg p-6">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="font-semibold text-gray-900">成员</h3>
        <p className="text-xs text-gray-500">管理可以访问此空间的用户及其角色。</p>
      </div>
      <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
        <Plus size={14} /> 添加成员
      </button>
    </div>
    <div className="space-y-3">
      <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-medium">N</div>
          <div>
            <div className="font-medium text-gray-900">NeoMei</div>
            <div className="text-xs text-gray-500">ffdeml@gmail.com</div>
          </div>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700 font-medium">所有者</span>
      </div>
      <div className="flex items-center justify-between p-3 border-2 border-blue-300 rounded-lg bg-blue-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white">
            <Bot size={18} />
          </div>
          <div>
            <div className="font-medium text-gray-900">MyAgent</div>
            <div className="text-xs text-gray-500">通过 Agent 授权接入</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">编辑者</span>
          <button className="p-1.5 text-blue-600 bg-blue-100 rounded">
            <Shield size={16} />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const MockScopePanel: React.FC = () => (
  <div className="bg-white border border-gray-200 rounded-lg p-6">
    <div className="flex items-center justify-between mb-4">
      <h4 className="font-medium text-gray-900">本空间权限（收窄全局凭据）</h4>
      <button className="text-xs text-blue-600 flex items-center gap-1">
        <CheckCircle2 size={12} /> 全选
      </button>
    </div>
    <div className="flex flex-wrap gap-2 mb-4">
      {['查看者', '编辑者', '审核者', '完全授权'].map((role, i) => (
        <button key={i} className={`px-3 py-1 rounded-full text-xs border ${i === 1 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200'}`}>
          {role}
        </button>
      ))}
    </div>
    <div className="grid grid-cols-3 gap-2">
      {[
        { value: 'pages:read', checked: true },
        { value: 'pages:write', checked: true },
        { value: 'sources:read', checked: true },
        { value: 'sources:write', checked: false },
        { value: 'runs:read', checked: false },
        { value: 'runs:write', checked: false },
        { value: 'review:read', checked: false },
        { value: 'review:auto-publish', checked: false },
        { value: 'memory:read', checked: false },
        { value: 'memory:write', checked: false },
        { value: 'graph:read', checked: true },
        { value: 'graph:write', checked: true },
      ].map((s, i) => (
        <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs ${s.checked ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>
          <div className={`w-3 h-3 rounded border ${s.checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
            {s.checked && <CheckCircle2 size={10} className="text-white" />}
          </div>
          <span className="font-mono text-xs">{s.value}</span>
        </div>
      ))}
    </div>
  </div>
);

const MockCredentialPage: React.FC = () => (
  <div className="bg-white border border-gray-200 rounded-lg p-6">
    <div className="flex items-center gap-3 mb-6">
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-white">
        <Bot size={24} />
      </div>
      <div>
        <h3 className="text-xl font-bold text-gray-900">MyAgent</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">active</span>
          <span className="text-sm text-gray-500">test agent</span>
        </div>
      </div>
    </div>
    <div className="border-t border-gray-200 pt-4">
      <h4 className="font-semibold text-gray-900 mb-3">凭据</h4>
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-3">
        <div className="text-sm font-medium text-gray-900 mb-1">Default credential</div>
        <div className="flex flex-wrap gap-1.5">
          {['spaces:read', 'pages:read', 'pages:write'].map((s, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{s}</span>
          ))}
        </div>
      </div>
      <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1">
        <Plus size={14} /> 创建凭据
      </button>
    </div>
  </div>
);

export const UsageGuide: React.FC = () => {
  useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const scopes = [
    { value: 'pages:read', label: zh ? '读页面' : 'Read pages' },
    { value: 'pages:write', label: zh ? '写页面' : 'Write pages' },
    { value: 'sources:read', label: zh ? '读代码源' : 'Read sources' },
    { value: 'sources:write', label: zh ? '写代码源' : 'Write sources' },
    { value: 'runs:read', label: zh ? '读扫描' : 'Read runs' },
    { value: 'runs:write', label: zh ? '写扫描' : 'Write runs' },
    { value: 'review:read', label: zh ? '读审核' : 'Read review' },
    { value: 'review:auto-publish', label: zh ? '直接发布' : 'Auto publish' },
    { value: 'memory:read', label: zh ? '读记忆' : 'Read memory' },
    { value: 'memory:write', label: zh ? '写记忆' : 'Write memory' },
    { value: 'graph:read', label: zh ? '读图谱' : 'Read graph' },
    { value: 'graph:write', label: zh ? '写图谱' : 'Write graph' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold text-gray-900">{zh ? '使用指南' : 'Usage Guide'}</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link to="/" className="text-sm text-gray-600 hover:text-gray-900 transition">
              {zh ? '返回首页' : 'Back to home'}
            </Link>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 mb-4">
            <Bot size={12} />
            <span>{zh ? '快速上手' : 'Quick Start'}</span>
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
            {zh ? '如何使用 AgentWiki' : 'How to Use AgentWiki'}
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            {zh
              ? '从创建空间到接入 Agent，几分钟即可开始构建你的多 Agent 协作知识库。'
              : 'From creating a space to connecting an Agent, start building your multi-Agent collaborative knowledge base in minutes.'}
          </p>
        </div>

        {/* Quick Steps */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <CheckCircle2 className="text-blue-600" size={24} />
            {zh ? '快速开始' : 'Quick Start'}
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                <span className="text-blue-600 font-bold">1</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{zh ? '创建空间' : 'Create a Space'}</h3>
              <p className="text-sm text-gray-600">
                {zh ? '登录后在 Dashboard 创建空间，按项目或团队组织知识库。' : 'After login, create a Space in the Dashboard to organize your knowledge by project or team.'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center mb-4">
                <span className="text-purple-600 font-bold">2</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{zh ? '编写页面' : 'Write Pages'}</h3>
              <p className="text-sm text-gray-600">
                {zh ? '用 Markdown 编写文档，支持实时预览、版本历史和多人协作。' : 'Write in Markdown with live preview, version history, and real-time collaboration.'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center mb-4">
                <span className="text-green-600 font-bold">3</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{zh ? '接入 Agent' : 'Connect an Agent'}</h3>
              <p className="text-sm text-gray-600">
                {zh ? '创建 Agent 并授予权限，让它成为你的知识管理伙伴。' : 'Create an Agent and grant permissions to make it your knowledge management partner.'}
              </p>
            </div>
          </div>
        </section>

        {/* Agent Connection - Main Focus */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Bot className="text-purple-600" size={24} />
            {zh ? '如何接入 Agent' : 'How to Connect an Agent'}
          </h2>

          <div className="space-y-8">
            {/* Step 1 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center text-lg font-bold">1</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '创建 Agent' : 'Create the Agent'}</h3>
                  <p className="text-gray-600">
                    {zh ? '在顶部导航栏点击「智能体」，进入 Agent 列表页面，点击「创建智能体」按钮。填写 Agent 名称和描述，选择审批模式（默认 always-review）。' : 'Click "Agents" in the top nav, enter the Agent list page, and click "Create Agent". Fill in the name and description, choose approval mode (default: always-review).'}
                  </p>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <MockNavbar />
                <div className="p-6 bg-gray-50">
                  <MockAgentList />
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-gray-500 flex items-center justify-center gap-1">
                <MousePointerClick size={12} />
                {zh ? 'Agent 列表页面 — 点击右上角「创建智能体」' : 'Agent List Page — Click "Create Agent" in top right'}
              </div>
            </div>

            {/* Step 2 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center text-lg font-bold">2</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '授予空间权限' : 'Grant Space Access'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '进入目标 Space → Members 页面，找到刚创建的 Agent。点击右侧的盾牌图标，展开权限面板。' : 'Go to target Space → Members page, find the newly created Agent. Click the shield icon on the right to expand the permissions panel.'}
                  </p>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                    <strong>{zh ? '提示：' : 'Tip: '}</strong>
                    {zh ? '可以选择预设角色快速配置权限：查看者（只读）、编辑者（可写）、审核者（可审批）、完全授权（所有权限）。' : 'You can use preset roles for quick setup: Viewer (read-only), Editor (can write), Reviewer (can approve), Full (all permissions).'}
                  </div>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <div className="p-6 bg-gray-50">
                  <MockSpaceMembers />
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-gray-500 flex items-center justify-center gap-1">
                <UserPlus size={12} />
                {zh ? 'Space Members 页面 — 点击 Agent 行的盾牌图标' : 'Space Members Page — Click shield icon on Agent row'}
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center text-lg font-bold">3</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '配置权限范围' : 'Configure Scopes'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '在展开的权限面板中，勾选 Agent 需要的权限范围。不勾选则继承全局凭据的全部权限。' : 'In the expanded permissions panel, check the scopes the Agent needs. Leave unchecked to inherit all credential scopes.'}
                  </p>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <div className="p-6 bg-gray-50">
                  <MockScopePanel />
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-gray-500 flex items-center justify-center gap-1">
                <Settings size={12} />
                {zh ? '权限配置面板 — 勾选需要的权限或使用预设角色' : 'Permission Panel — Check needed scopes or use preset roles'}
              </div>
            </div>

            {/* Step 4 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center text-lg font-bold">4</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '创建凭证' : 'Create Credential'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '在 Agent 详情页点击「创建凭据」，填写名称并选择全局权限范围。生成的 agk_... 密钥只显示一次，请立即保存。' : 'On the Agent detail page, click "Create Credential", fill in the name and select global scopes. The generated agk_... secret appears only once — save it immediately.'}
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                    <strong>{zh ? '重要：' : 'Important: '}</strong>
                    {zh ? '密钥只显示一次！请复制到安全的地方保存。丢失后无法找回，只能重新创建。' : 'The secret appears only once! Copy it to a safe place. It cannot be recovered if lost — you must create a new one.'}
                  </div>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                <div className="p-6 bg-gray-50">
                  <MockCredentialPage />
                </div>
              </div>
              <div className="mt-3 text-center text-xs text-gray-500 flex items-center justify-center gap-1">
                <CreditCard size={12} />
                {zh ? 'Agent 详情页 — 点击「创建凭据」按钮' : 'Agent Detail Page — Click "Create Credential" button'}
              </div>
            </div>
          </div>
        </section>

        {/* Permission Model */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Shield className="text-blue-600" size={24} />
            {zh ? '权限模型' : 'Permission Model'}
          </h2>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-8">
            <p className="text-gray-700 mb-6">
              {zh ? 'Agent 的有效权限是三层交集，确保最小权限原则：' : 'Effective Agent permission is the intersection of three layers, ensuring least-privilege:'}
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-5 border-2 border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="text-blue-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? '凭据范围' : 'Credential Scopes'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '全局能力上限' : 'Global capability ceiling'}</div>
                <div className="text-xs text-gray-500 mt-2">{zh ? '创建凭据时设置' : 'Set when creating credential'}</div>
              </div>
              <div className="bg-white rounded-lg p-5 border-2 border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="text-purple-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? '空间授权' : 'Space Grants'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '每个空间的权限' : 'Per-space permissions'}</div>
                <div className="text-xs text-gray-500 mt-2">{zh ? '在 Members 页面配置' : 'Configured in Members page'}</div>
              </div>
              <div className="bg-white rounded-lg p-5 border-2 border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="text-green-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? '角色门禁' : 'Role Gate'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '编辑者/查看者' : 'Editor/Viewer'}</div>
                <div className="text-xs text-gray-500 mt-2">{zh ? '根据 scope 自动推导' : 'Auto-derived from scopes'}</div>
              </div>
            </div>
            <div className="mt-6 text-center text-sm text-gray-600">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200">
                <span>{zh ? '有效权限 = 凭据 ∩ 授权 ∩ 角色' : 'Effective = Credential ∩ Grant  Role'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Available Scopes */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Key className="text-amber-600" size={24} />
            {zh ? '可用权限范围' : 'Available Scopes'}
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              {scopes.map(s => (
                <div key={s.value} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200">
                  <code className="text-xs text-blue-600 font-mono">{s.value}</code>
                  <span className="text-xs text-gray-500">—</span>
                  <span className="text-xs text-gray-700">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Core Features */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <FileText className="text-green-600" size={24} />
            {zh ? '核心功能' : 'Core Features'}
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <FileText size={18} className="text-blue-600" />
                {zh ? 'Markdown 编辑' : 'Markdown Editing'}
              </h3>
              <p className="text-sm text-gray-600">
                {zh ? 'Obsidian 式实时预览，所见即所得。支持 GFM 表格、代码高亮、任务列表。版本历史随时回溯。' : 'Obsidian-style live preview with WYSIWYG editing. Supports GFM tables, code highlighting, task lists. Version history for rollback.'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Network size={18} className="text-purple-600" />
                {zh ? '知识图谱' : 'Knowledge Graph'}
              </h3>
              <p className="text-sm text-gray-600">
                {zh ? '页面之间建立语义关联，可视化探索知识网络。每个关系都有来源、证据和置信度。' : 'Connect pages with semantic relationships. Explore the knowledge network visually with provenance and confidence.'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Search size={18} className="text-green-600" />
                {zh ? '语义搜索' : 'Semantic Search'}
              </h3>
              <p className="text-sm text-gray-600">
                {zh ? '基于向量嵌入的语义搜索，超越关键词匹配。用自然语言提问，找到最相关的页面。' : 'Vector-powered semantic search beyond keywords. Ask in natural language, find the most relevant pages.'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Users size={18} className="text-rose-600" />
                {zh ? '多人协作' : 'Collaboration'}
              </h3>
              <p className="text-sm text-gray-600">
                {zh ? 'WebSocket 实时同步编辑状态，结合版本历史安全恢复冲突。' : 'WebSocket real-time sync with version history for safe conflict recovery.'}
              </p>
            </div>
          </div>
        </section>

        {/* Footer CTA */}
        <section className="text-center py-12 border-t border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            {zh ? '准备好开始了吗？' : 'Ready to Start?'}
          </h2>
          <p className="text-gray-600 mb-8">
            {zh ? '创建你的第一个空间，接入第一个 Agent，开始构建多 Agent 协作的共同大脑。' : 'Create your first space, connect your first Agent, and start building the collective brain for multi-Agent collaboration.'}
          </p>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
          >
            {zh ? '进入工作台' : 'Open Dashboard'}
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
    </div>
  );
};
