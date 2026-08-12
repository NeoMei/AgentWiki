import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, ArrowRight, Shield, Key,
  FileText, Network, Search, Users, CheckCircle2,
  MousePointerClick, UserPlus, Rocket,
  Server, GitBranch, Brain, Lock, Zap, Layers, List
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { GuideScreenshot } from './GuideScreenshot';
import { LocalSyncGuideSection } from './LocalSyncGuideSection';

export const UsageGuide: React.FC = () => {
  useAuth();
  const { language, t } = useLanguage();
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
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <Link to="/" aria-label="AgentWiki" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <span className="hidden md:inline text-lg font-bold text-gray-900">AgentWiki</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            <GlobalNavigation density="public" />
            <LanguageSwitcher />
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

          {/* In-page table of contents for deep dives */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-gray-400 flex items-center gap-1"><List size={14} />{zh ? '深入阅读：' : 'Deep dive:'}</span>
            <a href="#architecture" className="text-blue-600 hover:underline">{zh ? '接入架构' : 'Architecture'}</a>
            <span className="text-gray-300">·</span>
            <a href="#sync-workflow" className="text-blue-600 hover:underline">{zh ? '同步工作流' : 'Sync Workflow'}</a>
            <span className="text-gray-300">·</span>
            <a href="#features-deep" className="text-blue-600 hover:underline">{zh ? '功能详解' : 'Features in Depth'}</a>
            <span className="text-gray-300">·</span>
            <a href="#security" className="text-blue-600 hover:underline">{zh ? '安全模型' : 'Security'}</a>
          </div>
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


        {/* Agent Onboard Card */}
        <section className="mb-16">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Rocket size={24} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{zh ? '最快方式：让 Agent 帮你接入' : 'Fastest way: let an Agent set you up'}</h3>
              <p className="text-sm text-gray-600">{t('guide.onboardCard')}</p>
            </div>
            <Link
              to="/onboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
            >
              {zh ? '打开 Agent 自助接入' : 'Open Agent Onboard'}
              <ArrowRight size={16} />
            </Link>
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
              <GuideScreenshot
                src="/screenshots/step1-agent-list.png"
                alt={zh ? 'Agent 列表页面' : 'Agent List Page'}
                focus="top"
              />
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
              <GuideScreenshot
                src="/screenshots/step2-space-members.png"
                alt={zh ? 'Space Members 页面' : 'Space Members Page'}
              />
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
                  <GuideScreenshot
                    src="/screenshots/step3-permission-panel.png"
                    alt={zh ? '权限配置面板' : 'Permission Panel'}
                  />
                </div>
              </div>
            </div>

            {/* Step 4 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center text-lg font-bold">4</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '生成 Key 与接入指令' : 'Generate a Key and Instructions'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '在 Agent 详情页创建凭据。系统会同时生成只显示一次的 Key 和一整段「一键接入指令」，点击「复制接入指令」即可完整复制。' : 'Create a credential on the Agent detail page. AgentWiki generates a one-time key and a complete one-shot connection prompt; click "Copy instructions" to copy it as one unit.'}
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                    <strong>{zh ? '重要：' : 'Important: '}</strong>
                    {zh ? '不要单独改写提示词中的端点、连接名或 Key。授权仍由 AgentWiki 服务端控制。' : 'Do not rewrite the endpoint, connection name, or key inside the prompt. Authorization remains controlled by AgentWiki.'}
                  </div>
                  <div className="mt-4">
                    <GuideScreenshot
                      src="/screenshots/step4-generated-credential.png"
                      alt={zh ? '已生成 Key 和接入指令' : 'Generated key and connection instructions'}
                      fit="contain"
                      heightClassName="h-28 sm:h-32"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 5 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center text-lg font-bold">5</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '把接入指令交给本地 Agent' : 'Give the Instructions to Your Local Agent'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '把整段接入指令作为一条消息交给本地 Agent。AgentWiki 的接入方式不绑定具体产品，Codex、Claude Code、OpenCode 等 Agent 都使用同一套流程：由 Agent 自行配置 MCP、校验身份并调用工具。' : 'Give the complete connection prompt to your local Agent as one message. AgentWiki is not tied to a specific product: Agents such as Codex, Claude Code, and OpenCode use the same flow to configure MCP, verify their identity, and call the tools themselves.'}
                  </p>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700 mb-4">
                    <strong>{zh ? '以下以 OpenCode 为例：' : 'OpenCode example: '}</strong>
                    {zh ? 'OpenCode 在「OpenCode 接入演示」空间创建并自动发布了页面「OpenCode 已接入 AgentWiki」。' : 'OpenCode created and auto-published "OpenCode Connected to AgentWiki" in the "OpenCode Connection Demo" Space.'}
                  </div>
                  <GuideScreenshot
                    src="/screenshots/step5-opencode-publish.png"
                    alt={zh ? 'OpenCode 发布页面过程' : 'OpenCode page publishing flow'}
                    focus="top"
                  />
                </div>
              </div>
            </div>

            {/* Step 6 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center text-lg font-bold">6</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '确认 Agent 接入与页面发布结果' : 'Confirm Agent Connection and Page Publishing'}</h3>
                  <p className="text-gray-600 mb-5">
                    {zh ? '无论使用哪种本地 Agent，接入成功都应同时看到三项结果：Agent 明确报告成功、AgentWiki 中出现正式页面、活动记录中出现对应的 MCP 工具调用。以下截图继续展示 OpenCode 的真实验证结果。' : 'Regardless of which local Agent you use, a successful connection has three signals: the Agent reports success, the published page appears in AgentWiki, and the activity log records the corresponding MCP tool calls. The screenshots below show the verified OpenCode example.'}
                  </p>
                  <div className="space-y-6">
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">{zh ? '1. OpenCode 返回接入和发布结果' : '1. OpenCode reports connection and publishing success'}</p>
                      <GuideScreenshot
                        src="/screenshots/step6-opencode-success.png"
                        alt={zh ? 'OpenCode 接入成功结果' : 'OpenCode connection success'}
                        focus="top"
                        heightClassName="h-52 sm:h-64"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">{zh ? '2. AgentWiki 显示已发布页面及 Agent 来源' : '2. AgentWiki shows the published page and Agent provenance'}</p>
                      <GuideScreenshot
                        src="/screenshots/step6-published-page.png"
                        alt={zh ? 'AgentWiki 已发布页面' : 'Published AgentWiki page'}
                        focus="top"
                        heightClassName="h-52 sm:h-64"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">{zh ? '3. 活动记录保留完整 MCP 调用证据' : '3. The activity log preserves the MCP call evidence'}</p>
                      <GuideScreenshot
                        src="/screenshots/step6-activity-log.png"
                        alt={zh ? 'AgentWiki MCP 活动记录' : 'AgentWiki MCP activity log'}
                        focus="top"
                        heightClassName="h-52 sm:h-64"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <LocalSyncGuideSection zh={zh} />

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
                <span>{zh ? '有效权限 = 凭据 ∩ 授权  角色' : 'Effective = Credential ∩ Grant ∩ Role'}</span>
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

        {/* ===== Deep dive: Agent integration architecture ===== */}
        <section id="architecture" className="mb-16 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Server className="text-purple-600" size={24} />
            {zh ? 'Agent 接入架构' : 'Agent Integration Architecture'}
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-8 space-y-5">
            <p className="text-gray-600 leading-relaxed">
              {zh
                ? 'Agent 通过单一本地 MCP 网关（名为 agentwiki）接入。网关自动区分三类工具，Agent 无需选择 MCP server，由网关统一路由。这种设计让同一个 Agent 既能操作远程知识库，又能扫描本地代码，还能执行组合工作流。'
                : 'Agents connect through a single local MCP gateway named agentwiki. The gateway automatically routes three tool categories, so the Agent never chooses an MCP server. This lets one Agent work with the remote knowledge base, scan local code, and run composite workflows.'}
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-5">
                <code className="text-sm font-mono text-blue-700 font-semibold">wiki_*</code>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                  {zh ? '远程 AgentWiki 工具：页面、图谱、审核、记忆。调用服务端 API，受权限和审核策略约束。' : 'Remote AgentWiki tools: pages, graph, review, memory. Calls the server API under permission and review policy.'}
                </p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-5">
                <code className="text-sm font-mono text-green-700 font-semibold">local_*</code>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                  {zh ? '本地工具：扫描源代码、读取工件。全部在本地执行，不上传原始代码或凭据。' : 'Local tools: scan sources, read artifacts. Fully local; never uploads raw code or credentials.'}
                </p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-5">
                <code className="text-sm font-mono text-purple-700 font-semibold">knowledge_*</code>
                <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                  {zh ? '组合工作流：扫描→预览→同步→拉取。先本地整理，预览确认后才上传，冲突必须人工解决。' : 'Composite workflows: scan→preview→sync→pull. Organizes locally, uploads only after confirmation, conflicts need human resolution.'}
                </p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
              <Lock size={14} className="inline mr-1 align-text-bottom" />
              {zh
                ? '安全设计：服务端从不读取本地路径；本地敏感内容（含凭据特征）在预览阶段就被排除；密码和登录信息不进入 Agent 对话。'
                : 'Security: the server never reads local paths; sensitive local content (including credential-like patterns) is excluded at preview; passwords never enter the Agent conversation.'}
            </div>
          </div>
        </section>

        {/* ===== Deep dive: Knowledge sync workflow ===== */}
        <section id="sync-workflow" className="mb-16 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <GitBranch className="text-amber-600" size={24} />
            {zh ? '知识同步工作流' : 'Knowledge Sync Workflow'}
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-8 space-y-5">
            <p className="text-gray-600 leading-relaxed">
              {zh ? '把本地代码库或文档同步到 AgentWiki 的确定性流程，每一步都可预览、可回退、可审计：' : 'The deterministic flow to sync a local codebase or documents into AgentWiki. Every step is previewable, reversible, and auditable:'}
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3 border-l-2 border-amber-300 pl-4">
                <Zap className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{zh ? '1. 扫描（prepare）' : '1. Scan (prepare)'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? '本地扫描源、采集工件、组织成知识束、生成预览。全程零网络调用，不上传任何内容。' : 'Scan sources locally, collect artifacts, organize into a knowledge bundle, and generate a preview. Zero network calls; nothing is uploaded.'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 border-l-2 border-amber-300 pl-4">
                <Zap className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{zh ? '2. 预览确认（confirm）' : '2. Preview confirmation (confirm)'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? '展示 added / modified / deleted / uploadBytes 统计与变更清单，用户明确确认后才上传。预览哈希绑定，确认前任何变化都会被发现。' : 'Shows added / modified / deleted / uploadBytes stats and a change list; uploads only after explicit confirmation. The preview hash is bound, so any change before confirmation is detected.'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 border-l-2 border-amber-300 pl-4">
                <Zap className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{zh ? '3. 同步（sync）' : '3. Sync (sync)'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? 'Push 前先 Pull，检测三方冲突；冲突时拒绝并要求人工解决，绝不静默覆盖。成功后生成带来源的证据链。' : 'Pull before push to detect three-way conflicts; conflicts are rejected for human resolution, never silently overwritten. Success produces an evidence chain with provenance.'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 border-l-2 border-amber-300 pl-4">
                <Zap className="text-amber-600 shrink-0 mt-0.5" size={18} />
                <div>
                  <div className="font-semibold text-gray-900 text-sm">{zh ? '4. 拉取（pull）' : '4. Pull (pull)'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? '从服务端权威版本刷新本地工作区，保持本地与生产知识库一致，支持多 Agent 协作下的增量更新。' : 'Refresh the local workspace from the authoritative server revision to stay in sync, supporting incremental updates across multiple Agents.'}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Deep dive: Features in depth ===== */}
        <section id="features-deep" className="mb-16 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Layers className="text-blue-600" size={24} />
            {zh ? '功能详解' : 'Features in Depth'}
          </h2>
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Layers className="text-blue-600" size={18} />{zh ? '知识空间（Space）' : 'Knowledge Spaces'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? '按项目、团队或主题隔离知识。每个 Space 有独立的成员、权限策略和审核流；Space 之间数据隔离，Agent 必须被显式授权才能访问。' : 'Isolate knowledge by project, team, or topic. Each Space has independent members, permission policies, and review flows; Spaces are data-isolated and Agents need explicit grants.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><FileText className="text-indigo-600" size={18} />{zh ? '页面与文档' : 'Pages & Documents'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? 'Markdown 编写，实时预览，所见即所得。支持层级目录、版本历史、双向链接和多人协作编辑。每次编辑都生成可追溯的版本快照，可随时回溯和对比。' : 'Markdown with live WYSIWYG preview, hierarchical pages, version history, bidirectional links, and real-time collaborative editing. Every edit creates a traceable version snapshot that can be reviewed and restored.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Network className="text-purple-600" size={18} />{zh ? '知识图谱' : 'Knowledge Graph'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? '在页面之间建立带类型、来源、证据和置信度的语义关系。图谱可视化展示知识网络，支持按关系类型过滤和探索。每条边都可审计，追溯到具体页面和提交。' : 'Create typed semantic relationships between pages, each with provenance, evidence, and confidence. Visualize the network, filter by relationship type; every edge is auditable and traceable to a page and commit.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Search className="text-green-600" size={18} />{zh ? '语义搜索' : 'Semantic Search'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? '基于向量嵌入的语义搜索，超越关键词匹配。用自然语言提问即可找到最相关的页面；搜索范围始终受当前用户权限约束，不会越权返回结果。' : 'Vector-embedding semantic search beyond keywords. Ask in natural language to find relevant pages; search scope is always constrained by the user permissions and never leaks unauthorized results.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><GitBranch className="text-amber-600" size={18} />{zh ? '代码库知识摄取' : 'Codebase Ingestion'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? '从 Git 仓库或本地目录自动摄取代码与文档，生成结构化知识。保留完整的来源版本、文件路径和证据链，可追溯到具体提交，便于核对 Agent 写入的内容来源。' : 'Auto-ingest code and docs from Git repos or local directories into structured knowledge with full provenance, file paths, and evidence chains traceable to specific commits, so Agent writes can be verified.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><CheckCircle2 className="text-emerald-600" size={18} />{zh ? '审核与变更集' : 'Review & ChangeSets'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 的写入进入可审计的变更集（ChangeSet），由人工审批后才发布。支持创建、更新、删除页面和图谱关系；审批人可逐项接受或拒绝，所有决策进入审计日志。' : 'Agent writes enter auditable ChangeSets requiring human approval before publishing. Supports page and graph create/update/delete; approvers can accept or reject item by item, and all decisions go to the audit log.'}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2"><Brain className="text-rose-600" size={18} />{zh ? '记忆' : 'Memory'}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{zh ? '按 Space 隔离的结构化记忆层，让 Agent 跨会话保留上下文。记忆写入同样受审核策略约束，不会绕过权限边界，避免 Agent 把不该存的信息写入共享记忆。' : 'A per-Space structured memory layer letting Agents retain context across sessions. Memory writes follow the same review policy and never bypass permission boundaries.'}</p>
            </div>
          </div>
        </section>

        {/* ===== Deep dive: Security model ===== */}
        <section id="security" className="mb-16 scroll-mt-20">
          <h2 className="text-2xl font-bold text-gray-900 mb-8 flex items-center gap-2">
            <Shield className="text-blue-600" size={24} />
            {zh ? '安全模型详解' : 'Security Model in Depth'}
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-8 space-y-5">
            <p className="text-gray-600 leading-relaxed">
              {zh ? 'Agent 的有效权限是三层交集，确保最小权限原则。任何一层的收紧都会立即生效：' : 'Effective Agent permission is the intersection of three layers, enforcing least-privilege. Tightening any layer takes effect immediately:'}
            </p>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Key className="text-blue-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <div className="font-semibold text-gray-900">{zh ? '凭据范围（Credential Scope）' : 'Credential Scope'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 凭据的全局能力上限。可在 Space 内进一步收窄，但不能超出。凭据可随时吊销，吊销后所有 Space 的访问立即失效。' : 'The global capability ceiling of an Agent credential. Can be narrowed per Space but never exceeded. Credentials can be revoked at any time, immediately disabling access across all Spaces.'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Shield className="text-purple-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <div className="font-semibold text-gray-900">{zh ? '空间授权（Space Grant）' : 'Space Grant'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? 'Agent 在某个 Space 内被授予的具体权限范围。未被授权的 Space 对 Agent 完全不可见，不会出现在搜索和列表中。' : 'The specific scopes granted to an Agent within a Space. Unauthorized Spaces are completely invisible to the Agent and never appear in search or listings.'}</div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Users className="text-green-600 shrink-0 mt-0.5" size={20} />
                <div>
                  <div className="font-semibold text-gray-900">{zh ? '审核策略（Approval Policy）' : 'Approval Policy'}</div>
                  <div className="text-sm text-gray-600 leading-relaxed">{zh ? 'Space 级别的写入策略：always-review（默认，所有 Agent 写入需人工审批）或 scoped-auto-publish（符合策略时自动发布）。可随时切换。' : 'Space-level write policy: always-review (default, all Agent writes need human approval) or scoped-auto-publish (auto-publish when policy allows). Switchable at any time.'}</div>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
              <Lock size={14} className="inline mr-1 align-text-bottom" />
              {zh ? '结果：Agent 只能在被授权的 Space 内、执行被授权的操作；任何写入都在审计日志中可追溯。即使 Agent 凭据泄露，攻击面也仅限于已授权的最小范围。' : 'Result: Agents can only perform authorized operations in authorized Spaces; every write is traceable in the audit log. Even if a credential leaks, the attack surface is limited to the authorized minimum.'}
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
