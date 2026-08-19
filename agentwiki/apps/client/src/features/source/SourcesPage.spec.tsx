import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { SourcesPage } from './SourcesPage';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

describe('SourcesPage file upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
  });

  it('shows an explicit selected file and upload button', async () => {
    render(
      <MemoryRouter initialEntries={['/spaces/space-1/sources']}>
        <LanguageProvider><Routes><Route path="/spaces/:id/sources" element={<SourcesPage />} /></Routes></LanguageProvider>
      </MemoryRouter>,
    );
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
});
