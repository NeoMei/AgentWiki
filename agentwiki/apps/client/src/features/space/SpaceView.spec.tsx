import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { SpaceView } from './SpaceView';

const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { user: { id: 'user-1', platformRole: 'user' } as { id: string; platformRole: string } },
}));

vi.mock('../../api/client', () => ({ default: mocks.api }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));

const emptyCatalog = {
  system: [],
  space: [],
  totalSpace: 0,
  skip: 0,
  take: 100,
  capabilities: { canManage: false },
};

const renderSpaceView = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/spaces/space-1']}>
      <Routes>
        <Route path="/spaces/:id" element={<SpaceView />} />
        <Route path="/pages/:pageId/edit" element={<h1>Editing created page</h1>} />
      </Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

describe('SpaceView new-page flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.auth.user = { id: 'user-1', platformRole: 'user' };
  });

  it.each([
    ['owner', true],
    ['admin', false],
    ['editor', true],
    ['viewer', false],
  ] as const)('shows the new-page trigger for %s according to live Space membership', async (role, visible) => {
    mocks.api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
      ? { data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role }] } }
      : { data: [] });
    renderSpaceView();

    await screen.findByRole('heading', { name: 'Role Space' });
    expect(screen.queryByRole('button', { name: '新建页面' }) !== null).toBe(visible);
  });

  it('shows the new-page trigger to a platform super admin without membership', async () => {
    mocks.auth.user = { id: 'super-1', platformRole: 'super_admin' };
    mocks.api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
      ? { data: { id: 'space-1', name: 'Admin Space', members: [] } }
      : { data: [] });
    renderSpaceView();

    await screen.findByRole('heading', { name: 'Admin Space' });
    expect(screen.getByRole('button', { name: '新建页面' })).toBeInTheDocument();
  });

  it('opens the two-step dialog and preserves navigation to the created page editor', async () => {
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') {
        return { data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role: 'owner' }] } };
      }
      if (url === '/pages/hierarchy/space-1') return { data: [] };
      if (url === '/spaces/space-1/page-templates') return { data: emptyCatalog };
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.api.post.mockResolvedValue({ data: { id: 'page-new' } });
    renderSpaceView();

    fireEvent.click(await screen.findByRole('button', { name: '新建页面' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Created page' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledWith('/pages', {
      title: 'Created page',
      spaceId: 'space-1',
    }));
    expect(await screen.findByRole('heading', { name: 'Editing created page' })).toBeInTheDocument();
  });
});
