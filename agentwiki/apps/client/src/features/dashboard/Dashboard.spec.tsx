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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const spacePage = (
  data: any[],
  total: number,
  overrides: Partial<{
    revision: string;
    nextCursor: string | null;
    hasMore: boolean;
    resetRequired: boolean;
  }> = {},
) => ({
  data: {
    data,
    total,
    page: 1,
    limit: 20,
    revision: 'revision-default',
    nextCursor: total > data.length ? 'cursor-default' : null,
    hasMore: total > data.length,
    resetRequired: false,
    ...overrides,
  },
});

describe('Dashboard Space pagination and creation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue(spacePage(spaces, 25));
  });

  it('shows useful Space context on each card', async () => {
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'space-context',
      name: '产品知识库',
      slug: 'product-knowledge',
      description: '沉淀产品决策和交付资料',
      updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      approvalPolicy: 'always-review',
      _count: { pages: 12 },
      members: [
        { type: 'human', role: 'owner', user: { id: 'owner-1', name: '空间负责人', email: 'owner@example.test' } },
        { type: 'human', role: 'admin', user: { id: 'admin-1', name: 'Admin' } },
      ],
    }], 1, { nextCursor: null, hasMore: false }));

    renderDashboard();

    const card = await screen.findByTestId('space-card');
    expect(within(card).getByText('12 个页面')).toBeInTheDocument();
    expect(within(card).getByText('2 位成员')).toBeInTheDocument();
    expect(within(card).getByText('所有者：空间负责人')).toBeInTheDocument();
    expect(within(card).getByText('始终审核')).toBeInTheDocument();
    expect(within(card).getByText(/最近更新/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /进入空间/ })).toHaveAttribute('href', '/spaces/space-context');
  });

  it('shows every owner, using email for blank names without including other member roles', async () => {
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'multi-owner', name: '协作空间', slug: 'shared',
      members: [
        { role: 'admin', user: { id: 'admin-1', name: 'Admin' } },
        { role: 'owner', user: { id: 'owner-a', name: ' 张三 ', email: 'a@example.test' } },
        { role: 'editor', user: { id: 'editor', name: '编辑者' } },
        { role: 'owner', user: { id: 'owner-b', name: '  ', email: 'owner-b@example.test' } },
      ],
    }], 1));
    renderDashboard();
    const card = await screen.findByTestId('space-card');
    const owner = within(card).getByText('所有者：张三、owner-b@example.test');
    expect(owner.closest('p')).toHaveAttribute('title', owner.textContent);
    expect(within(card).queryByText(/所有者：.*Admin|所有者：.*编辑者/)).not.toBeInTheDocument();
  });

  it.each(['zh-CN', 'en'])('does not invent an owner when member details are absent (%s)', async (language) => {
    localStorage.setItem('agentwiki.language.v1', language);
    vi.mocked(api.get).mockResolvedValue(spacePage([{ id: 'unknown-owner', name: '未知所有者', slug: 'unknown' }], 1));
    renderDashboard();
    const card = await screen.findByTestId('space-card');
    expect(within(card).getByText(language === 'en' ? 'Owner: Not available' : '所有者：暂无信息')).toBeInTheDocument();
    expect(within(card).queryByText(/Owner: Admin|所有者：Admin/)).not.toBeInTheDocument();
  });

  it.each([
    { lastUpdatedAt: '2026-10-13T10:00:00.000Z', expected: '最近更新 2小时前' },
    { lastUpdatedAt: undefined, expected: '最近更新 前天' },
  ])('shows the latest page activity with a fallback for older API responses: $expected', async ({ lastUpdatedAt, expected }) => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-13T12:00:00.000Z').getTime());
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'space-recent', name: '有更新的空间', slug: 'recent',
      updatedAt: '2026-10-11T12:00:00.000Z', lastUpdatedAt,
    }], 1));

    renderDashboard();

    expect(await screen.findByText(expected)).toHaveAttribute(
      'title',
      new Date(lastUpdatedAt ?? '2026-10-11T12:00:00.000Z').toLocaleString('zh-CN'),
    );
  });

  it.each([
    { language: 'zh-CN', field: 'lastUpdatedAt', expected: '更新时间待校准' },
    { language: 'en', field: 'lastUpdatedAt', expected: 'Update time needs calibration' },
    { language: 'zh-CN', field: 'updatedAt', expected: '更新时间待校准' },
  ])('flags a future $field in $language and preserves its local timestamp', async ({ language, field, expected }) => {
    const futureTimestamp = '2026-10-13T20:00:00.000Z';
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-13T12:00:00.000Z').getTime());
    localStorage.setItem('agentwiki.language.v1', language);
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'space-future', name: '未来时间的空间', slug: 'future',
      [field]: futureTimestamp,
    }], 1));

    renderDashboard();

    expect(await screen.findByText(expected)).toHaveAttribute('title', new Date(futureTimestamp).toLocaleString(language));
    expect(screen.queryByText(/8小时后|in 8 hours/)).not.toBeInTheDocument();
  });

  it.each([30, 60])('tolerates a %s-second future clock offset as now', async (seconds) => {
    const now = new Date('2026-10-13T12:00:00.000Z').getTime();
    const futureTimestamp = new Date(now + seconds * 1000).toISOString();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'space-clock-offset', name: '刚更新的空间', slug: 'clock-offset',
      lastUpdatedAt: futureTimestamp,
    }], 1));

    renderDashboard();

    expect(await screen.findByText('最近更新 现在')).toHaveAttribute('title', new Date(futureTimestamp).toLocaleString('zh-CN'));
  });

  it.each([undefined, 'invalid-date'])('keeps the existing fallback for a missing or invalid timestamp: %s', async (updatedAt) => {
    vi.mocked(api.get).mockResolvedValue(spacePage([{
      id: 'space-no-time', name: '没有更新时间的空间', slug: 'no-time',
      updatedAt, pageCount: 1, memberCount: 1,
    }], 1));

    renderDashboard();

    expect(await screen.findByText('统计同步中')).not.toHaveAttribute('title');
  });

  it('shows zero pages and the owner immediately after creation without an extra list request', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {
      id: 'space-new', name: '新的知识空间', slug: 'new-space',
      updatedAt: new Date().toISOString(), members: [{ userId: 'admin-1' }], _count: { pages: 0 },
    } });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '新的知识空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    const heading = await screen.findByRole('heading', { name: '新的知识空间' });
    const card = heading.closest('[data-testid="space-card"]') as HTMLElement;
    expect(within(card).getByText('0 个页面')).toBeInTheDocument();
    expect(within(card).getByText('1 位成员')).toBeInTheDocument();
    expect(within(card).queryByText('统计同步中')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it.each(['空', 'a', '😀', '✈️'])('blocks overlong creation without truncating %s input', async (unit) => {
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: '新建空间' }));
    const input = screen.getByPlaceholderText('例如：我的知识库');
    fireEvent.change(input, { target: { value: unit.repeat(33) } });
    expect(input).toHaveValue(unit.repeat(33));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/33 \/ 32/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    fireEvent.submit(input.closest('form')!);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: `  ${unit.repeat(32)}  ` } });
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'boundary', name: unit.repeat(32), slug: 'boundary' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByRole('heading', { name: unit.repeat(32) });
    expect(api.post).toHaveBeenCalledWith('/spaces', { name: unit.repeat(32), description: undefined });
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
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
      .mockResolvedValueOnce(spacePage(
        [spaces[19], { id: 'space-20', name: '空间 20', slug: 'space-20' }],
        22,
        { nextCursor: null, hasMore: false },
      ));
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('空间 20')).toBeInTheDocument();
    expect(screen.getAllByText('空间 19')).toHaveLength(1);
    expect(api.get).toHaveBeenNthCalledWith(2, '/spaces', { params: { take: 20, cursor: 'cursor-1' } });
  });

  it('uses the server cursor and replaces the page when its revision requires a reset', async () => {
    const externalSpace = { id: 'space-external', name: '外部新空间', slug: 'external-space' };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: {
        data: spaces,
        total: 25,
        page: 1,
        limit: 20,
        revision: 'revision-1',
        nextCursor: 'cursor-1',
        hasMore: true,
        resetRequired: false,
      } })
      .mockResolvedValueOnce({ data: {
        data: [externalSpace, ...spaces.slice(0, 19)],
        total: 25,
        page: 1,
        limit: 20,
        revision: 'revision-2',
        nextCursor: 'cursor-2',
        hasMore: true,
        resetRequired: true,
      } });

    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));

    expect(await screen.findByRole('heading', { name: '外部新空间' })).toBeInTheDocument();
    expect(api.get).toHaveBeenNthCalledWith(1, '/spaces', { params: { take: 20 } });
    expect(api.get).toHaveBeenNthCalledWith(2, '/spaces', { params: { take: 20, cursor: 'cursor-1' } });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(headings).toEqual(['外部新空间', ...spaces.slice(0, 19).map((space) => space.name)]);
  });

  it('drops a POST overlay when a newer server revision says the Space was externally deleted', async () => {
    const createdSpace = { id: 'space-created', name: '稍后被删除', slug: 'deleted-later' };
    const serverAfterDelete = {
      data: spaces,
      total: 21,
      page: 1,
      limit: 20,
      revision: 'revision-after-delete',
      nextCursor: 'cursor-after-delete',
      hasMore: true,
      resetRequired: true,
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: {
        data: spaces,
        total: 21,
        page: 1,
        limit: 20,
        revision: 'revision-before-create',
        nextCursor: 'cursor-before-create',
        hasMore: true,
        resetRequired: false,
      } })
      .mockResolvedValueOnce({ data: serverAfterDelete })
      // Any defensive refresh sees the same authoritative revision.
      .mockResolvedValue({ data: serverAfterDelete });
    vi.mocked(api.post).mockResolvedValue({ data: createdSpace });

    renderDashboard();
    await screen.findByText('空间 0');
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: createdSpace.name } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: createdSpace.name });

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: createdSpace.name })).not.toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(20);
  });

  it('expires an unconfirmed POST overlay even when no later list request completes', async () => {
    const createdSpace = { id: 'space-expiring', name: '待过期空间', slug: 'expiring-space' };
    const create = deferred<any>();
    vi.mocked(api.post).mockReturnValue(create.promise);
    renderDashboard();
    await screen.findByText('空间 0');

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: createdSpace.name } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    try {
      await act(async () => {
        create.resolve({ data: createdSpace });
        await Promise.resolve();
      });
      expect(screen.getByRole('heading', { name: createdSpace.name })).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });

      expect(screen.queryByRole('heading', { name: createdSpace.name })).not.toBeInTheDocument();
      expect(api.get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not double-count a POST response after an earlier GET already observed that record', async () => {
    const createdSpace = { id: 'space-created', name: '逆序到达空间', slug: 'reverse-arrival' };
    const loadMore = deferred<any>();
    const create = deferred<any>();
    const serverSawCreate = {
      data: [createdSpace, ...spaces.slice(0, 19)],
      total: 20,
      page: 1,
      limit: 20,
      revision: 'revision-with-created-space',
      nextCursor: null,
      hasMore: false,
      resetRequired: true,
    };
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: {
        data: spaces,
        total: 21,
        page: 1,
        limit: 20,
        revision: 'revision-before-create',
        nextCursor: 'cursor-before-create',
        hasMore: true,
        resetRequired: false,
      } })
      .mockReturnValueOnce(loadMore.promise)
      // Any defensive refresh sees the same already-committed record.
      .mockResolvedValue({ data: serverSawCreate });
    vi.mocked(api.post).mockReturnValue(create.promise);

    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: createdSpace.name } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

    await act(async () => {
      loadMore.resolve({ data: serverSawCreate });
      await Promise.resolve();
    });
    await screen.findByRole('heading', { name: createdSpace.name });
    await act(async () => {
      create.resolve({ data: createdSpace });
      await Promise.resolve();
    });

    expect(screen.getAllByRole('heading', { name: createdSpace.name })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('realigns from page one when an external insertion shifts the offset boundary', async () => {
    const externalSpace = { id: 'space-external', name: '外部新空间', slug: 'external-space' };
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 25, { revision: 'revision-1', nextCursor: 'cursor-1', hasMore: true }))
      .mockResolvedValueOnce(spacePage(
        [externalSpace, ...spaces.slice(0, 19)],
        26,
        { revision: 'revision-2', nextCursor: 'cursor-2', hasMore: true, resetRequired: true },
      ));
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('外部新空间')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenNthCalledWith(2, '/spaces', { params: { take: 20, cursor: 'cursor-1' } });
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
    let resolveLoadMore!: (value: any) => void;
    const loadMore = new Promise<any>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 25, { nextCursor: 'cursor-1', hasMore: true }))
      .mockReturnValueOnce(loadMore)
      .mockResolvedValueOnce(spacePage(
        [localSpace, externalSpace, ...spaces.slice(0, 18)],
        27,
        { revision: 'revision-3', nextCursor: 'cursor-3', hasMore: true },
      ));
    vi.mocked(api.post).mockResolvedValue({ data: localSpace });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '本地新空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: '本地新空间' });

    resolveLoadMore(spacePage(
      [spaces[18], spaces[19], ...olderSpaces],
      27,
      { revision: 'revision-1', nextCursor: null, hasMore: false },
    ));

    expect(await screen.findByRole('heading', { name: '外部新空间' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地新空间' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { take: 20 } });
  });

  it('realigns when an external snapshot and a later local create converge on the same total', async () => {
    const olderSpaces = Array.from({ length: 5 }, (_, index) => ({
      id: `space-${20 + index}`,
      name: `空间 ${20 + index}`,
      slug: `space-${20 + index}`,
    }));
    const localSpace = { id: 'space-local', name: '本地新空间', slug: 'local-space' };
    const externalSpace = { id: 'space-external', name: '外部新空间', slug: 'external-space' };
    let resolveExternalSnapshot!: (value: any) => void;
    const externalSnapshot = new Promise<any>((resolve) => {
      resolveExternalSnapshot = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 25, { nextCursor: 'cursor-1', hasMore: true }))
      .mockReturnValueOnce(externalSnapshot)
      .mockResolvedValueOnce(spacePage(
        [localSpace, externalSpace, ...spaces.slice(0, 18)],
        27,
        { revision: 'revision-3', nextCursor: 'cursor-3', hasMore: true },
      ));
    vi.mocked(api.post).mockResolvedValue({ data: localSpace });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '本地新空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: '本地新空间' });

    resolveExternalSnapshot(spacePage(
      [spaces[19], ...olderSpaces],
      26,
      { revision: 'revision-1', nextCursor: null, hasMore: false },
    ));

    expect(await screen.findByRole('heading', { name: '外部新空间' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地新空间' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { take: 20 } });
    expect(screen.getByRole('button', { name: '加载更多' })).toBeEnabled();
  });

  it('preserves a creation made while an older page request is in flight', async () => {
    const createdSpace = { id: 'space-new', name: '新建空间', slug: 'new-space' };
    let resolveLoadMore!: (value: any) => void;
    const loadMore = new Promise<any>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
      .mockReturnValueOnce(loadMore)
      .mockResolvedValueOnce(spacePage(
        [createdSpace, ...spaces.slice(0, 19)],
        23,
        { revision: 'revision-2', nextCursor: 'cursor-2', hasMore: true },
      ));
    vi.mocked(api.post).mockResolvedValue({ data: createdSpace });
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    fireEvent.change(screen.getByPlaceholderText('例如：我的知识库'), { target: { value: '新建空间' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('heading', { name: '新建空间' });

    resolveLoadMore(spacePage(
      [{ id: 'space-20', name: '空间 20', slug: 'space-20' }],
      22,
      { revision: 'revision-1', nextCursor: null, hasMore: false },
    ));

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { take: 20 } });
    expect(screen.queryByText('空间 20')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '新建空间' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('新建空间');
    expect(screen.getByRole('button', { name: '加载更多' })).toBeInTheDocument();
  });

  it('discards an older page response and realigns the first page after deletion', async () => {
    const space20 = { id: 'space-20', name: '空间 20', slug: 'space-20' };
    const space21 = { id: 'space-21', name: '空间 21', slug: 'space-21' };
    let resolveLoadMore!: (value: any) => void;
    const loadMore = new Promise<any>((resolve) => {
      resolveLoadMore = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
      .mockReturnValueOnce(loadMore)
      .mockResolvedValueOnce(spacePage(
        [...spaces.slice(1), space20],
        21,
        { revision: 'revision-2', nextCursor: 'cursor-2', hasMore: true },
      ));
    vi.mocked(api.delete).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/spaces/space-0'));

    resolveLoadMore(spacePage(
      [space20, space21],
      22,
      { revision: 'revision-1', nextCursor: null, hasMore: false },
    ));
    await screen.findByRole('button', { name: '加载更多' });

    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { take: 20 } });
    expect(screen.queryByText('空间 0')).not.toBeInTheDocument();
    expect(screen.getAllByText('空间 20')).toHaveLength(1);
    expect(screen.queryByText('空间 21')).not.toBeInTheDocument();
  });

  it('keeps pagination locked and ignores a stale load failure during deletion realignment', async () => {
    const space20 = { id: 'space-20', name: '空间 20', slug: 'space-20' };
    let rejectLoadMore!: (reason: unknown) => void;
    let resolveReset!: (value: any) => void;
    const loadMore = new Promise<any>((_resolve, reject) => {
      rejectLoadMore = reject;
    });
    const reset = new Promise<any>((resolve) => {
      resolveReset = resolve;
    });
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
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
      resolveReset(spacePage(
        [...spaces.slice(1), space20],
        21,
        { revision: 'revision-2', nextCursor: 'cursor-2', hasMore: true },
      ));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: '加载更多' })).toBeEnabled();
  });

  it('retries a failed deletion reset as an authoritative first-page replacement', async () => {
    const externalSpace = { id: 'space-external', name: '外部替换空间', slug: 'external-space' };
    const resetPage = [externalSpace, ...spaces.slice(1, 19)];
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
      .mockRejectedValueOnce({ response: { status: 500, data: { message: 'reset failed' } } })
      .mockResolvedValueOnce(spacePage(
        resetPage,
        21,
        { revision: 'revision-2', nextCursor: 'cursor-2', hasMore: true },
      ));
    vi.mocked(api.delete).mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    await screen.findByText('空间 0');
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(await screen.findByText('空间加载失败')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByRole('heading', { name: externalSpace.name });

    expect(api.get).toHaveBeenNthCalledWith(3, '/spaces', { params: { take: 20 } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent))
      .toEqual(resetPage.map((space) => space.name));
    expect(screen.queryByRole('heading', { name: '空间 19' })).not.toBeInTheDocument();
    expect(screen.queryByText('空间加载失败')).not.toBeInTheDocument();
  });

  it('keeps a concurrent deletion failure visible when the current list request later succeeds', async () => {
    const loadMore = deferred<any>();
    vi.mocked(api.get)
      .mockResolvedValueOnce(spacePage(spaces, 22, { nextCursor: 'cursor-1', hasMore: true }))
      .mockReturnValueOnce(loadMore.promise);
    vi.mocked(api.delete).mockRejectedValue({ response: { status: 500, data: { message: 'delete failed' } } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderDashboard();

    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(await screen.findByText('空间删除失败')).toBeInTheDocument();

    await act(async () => {
      loadMore.resolve(spacePage(
        [{ id: 'space-20', name: '空间 20', slug: 'space-20' }],
        21,
        { revision: 'revision-1', nextCursor: null, hasMore: false },
      ));
      await Promise.resolve();
    });

    expect(screen.getByText('空间删除失败')).toBeInTheDocument();
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

  it.each(['backdrop', 'close button', 'cancel button'] as const)(
    'keeps the dialog and eventual failure visible when the POST is pending and %s is used',
    async (dismissMethod) => {
      const create = deferred<any>();
      vi.mocked(api.post).mockReturnValue(create.promise);
      renderDashboard();
      await screen.findByText('空间 0');

      fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
      const dialog = screen.getByRole('dialog', { name: '创建新空间' });
      fireEvent.change(within(dialog).getByPlaceholderText('例如：我的知识库'), { target: { value: '失败空间' } });
      fireEvent.click(within(dialog).getByRole('button', { name: '创建' }));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));

      if (dismissMethod === 'backdrop') fireEvent.click(dialog.parentElement as HTMLElement);
      if (dismissMethod === 'close button') fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }));
      if (dismissMethod === 'cancel button') fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

      await act(async () => {
        create.reject({ response: { status: 500, data: { message: 'raw server failure' } } });
        await Promise.resolve();
      });

      const pendingDialog = screen.getByRole('dialog', { name: '创建新空间' });
      expect(within(pendingDialog).getByRole('alert')).toHaveTextContent('空间创建失败');
      expect(screen.queryByText('raw server failure')).not.toBeInTheDocument();
    },
  );

  it('associates the visible labels with the name and description fields', async () => {
    renderDashboard();
    await screen.findByText('空间 0');
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));

    expect(screen.getByLabelText('名称 *')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('描述').tagName).toBe('TEXTAREA');
  });

  it('keeps card actions visible on touch and reveals them for keyboard focus', async () => {
    renderDashboard();
    await screen.findByText('空间 0');

    const actions = screen.getAllByRole('link', { name: '图谱' })[0].parentElement;
    expect(actions).toHaveClass('opacity-100');
    expect(actions).toHaveClass('sm:opacity-0');
    expect(actions).toHaveClass('sm:group-focus-within:opacity-100');
  });

  it('closes on Escape and restores focus to the opener', async () => {
    renderDashboard();
    await screen.findByText('空间 0');
    const opener = screen.getByRole('button', { name: '新建空间' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: '创建新空间' });

    fireEvent.keyDown(dialog, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '创建新空间' })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('wraps reverse Tab focus inside the modal', async () => {
    renderDashboard();
    await screen.findByText('空间 0');
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));
    const dialog = screen.getByRole('dialog', { name: '创建新空间' });
    const close = within(dialog).getByRole('button', { name: '关闭' });
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    close.focus();

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });

    expect(cancel).toHaveFocus();
  });

  it('makes the background inert while the modal is open', async () => {
    renderDashboard();
    const dashboardHeading = await screen.findByRole('heading', { name: '我的知识空间' });
    fireEvent.click(screen.getByRole('button', { name: '新建空间' }));

    expect(dashboardHeading.closest('[inert]')).not.toBeNull();
  });
});
