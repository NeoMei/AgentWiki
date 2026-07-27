import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen, Network, Search, Bot, FileText, Users,
  ArrowRight, Zap, Brain, Code2
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export const ProductPage: React.FC = () => {
  const { token } = useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';

  const features = [
    {
      icon: FileText,
      title: 'Markdown Wiki',
      desc: zh ? '用 Markdown 编写文档，支持 GFM 表格、代码高亮、任务列表。在同一工作区切换编辑与预览，版本历史随时回溯。' : 'Write Markdown with GFM tables, syntax highlighting and task lists. Switch between editing and preview in one workspace, with complete version history.',
      color: 'text-blue-600 bg-blue-50',
    },
    {
      icon: Network,
      title: zh ? '知识图谱' : 'Knowledge graph',
      desc: zh ? '页面之间建立语义关联，可视化呈现知识网络，并展示关系来源、证据与置信度。' : 'Connect pages semantically, explore a visual knowledge network, and inspect relationship sources, evidence and confidence.',
      color: 'text-purple-600 bg-purple-50',
    },
    {
      icon: Search,
      title: zh ? '语义搜索' : 'Semantic search',
      desc: zh ? '基于向量嵌入的语义搜索，不只是关键词匹配。输入自然语言问题，找到最相关的页面。' : 'Go beyond keywords with vector-powered semantic search and find relevant pages using natural-language questions.',
      color: 'text-green-600 bg-green-50',
    },
    {
      icon: Bot,
      title: zh ? 'Agent 接入' : 'Agent access',
      desc: zh ? 'Agent 使用独立凭证、Scope 与空间授权访问知识库；写入进入可审计、可回滚的审批流程。' : 'Agents use separate credentials, scopes and space grants; writes enter an auditable, reversible review flow.',
      color: 'text-amber-600 bg-amber-50',
    },
    {
      icon: Code2,
      title: zh ? '代码库文档生成' : 'Repository documentation',
      desc: zh ? '从文本、文件、安全 URL 或 Git 仓库摄取资料，保留来源版本、运行阶段与证据。' : 'Ingest text, files, safe URLs or Git repositories while retaining source versions, run stages and evidence.',
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      icon: Users,
      title: zh ? '多人协作' : 'Collaboration',
      desc: zh ? '经过身份验证的 WebSocket 协作会话可同步编辑状态，并结合版本历史安全恢复。' : 'Authenticated WebSocket sessions synchronize editing while version history provides safe recovery.',
      color: 'text-rose-600 bg-rose-50',
    },
  ];

  const steps = [
    { num: '1', title: zh ? '创建知识空间' : 'Create a space', desc: zh ? '按项目、团队或主题组织你的知识库' : 'Organize knowledge by project, team or topic' },
    { num: '2', title: zh ? '编写页面' : 'Write pages', desc: zh ? '用 Markdown 记录知识，建立页面层级' : 'Capture knowledge in Markdown and build a hierarchy' },
    { num: '3', title: zh ? '连接知识' : 'Connect knowledge', desc: zh ? '在知识图谱中建立页面间的语义关系' : 'Build semantic relationships in the graph' },
    { num: '4', title: zh ? '搜索与发现' : 'Search and discover', desc: zh ? '语义搜索快速定位，图谱探索发现关联' : 'Find answers quickly and explore connections' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="absolute right-4 top-4 z-20"><LanguageSwitcher /></div>
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 via-purple-600 to-blue-800 opacity-5" />
        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center">
              <BookOpen size={28} className="text-white" />
            </div>
            <h1 className="text-4xl font-bold text-gray-900">AgentWiki</h1>
          </div>
          <p className="text-xl text-gray-600 leading-relaxed max-w-3xl">
            {zh ? '一个为人类和 AI Agent 共同设计的知识库系统。用 Markdown 写文档，用知识图谱连接信息，用语义搜索快速定位，让 Agent 成为你的知识管理伙伴。' : 'A knowledge system designed for people and AI Agents. Write in Markdown, connect information through a knowledge graph, search semantically, and make Agents part of your knowledge workflow.'}
          </p>
          <div className="flex items-center gap-4 mt-8">
            {token ? (
              <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
                {zh ? '进入工作台' : 'Open workspace'} <ArrowRight size={18} />
              </Link>
            ) : (
              <>
                <Link to="/login" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
                  {zh ? '开始使用' : 'Get started'} <ArrowRight size={18} />
                </Link>
                <Link to="/guide" className="inline-flex items-center gap-2 px-6 py-3 bg-white text-gray-700 rounded-lg border hover:bg-gray-50 transition">
                  <BookOpen size={18} /> {zh ? '使用指南' : 'Guide'}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-6">{zh ? '为什么开发 AgentWiki？' : 'Why AgentWiki?'}</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <div className="p-6 bg-white rounded-xl border">
            <Brain className="text-blue-600 mb-3" size={28} />
            <h3 className="font-semibold mb-2">{zh ? '知识不只是文档' : 'Knowledge is more than documents'}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{zh ? '传统 Wiki 把知识当成孤立的页面。AgentWiki 认为知识是一个网络——页面之间的关联和上下文，比页面本身更有价值。' : 'Traditional wikis treat knowledge as isolated pages. AgentWiki treats it as a network where relationships and context add essential value.'}</p>
          </div>
          <div className="p-6 bg-white rounded-xl border">
            <Bot className="text-purple-600 mb-3" size={28} />
            <h3 className="font-semibold mb-2">{zh ? 'Agent 是一等公民' : 'Agents are first-class identities'}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{zh ? 'Agent 拥有独立身份、最小权限凭证、空间授权、记忆与活动审计；它只能访问被明确授予的资源。' : 'Agents have independent identities, least-privilege credentials, space grants, memory and activity audits, and only access explicitly granted resources.'}</p>
          </div>
          <div className="p-6 bg-white rounded-xl border">
            <Zap className="text-amber-600 mb-3" size={28} />
            <h3 className="font-semibold mb-2">{zh ? '自动化知识生产' : 'Automated knowledge production'}</h3>
            <p className="text-sm text-gray-500 leading-relaxed">{zh ? '来源先进入可恢复的摄取运行，再形成候选页面或关系；人类可审批、拒绝和回滚自动生成内容。' : 'Sources enter recoverable ingestion runs before producing candidate pages or relationships that people can approve, reject or revert.'}</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-8">{zh ? '核心功能' : 'Core features'}</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div key={i} className="p-6 bg-white rounded-xl border hover:shadow-md transition">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${f.color}`}>
                  <Icon size={20} />
                </div>
                <h3 className="font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-8">{zh ? '工作流程' : 'Workflow'}</h2>
        <div className="grid md:grid-cols-4 gap-4">
          {steps.map((s, i) => (
            <div key={i} className="relative">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-sm font-bold">{s.num}</div>
                {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-200 hidden md:block" />}
              </div>
              <h3 className="font-medium mb-1">{s.title}</h3>
              <p className="text-sm text-gray-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-bold mb-6">{zh ? '技术栈' : 'Technology stack'}</h2>
        <div className="flex flex-wrap gap-3">
          {['NestJS', 'React + Vite', 'PostgreSQL', 'Redis', 'Prisma', 'Socket.io', 'Tailwind CSS', 'react-markdown', 'bcryptjs'].map(tech => (
            <span key={tech} className="px-3 py-1.5 bg-white border rounded-lg text-sm text-gray-600">{tech}</span>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-16 text-center">
        <h2 className="text-2xl font-bold mb-4">{zh ? '开始构建你的知识库' : 'Start building your knowledge base'}</h2>
        <p className="text-gray-500 mb-8">{zh ? '几秒钟创建账号，立刻开始' : 'Create an account in seconds and begin immediately'}</p>
        {token ? (
          <Link to="/" className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
            {zh ? '进入工作台' : 'Open workspace'} <ArrowRight size={18} />
          </Link>
        ) : (
          <Link to="/register" className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
            {zh ? '免费注册' : 'Register free'} <ArrowRight size={18} />
          </Link>
        )}
      </div>
    </div>
  );
};
