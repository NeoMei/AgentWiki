import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_SYNC_ONBOARD_COMMAND as COMMAND, LOCAL_SYNC_VERSION } from '../../config/localSync';
import { LanguageProvider } from '../../context/LanguageContext';
import { GuideLayout } from '../guide/GuideLayout';
import { OnboardPage } from './OnboardPage';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: null }),
}));


const renderPage = (language: 'zh-CN' | 'en') => {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/guide/agent-onboard']}>
        <GuideLayout><OnboardPage /></GuideLayout>
      </MemoryRouter>
    </LanguageProvider>,
  );
};

describe('OnboardPage Agent-driven onboarding guide', () => {
  beforeEach(() => {
    localStorage.clear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it('presents the pinned command as an Agent prompt instead of a terminal command', () => {
    const { container } = renderPage('zh-CN');

    expect(screen.getByText(COMMAND)).toBeInTheDocument();
    expect((container.textContent || '').split(COMMAND)).toHaveLength(2);
    expect(screen.getByText(`AgentWiki ${LOCAL_SYNC_VERSION}`)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('AgentWiki 0.5');
    expect(screen.getByText('复制整段提示词到你的 Agent')).toBeInTheDocument();
    expect(screen.queryByText('在本地终端运行')).not.toBeInTheDocument();
    expect(screen.getByText(/这不是普通终端命令/)).toBeInTheDocument();
    expect(screen.getByText(/在浏览器中登录或注册并授权/)).toBeInTheDocument();
    expect(screen.getByText(/确认 Agent、Space、权限和本地扫描计划/)).toBeInTheDocument();
    expect(screen.getByText(/预览整理后的知识并确认同步/)).toBeInTheDocument();
    expect(screen.getByText(/Codex、Claude Code、OpenCode/)).toBeInTheDocument();
  });

  it('renders and copies an equivalent English protocol prompt', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const copiedPrompt = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    expect(copiedPrompt).toContain('{"requestId":"input-1","values":{"sourcePaths":["/path/to/source"],"role":"editor"}}');
    expect(copiedPrompt).toContain('{"requestId":"plan-1","confirmed":true,"planHash":"plan-hash-1"}');
    expect(copiedPrompt).toContain('retryable, plus resumeSessionId and nextAction when present');
    expect(copiedPrompt).not.toContain('"approved"');
  });

  it('copies an executable Agent task prompt and reports blocked clipboard access', async () => {
    const { unmount } = renderPage('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const copiedPrompt = vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0];
    expect(copiedPrompt).not.toBe(COMMAND);
    expect(copiedPrompt).toContain(COMMAND);
    expect(copiedPrompt).toContain('请帮我完成 AgentWiki 自助接入');
    expect(copiedPrompt).toContain('持续读取 stdout 中的逐行 NDJSON');
    expect(copiedPrompt).toContain('把带相同 requestId 的 JSON 回复写回进程 stdin');
    expect(copiedPrompt).toContain('{"requestId":"input-1","values":{"sourcePaths":["/path/to/source"],"role":"editor"}}');
    expect(copiedPrompt).toContain('{"requestId":"plan-1","confirmed":true,"planHash":"plan-hash-1"}');
    expect(copiedPrompt).toContain('paths 类型必须写成字符串数组');
    expect(copiedPrompt).toContain('choice 类型只能使用 choices 中的值');
    expect(copiedPrompt).toContain('retryable，以及事件包含时的 resumeSessionId 和 nextAction');
    expect(copiedPrompt).not.toContain('"approved"');
    expect(copiedPrompt).toContain('首次运行 npx 可能需要安装依赖');
    expect(copiedPrompt).toContain('保持同一个进程会话');
    expect(await screen.findByRole('button', { name: '已复制提示词' })).toBeInTheDocument();

    unmount();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    renderPage('zh-CN');
    fireEvent.click(screen.getByRole('button', { name: '复制提示词' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('浏览器未允许复制');
  });
});
