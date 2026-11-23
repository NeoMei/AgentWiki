import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { Profile } from './Profile';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../api/client', () => ({ default: apiMock }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Test User', email: 'user@example.com' },
    login: vi.fn(),
  }),
}));

describe('Profile shortcuts', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({
      data: { name: 'Test User', email: 'user@example.com', apiKeys: [] },
    });
  });

  it('keeps the Obsidian shortcut pointed at the dedicated guide page', async () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('link', { name: '连接 Obsidian →' }))
      .toHaveAttribute('href', '/guide/obsidian');
  });

  it('shows the signed-in user avatar and owned Agents in account settings', async () => {
    apiMock.get
      .mockResolvedValueOnce({ data: { name: 'Test User', email: 'user@example.com', apiKeys: [] } })
      .mockResolvedValueOnce({ data: [{ id: 'agent-1', name: '写作助手', description: '我的 Agent', status: 'active' }] });

    render(
      <LanguageProvider>
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByText('TU')).toBeInTheDocument();
    expect(await screen.findByText('我的智能体')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /写作助手/ })).toHaveAttribute('href', '/agents/agent-1');
  });

  it.each([
    { language: 'zh-CN', scenario: /定时导出知识库页面/u, account: '你的账号有权访问的空间' },
    { language: 'en', scenario: /scheduled export of wiki pages/u, account: 'spaces your account can access' },
  ])('explains where and how to use a personal Key in $language', async ({ language, scenario, account }) => {
    localStorage.setItem('agentwiki.language.v1', language);
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    const help = await screen.findByText(scenario);
    expect(help).toHaveTextContent('x-api-key');
    expect(help).toHaveTextContent('GET /api/spaces');
    expect(help).toHaveTextContent(account);
  });

  it('requires confirmation before regenerating a Key and refreshes owned Agent connection status', async () => {
    const agent = { id: 'agent-1', name: '写作助手', status: 'active' };
    apiMock.get
      .mockResolvedValueOnce({ data: { name: 'Test User', email: 'user@example.com', apiKeys: [{ id: 'key-1' }] } })
      .mockResolvedValueOnce({ data: [agent] })
      .mockResolvedValueOnce({ data: [{ ...agent, reconnectRequired: true }] });
    apiMock.post.mockResolvedValue({ data: { apiKey: 'new-test-key' } });
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    const regenerate = await screen.findByRole('button', { name: '重新生成' });
    fireEvent.click(regenerate);
    const dialog = screen.getByRole('dialog', { name: '重新生成个人访问令牌' });
    expect(dialog).toHaveTextContent('你拥有的所有智能体连接立即失效');
    expect(apiMock.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();

    fireEvent.click(regenerate);
    fireEvent.click(screen.getByRole('button', { name: '确认重新生成' }));
    expect(await screen.findByText('new-test-key')).toBeVisible();
    expect(apiMock.post).toHaveBeenCalledExactlyOnceWith('/users/me/api-key');
    expect(await screen.findByRole('link', { name: /写作助手.*需要重连/ })).toHaveAttribute('href', '/agents/agent-1');
  });

  it('reveals the current Key only when requested and can reveal it again after hiding it', async () => {
    apiMock.get
      .mockResolvedValueOnce({ data: { name: 'Test User', apiKeys: [{ id: 'key-1' }] } })
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValue({ data: { apiKey: 'existing-test-key' } });
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '查看令牌' }));
    expect(await screen.findByText('existing-test-key')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '隐藏令牌' }));
    expect(screen.queryByText('existing-test-key')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '查看令牌' }));
    expect(await screen.findByText('existing-test-key')).toBeVisible();

    expect(apiMock.get.mock.calls.filter(([path]) => path === '/users/me/api-key')).toHaveLength(2);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('explains why a legacy Key cannot be viewed without rotating it automatically', async () => {
    apiMock.get
      .mockResolvedValueOnce({ data: { name: 'Test User', apiKeys: [{ id: 'legacy-key' }] } })
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce({ response: { status: 409, data: { code: 'PERSONAL_TOKEN_LEGACY' } } });
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '查看令牌' }));
    expect(await screen.findByText(/旧版令牌只保存了校验摘要/u)).toBeVisible();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeVisible();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('warns before issuing a Key when an Agent exists but no active Key is visible', async () => {
    apiMock.get
      .mockResolvedValueOnce({ data: { name: 'Test User', email: 'user@example.com', apiKeys: [] } })
      .mockResolvedValueOnce({ data: [{ id: 'agent-1', name: '写作助手', status: 'active' }] });
    apiMock.post.mockResolvedValue({ data: { apiKey: 'new-test-key' } });
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '生成个人令牌' }));
    const dialog = screen.getByRole('dialog', { name: '生成个人令牌' });
    expect(dialog).toHaveTextContent(/如果此账号曾生成过令牌.*你拥有的所有智能体连接立即失效/);
    expect(apiMock.post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('requires confirmation when the current Key state could not be loaded', async () => {
    apiMock.get.mockRejectedValueOnce(new Error('profile unavailable'));
    apiMock.post.mockResolvedValue({ data: { apiKey: 'new-test-key' } });
    render(<LanguageProvider><MemoryRouter><Profile /></MemoryRouter></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: '生成个人令牌' }));
    expect(screen.getByRole('dialog', { name: '生成个人令牌' })).toHaveTextContent('所有智能体连接立即失效');
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});
