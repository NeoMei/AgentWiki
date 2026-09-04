import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { AdminPage } from './AdminPage';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', platformRole: 'super_admin' } }),
}));

const target = {
  id: 'user-1', name: 'Billy', email: 'billy_7609@test-agentwiki.com',
  platformRole: 'user', lockedAt: null, deletedAt: null,
  createdAt: '2026-08-19T00:00:00.000Z', spaceCount: 0, agentCount: 0,
};
const stats = {
  users: { total: 1, active: 1, locked: 0, deleted: 0, new7d: 1, new30d: 1 },
  spaces: 0, pages: 0, agents: 0, userTrend30d: [], recentUsers: [],
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe('AdminPage password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockImplementation(async (url: string) => (
      url.includes('/stats') ? { data: stats } : { data: { users: [target], total: 1 } }
    ));
  });

  it('keeps the exact account email visible and copies labeled login credentials', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { password: 'Temp_Aa1!' } });
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<LanguageProvider><AdminPage /></LanguageProvider>);

    fireEvent.click(await screen.findByTitle('重置密码'));
    expect(screen.getAllByText('billy_7609@test-agentwiki.com').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole('button', { name: '确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '复制登录信息' }));

    expect(writeText).toHaveBeenCalledWith('邮箱: billy_7609@test-agentwiki.com\n临时密码: Temp_Aa1!');
    await waitFor(() => expect(screen.getAllByText('billy_7609@test-agentwiki.com').length).toBeGreaterThan(1));
  });

  it('locks the reset dialog to one account and one request until the password arrives', async () => {
    let resolveReset!: (value: any) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise((resolve) => { resolveReset = resolve; }));
    render(<LanguageProvider><AdminPage /></LanguageProvider>);

    fireEvent.click(await screen.findByTitle('重置密码'));
    const confirm = screen.getByRole('button', { name: '确认' });
    fireEvent.click(confirm);

    expect(screen.getByRole('button', { name: '加载中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '加载中…' }));
    expect(api.post).toHaveBeenCalledTimes(1);

    resolveReset({ data: { password: 'Temp_Aa1!' } });
    expect(await screen.findByText('Temp_Aa1!')).toBeInTheDocument();
    expect(screen.getAllByText(target.email).length).toBeGreaterThan(1);
  });

  it('closes the action dialog with Escape and restores focus to its opener', async () => {
    render(<LanguageProvider><AdminPage /></LanguageProvider>);

    const opener = await screen.findByTitle('重置密码');
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '重置密码' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('shows a retryable list error when initial admin loading fails', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.includes('/stats')) return { data: stats };
      throw new Error('offline');
    });
    render(<LanguageProvider><AdminPage /></LanguageProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('does not let an older search response replace the latest query', async () => {
    const oldRequest = deferred<any>();
    const newRequest = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/stats')) return Promise.resolve({ data: stats });
      if (url.includes('query=a&')) return oldRequest.promise;
      if (url.includes('query=ab&')) return newRequest.promise;
      return Promise.resolve({ data: { users: [target], total: 1 } });
    });
    render(<LanguageProvider><AdminPage /></LanguageProvider>);
    const search = await screen.findByPlaceholderText('搜索');

    fireEvent.change(search, { target: { value: 'a' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('query=a&')));
    fireEvent.change(search, { target: { value: 'ab' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringContaining('query=ab&')));
    await act(async () => newRequest.resolve({ data: { users: [{ ...target, id: 'new', name: 'Latest result' }], total: 1 } }));
    expect(await screen.findByText('Latest result')).toBeInTheDocument();
    await act(async () => oldRequest.resolve({ data: { users: [{ ...target, id: 'old', name: 'Stale result' }], total: 1 } }));

    expect(screen.getByText('Latest result')).toBeInTheDocument();
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
  });
});
