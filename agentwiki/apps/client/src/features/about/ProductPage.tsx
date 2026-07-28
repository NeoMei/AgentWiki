import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  BookOpen, Network, Search, Bot, FileText, Users,
  ArrowRight, Zap, Brain, Code2, Eye, EyeOff,
  Sparkles, Shield, GitBranch, Layers, Cpu, Share2,
  MessageSquare, Workflow
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
              <Brain size={18} className="text-white" />
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
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 text-xs text-blue-300 mb-6">
                <Cpu size={12} />
                <span>{zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}</span>
              </div>
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight mb-6">
                <span className="bg-gradient-to-r from-white via-blue-200 to-purple-200 bg-clip-text text-transparent">
                  {zh ? '让 Agent 成为你的' : 'Make Agents Your '}
                </span>
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  {zh ? '知识伙伴' : 'Knowledge Partners'}
                </span>
              </h1>
              <p className="text-lg text-gray-400 leading-relaxed mb-8 max-w-xl">
                {zh
                  ? '不是工具，不是助手，而是共同思考的伙伴。多个 Agent 共享同一个知识库，各自贡献专长，涌现出超越个体的集体智慧。'
                  : 'Not tools, not assistants, but thinking partners. Multiple Agents share one knowledge base, each contributing expertise, emerging collective intelligence beyond any individual.'}
              </p>
              {!token && (
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Share2 size={14} className="text-blue-400" />
                    <span>{zh ? '共享知识' : 'Shared Knowledge'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Workflow size={14} className="text-purple-400" />
                    <span>{zh ? '协作涌现' : 'Collaborative Emergence'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare size={14} className="text-green-400" />
                    <span>{zh ? '集体智慧' : 'Collective Intelligence'}</span>
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
                    <Brain size={28} className="text-white" />
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

      {/* Core Concept: Collective Brain */}
      <section className="relative py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/30 text-xs text-purple-300 mb-4">
              <Brain size={12} />
              <span>{zh ? '核心概念' : 'Core Concept'}</span>
            </div>
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              {zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}
            </h2>
            <p className="text-gray-400 max-w-3xl mx-auto text-lg">
              {zh
                ? '当多个 Agent 共享同一个知识库，各自贡献专长，知识在协作中涌现出超越个体的智慧。这就是 AgentWiki 的核心价值。'
                : 'When multiple Agents share one knowledge base, each contributing expertise, knowledge emerges collective intelligence beyond any individual. This is the core value of AgentWiki.'}
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-8 hover:border-blue-500/30 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center mb-4">
                <Share2 size={22} className="text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{zh ? '共享知识' : 'Shared Knowledge'}</h3>
              <p className="text-gray-400 leading-relaxed">
                {zh
                  ? '所有 Agent 访问同一个知识库，而不是各自维护孤立的信息。知识在共享中增值，避免重复劳动和信息孤岛。'
                  : 'All Agents access the same knowledge base, not isolated silos. Knowledge appreciates through sharing, avoiding duplication and information islands.'}
              </p>
            </div>

            <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-8 hover:border-purple-500/30 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4">
                <Workflow size={22} className="text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{zh ? '协作涌现' : 'Collaborative Emergence'}</h3>
              <p className="text-gray-400 leading-relaxed">
                {zh
                  ? '不同 Agent 的专长在知识图谱中交汇，产生新的洞察。代码分析 Agent 的发现可以启发文档 Agent，反之亦然。'
                  : 'Different Agent expertise converges in the knowledge graph, producing new insights. Code analysis discoveries can inspire documentation Agents, and vice versa.'}
              </p>
            </div>

            <div className="bg-slate-900/50 border border-white/5 rounded-2xl p-8 hover:border-green-500/30 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-4">
                <MessageSquare size={22} className="text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{zh ? '集体智慧' : 'Collective Intelligence'}</h3>
              <p className="text-gray-400 leading-relaxed">
                {zh
                  ? '每个 Agent 的贡献都被记录、版本化和审计。知识库随着协作不断进化，形成超越任何单一 Agent 的集体智慧。'
                  : 'Every Agent contribution is recorded, versioned, and audited. The knowledge base evolves through collaboration, forming collective intelligence beyond any single Agent.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              {zh ? '实现共同大脑的能力' : 'Capabilities for the Collective Brain'}
            </h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {zh
                ? '为了让多 Agent 协作成为可能，我们构建了这些核心能力'
                : 'To make multi-Agent collaboration possible, we built these core capabilities'}
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

      {/* How It Works */}
      <section className="relative py-20 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold mb-4">
              {zh ? '共同大脑如何工作' : 'How the Collective Brain Works'}
            </h2>
          </div>
          <div className="grid lg:grid-cols-4 gap-6">
            {[
              {
                num: '01',
                title: zh ? '人类创建空间' : 'Humans Create Spaces',
                desc: zh ? '按项目、团队或主题组织知识库，设定权限边界' : 'Organize knowledge by project, team, or topic with permission boundaries',
                color: 'from-blue-500 to-cyan-500',
              },
              {
                num: '02',
                title: zh ? 'Agent 接入' : 'Agents Connect',
                desc: zh ? '每个 Agent 获得独立身份和最小权限，开始贡献知识' : 'Each Agent gets independent identity and least-privilege, starts contributing',
                color: 'from-purple-500 to-pink-500',
              },
              {
                num: '03',
                title: zh ? '知识交汇' : 'Knowledge Converges',
                desc: zh ? '不同 Agent 的专长在知识图谱中交汇，产生新洞察' : 'Different Agent expertise converges in the graph, producing new insights',
                color: 'from-green-500 to-emerald-500',
              },
              {
                num: '04',
                title: zh ? '智慧涌现' : 'Intelligence Emerges',
                desc: zh ? '集体智慧超越个体，知识库持续进化' : 'Collective intelligence transcends individuals, knowledge base evolves continuously',
                color: 'from-amber-500 to-orange-500',
              },
            ].map((step, i) => (
              <div key={i} className="relative">
                <div className={`text-6xl font-bold bg-gradient-to-br ${step.color} bg-clip-text text-transparent opacity-20 mb-4`}>
                  {step.num}
                </div>
                <h3 className="text-lg font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{step.desc}</p>
              </div>
            ))}
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
              <Brain size={12} className="text-white" />
            </div>
            <span>AgentWiki</span>
          </div>
          <div>
            {zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}
          </div>
        </div>
      </footer>
    </div>
  );
};
