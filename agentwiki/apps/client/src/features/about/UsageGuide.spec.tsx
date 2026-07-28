import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { UsageGuide } from './UsageGuide';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

const renderGuide = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/guide']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UsageGuide />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('UsageGuide Agent connection flow', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('presents the generic local-sync workflow with OpenCode as an example', () => {
    renderGuide();

    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '使用指南' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('href', '/?intent=workspace#login');
    expect(screen.getByRole('heading', { name: '创建 Agent 并授予空间访问权限' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '生成本地同步接入指令' })).toBeInTheDocument();
    expect(screen.getByText(/10 分钟有效的一次性安装码/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地 Agent 自动安装并自检' })).toBeInTheDocument();
    expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
    expect(screen.getByText(/OpenCode 只是下面截图中的演示示例/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '扫描、预览并确认同步' })).toBeInTheDocument();
    expect(screen.getByText(/是否同步到 AgentWiki/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '本地同步接入指令' }))
      .toHaveAttribute('src', '/screenshots/local-sync-install.png');
  });
});
