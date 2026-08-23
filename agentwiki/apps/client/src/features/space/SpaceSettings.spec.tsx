import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { SpaceSettings } from './SpaceSettings';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('../../api/client', () => ({ default: api }));
vi.mock('../../components/SpaceNav', () => ({ SpaceNav: () => <div>Space navigation</div> }));

const graphSettings = {
  wikilinkEnabled: true,
  similarEnabled: false,
  similarThreshold: 0.86,
  llmEnabled: false,
};

const renderSettings = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
      <Routes>
        <Route path='/spaces/:id/settings' element={<SpaceSettings />} />
      </Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

const NavigableSettings = () => {
  const navigate = useNavigate();
  return <>
    <button type='button' onClick={() => navigate('/spaces/space-2/settings')}>Switch space</button>
    <SpaceSettings />
  </>;
};

describe('SpaceSettings auto graph card', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    vi.clearAllMocks();
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: {
          name: 'Docs', description: '', approvalPolicy: 'always-review',
        } });
      }
      if (url === '/spaces/space-1/graph/settings') {
        return Promise.resolve({ data: graphSettings });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('patches graph settings and runs a manual refresh', async () => {
    api.patch.mockResolvedValue({ data: { ...graphSettings, similarEnabled: true } });
    api.post.mockResolvedValue({ data: {
      wikilink: { created: 2, removed: 1, dangling: 0 },
      similar: { created: 1, removed: 0, skipped: 0 },
      llm: { changeSetId: null, proposed: 0 },
    } });
    renderSettings();

    fireEvent.click(await screen.findByRole('checkbox', { name: /相似度建议/ }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/spaces/space-1/graph/settings',
      { ...graphSettings, similarEnabled: true },
    ));

    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(await screen.findByText(/链接 \+2\/-1/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/graph/refresh', {});
  });

  it('shows a retryable error instead of silently hiding the card', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: {
          name: 'Docs', description: '', approvalPolicy: 'always-review',
        } });
      }
      return Promise.reject(new Error('offline'));
    });
    renderSettings();

    expect(await screen.findByText('图谱设置加载失败')).toBeInTheDocument();

    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: {
          name: 'Docs', description: '', approvalPolicy: 'always-review',
        } });
      }
      return Promise.resolve({ data: graphSettings });
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeInTheDocument();
  });

  it('clears the previous space graph settings while a new space loads', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1' || url === '/spaces/space-2') {
        return Promise.resolve({ data: {
          name: 'Docs', description: '', approvalPolicy: 'always-review',
        } });
      }
      if (url === '/spaces/space-1/graph/settings') {
        return Promise.resolve({ data: graphSettings });
      }
      if (url === '/spaces/space-2/graph/settings') {
        return new Promise(() => undefined);
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
          <Routes>
            <Route path='/spaces/:id/settings' element={<NavigableSettings />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    expect(await screen.findByText('正在加载图谱设置…')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Wiki 链接提取/ })).not.toBeInTheDocument();
  });

  it('explains the complete Publisher auto-publish gate in Chinese', async () => {
    renderSettings();

    expect(await screen.findByText(/Publisher Space 授权和 Space 发布策略同时允许/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/编辑权限和匹配的写入 Scope/);
  });

  it('explains the complete Publisher auto-publish gate in English', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    renderSettings();

    expect(await screen.findByText(/Publisher Space authorization and Space publishing policy both permit/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/editor grant and matching write scope/i);
  });
});
