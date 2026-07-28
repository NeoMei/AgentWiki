import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen, Network, Search, Bot, FileText, Users,
  ArrowRight, Zap, Brain, Code2, Eye, EyeOff
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

const validatePassword = (pwd: string, t: (key: string) => string): string | null => {
  if (pwd.length < 8) return t('auth.passwordMin');
  if (!/[A-Z]/.test(pwd)) return t('auth.passwordUppercase');
  if (!/[0-9]/.test(pwd)) return t('auth.passwordNumber');
  return null;
};

export const ProductPage: React.FC = () => {
  const { token, login } = useAuth();
  const { language, t } = useLanguage();
  const zh = language === 'zh-CN';
  const navigate = useNavigate();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authMode === 'register') {
      const pwdErr = validatePassword(password, t);
      if (pwdErr) { setPasswordError(pwdErr); return; }
    }
    setIsSubmitting(true);
    setAuthError('');
    try {
      const payload: Record<string, string> = { email, password };
      if (authMode === 'register' && name) payload.name = name;
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const res = await api.post(endpoint, payload);
      login(res.data.access_token, res.data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setAuthError(err.response?.data?.message || (authMode === 'login' ? t('auth.loginFailed') : t('auth.registrationFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

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
          <div className="flex flex-col gap-6 mt-8 lg:flex-row lg:items-start">
            <div className="flex items-center gap-4">
              <Link to="/guide" className="inline-flex items-center gap-2 px-5 py-3 bg-white text-gray-700 rounded-lg border hover:bg-gray-50 transition">
                <BookOpen size={18} /> {zh ? '使用指南' : 'Guide'}
              </Link>
            </div>
            {!token ? (
              <div className="w-full max-w-sm bg-white rounded-xl shadow-lg border p-6">
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${authMode === 'login' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    {t('auth.signIn')}
                  </button>
                  <button
                    onClick={() => { setAuthMode('register'); setAuthError(''); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition ${authMode === 'register' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                  >
                    {t('auth.register')}
                  </button>
                </div>
                {authError && <div className="mb-3 p-2 bg-red-50 text-red-600 rounded-md text-xs text-center">{authError}</div>}
                <form onSubmit={handleAuth} className="space-y-3">
                  {authMode === 'register' && (
                    <input
                      type="text" placeholder={t('common.name')} value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  )}
                  <input
                    type="email" placeholder={t('common.email')} value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'} placeholder={t('common.password')} value={password}
                      onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-3 py-2 pr-10 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {authMode === 'register' && passwordError && <div className="text-red-500 text-xs">{passwordError}</div>}
                  <button type="submit" disabled={isSubmitting}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition text-sm font-medium">
                    {isSubmitting ? '...' : (authMode === 'login' ? t('auth.signIn') : t('auth.register'))}
                  </button>
                </form>
              </div>
            ) : (
              <Link to="/dashboard" className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
                {zh ? '进入工作台' : 'Open workspace'} <ArrowRight size={18} />
              </Link>
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
          <Link to="/dashboard" className="inline-flex items-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
            {zh ? '进入工作台' : 'Open workspace'} <ArrowRight size={18} />
          </Link>
        )}
      </div>
    </div>
  );
};
