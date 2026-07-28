import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, ArrowRight, Shield, Key, GitBranch,
  FileText, Network, Search, Users, CheckCircle2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

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

          <div className="bg-white border border-gray-200 rounded-xl p-8 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{zh ? '四步接入流程' : 'Four-Step Connection Process'}</h3>

            <div className="space-y-6">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">1</div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-2">{zh ? '创建 Agent' : 'Create the Agent'}</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {zh ? '在顶部导航栏点击 Agents，创建新 Agent。每个 Agent 拥有独立身份。' : 'Click Agents in the top nav to create a new Agent. Each Agent has an independent identity.'}
                  </p>
                 <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-xs text-gray-700">
                   <div className="text-gray-500 mb-1"># API 方式</div>
                   <div>curl -X POST $BASE/agents \</div>
                   <div className="pl-4">-H "Authorization: Bearer $TOKEN" \</div>
                    <div className="pl-4">{"-d '{\"name\":\"My Agent\"}'"}</div>
                 </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">2</div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-2">{zh ? '授予空间权限' : 'Grant Space Access'}</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {zh ? '在 Space → Members 页面，找到 Agent 并点击盾牌图标，选择预设角色（查看者/编辑者/审核者/完全授权）。' : 'In Space → Members, find the Agent and click the shield icon to select a preset role (Viewer/Editor/Reviewer/Full).'}
                  </p>
                 <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-xs text-gray-700">
                   <div className="text-gray-500 mb-1"># API 方式</div>
                   <div>curl -X PUT $BASE/agents/AGENT_ID/grants/SPACE_ID \</div>
                   <div className="pl-4">-H "Authorization: Bearer $TOKEN" \</div>
                    <div className="pl-4">{"-d '{\"role\":\"editor\",\"scopes\":[\"pages:read\",\"pages:write\"]}'"}</div>
                 </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-bold">3</div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-2">{zh ? '创建凭证' : 'Create Credential'}</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {zh ? '在 Agent 详情页创建凭证（agk_...），只勾选需要的权限范围。明文只显示一次，请立即保存。' : 'Create a credential (agk_...) on the Agent detail page. Check only needed scopes. The secret appears once — save it immediately.'}
                  </p>
                 <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-xs text-gray-700">
                   <div className="text-gray-500 mb-1"># API 方式</div>
                   <div>curl -X POST $BASE/agents/AGENT_ID/credentials \</div>
                   <div className="pl-4">-H "Authorization: Bearer $TOKEN" \</div>
                    <div className="pl-4">{"-d '{\"name\":\"default\",\"scopes\":[\"pages:read\",\"pages:write\"]}'"}</div>
                 </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center text-sm font-bold">4</div>
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 mb-2">{zh ? '开始使用' : 'Start Using'}</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    {zh ? '用凭证调用 API。读操作直接返回；写操作进入审批流程，人类审核后才发布。' : 'Call the API with the credential. Reads return directly; writes enter review flow and publish after human approval.'}
                  </p>
                 <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-xs text-gray-700">
                   <div className="text-gray-500 mb-1"># 读取页面</div>
                   <div>curl "$BASE/pages/PAGE_ID" \</div>
                   <div className="pl-4">-H "Authorization: Bearer agk_..."</div>
                   <div className="text-gray-500 mb-1 mt-3"># 写入页面（需审批）</div>
                   <div>curl -X PATCH "$BASE/pages/PAGE_ID" \</div>
                   <div className="pl-4">-H "Authorization: Bearer agk_..." \</div>
                    <div className="pl-4">{"-d '{\"content\":\"# New content\"}'"}</div>
                 </div>
                </div>
              </div>
            </div>
          </div>

          {/* Permission Model */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
            <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Shield className="text-blue-600" size={18} />
              {zh ? '权限模型' : 'Permission Model'}
            </h4>
            <p className="text-sm text-gray-700 mb-3">
              {zh ? 'Agent 的有效权限是三层交集：' : 'Effective Agent permission is the intersection of three layers:'}
            </p>
            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <div className="bg-white rounded-lg p-3 border border-blue-100">
                <div className="font-medium text-gray-900 mb-1">{zh ? '凭据范围' : 'Credential Scopes'}</div>
                <div className="text-gray-600 text-xs">{zh ? '全局能力上限' : 'Global capability ceiling'}</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-blue-100">
                <div className="font-medium text-gray-900 mb-1">{zh ? '空间授权' : 'Space Grants'}</div>
                <div className="text-gray-600 text-xs">{zh ? '每个空间的权限' : 'Per-space permissions'}</div>
              </div>
              <div className="bg-white rounded-lg p-3 border border-blue-100">
                <div className="font-medium text-gray-900 mb-1">{zh ? '角色门禁' : 'Role Gate'}</div>
                <div className="text-gray-600 text-xs">{zh ? '编辑者/查看者' : 'Editor/Viewer'}</div>
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

        {/* MCP Integration */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <GitBranch className="text-cyan-600" size={24} />
            {zh ? 'MCP 集成' : 'MCP Integration'}
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <p className="text-sm text-gray-600 mb-4">
              {zh ? 'AgentWiki 提供 MCP (Model Context Protocol) 服务器，让 Agent 通过标准协议访问知识库。' : 'AgentWiki provides an MCP (Model Context Protocol) server for Agents to access the knowledge base via standard protocol.'}
            </p>
           <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 font-mono text-xs text-gray-700">
             <div className="text-gray-500 mb-2"># MCP 配置示例</div>
             <div>{`{`}</div>
             <div className="pl-4">"mcpServers": {"{"}</div>
             <div className="pl-8">"agentwiki": {"{"}</div>
             <div className="pl-12">"url": "https://wiki.example.com/api/mcp",</div>
             <div className="pl-12">"headers": {"{"} "Authorization": "Bearer agk_..." {"}"}</div>
             <div className="pl-8">{"}"}</div>
             <div className="pl-4">{"}"}</div>
             <div>{`}`}</div>
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
