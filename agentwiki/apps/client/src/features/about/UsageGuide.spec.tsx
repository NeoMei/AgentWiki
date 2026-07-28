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
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UsageGuide />
    </MemoryRouter>
  </LanguageProvider>,
);

describe('UsageGuide Agent connection flow', () => {
  beforeEach(() => localStorage.setItem('agentwiki.language.v1', 'zh-CN'));

  it('shows key generation, OpenCode publishing, and three success signals', () => {
    renderGuide();

    expect(screen.getByRole('heading', { name: '生成 Key 与接入指令' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '把接入指令交给 OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '确认页面已发布' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '已生成 Key 和接入指令' })).toHaveAttribute('src', '/screenshots/step4-generated-credential.png');
    expect(screen.getByRole('img', { name: 'OpenCode 发布页面过程' })).toHaveAttribute('src', '/screenshots/step5-opencode-publish.png');
    expect(screen.getByRole('img', { name: 'OpenCode 接入成功结果' })).toHaveAttribute('src', '/screenshots/step6-opencode-success.png');
    expect(screen.getByRole('img', { name: 'AgentWiki 已发布页面' })).toHaveAttribute('src', '/screenshots/step6-published-page.png');
    expect(screen.getByRole('img', { name: 'AgentWiki MCP 活动记录' })).toHaveAttribute('src', '/screenshots/step6-activity-log.png');
  });
});
