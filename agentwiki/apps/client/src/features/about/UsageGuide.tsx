import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Bot, CheckCircle2, FileText, Network, Search, Shield, Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { GlobalNavigation } from '../../components/GlobalNavigation';


export const UsageGuide: React.FC = () => {
  useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const connectionSteps = [
    {
      title: zh ? '创建 Agent 并授予空间访问权限' : 'Create an Agent and grant Space access',
      body: zh
        ? '创建用于同步的 Agent，并为它授予需要同步到的一个或多个知识空间。访问权限决定它最终可以写入或提交到哪里。'
        : 'Create the Agent that will sync knowledge, then grant it one or more Spaces. Its access determines where it can write or submit changes.',
      tone: 'bg-blue-600',
    },
    {
      title: zh ? '生成本地同步接入指令' : 'Generate local sync instructions',
      body: zh
        ? '在 Agent 详情页生成并复制完整接入指令。指令包含 10 分钟有效的一次性安装码，不会向提示词暴露永久 Key。'
        : 'Generate and copy the complete instruction on the Agent detail page. It contains a single-use installation code valid for 10 minutes, never a permanent key in the prompt.',
      tone: 'bg-purple-600',
    },
    {
      title: zh ? '本地 Agent 自动安装并自检' : 'Let your local Agent install and run doctor',
      body: zh
        ? '将整段指令粘贴给任意具备本地工具能力的 Agent，它会完成连接与 doctor 自检。Codex、Claude Code、OpenCode 等都可使用同一流程；OpenCode 只是下面截图中的演示示例。'
        : 'Paste the complete instruction to any local Agent with tool access. It connects and runs doctor itself. Codex, Claude Code, OpenCode, and others follow the same flow; OpenCode is only the example shown in the screenshots.',
      tone: 'bg-green-600',
    },
    {
      title: zh ? '扫描、预览并确认同步' : 'Scan, preview, and confirm sync',
      body: zh
        ? '请 Agent 扫描代码或文档目录。它会说明使用的提供方，展示本地变更预览，并明确询问"是否同步到 AgentWiki？"。确认后，结果会进入发布或审核流程。'
        : 'Ask the Agent to scan a code or document directory. It discloses the provider, shows a local change preview, and explicitly asks "Sync to AgentWiki?". Once confirmed, the result enters publishing or review.',
      tone: 'bg-amber-600',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="sticky top-0 z-50 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4">
          <Link to="/" aria-label="AgentWiki" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Bot size={18} className="text-white" />
            </div>
            <span className="hidden text-lg font-bold text-gray-900 md:inline">AgentWiki</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            <GlobalNavigation density="public" />
            <LanguageSwitcher />
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="mb-16 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
            <Bot size={12} />
            <span>{zh ? '快速上手' : 'Quick Start'}</span>
          </div>
          <h1 className="mb-4 text-3xl font-bold text-gray-900 lg:text-4xl">
            {zh ? '如何使用 AgentWiki' : 'How to Use AgentWiki'}
          </h1>
          <p className="mx-auto max-w-2xl text-gray-600">
            {zh
              ? '将本地代码和文档交给你信任的 Agent，在确认后同步为可审核的团队知识。'
              : 'Let an Agent you trust turn local code and documents into team knowledge, with confirmation before anything syncs.'}
          </p>
        </section>

        <section className="mb-16">
          <h2 className="mb-8 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <CheckCircle2 className="text-blue-600" size={24} />
            {zh ? '快速开始' : 'Quick Start'}
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              [zh ? '创建空间' : 'Create a Space', zh ? '按项目或团队组织需要沉淀的知识。' : 'Organize the knowledge you want to preserve by project or team.'],
              [zh ? '创建 Agent' : 'Create an Agent', zh ? '为本地同步创建一个清晰、可控的身份。' : 'Give local sync a clear, controllable identity.'],
              [zh ? '复制接入指令' : 'Copy the instructions', zh ? '把 AgentWiki 生成的完整指令交给本地 Agent。' : 'Give the complete AgentWiki-generated instruction to your local Agent.'],
            ].map(([title, body], index) => (
              <div key={title} className="rounded-xl border border-gray-200 bg-white p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 font-bold">{index + 1}</div>
                <h3 className="mb-2 font-semibold text-gray-900">{title}</h3>
                <p className="text-sm text-gray-600">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-16">
          <h2 className="mb-8 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Bot className="text-purple-600" size={24} />
            {zh ? '用本地 Agent 同步知识' : 'Sync knowledge with a local Agent'}
          </h2>
          <div className="space-y-8">
            {connectionSteps.map((step, index) => (
              <article key={step.title} className="rounded-xl border border-gray-200 bg-white p-8">
                <div className="mb-6 flex items-start gap-4">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${step.tone}`}>{index + 1}</div>
                  <div>
                    <h3 className="mb-2 text-xl font-semibold text-gray-900">{step.title}</h3>
               <p className="text-gray-600">{step.body}</p>
              </div>
            </div>
          </article>
            ))}
          </div>
        </section>

        <section className="mb-16 rounded-xl border border-blue-200 bg-blue-50 p-8">
          <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Shield className="text-blue-600" size={24} />
            {zh ? '权限保持在 AgentWiki 中' : 'Access stays in AgentWiki'}
          </h2>
          <p className="text-gray-700">
            {zh ? '本地 Agent 只能在你授予的空间和权限内工作。需要调整访问范围时，请前往 ' : 'Your local Agent can act only within the Spaces and permissions you grant. To change access, go to '}
            <Link to="/agents" className="font-medium text-blue-700 underline underline-offset-2">
              {zh ? 'Agent 访问设置' : 'Agent access settings'}
            </Link>
            {zh ? '。' : '.'}
          </p>
        </section>

        <section className="mb-16">
          <h2 className="mb-8 flex items-center gap-2 text-2xl font-bold text-gray-900">
            <FileText className="text-green-600" size={24} />
            {zh ? '核心功能' : 'Core Features'}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <FileText size={18} className="text-blue-600" />
                {zh ? 'Markdown 编辑' : 'Markdown Editing'}
              </h3>
              <p className="text-sm text-gray-600">{zh ? '在统一工作区中编写、预览和回溯知识页面。' : 'Write, preview, and revisit knowledge pages in one workspace.'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <Network size={18} className="text-purple-600" />
                {zh ? '知识图谱' : 'Knowledge Graph'}
              </h3>
              <p className="text-sm text-gray-600">{zh ? '用来源和证据探索页面之间的关联。' : 'Explore page relationships with provenance and evidence.'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <Search size={18} className="text-green-600" />
                {zh ? '语义搜索' : 'Semantic Search'}
              </h3>
              <p className="text-sm text-gray-600">{zh ? '用自然语言找到相关的团队知识。' : 'Find relevant team knowledge in natural language.'}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <Users size={18} className="text-rose-600" />
                {zh ? '多人协作' : 'Collaboration'}
              </h3>
              <p className="text-sm text-gray-600">{zh ? '让团队在可追溯的页面和审核流程中协作。' : 'Collaborate through traceable pages and review flows.'}</p>
            </div>
          </div>
        </section>

        <section className="border-t border-gray-200 py-12 text-center">
          <h2 className="mb-4 text-2xl font-bold text-gray-900">{zh ? '准备好开始了吗？' : 'Ready to Start?'}</h2>
          <p className="mb-8 text-gray-600">
            {zh ? '创建你的第一个空间和 Agent，开始把本地知识安全地带入团队。' : 'Create your first Space and Agent, then bring local knowledge into your team safely.'}
          </p>
          <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-medium text-white transition hover:bg-blue-700">
            {zh ? '进入工作台' : 'Open Dashboard'}
            <ArrowRight size={16} />
          </Link>
        </section>
      </main>
    </div>
  );
};
