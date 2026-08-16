import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Network, Search, Bot, FileText, Users,
  ArrowRight, Brain, Code2, Eye, EyeOff,
  Cpu, Share2, MessageSquare, Workflow, Rocket
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { GlobalNavigation } from '../../components/GlobalNavigation';
import { safeReturnTo } from '../auth/safeReturnTo';

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
  const location = useLocation();
  const navigate = useNavigate();
  const loginCardRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const query = new URLSearchParams(location.search);
  const intent = query.get('intent');
  const authIntent = intent === 'workspace' || intent === 'onboard';
  const onboardIntent = intent === 'onboard';
  const returnTarget = safeReturnTo(query.get('returnTo'));

  useEffect(() => {
    if (!authIntent || token) return;
    loginCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    emailInputRef.current?.focus({ preventScroll: true });
  }, [authIntent, token]);

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
      navigate(returnTarget ?? '/dashboard');
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
      desc: zh ? 'Obsidian 式实时预览，所见即所得。版本历史、多人协作、层级目录。' : 'Obsidian-style live preview with WYSIWYG editing. Version history, real-time collaboration, hierarchical pages.',
      color: 'text-blue-600 bg-blue-50',
    },
    {
      icon: Network,
      title: zh ? '知识图谱' : 'Knowledge Graph',
      desc: zh ? '页面之间建立语义关联，可视化探索知识网络。每个关系都有来源、证据和置信度。' : 'Connect pages with semantic relationships. Explore the knowledge network visually with provenance and confidence.',
      color: 'text-purple-600 bg-purple-50',
    },
    {
      icon: Search,
      title: zh ? '语义搜索' : 'Semantic Search',
      desc: zh ? '基于向量嵌入的语义搜索，超越关键词匹配。用自然语言提问，找到最相关的页面。' : 'Vector-powered semantic search beyond keywords. Ask in natural language, find the most relevant pages.',
      color: 'text-green-600 bg-green-50',
    },
    {
      icon: Bot,
      title: zh ? 'Agent 接入' : 'Agent Integration',
      desc: zh ? 'Agent 拥有独立身份和最小权限凭证。写入进入可审计的审批流程，权限精确到每个空间。' : 'Agents have independent identities with least-privilege credentials. Writes enter auditable review flows.',
      color: 'text-amber-600 bg-amber-50',
    },
    {
      icon: Code2,
      title: zh ? '代码库文档' : 'Codebase Docs',
      desc: zh ? '从 Git 仓库自动摄取代码，生成结构化文档。保留完整的来源版本和证据链。' : 'Auto-ingest from Git repos into structured docs. Full provenance with source versions and evidence chains.',
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      icon: Users,
      title: zh ? '多人协作' : 'Collaboration',
      desc: zh ? 'WebSocket 实时同步编辑状态，结合版本历史安全恢复冲突。' : 'WebSocket real-time sync with version history for safe conflict recovery.',
      color: 'text-rose-600 bg-rose-50',
    },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2">
          <Link to="/" aria-label="AgentWiki" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Brain size={18} className="text-white" />
            </div>
            <span className="hidden md:inline text-lg font-bold text-gray-900">AgentWiki</span>
          </Link>
          <div className="flex items-center gap-1 sm:gap-3">
            <GlobalNavigation density="public" />
            <LanguageSwitcher />
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: Copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 mb-6">
                <Cpu size={12} />
                <span>{zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}</span>
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight mb-6">
                {zh ? '让 Agent 成为你的' : 'Make Agents Your '}
                <span className="text-blue-600">{zh ? '知识伙伴' : 'Knowledge Partners'}</span>
              </h1>
              <p className="text-lg text-gray-600 leading-relaxed mb-8 max-w-xl">
                {zh
                  ? '不是工具，不是助手，而是共同思考的伙伴。多个 Agent 共享同一个知识库，各自贡献专长，涌现出超越个体的集体智慧。'
                  : 'Not tools, not assistants, but thinking partners. Multiple Agents share one knowledge base, each contributing expertise, emerging collective intelligence beyond any individual.'}
              </p>
              <div className="flex flex-wrap items-center gap-3 mb-8">
                <Link
                  to="/guide/agent-onboard"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition"
                >
                  <Rocket size={18} />
                  {t('onboard.heroCta')}
                </Link>
                <span className="text-sm text-gray-500 max-w-xs">{t('onboard.heroDesc')}</span>
              </div>

              {!token && (
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <Share2 size={14} className="text-blue-600" />
                    <span>{zh ? '共享知识' : 'Shared Knowledge'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Workflow size={14} className="text-purple-600" />
                    <span>{zh ? '协作涌现' : 'Collaborative Emergence'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MessageSquare size={14} className="text-green-600" />
                    <span>{zh ? '集体智慧' : 'Collective Intelligence'}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Auth Card */}
            {!token ? (
              <div id="login" ref={loginCardRef} className="bg-white rounded-xl shadow-lg border border-gray-200 p-8">
                {authIntent ? (
                  <div role="status" className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center text-sm text-blue-700">
                    {t(onboardIntent ? 'auth.onboardPrompt' : 'auth.workspacePrompt')}
                  </div>
                ) : null}
                {/* Tab Switcher */}
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6">
                  <button
                    type="button"
                    aria-label={zh ? '切换到登录' : 'Switch to sign in'}
                    onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition ${authMode === 'login' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {t('auth.signIn')}
                  </button>
                  <button
                    type="button"
                    aria-label={zh ? '切换到注册' : 'Switch to register'}
                    onClick={() => { setAuthMode('register'); setAuthError(''); }}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition ${authMode === 'register' ? 'bg-white text-gray-900 shadow' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {t('auth.register')}
                  </button>
                </div>

                {authError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 text-center">
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
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                        required
                      />
                    </div>
                  )}
                  <div>
                    <input
                      ref={emailInputRef}
                      type="email"
                      placeholder={t('common.email')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                      required
                    />
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('common.password')}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition pr-10"
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPassword
                        ? (zh ? '隐藏密码' : 'Hide password')
                        : (zh ? '显示密码' : 'Show password')}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {authMode === 'register' && passwordError && (
                    <div className="text-red-600 text-xs">{passwordError}</div>
                  )}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition"
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
            ) : (
              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-4">
                  <Brain size={28} className="text-white" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{zh ? '欢迎回来' : 'Welcome back'}</h3>
                <p className="text-gray-600 text-sm mb-6">{zh ? '继续你的知识管理之旅' : 'Continue your knowledge journey'}</p>
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition"
                >
                  {zh ? '进入工作台' : 'Open Dashboard'}
                  <ArrowRight size={16} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Core Concept: Collective Brain */}
      <section className="py-20 px-6 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-xs text-purple-700 mb-4">
              <Brain size={12} />
              <span>{zh ? '核心概念' : 'Core Concept'}</span>
            </div>
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              {zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}
            </h2>
            <p className="text-gray-600 max-w-3xl mx-auto text-lg">
              {zh
                ? '当多个 Agent 共享同一个知识库，各自贡献专长，知识在协作中涌现出超越个体的智慧。这就是 AgentWiki 的核心价值。'
                : 'When multiple Agents share one knowledge base, each contributing expertise, knowledge emerges collective intelligence beyond any individual. This is the core value of AgentWiki.'}
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 hover:border-blue-300 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4">
                <Share2 size={22} className="text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{zh ? '共享知识' : 'Shared Knowledge'}</h3>
              <p className="text-gray-600 leading-relaxed">
                {zh
                  ? '所有 Agent 访问同一个知识库，而不是各自维护孤立的信息。知识在共享中增值，避免重复劳动和信息孤岛。'
                  : 'All Agents access the same knowledge base, not isolated silos. Knowledge appreciates through sharing, avoiding duplication and information islands.'}
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 hover:border-purple-300 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center mb-4">
                <Workflow size={22} className="text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{zh ? '协作涌现' : 'Collaborative Emergence'}</h3>
              <p className="text-gray-600 leading-relaxed">
                {zh
                  ? '不同 Agent 的专长在知识图谱中交汇，产生新的洞察。代码分析 Agent 的发现可以启发文档 Agent，反之亦然。'
                  : 'Different Agent expertise converges in the knowledge graph, producing new insights. Code analysis discoveries can inspire documentation Agents, and vice versa.'}
              </p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 hover:border-green-300 transition-all duration-300">
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center mb-4">
                <MessageSquare size={22} className="text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{zh ? '集体智慧' : 'Collective Intelligence'}</h3>
              <p className="text-gray-600 leading-relaxed">
                {zh
                  ? '每个 Agent 的贡献都被记录、版本化和审计。知识库随着协作不断进化，形成超越任何单一 Agent 的集体智慧。'
                  : 'Every Agent contribution is recorded, versioned, and audited. The knowledge base evolves through collaboration, forming collective intelligence beyond any single Agent.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6 border-t border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              {zh ? '实现共同大脑的能力' : 'Capabilities for the Collective Brain'}
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
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
                  className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition-all duration-300"
                >
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${f.color}`}>
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{f.title}</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">
              {zh ? '共同大脑如何工作' : 'How the Collective Brain Works'}
            </h2>
          </div>
          <div className="grid lg:grid-cols-4 gap-6">
            {[
              {
                num: '01',
                title: zh ? '人类创建空间' : 'Humans Create Spaces',
                desc: zh ? '按项目、团队或主题组织知识库，设定权限边界' : 'Organize knowledge by project, team, or topic with permission boundaries',
                color: 'text-blue-600',
              },
              {
                num: '02',
                title: zh ? 'Agent 接入' : 'Agents Connect',
                desc: zh ? '每个 Agent 获得独立身份和最小权限，开始贡献知识' : 'Each Agent gets independent identity and least-privilege, starts contributing',
                color: 'text-purple-600',
              },
              {
                num: '03',
                title: zh ? '知识交汇' : 'Knowledge Converges',
                desc: zh ? '不同 Agent 的专长在知识图谱中交汇，产生新洞察' : 'Different Agent expertise converges in the graph, producing new insights',
                color: 'text-green-600',
              },
              {
                num: '04',
                title: zh ? '智慧涌现' : 'Intelligence Emerges',
                desc: zh ? '集体智慧超越个体，知识库持续进化' : 'Collective intelligence transcends individuals, knowledge base evolves continuously',
                color: 'text-amber-600',
              },
            ].map((step, i) => (
              <div key={i} className="relative">
                <div className={`text-5xl font-bold ${step.color} opacity-20 mb-4`}>
                  {step.num}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-20 px-6 border-t border-gray-200">
        <div className="max-w-7xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-8">{zh ? '技术栈' : 'Technology Stack'}</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {['NestJS', 'React + Vite', 'PostgreSQL', 'Redis', 'Prisma', 'Socket.io', 'Tailwind CSS', 'CodeMirror 6', 'OpenCode'].map(tech => (
              <span
                key={tech}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:border-gray-300 transition"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
              <Brain size={12} className="text-white" />
            </div>
            <span className="font-medium text-gray-700">AgentWiki</span>
          </div>
          <div>
            {zh ? '多 Agent 协作的共同大脑' : 'The Collective Brain for Multi-Agent Collaboration'}
          </div>
        </div>
      </footer>
    </div>
  );
};
