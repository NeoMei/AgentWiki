import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { PageVersionHistory } from './PageVersionHistory';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const NavigationHarness = () => {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/pages/page-2/versions')}>Open second history</button>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </>
  );
};

describe('PageVersionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
      ? { data: [{ id: 'v1', title: '旧版本', content: '# 旧标题\n\n旧正文\n\n- [ ] 历史任务', createdAt: '2026-08-19T00:00:00Z' }] }
      : { data: { id: 'page-1', title: '当前页面', spaceId: 'space-1', capabilities: { canEdit: false } } });
  });

  it('previews a historical Markdown version without restoring it', async () => {
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '预览 v1' }));
    expect(screen.getByRole('heading', { name: '旧标题' })).toBeInTheDocument();
    expect(screen.getByText('旧正文')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(screen.queryByText('旧正文')).not.toBeInTheDocument();
  });

  it('offers Restore to an editor while keeping historical tasks immutable', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => url.endsWith('/versions')
      ? { data: [{ id: 'v1', title: '旧版本', content: '- [ ] 历史任务', createdAt: '2026-08-19T00:00:00Z' }] }
      : { data: { id: 'page-1', title: '当前页面', spaceId: 'space-1', capabilities: { canEdit: true } } });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <Routes><Route path="/pages/:id/versions" element={<PageVersionHistory />} /></Routes>
    </LanguageProvider></MemoryRouter>);

    expect(await screen.findByRole('button', { name: '恢复' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览 v1' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();

    fireEvent.click(checkbox);

    expect(checkbox).not.toBeChecked();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('ignores stale page and capability responses after a version-history route switch', async () => {
    const stalePage = deferred<any>();
    const staleVersions = deferred<any>();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-1') return stalePage.promise;
      if (url === '/pages/page-1/versions') return staleVersions.promise;
      if (url === '/pages/page-2') {
        return { data: { id: 'page-2', title: 'Second page', spaceId: 'space-2', capabilities: { canEdit: false } } };
      }
      if (url === '/pages/page-2/versions') {
        return { data: [{ id: 'v2', title: 'Second version', content: '- [ ] second task', createdAt: '2026-08-20T00:00:00Z' }] };
      }
      throw new Error(`unexpected get ${url}`);
    });
    render(<MemoryRouter initialEntries={['/pages/page-1/versions']}><LanguageProvider>
      <NavigationHarness />
    </LanguageProvider></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: 'Open second history' }));
    expect(await screen.findByText('Second version')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();

    await act(async () => {
      stalePage.resolve({ data: { id: 'page-1', title: 'First page', spaceId: 'space-1', capabilities: { canEdit: true } } });
      staleVersions.resolve({ data: [{ id: 'v1', title: 'Stale first version', content: '- [ ] first task', createdAt: '2026-08-19T00:00:00Z' }] });
      await Promise.all([stalePage.promise, staleVersions.promise]);
    });

    expect(screen.getByText('Second version')).toBeInTheDocument();
    expect(screen.queryByText('Stale first version')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
  });
});
