import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen, Network, Search, Bot, FileText, Users,
  ArrowRight, Zap, Brain, Code2, Eye, EyeOff,
  Sparkles, Shield, GitBranch, Layers
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
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

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
      title: zh ? 'Markdown Wiki' : 'Markdown Wiki',
      desc: zh ? 'Obsidian 式实时预览，所见即所得。版本历史、多人协作、层级目录，一个都不能少。' : 'Obsidian-style live preview with WYSIWYG editing. Version history, real-time collaboration, hierarchical pages.',
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      icon: Network,
      title: zh ? '知识图谱' : 'Knowledge Graph',
      desc: zh ? '页面之间建立语义关联，可视化探索知识网络。每个关系都有来源、证据和置信度。' : 'Connect pages with semantic relationships. Explore the knowledge network visually with provenance and confidence.',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      icon: Search,
      title: zh ? '语义搜索' : 'Semantic Search',
      desc: zh ? '基于向量嵌入的语义搜索，超越关键词匹配。用自然语言提问，找到最相关的页面。' : 'Vector-powered semantic search beyond keywords. Ask in natural language, find the most relevant pages.',
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      icon: Bot,
      title: zh ? 'Agent 接入' : 'Agent Integration',
      desc: zh ? 'Agent 拥有独立身份和最小权限凭证。写入进入可审计的审批流程，权限精确到每个空间。' : 'Agents have independent identities with least-privilege credentials. Writes enter auditable review flows.',
      gradient: 'from-amber-500 to-orange-500',
    },
    {
      icon: Code2,
      title: zh ? '代码库文档' : 'Codebase Docs',
      desc: zh ? '从 Git 仓库自动摄取代码，生成结构化文档。保留完整的来源版本和证据链。' : 'Auto-ingest from Git repos into structured docs. Full provenance with source versions and evidence chains.',
      gradient: 'from-cyan-500 to-blue-500',
    },
    {
      icon: Users,
      title: zh ? '多人协作' : 'Collaboration',
      desc: zh ? 'WebSocket 实时同步编辑状态，结合版本历史安全恢复冲突。' : 'WebSocket real-time sync with version history for safe conflict recovery.',
      gradient: 'from-rose-500 to-pink-500',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
      </div>

      {/* Navbar */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrollY > 50 ? 'bg-slate-950/80 backdrop-blur-xl border-b border-white/5' : ''}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <BookOpen size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold">AgentWiki</span>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {token ? (
              <Link to="/dashboard" className="px-4 py-2 bg-white text-slate-900 rounded-lg text-sm font-medium hover:bg-gray-100 transition">
                {zh ? '进入工作台' : 'Dashboard'}
              </Link>
            ) : (
              <Link to="/guide" className="px-4 py-2 text-sm text-gray-300 hover:text-white transition">
                {zh ? '使用指南' : 'Guide'}
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-gray-400 mb-6">
                <Sparkles size={12} />
                <span>{zh ? '为人类和 AI Agent 共同设计' : 'Designed for humans and AI Agents'}</span>
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-6">
                <span className="bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent">
                  {zh ? '知识库的' : 'The '}
                </span>
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  {zh ? '下一代形态' : 'Next Generation'}
                </span>
              </h1>
              <p className="text-lg text-gray-400 leading-relaxed mb-8 max-w-xl">
                {zh
                  ? '用 Markdown 写文档，用知识图谱连接信息，用语义搜索快速定位。让 Agent 成为你的知识管理伙伴，而不是简单的工具。'
                  : 'Write in Markdown, connect through knowledge graphs, search semantically. Make Agents your knowledge partners, not just tools.'}
              </p>
              {!token && (
                <div className="flex items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-green-400" />
                    <span>{zh ? '安全权限' : 'Secure permissions'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <GitBranch size={14} className="text-blue-400" />
                    <span>{zh ? '版本控制' : 'Version control'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Layers size={14} className="text-purple-400" />
                    <span>{zh ? '知识图谱' : 'Knowledge graph'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Auth Card */}
            {!token ? (
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-xl opacity-20" />
                <div className="relative bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
                  {/* Tab Switcher */}
                  <div className="flex gap-1 p-1 bg-slate-800 rounded-lg mb-6">
                    <button
                      onClick={() => { setAuthMode('login'); setAuthError(''); }}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition ${authMode === 'login' ? 'bg-white text-slate-900 shadow' : 'text-gray-400 hover:text-white'}`}
                    >
                      {t('auth.signIn')}
                    </button>
                    <button
                      onClick={() => { setAuthMode('register'); setAuthError(''); }}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition ${authMode === 'register' ? 'bg-white text-slate-900 shadow' : 'text-gray-400 hover:text-white'}`}
                    >
                      {t('auth.register')}
                    </button>
                  </div>

                  {authError && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 text-center">
                      {authError}
                    </div>
                  )}

                  <form onSubmit={handleAuth} className="space-y-4">
                    {authMode === 'register' && (
                      <div>
                        <input
                          type="text"
                          placeholder={t('common.name')}
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <input
                        type="email"
                        placeholder={t('common.email')}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition"
                        required
                      />
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t('common.password')}
                        value={password}
                        onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                        className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition pr-10"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300 transition"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {authMode === 'register' && passwordError && (
                      <div className="text-red-400 text-xs">{passwordError}</div>
                    )}
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition shadow-lg shadow-blue-600/25"
                    >
                      {isSubmitting ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          {zh ? '处理中...' : 'Processing...'}
                        </span>
                      ) : (
                        <>
                          {authMode === 'login' ? t('auth.signIn') : t('auth.register')}
                          <ArrowRight size={16} className="inline ml-2" />
                        </>
                      )}
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl blur-xl opacity-20" />
                <div className="relative bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl text-center">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4">
                    <Sparkles size={28} className="text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{zh ? '欢迎回来' : 'Welcome back'}</h3>
                  <p className="text-gray-400 text-sm mb-6">{zh ? '继续你的知识管理之旅' : 'Continue your knowledge journey'}</p>
                  <Link
                    to="/dashboard"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition shadow-lg shadow-blue-600/25"
                  >
                    {zh ? '进入工作台' : 'Open Dashboard'}
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              {zh ? '为什么选择 AgentWiki？' : 'Why AgentWiki?'}
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {zh
                ? '不仅仅是文档管理，而是知识的连接、发现和自动化生产'
                : 'More than document management — knowledge connection, discovery, and automated production'}
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div
                  key={i}
                  className="group relative bg-slate-900/50 backdrop-blur border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-all duration-300 hover:-translate-y-1"
                >
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.gradient} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                    <Icon size={22} className="text-white" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Philosophy Section */}
      <section className="relative py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1">
              <h2 className="text-3xl font-bold mb-4">
                {zh ? '设计理念' : 'Design Philosophy'}
              </h2>
              <p className="text-gray-400">
                {zh
                  ? '我们相信知识不是孤立的文档，而是相互关联的网络。Agent 不是工具，而是知识管理的合作伙伴。'
                  : 'We believe knowledge is not isolated documents, but an interconnected network. Agents are not tools, but knowledge management partners.'}
              </p>
            </div>
            <div className="lg:col-span-2 grid sm:grid-cols-2 gap-6">
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6">
                <Brain className="text-blue-400 mb-3" size={24} />
                <h3 className="font-semibold mb-2">{zh ? '知识即网络' : 'Knowledge as Network'}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {zh ? '页面之间的关联和上下文，比页面本身更有价值。知识图谱让隐性关系显性化。' : 'Relationships and context between pages are more valuable than the pages themselves. Knowledge graphs make implicit connections explicit.'}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6">
                <Bot className="text-purple-400 mb-3" size={24} />
                <h3 className="font-semibold mb-2">{zh ? 'Agent 是一等公民' : 'Agents as First-Class Citizens'}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {zh ? '独立身份、最小权限、空间授权、记忆与审计。Agent 只能访问被明确授予的资源。' : 'Independent identity, least-privilege, space grants, memory and audit. Agents only access explicitly granted resources.'}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6">
                <Zap className="text-amber-400 mb-3" size={24} />
                <h3 className="font-semibold mb-2">{zh ? '自动化知识生产' : 'Automated Knowledge Production'}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {zh ? '来源进入可恢复的摄取流程，人类可审批、拒绝和回滚。自动化与人工审核的完美结合。' : 'Sources enter recoverable ingestion flows. Humans can approve, reject, or revert. Perfect balance of automation and human review.'}
                </p>
              </div>
              <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-6">
                <Shield className="text-green-400 mb-3" size={24} />
                <h3 className="font-semibold mb-2">{zh ? '安全优先' : 'Security First'}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {zh ? '三层权限模型：凭据范围 ∩ 空间授权 ∩ 角色门禁。精确控制每个 Agent 的访问边界。' : 'Three-layer permission model: credential scopes ∩ space grants ∩ role gates. Precise control over every Agent\'s access boundary.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="relative py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-8">{zh ? '技术栈' : 'Technology Stack'}</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {['NestJS', 'React + Vite', 'PostgreSQL', 'Redis', 'Prisma', 'Socket.io', 'Tailwind CSS', 'CodeMirror 6', 'OpenCode'].map(tech => (
              <span
                key={tech}
                className="px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-sm text-gray-300 hover:border-white/20 hover:text-white transition"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative py-8 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <BookOpen size={12} className="text-white" />
            </div>
            <span>AgentWiki</span>
          </div>
          <div>
            {zh ? '为人类和 AI Agent 共同设计' : 'Designed for humans and AI Agents'}
          </div>
        </div>
      </footer>
    </div>
  );
};
