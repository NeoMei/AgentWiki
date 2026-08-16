import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BookOpen, Bot, Compass, Gem, GitBranch, Layers, Menu, Rocket, Server, Shield, X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { GlobalNavigation } from '../../components/GlobalNavigation';

export interface GuideEntry {
  to: string;
  icon: React.ElementType;
  titleZh: string;
  titleEn: string;
  descZh?: string;
  descEn?: string;
}

export interface GuideGroup {
  labelZh: string;
  labelEn: string;
  items: GuideEntry[];
}

export const guideGroups: GuideGroup[] = [
  {
    labelZh: '快速上手',
    labelEn: 'Getting Started',
    items: [
      {
        to: '/guide',
        icon: Compass,
        titleZh: '快速开始',
        titleEn: 'Quick Start',
      },
      {
        to: '/guide/agent-onboard',
        icon: Rocket,
        titleZh: 'Agent 自助接入',
        titleEn: 'Agent Onboard',
      },
      {
        to: '/guide/obsidian',
        icon: Gem,
        titleZh: 'Obsidian 插件',
        titleEn: 'Obsidian Plugin',
      },
    ],
  },
  {
    labelZh: '详细文档',
    labelEn: 'Documentation',
    items: [
      {
        to: '/guide/docs',
        icon: BookOpen,
        titleZh: '项目解读',
        titleEn: 'Project Overview',
        descZh: 'AgentWiki 是什么、解决什么问题、整体架构。',
        descEn: 'What AgentWiki is, the problem it solves, and its architecture.',
      },
      {
        to: '/guide/docs/architecture',
        icon: Server,
        titleZh: '系统架构',
        titleEn: 'System Architecture',
        descZh: 'MCP 网关路由、本地与远程执行平面、工具分层。',
        descEn: 'MCP gateway routing, local vs remote execution planes, tool layering.',
      },
      {
        to: '/guide/docs/features',
        icon: Layers,
        titleZh: '功能详解',
        titleEn: 'Features in Depth',
        descZh: '每个功能模块的设计原理、使用方法和最佳实践。',
        descEn: 'Design rationale, usage, and best practices for each feature module.',
      },
      {
        to: '/guide/docs/security',
        icon: Shield,
        titleZh: '安全模型',
        titleEn: 'Security Model',
        descZh: '三层权限交集、审核流、凭据管理与审计。',
        descEn: 'Three-layer permission intersection, review flow, credential management, audit.',
      },
      {
        to: '/guide/docs/sync',
        icon: GitBranch,
        titleZh: '知识同步工作流',
        titleEn: 'Knowledge Sync Workflow',
        descZh: '扫描、预览、同步、拉取的确定性流程与冲突处理。',
        descEn: 'The deterministic scan, preview, sync, pull flow and conflict handling.',
      },
    ],
  },
];

/** Documentation entries reused by the docs index page. */
export const docSections: GuideEntry[] = guideGroups[1].items;

export const GuideLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const { pathname } = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" aria-label="AgentWiki" className="flex items-center gap-2 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Bot size={18} className="text-white" />
              </div>
              <span className="hidden md:inline text-lg font-bold text-gray-900">AgentWiki</span>
            </Link>
            <span className="text-gray-300 hidden md:inline">/</span>
            <span className="hidden md:inline text-sm font-medium text-gray-600 flex items-center gap-1 min-w-0">
              <BookOpen size={15} className="shrink-0" />
              {zh ? '使用指南' : 'Usage Guide'}
            </span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <GlobalNavigation density="public" />
            <LanguageSwitcher />
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-100"
              aria-label={zh ? '切换目录' : 'Toggle contents'}
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-8">
        {/* Sidebar */}
        <aside className={(sidebarOpen ? 'block' : 'hidden') + ' lg:block w-64 shrink-0 py-8'}>
          <div className="sticky top-20 space-y-5">
            {guideGroups.map((group) => (
              <div key={group.labelEn}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-3">
                  {zh ? group.labelZh : group.labelEn}
                </p>
                <div className="space-y-1">
                  {group.items.map((s) => {
                    const active = pathname === s.to;
                    const Icon = s.icon;
                    return (
                      <Link
                        key={s.to}
                        to={s.to}
                        onClick={() => setSidebarOpen(false)}
                        className={'flex items-start gap-2.5 px-3 py-2 rounded-lg text-sm transition ' + (active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100')}
                      >
                        <Icon size={16} className="shrink-0 mt-0.5" />
                        <span>{zh ? s.titleZh : s.titleEn}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 py-8 lg:py-12 max-w-4xl">{children}</main>
      </div>
    </div>
  );
};
