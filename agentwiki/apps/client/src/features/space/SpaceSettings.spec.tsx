import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../context/AuthContext';
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
const spaceSettings = {
  name: 'Docs', description: '', approvalPolicy: 'always-review',
  members: [{ userId: 'user-1', role: 'owner' }],
};

const renderSettings = () => render(
  <AuthProvider>
    <LanguageProvider>
      <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
        <Routes>
          <Route path='/spaces/:id/settings' element={<SpaceSettings />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>
  </AuthProvider>,
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
    localStorage.setItem('user', JSON.stringify({ id: 'user-1', platformRole: 'user' }));
    vi.clearAllMocks();
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: spaceSettings });
      }
      if (url === '/spaces/space-1/graph/settings') {
        return Promise.resolve({ data: graphSettings });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  it('patches graph settings and runs a manual refresh', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: spaceSettings });
      }
      if (url === '/spaces/space-1/graph/settings') {
        return Promise.resolve({ data: { ...graphSettings, lastRunAt: '2026-08-23T14:00:00.000Z' } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
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
      { similarEnabled: true },
    ));
    expect(await screen.findByText('已保存')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '立即刷新' }));
    expect(await screen.findByText(/链接 \+2\/-1/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/spaces/space-1/graph/refresh', {});
  });

  it('restores the last confirmed threshold when saving fails', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') return Promise.resolve({ data: spaceSettings });
      if (url === '/spaces/space-1/graph/settings') {
        return Promise.resolve({ data: { ...graphSettings, similarEnabled: true } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    api.patch.mockRejectedValue(new Error('offline'));
    renderSettings();

    const threshold = await screen.findByRole('spinbutton', { name: '相似度阈值' });
    fireEvent.change(threshold, { target: { value: '0.72' } });
    fireEvent.blur(threshold);

    expect(await screen.findByText('保存失败')).toBeInTheDocument();
    expect(threshold).toHaveValue(0.86);
  });

  it('uses the confirmed Space response and clears Saved after another edit', async () => {
    api.patch.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: { name: 'Renamed', description: '', approvalPolicy: 'always-review' } });
      }
      return Promise.reject(new Error(`Unexpected PATCH ${url}`));
    });
    renderSettings();

    const name = await screen.findByLabelText('名称');
    fireEvent.change(name, { target: { value: '  Renamed  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText('已保存')).toBeInTheDocument();
    expect(name).toHaveValue('Renamed');

    fireEvent.change(name, { target: { value: 'Draft' } });
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('shows a retryable error instead of silently hiding the card', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: spaceSettings });
      }
      return Promise.reject(new Error('offline'));
    });
    renderSettings();

    expect(await screen.findByText('图谱设置加载失败')).toBeInTheDocument();

    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: spaceSettings });
      }
      return Promise.resolve({ data: graphSettings });
    });
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeInTheDocument();
  });

  it('clears the previous space graph settings while a new space loads', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1' || url === '/spaces/space-2') {
        return Promise.resolve({ data: spaceSettings });
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
      <AuthProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
            <Routes>
              <Route path='/spaces/:id/settings' element={<NavigableSettings />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    expect(await screen.findByText('正在加载图谱设置…')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Wiki 链接提取/ })).not.toBeInTheDocument();
  });

  it('clears the previous Space and its permissions while the next Space loads', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') return Promise.resolve({ data: spaceSettings });
      if (url === '/spaces/space-1/graph/settings' || url === '/spaces/space-2/graph/settings') {
        return Promise.resolve({ data: graphSettings });
      }
      if (url === '/spaces/space-2') return new Promise(() => undefined);
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    render(
      <AuthProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
            <Routes>
              <Route path='/spaces/:id/settings' element={<NavigableSettings />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));

    expect(await screen.findByText('正在加载设置…')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Wiki 链接提取/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
  });

  it('ignores a completed save from the Space visited before navigation', async () => {
    let finishOldSave: (value: unknown) => void = () => undefined;
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') return Promise.resolve({ data: spaceSettings });
      if (url === '/spaces/space-2') return Promise.resolve({ data: { ...spaceSettings, name: 'Space Two' } });
      if (url.endsWith('/graph/settings')) return Promise.resolve({ data: graphSettings });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    api.patch.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return new Promise((resolve) => {
          finishOldSave = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected PATCH ${url}`));
    });
    render(
      <AuthProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/spaces/space-1/settings']}>
            <Routes>
              <Route path='/spaces/:id/settings' element={<NavigableSettings />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </AuthProvider>,
    );
    const name = await screen.findByLabelText('名称');
    fireEvent.change(name, { target: { value: 'Old draft' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    fireEvent.click(screen.getByRole('button', { name: 'Switch space' }));
    expect(await screen.findByLabelText('名称')).toHaveValue('Space Two');
    await act(async () => {
      finishOldSave({ data: { name: 'Old normalized', description: '', approvalPolicy: 'always-review' } });
    });

    expect(screen.getByLabelText('名称')).toHaveValue('Space Two');
    expect(screen.queryByText('已保存')).not.toBeInTheDocument();
  });

  it('renders automatic graph controls read-only when the current member cannot manage them', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/spaces/space-1') {
        return Promise.resolve({ data: {
          ...spaceSettings,
          members: [{ userId: 'user-1', role: 'editor' }],
        } });
      }
      if (url === '/spaces/space-1/graph/settings') return Promise.resolve({ data: graphSettings });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    renderSettings();

    expect(await screen.findByRole('checkbox', { name: /Wiki 链接提取/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '立即刷新' })).toBeDisabled();
    expect(screen.getByText('只有空间 Owner 或 Admin 可以修改和刷新。')).toBeInTheDocument();
    const form = screen.getByRole('button', { name: '保存设置' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(api.patch).not.toHaveBeenCalled();
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
