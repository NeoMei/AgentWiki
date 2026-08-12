import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Bot, BookOpen, Server, Layers, Shield, GitBranch, Menu, X, ArrowRight, Home,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export interface DocSection {
  to: string;
  icon: React.ElementType;
  titleZh: string;
  titleEn: string;
  descZh: string;
  descEn: string;
}

export const docSections: DocSection[] = [
  {
    to: '/docs',
    icon: BookOpen,
    titleZh: '项目解读',
    titleEn: 'Project Overview',
    descZh: 'AgentWiki 是什么、解决什么问题、整体架构。',
    descEn: 'What AgentWiki is, the problem it solves, and its architecture.',
  },
  {
    to: '/docs/architecture',
    icon: Server,
    titleZh: '系统架构',
    titleEn: 'System Architecture',
    descZh: 'MCP 网关路由、本地与远程执行平面、工具分层。',
    descEn: 'MCP gateway routing, local vs remote execution planes, tool layering.',
  },
  {
    to: '/docs/features',
    icon: Layers,
    titleZh: '功能详解',
    titleEn: 'Features in Depth',
    descZh: '每个功能模块的设计原理、使用方法和最佳实践。',
    descEn: 'Design rationale, usage, and best practices for each feature module.',
  },
  {
    to: '/docs/security',
    icon: Shield,
    titleZh: '安全模型',
    titleEn: 'Security Model',
    descZh: '三层权限交集、审核流、凭据管理与审计。',
    descEn: 'Three-layer permission intersection, review flow, credential management, audit.',
  },
  {
    to: '/docs/sync',
    icon: GitBranch,
    titleZh: '知识同步工作流',
    titleEn: 'Knowledge Sync Workflow',
    descZh: '扫描、预览、同步、拉取的确定性流程与冲突处理。',
    descEn: 'The deterministic scan, preview, sync, pull flow and conflict handling.',
  },
];

export const DocsLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useAuth();
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Link to="/" aria-label="AgentWiki" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Bot size={18} className="text-white" />
              </div>
              <span className="hidden md:inline text-lg font-bold text-gray-900">AgentWiki</span>
            </Link>
            <span className="text-gray-300 hidden md:inline">/</span>
            <Link to="/docs" className="hidden md:inline text-sm font-medium text-gray-600 hover:text-gray-900 flex items-center gap-1">
              <BookOpen size={15} /> {zh ? '详细文档' : 'Documentation'}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/guide" className="hidden sm:inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded">
              <Home size={15} /> {zh ? '使用指南' : 'Guide'}
            </Link>
            <Link to="/onboard" className="hidden sm:inline-flex items-center gap-1 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg font-medium">
              {zh ? '接入' : 'Onboard'} <ArrowRight size={14} />
            </Link>
            <LanguageSwitcher />
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100" aria-label="Toggle sidebar">
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-8">
        {/* Sidebar */}
        <aside className={`${sidebarOpen ? 'block' : 'hidden'} lg:block w-64 shrink-0 py-8`}>
          <div className="sticky top-20 space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">{zh ? '文档目录' : 'Contents'}</p>
            {docSections.map((s) => {
              const active = pathname === s.to;
              const Icon = s.icon;
              return (
                <Link key={s.to} to={s.to} onClick={() => setSidebarOpen(false)} className={`flex items-start gap-2.5 px-3 py-2 rounded-lg text-sm transition ${active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
                  <Icon size={16} className="shrink-0 mt-0.5" />
                  <span>{zh ? s.titleZh : s.titleEn}</span>
                </Link>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 py-8 lg:py-12 max-w-4xl">{children}</main>
      </div>
    </div>
  );
};
