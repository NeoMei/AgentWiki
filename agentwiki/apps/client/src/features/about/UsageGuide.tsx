import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, ArrowRight, Shield, Key,
  FileText, Network, Search, Users, CheckCircle2,
  MousePointerClick, UserPlus, Rocket
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { GuideScreenshot } from './GuideScreenshot';
import { LocalSyncGuideSection } from './LocalSyncGuideSection';
import { GatewayGuidePreview } from './GatewayGuidePreview';

export const UsageGuide: React.FC = () => {
  const { language, t } = useLanguage();
  const zh = language === 'zh-CN';

  return (
    <div>
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
              to="/guide/agent-onboard"
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
                    {zh ? '在顶部导航栏点击「智能体」，进入 Agent 列表页面，点击「创建智能体」按钮并填写名称和描述。访问授权会在连接到 Space 时统一选择。' : 'Click "Agents" in the top nav, open the Agent list, and create an Agent with a name and description. Access authorization is selected when connecting it to a Space.'}
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
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '选择 Space 与 Agent 角色' : 'Choose a Space and Agent Role'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '在 Space → Members 中添加 Agent，或在 Agent 的统一网关卡片中连接 Space。两种入口都只选择 Reader、Editor 或 Publisher，一个角色同时定义连接凭据与 Space 授权。' : 'Add the Agent from Space → Members or connect a Space from the Agent unified gateway card. Both entry points choose only Reader, Editor, or Publisher; one role defines both the connection credential and Space grant.'}
                  </p>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
                    <strong>{zh ? '提示：' : 'Tip: '}</strong>
                    {zh ? 'Agent 角色和人类成员的所有者、管理员、编辑者、查看者角色彼此独立。' : 'Agent roles are separate from the Owner, Admin, Editor, and Viewer roles used for human members.'}
                  </div>
                </div>
              </div>
              <GuideScreenshot
                src="/screenshots/step2-space-members.png"
                alt={zh ? 'Space Members 页面' : 'Space Members Page'}
              />
              <div className="mt-3 text-center text-xs text-gray-500 flex items-center justify-center gap-1">
                <UserPlus size={12} />
                {zh ? 'Space Members 页面 — 为 Agent 选择统一访问角色' : 'Space Members Page — Choose one unified access role for the Agent'}
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-600 text-white flex items-center justify-center text-lg font-bold">3</div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '理解三个 Agent 角色' : 'Understand the Three Agent Roles'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? 'Reader 只读；Editor 可提交内容变更并进入审核；Publisher 具备 Editor 能力，并可在治理条件满足时自动发布。Publisher 自动发布仍受 Space 发布策略限制，Agent 不能执行人工审批或成员管理。' : 'Reader is read-only. Editor can propose content changes for review. Publisher includes Editor access and may auto-publish only when governance conditions permit. Publisher remains subject to Space publishing policy, and Agents cannot approve reviews or manage members.'}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {['Reader', 'Editor', 'Publisher'].map((role) => (
                      <div key={role} className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-medium text-gray-800">{role}</div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4 */}
            <div className="bg-white border border-gray-200 rounded-xl p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-600 text-white flex items-center justify-center text-lg font-bold">4</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{zh ? '生成统一网关接入指令' : 'Generate Gateway Instructions'}</h3>
                  <p className="text-gray-600 mb-3">
                    {zh ? '进入「智能体 → 目标 Agent → 访问权限 → AgentWiki 统一网关」，选择 Space 与 Agent 角色，再生成 10 分钟有效的一次性安装指令（onboard --code），点击「复制」完整复制后交给本地 Agent。普通凭据区创建的 API Key 只用于脚本和外部系统。' : 'Go to Agents → target Agent → Access → AgentWiki unified gateway, choose a Space and Agent role, then generate the one-time installation instructions (onboard --code, valid for 10 minutes). Copy the complete prompt and give it to your local Agent. API keys in the credentials section are only for scripts and external systems.'}
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-700">
                    <strong>{zh ? '重要：' : 'Important: '}</strong>
                    {zh ? '不要单独改写指令中的端点、连接名或安装码。安装码是一次性的，授权仍由 AgentWiki 服务端控制。' : 'Do not rewrite the endpoint, connection name, or installation code inside the prompt. The code is single-use; authorization remains controlled by AgentWiki.'}
                  </div>
                  <div className="mt-4">
                    <GatewayGuidePreview />
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
                    {zh ? '示例中的 OpenCode 使用 Publisher；仅当 Space 发布策略同时允许时，页面才会自动发布，否则仍进入人工审核。' : 'The example uses Publisher. The page auto-publishes only when Space publishing policy also permits it; otherwise it still enters human review.'}
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
              {zh ? '产品入口只选择统一角色；运行时仍由三层治理约束取交集：' : 'Product entry points select one unified role; runtime access remains the intersection of three governance layers:'}
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-5 border-2 border-blue-200">
                <div className="flex items-center gap-2 mb-2">
                  <Key className="text-blue-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? '凭据角色' : 'Credential Role'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '全局能力上限' : 'Global capability ceiling'}</div>
                <div className="text-xs text-gray-500 mt-2">Reader · Editor · Publisher</div>
              </div>
              <div className="bg-white rounded-lg p-5 border-2 border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="text-purple-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? 'Space Agent 角色' : 'Space Agent Role'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '每个空间的权限' : 'Per-space permissions'}</div>
                <div className="text-xs text-gray-500 mt-2">Reader · Editor · Publisher</div>
              </div>
              <div className="bg-white rounded-lg p-5 border-2 border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="text-green-600" size={18} />
                  <div className="font-semibold text-gray-900">{zh ? 'Space 发布策略' : 'Space Publishing Policy'}</div>
                </div>
                <div className="text-sm text-gray-600">{zh ? '审核与自动发布治理' : 'Review and auto-publish governance'}</div>
                <div className="text-xs text-gray-500 mt-2">{zh ? 'Agent 无人工审批权' : 'Agents cannot perform human approval'}</div>
              </div>
            </div>
            <div className="mt-6 text-center text-sm text-gray-600">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200">
                <span>{zh ? '有效权限 = 凭据角色 ∩ Space Agent 角色 ∩ Space 策略' : 'Effective = Credential role ∩ Space Agent role ∩ Space policy'}</span>
              </div>
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
  );
};
