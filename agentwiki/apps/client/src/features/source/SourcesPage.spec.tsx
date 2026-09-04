import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { SourcesPage } from './SourcesPage';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

const renderPage = () => render(
  <MemoryRouter initialEntries={['/spaces/space-1/sources']}>
    <LanguageProvider><Routes><Route path="/spaces/:id/sources" element={<SourcesPage />} /></Routes></LanguageProvider>
  </MemoryRouter>,
);

const SpaceSwitcher = () => {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/spaces/space-2/sources')}>切换空间</button>;
};

describe('SourcesPage file upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('shows an explicit selected file and upload button', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '添加来源' }));
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
    fireEvent.click(screen.getByRole('button', { name: '添加来源' }));
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
    vi.mocked(api.get).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [] });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('网络连接失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.get).toHaveBeenCalledTimes(2);
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
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
