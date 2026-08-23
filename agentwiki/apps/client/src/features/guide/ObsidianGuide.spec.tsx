import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../context/LanguageContext';
import { ObsidianGuide } from './ObsidianGuide';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ token: 'signed-in' }) }));
vi.mock('../../api/client', () => ({ default: apiMock }));

describe('ObsidianGuide availability', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    apiMock.get.mockResolvedValue({ data: { credentials: [] } });
    apiMock.post.mockResolvedValue({
      data: { code: 'AW-TEST-CODE', expiresAt: new Date(Date.now() + 600_000).toISOString() },
    });
  });

  it('states that community review is pending and gives exact manual files', () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);
    expect(screen.getByText('社区市场审核中')).toBeInTheDocument();
    expect(screen.getByText(/main\.js.*manifest\.json.*styles\.css/)).toBeInTheDocument();
    expect(screen.getByText(/\.obsidian\/plugins\/agentwiki-sync\//)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '下载最新 Release' })).toHaveAttribute(
      'href', 'https://github.com/NeoMei/agentwiki-sync/releases/latest',
    );
  });

  it('keeps installation, code generation, and device management on the same page', async () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '生成连接码' })).toBeInTheDocument();
    expect(screen.getByText('已连接设备')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '打开集成管理' })).not.toBeInTheDocument();
  });

  it('shows the API base URL required by the local sync client after generating a code', async () => {
    render(<MemoryRouter><LanguageProvider><ObsidianGuide /></LanguageProvider></MemoryRouter>);

    fireEvent.click(await screen.findByRole('button', { name: '生成连接码' }));

    expect(await screen.findByText(`2. 服务器地址：${window.location.origin}/api`)).toBeInTheDocument();
  });
});
