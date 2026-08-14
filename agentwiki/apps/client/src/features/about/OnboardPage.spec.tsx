import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { OnboardPage } from './OnboardPage';

const COMMAND = 'npx --yes @neomei/agentwiki-local-sync@0.3.7 onboard --server https://agentwiki.quukk.com/api --protocol ndjson';

const renderPage = (language: 'zh-CN' | 'en') => {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/onboard']}>
        <OnboardPage />
      </MemoryRouter>
    </LanguageProvider>,
  );
};

describe('OnboardPage 0.3 onboarding guide', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('shows one pinned command and the three human actions in Chinese', () => {
    const { container } = renderPage('zh-CN');

    expect(screen.getByText(COMMAND)).toBeInTheDocument();
    expect(container.textContent?.match(/@neomei\/agentwiki-local-sync@0\.3\.7/g)).toHaveLength(1);
    expect(screen.getByText(/在浏览器中登录或注册并授权/)).toBeInTheDocument();
    expect(screen.getByText(/确认 Agent、Space、权限和本地扫描计划/)).toBeInTheDocument();
    expect(screen.getByText(/预览整理后的知识并确认同步/)).toBeInTheDocument();
    expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
  });

  it('renders equivalent English copy and removes the retired onboarding surface', () => {
    const { container } = renderPage('en');
    const text = container.textContent || '';

    expect(screen.getByText(COMMAND)).toBeInTheDocument();
    expect(screen.getByText(/Authorize in your browser/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm the Agent, Space, permissions, and local scan plan/)).toBeInTheDocument();
    expect(screen.getByText(/Preview the organized knowledge and confirm sync/)).toBeInTheDocument();
    expect(text).not.toContain('/api/onboard.json');
    expect(text).not.toContain('API Key');
    expect(text).not.toContain('Two MCP');
    expect(text).not.toContain('0.2.9');
    expect(text).not.toContain('start_knowledge_job');
  });

  it('copies the pinned command and reports blocked clipboard access', async () => {
    const { unmount } = renderPage('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(COMMAND));
    expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument();

    unmount();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    renderPage('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器未允许复制');
  });
});
