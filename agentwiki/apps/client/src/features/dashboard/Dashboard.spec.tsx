import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { Dashboard } from './Dashboard';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', name: 'Admin', platformRole: 'super_admin' } }),
}));

const spaces = Array.from({ length: 20 }, (_, index) => ({
  id: `space-${index}`,
  name: `空间 ${index}`,
  slug: `space-${index}`,
}));

const renderDashboard = () => render(
  <LanguageProvider><MemoryRouter><Dashboard /></MemoryRouter></LanguageProvider>,
);

describe('Dashboard Space pagination and creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: { data: spaces, total: 25 } });
  });

  it('prepends the POST response without depending on a second list request', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { id: 'space-new', name: '新建空间', slug: 'new-space' },
    });
    renderDashboard();
    await screen.findByText('空间 0');

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '新建空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(await screen.findByRole('heading', { name: '新建空间' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('新建空间');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/spaces', { name: '新建空间', description: undefined });
  });

  it('loads and de-duplicates the next page when more Spaces exist', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 22 } })
      .mockResolvedValueOnce({ data: { data: [spaces[19], { id: 'space-20', name: '空间 20', slug: 'space-20' }], total: 22 } });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('空间 20')).toBeInTheDocument();
    expect(screen.getAllByText('空间 19')).toHaveLength(1);
    expect(api.get).toHaveBeenNthCalledWith(2, '/spaces', { params: { skip: 20, take: 20 } });
  });

  it('realigns from page one when an external insertion shifts the offset boundary', async () => {
    const olderSpaces = Array.from({ length: 5 }, (_, index) => ({
      id: `space-${20 + index}`,
      name: `空间 ${20 + index}`,
      slug: `space-${20 + index}`,
    }));
    const externalSpace = { id: 'space-external', name: '外部新空间', slug: 'external-space' };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 25 } })
      .mockResolvedValueOnce({ data: { data: [spaces[19], ...olderSpaces], total: 26 } })
      .mockResolvedValueOnce({ data: { data: [externalSpace, ...spaces.slice(0, 19)], total: 26 } });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('外部新空间')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { skip: 0, take: 20 } });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toHaveLength(20);
    expect(new Set(headings).size).toBe(20);
  });

  it('realigns combined local and external total drift without losing the POST response', async () => {
    const olderSpaces = Array.from({ length: 5 }, (_, index) => ({
      id: `space-${20 + index}`,
      name: `空间 ${20 + index}`,
      slug: `space-${20 + index}`,
    }));
    const localSpace = { id: 'space-local', name: '本地新空间', slug: 'local-space' };
    const externalSpace = { id: 'space-external', name: '外部新空间', slug: 'external-space' };
    let resolveLoadMore!: (value: { data: { data: typeof spaces; total: number } }) => void;
    const loadMore = new Promise<{ data: { data: typeof spaces; total: number } }>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 25 } })
      .mockReturnValueOnce(loadMore)
      .mockResolvedValueOnce({ data: { data: [externalSpace, ...spaces.slice(0, 19)], total: 27 } });
    vi.mocked(api.post).mockResolvedValue({ data: localSpace });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '本地新空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: '本地新空间' });

    resolveLoadMore({
      data: { data: [spaces[18], spaces[19], ...olderSpaces], total: 27 },
    });

    expect(await screen.findByRole('heading', { name: '外部新空间' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地新空间' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { skip: 0, take: 20 } });
  });

  it('preserves a creation made while an older page request is in flight', async () => {
    let resolveLoadMore!: (value: { data: { data: typeof spaces; total: number } }) => void;
    const loadMore = new Promise<{ data: { data: typeof spaces; total: number } }>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 22 } })
      .mockReturnValueOnce(loadMore);
    vi.mocked(api.post).mockResolvedValue({
      data: { id: 'space-new', name: '新建空间', slug: 'new-space' },
    });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '新建空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: '新建空间' });

    resolveLoadMore({
      data: { data: [{ id: 'space-20', name: '空间 20', slug: 'space-20' }], total: 22 },
    });

    expect(await screen.findByText('空间 20')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新建空间' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('新建空间');
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
  });

  it('discards an older page response and realigns the first page after deletion', async () => {
    const space20 = { id: 'space-20', name: '空间 20', slug: 'space-20' };
    const space21 = { id: 'space-21', name: '空间 21', slug: 'space-21' };
    let resolveLoadMore!: (value: { data: { data: typeof spaces; total: number } }) => void;
    const loadMore = new Promise<{ data: { data: typeof spaces; total: number } }>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 22 } })
      .mockReturnValueOnce(loadMore)
      .mockResolvedValueOnce({ data: { data: [...spaces.slice(1), space20], total: 21 } });
    vi.mocked(api.delete).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/space-0'));

    resolveLoadMore({ data: { data: [space20, space21], total: 22 } });
    await screen.findByRole('button', { name: '加载更多' });

    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { skip: 0, take: 20 } });
    expect(screen.queryByText('空间 0')).not.toBeInTheDocument();
    expect(screen.getAllByText('空间 20')).toHaveLength(1);
    expect(screen.queryByText('空间 21')).not.toBeInTheDocument();
  });

  it('keeps pagination locked and ignores a stale load failure during deletion realignment', async () => {
    const space20 = { id: 'space-20', name: '空间 20', slug: 'space-20' };
    let rejectLoadMore!: (reason: unknown) => void;
    let resolveReset!: (value: { data: { data: typeof spaces; total: number } }) => void;
    const loadMore = new Promise<{ data: { data: typeof spaces; total: number } }>((_resolve, reject) => {
      rejectLoadMore = reject;
    });
    const reset = new Promise<{ data: { data: typeof spaces; total: number } }>((resolve) => {
      resolveReset = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { data: spaces, total: 22 } })
      .mockReturnValueOnce(loadMore)
      .mockReturnValueOnce(reset);
    vi.mocked(api.delete).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));

    await act(async () => {
      rejectLoadMore({ response: { status: 500, data: { message: 'stale failure' } } });
      await Promise.resolve();
    });

    expect(screen.queryByText('空间加载失败')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /加载更多|正在加载/ })).toBeDisabled();

    await act(async () => {
      resolveReset({ data: { data: [...spaces.slice(1), space20], total: 21 } });
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '加载更多' })).toBeEnabled();
  });

  it('shows a localized creation failure inside the open dialog', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 500, data: { message: 'internal detail' } } });
    renderDashboard();
    await screen.findByText('空间 0');

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    const dialog = screen.getByRole('dialog', { name: '创建新空间' });
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByPlaceholderText('例如：我的知识库'), { target: { value: '失败空间' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('空间创建失败');
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeEnabled();
  });
});
