import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { SourcesPage } from './SourcesPage';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

let members = [{ userId: 'user-1', role: 'editor' }];
const withMembership = () => {
  const implementation = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockImplementation((url, config) => /^\/spaces\/[^/]+$/.test(url)
    ? Promise.resolve({ data: { members } } as any) : implementation(url, config));
};
const renderPage = () => {
  withMembership();
  return render(
  <MemoryRouter initialEntries={['/spaces/space-1/sources']}>
    <LanguageProvider><Routes><Route path="/spaces/:id/sources" element={<SourcesPage />} /></Routes></LanguageProvider>
  </MemoryRouter>,
);
};

const SpaceSwitcher = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/spaces/space-2/sources')}>切换空间</button>;
};

describe('SourcesPage file upload', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    members = [{ userId: 'user-1', role: 'editor' }];
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1', platformRole: 'super_admin' } } as any);
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('keeps a nonmember platform admin read-only while showing source details', async () => {
    members = [];
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'source-1', type: 'text', name: 'Visible source', _count: { versions: 1, runs: 0 } }] });
    renderPage();
    expect(await screen.findByText('Visible source')).toBeVisible();
    expect(screen.queryByRole('button', { name: '添加来源' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行' })).not.toBeInTheDocument();
  });

  it.each(['owner', 'admin', 'editor'])('allows a real %s member to add and run sources', async (role) => {
    members = [{ userId: 'user-1', role }];
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'source-1', type: 'text', name: 'Visible source', _count: { versions: 1, runs: 0 } }] });
    renderPage();
    expect(await screen.findByRole('button', { name: '添加来源' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '运行' })).toBeEnabled();
  });

  it('keeps a viewer membership read-only despite platform admin role', async () => {
    members = [{ userId: 'user-1', role: 'viewer' }];
    renderPage();
    await screen.findByText('还没有知识来源。');
    expect(screen.queryByRole('button', { name: '添加来源' })).not.toBeInTheDocument();
  });

  it('links a failed latest run in source details to the current space run diagnostics', async () => {
    const source = { id: 'git-source', name: 'Repository', type: 'git', status: 'active', _count: { versions: 0, runs: 1 } };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/sources/git-source' ? { ...source, versions: [], runs: [{ id: 'failed', status: 'failed', createdAt: '2026-09-14T00:00:00.000Z' }] } : [source] }));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: /Repository/ }));
    expect(await screen.findByRole('link', { name: '查看失败运行详情' })).toHaveAttribute('href', '/spaces/space-1/runs');
  });

  it.each([['zh-CN', '已启用', '失败'], ['en', 'Active', 'Failed']])('localizes source and run states in %s while preserving the source name', async (locale, state, runState) => {
    localStorage.setItem('agentwiki.language.v1', locale);
    const source = { id: 's', name: 'active / 自定义来源', type: 'git', status: 'active', _count: { versions: 0, runs: 1 } };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/sources/s' ? { ...source, versions: [], runs: [{ status: 'failed', createdAt: '2026-10-01T00:00:00.000Z' }] } : [source] }));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: /active \/ 自定义来源/ }));
    expect(await screen.findByText(state)).toBeVisible();
    expect(screen.getAllByText(new RegExp(runState))[0]).toBeVisible();
    expect(screen.getByText('active / 自定义来源')).toBeVisible();
  });

  it.each([['zh-CN', '已归档', '发布中'], ['en', 'Archived', 'Publishing']])('shows archived source status and publishing run status in %s', async (locale, state, runState) => {
    localStorage.setItem('agentwiki.language.v1', locale);
    const source = { id: 's', name: 'Publisher / 来源名', type: 'git', status: 'archived', _count: { versions: 0, runs: 1 } };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/sources/s' ? { ...source, versions: [], runs: [{ status: 'publishing', createdAt: '2026-10-01T00:00:00.000Z' }] } : [source] }));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: /Publisher \/ 来源名/ }));
    expect(await screen.findByText(state)).toBeVisible();
    expect(screen.getByText(new RegExp(runState))).toBeVisible();
    expect(screen.getByText('Publisher / 来源名')).toBeVisible();
  });

  it('shows an explicit selected file and upload button', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '添加来源' }));
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: 'file' } });
    const file = new File(['# 中文'], '图片内容总结.md', { type: 'text/markdown' });
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
    expect(screen.getByText('图片内容总结.md')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('图片内容总结.md');
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '自定义来源名称' } });
    fireEvent.click(screen.getByRole('button', { name: '上传文件' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/spaces/space-1/sources/file', expect.any(FormData), expect.anything(),
    ));
    const body = vi.mocked(api.post).mock.calls[0][1] as FormData;
    expect(body.get('name')).toBe('自定义来源名称');
  });

  it('submits a new source only once while the first request is pending', async () => {
    const request = deferred<any>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '添加来源' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '一次提交' } });
    fireEvent.change(screen.getByLabelText('粘贴来源文本'), { target: { value: 'content' } });

    const save = screen.getByRole('button', { name: '保存来源' });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    request.resolve({ data: {} });
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存来源' })).not.toBeInTheDocument());
  });

  it('prevents duplicate run requests for the same source', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{
      id: 'source-1', type: 'text', name: '来源一', _count: { versions: 1, runs: 0 },
    }] });
    const request = deferred<any>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    renderPage();
    const run = await screen.findByRole('button', { name: '运行' });

    fireEvent.click(run);
    fireEvent.click(run);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(run).toBeDisabled();
    request.resolve({ data: {} });
    await waitFor(() => expect(run).not.toBeDisabled());
  });

  it('shows a retry action after loading fails and clears the error after recovery', async () => {
    let sourceReads = 0;
    vi.mocked(api.get).mockImplementation(async () => {
      if (++sourceReads === 1) throw new Error('offline');
      return { data: [] };
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('网络连接失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.endsWith('/sources'))).toHaveLength(2);
  });

  it('does not let a completed action from the previous route reload stale Space data', async () => {
    const action = deferred<any>();
    const source = (id: string, name: string) => ({
      id, type: 'text', name, _count: { versions: 1, runs: 0 },
    });
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: String(url).includes('space-2') ? [source('source-2', '空间二来源')] : [source('source-1', '空间一来源')],
    }));
    vi.mocked(api.post).mockReturnValue(action.promise);
    withMembership();
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/sources']}>
        <LanguageProvider><SpaceSwitcher /><Routes><Route path="/spaces/:id/sources" element={<SourcesPage />} /></Routes></LanguageProvider>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '运行' }));
    fireEvent.click(screen.getByRole('button', { name: '切换空间' }));
    expect(await screen.findByText('空间二来源')).toBeInTheDocument();

    await act(async () => action.resolve({ data: {} }));

    expect(screen.getByText('空间二来源')).toBeInTheDocument();
    expect(screen.queryByText('空间一来源')).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.endsWith('/sources'))).toHaveLength(2);
  });
  it('omits Git from new source choices and keeps historical Git sources runnable', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 'git-old', type: 'git', name: 'Historical repository', _count: { versions: 1, runs: 0 } }] });
    renderPage();
    expect(await screen.findByText('Historical repository')).toBeVisible();
    expect(screen.getByRole('button', { name: '运行' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '添加来源' }));
    expect(screen.queryByRole('option', { name: 'Git 仓库' })).not.toBeInTheDocument();
    expect(Array.from((screen.getByLabelText('类型') as HTMLSelectElement).options).map((option) => option.value)).toEqual(['text', 'file', 'url']);
  });

  it('shows a returned source immediately while reconciliation is still pending', async () => {
    const request = deferred<any>();
    const refresh = deferred<any>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    let reads = 0;
    vi.mocked(api.get).mockImplementation(() => ++reads === 1 ? Promise.resolve({ data: [] }) : refresh.promise);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '添加来源' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Created source' } });
    fireEvent.change(screen.getByLabelText('粘贴来源文本'), { target: { value: 'content' } });
    fireEvent.click(screen.getByRole('button', { name: '保存来源' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在保存来源');
    await act(async () => request.resolve({ data: { id: 'created', name: 'Created source', type: 'text', versions: [{ id: 'v' }] } }));
    expect(screen.getByText('Created source')).toBeVisible();
    expect(screen.getByRole('button', { name: '添加来源' })).toBeEnabled();
    expect(screen.queryByText('正在保存来源…')).not.toBeInTheDocument();
    expect(screen.getByText('加载中…')).toBeVisible();
    await act(async () => refresh.resolve({ data: [{ id: 'created', name: 'Created source', type: 'text', _count: { versions: 1, runs: 0 } }] }));
  });

  it('shows queued feedback from the run response and polls own results until terminal', async () => {
    const source = { id: 'source-1', name: 'Own source', type: 'text', status: 'active', _count: { versions: 1, runs: 0 } };
    const run = { id: 'run-1', sourceId: 'source-1', spaceId: 'space-1', status: 'queued', stage: 'queued', createdAt: '2026-10-01T00:00:00Z' };
    let terminal = false;
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/sources/source-1'
      ? { ...source, versions: [], runs: [terminal ? { ...run, status: 'completed', stage: 'completed', result: { chunks: 2, pages: 1, changeItems: 1 }, artifacts: [{ id: 'artifact-1', type: 'compiled_page' }], changeSet: { id: 'cs-1', status: 'pending_review' } } : run] }
      : [source] }));
    const request = deferred<any>();
    vi.mocked(api.post).mockReturnValue(request.promise);
    const view = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '运行' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在提交运行');
    vi.useFakeTimers();
    await act(async () => request.resolve({ data: run }));
    expect(screen.getByText('排队中')).toBeVisible();
    terminal = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('已完成')).toBeVisible();
    expect(screen.getByText(/文本片段: 2/)).toBeVisible();
    expect(screen.getByText('编译页面')).toBeVisible();
    expect(screen.getByRole('link', { name: /^审核/ })).toHaveAttribute('href', '/review?changeSet=cs-1');
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url.startsWith('/runs/'))).toBe(false);
    const reads = vi.mocked(api.get).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(vi.mocked(api.get).mock.calls).toHaveLength(reads);
    view.unmount();
  });

  it('ignores an older same-space detail selection response', async () => {
    const first = deferred<any>();
    const sources = ['first', 'second'].map((id) => ({ id, name: id, type: 'text', status: 'active', _count: { versions: 0, runs: 0 } }));
    vi.mocked(api.get).mockImplementation(async (url) => url === '/sources/first' ? first.promise : { data: url === '/sources/second' ? { ...sources[1], uri: 'https://second.example', versions: [], runs: [] } : sources });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /first/ }));
    fireEvent.click(screen.getByRole('button', { name: /second/ }));
    expect(await screen.findByText((_, node) => node?.tagName === 'P' && !!node.textContent?.includes('https://second.example'))).toBeVisible();
    await act(async () => first.resolve({ data: { ...sources[0], uri: 'https://first.example', versions: [], runs: [] } }));
    expect(screen.queryByText((_, node) => node?.tagName === 'P' && !!node.textContent?.includes('https://first.example'))).not.toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.tagName === 'P' && !!node.textContent?.includes('https://second.example'))).toBeVisible();
  });

  it.each([
    ['zh-CN', 'pending_review', '待审核'], ['zh-CN', 'approved', '已批准'], ['zh-CN', 'published', '已发布'], ['zh-CN', 'reverted', '已回滚'],
    ['en', 'pending_review', 'Pending review'], ['en', 'approved', 'Approved'], ['en', 'published', 'Published'], ['en', 'reverted', 'Reverted'],
  ])('renders the source review link status %s/%s', async (language, status, label) => {
    localStorage.setItem('agentwiki.language.v1', language);
    const source = { id: 's', name: 'Reviewed source', type: 'text', status: 'active', _count: { versions: 0, runs: 1 } };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/sources/s'
      ? { ...source, versions: [], runs: [{ id: 'r', status: 'completed', createdAt: '2026-10-01T00:00:00Z', changeSet: { id: 'cs', status } }] }
      : [source] }));
    renderPage(); fireEvent.click(await screen.findByRole('button', { name: /Reviewed source/ }));
    expect(await screen.findByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', '/review?changeSet=cs');
  });

});
