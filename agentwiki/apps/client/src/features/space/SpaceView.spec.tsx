import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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

const spaceResponse = (id: string, name: string, role: 'owner' | 'admin' | 'editor' | 'viewer') => ({
  data: {
    id,
    name,
    description: '',
    members: [{ userId: 'user-1', role }],
  },
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

const renderNavigableSpaceView = () => {
  let navigate!: ReturnType<typeof useNavigate>;
  const Harness = () => {
    navigate = useNavigate();
    return <SpaceView />;
  };
  const result = render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/spaces/space-a']}>
        <Routes>
          <Route path="/spaces/:id" element={<Harness />} />
          <Route path="/pages/:pageId/edit" element={<h1>Editing created page</h1>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
  return {
    ...result,
    navigateTo: (spaceId: string) => act(() => navigate(`/spaces/${spaceId}`)),
  };
};

const mockNavigableGets = (spaceRequests: Record<string, Promise<ReturnType<typeof spaceResponse>>>) => {
  mocks.api.get.mockImplementation((url: string) => {
    const spaceMatch = /^\/spaces\/([^/]+)$/.exec(url);
    if (spaceMatch) {
      const request = spaceRequests[spaceMatch[1]];
      if (!request) return Promise.reject(new Error(`Unexpected Space GET ${url}`));
      return request;
    }
    if (url.startsWith('/pages/hierarchy/')) return Promise.resolve({ data: [] });
    if (/^\/spaces\/[^/]+\/page-templates$/.test(url)) return Promise.resolve({ data: emptyCatalog });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
};

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

  it('removes owner authorization immediately while a viewer Space route is loading', async () => {
    const viewerB = deferred<ReturnType<typeof spaceResponse>>();
    mockNavigableGets({
      'space-a': Promise.resolve(spaceResponse('space-a', 'Owner A', 'owner')),
      'space-b': viewerB.promise,
    });
    const { navigateTo } = renderNavigableSpaceView();
    expect(await screen.findByRole('button', { name: '新建页面' })).toBeInTheDocument();

    navigateTo('space-b');

    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('加载中…')).toBeInTheDocument();
    await act(async () => viewerB.resolve(spaceResponse('space-b', 'Viewer B', 'viewer')));
    expect(await screen.findByRole('heading', { name: 'Viewer B' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();
  });

  it('grants create authorization only after the owner Space route resolves', async () => {
    const ownerB = deferred<ReturnType<typeof spaceResponse>>();
    mockNavigableGets({
      'space-a': Promise.resolve(spaceResponse('space-a', 'Viewer A', 'viewer')),
      'space-b': ownerB.promise,
    });
    const { navigateTo } = renderNavigableSpaceView();
    await screen.findByRole('heading', { name: 'Viewer A' });
    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();

    navigateTo('space-b');
    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();
    await act(async () => ownerB.resolve(spaceResponse('space-b', 'Owner B', 'owner')));

    expect(await screen.findByRole('heading', { name: 'Owner B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建页面' })).toBeInTheDocument();
  });

  it('ignores an old Space response that resolves after the current route', async () => {
    const oldA = deferred<ReturnType<typeof spaceResponse>>();
    const currentB = deferred<ReturnType<typeof spaceResponse>>();
    mockNavigableGets({ 'space-a': oldA.promise, 'space-b': currentB.promise });
    const { navigateTo } = renderNavigableSpaceView();

    navigateTo('space-b');
    await act(async () => currentB.resolve(spaceResponse('space-b', 'Current Viewer B', 'viewer')));
    expect(await screen.findByRole('heading', { name: 'Current Viewer B' })).toBeInTheDocument();
    await act(async () => oldA.resolve(spaceResponse('space-a', 'Late Owner A', 'owner')));

    expect(screen.getByRole('heading', { name: 'Current Viewer B' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Late Owner A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();
  });

  it('closes an old dialog on route change and creates only against the newly loaded Space', async () => {
    const ownerB = deferred<ReturnType<typeof spaceResponse>>();
    mockNavigableGets({
      'space-a': Promise.resolve(spaceResponse('space-a', 'Owner A', 'owner')),
      'space-b': ownerB.promise,
    });
    mocks.api.post.mockResolvedValue({ data: { id: 'page-new' } });
    const { navigateTo } = renderNavigableSpaceView();
    fireEvent.click(await screen.findByRole('button', { name: '新建页面' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    navigateTo('space-b');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建页面' })).not.toBeInTheDocument();
    expect(mocks.api.post).not.toHaveBeenCalled();
    await act(async () => ownerB.resolve(spaceResponse('space-b', 'Owner B', 'owner')));
    fireEvent.click(await screen.findByRole('button', { name: '新建页面' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'B page' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledWith('/pages', {
      title: 'B page',
      spaceId: 'space-b',
    }));
  });
});
