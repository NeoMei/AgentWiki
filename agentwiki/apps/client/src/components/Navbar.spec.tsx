import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Navbar } from './Navbar';
import { REVIEW_CHANGED_EVENT } from '../features/review/review-events';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: { email: 'user@example.com' }, logout: vi.fn() }),
}));

vi.mock('../api/client', () => ({
  default: apiMock,
}));

describe('Navbar global destinations', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({ data: { pending: 0 } });
  });

  it('shows top-level routes and removes their menu duplicates', () => {
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Navbar />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByRole('link', { name: 'AgentWiki' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: '首页' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '工作台' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '智能体' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '审核' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '个人菜单' }));
    expect(screen.queryAllByRole('link', { name: '使用指南' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: '连接 Obsidian' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '关于' })).not.toBeInTheDocument();
  });

  it('refreshes the pending badge on focus, custom event, and polling', async () => {
    vi.useFakeTimers();
    apiMock.get
      .mockResolvedValueOnce({ data: { pending: 0 } })
      .mockResolvedValueOnce({ data: { pending: 2 } })
      .mockResolvedValueOnce({ data: { pending: 3 } })
      .mockResolvedValueOnce({ data: { pending: 4 } });
    render(<LanguageProvider><MemoryRouter initialEntries={['/dashboard']}><Navbar /></MemoryRouter></LanguageProvider>);
    await act(async () => Promise.resolve());
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByText('2')).toBeInTheDocument();
    await act(async () => window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT)));
    expect(screen.getByText('3')).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it('does not let an older count response overwrite a newer refresh', async () => {
    let resolveInitial!: (value: any) => void;
    apiMock.get
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ data: { pending: 2 } });
    render(<LanguageProvider><MemoryRouter initialEntries={['/dashboard']}><Navbar /></MemoryRouter></LanguageProvider>);

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByText('2')).toBeInTheDocument();
    await act(async () => resolveInitial({ data: { pending: 0 } }));

    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
