import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Router, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { SpaceView } from './SpaceView';
import type { ContentTreeNode } from '../content-tree/contentTreeTypes';

const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  auth: { user: { id: 'user-1', platformRole: 'user' } as { id: string; platformRole: string } },
  getContentTreeRevision: vi.fn(),
  listCompositeTemplates: vi.fn(),
}));

vi.mock('../page-templates/PageAgentBindingDialog', () => ({
  PageAgentBindingDialog: ({ scope, onClose }: { scope: { kind: string; title?: string; name?: string }; onClose: () => void }) => (
    <div role="dialog">Binding {scope.kind}: {scope.title ?? scope.name}<button type="button" onClick={onClose}>Close binding</button></div>
  ),
}));

vi.mock('../page-templates/SaveFolderAsTemplateDialog', () => ({
  SaveFolderAsTemplateDialog: ({ folderName, onClose }: { folderName: string; onClose: () => void }) => (
    <div role="dialog">Save folder template: {folderName}<button type="button" onClick={onClose}>Close template save</button></div>
  ),
}));

vi.mock('../../api/client', () => ({ default: mocks.api }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: mocks.getContentTreeRevision }));
vi.mock('../page-templates/compositeTemplateApi', () => ({
  listCompositeTemplates: mocks.listCompositeTemplates,
}));

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

const treeResponse = (spaceId: string, nodes: ContentTreeNode[] = []) => ({
  data: {
    spaceId,
    treeRevision: '7',
    parentFolderId: null,
    data: nodes,
    nextCursor: null,
  },
});

const pageNode = (id: string, title: string): ContentTreeNode => ({
  kind: 'page',
  id,
  folderId: null,
  title,
  path: '/' + title,
  sortOrder: 0,
  createdAt: '2026-08-28T09:00:00.000Z',
  updatedAt: '2026-08-28T10:00:00.000Z',
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

const renderCommitNavigableSpaceView = async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const navigator = {
    createHref: () => '', encodeLocation: (value: unknown) => value,
    go: () => undefined, push: () => undefined, replace: () => undefined,
  } as any;
  const view = (pathname: string) => (
    <LanguageProvider>
      <Router location={pathname} navigator={navigator}>
        <Routes><Route path="/spaces/:id" element={<SpaceView />} /></Routes>
      </Router>
    </LanguageProvider>
  );
  await act(async () => root.render(view('/spaces/space-a')));
  return {
    commitNavigateTo: (spaceId: string) => flushSync(() => root.render(view(`/spaces/${spaceId}`))),
    dispose: () => {
      act(() => root.unmount());
      container.remove();
    },
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
    const treeMatch = /^\/spaces\/([^/]+)\/content-tree$/.exec(url);
    if (treeMatch) return Promise.resolve(treeResponse(treeMatch[1]));
    if (/^\/spaces\/[^/]+\/page-templates$/.test(url)) return Promise.resolve({ data: emptyCatalog });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
};

describe('SpaceView new-page flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContentTreeRevision.mockResolvedValue('43');
    mocks.listCompositeTemplates.mockResolvedValue({
      data: [], total: 0, skip: 0, take: 1,
      capabilities: { canManage: true, canCreate: true },
    });
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    mocks.auth.user = { id: 'user-1', platformRole: 'user' };
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['editor', true],
    ['viewer', false],
  ] as const)('shows the new-page trigger for %s according to live Space membership', async (role, visible) => {
    mocks.api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
      ? { data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role }] } }
      : treeResponse('space-1'));
    renderSpaceView();

    await screen.findByRole('heading', { name: 'Role Space' });
    expect(screen.queryByRole('button', { name: '新建页面' }) !== null).toBe(visible);
  });

  it('shows the new-page trigger to a platform super admin without membership', async () => {
    mocks.auth.user = { id: 'super-1', platformRole: 'super_admin' };
    mocks.api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
      ? { data: { id: 'space-1', name: 'Admin Space', members: [] } }
      : treeResponse('space-1'));
    renderSpaceView();

    await screen.findByRole('heading', { name: 'Admin Space' });
    expect(screen.getByRole('button', { name: '新建页面' })).toBeInTheDocument();
  });

  it('opens the two-step dialog and preserves navigation to the created page editor', async () => {
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') {
        return { data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role: 'owner' }] } };
      }
      if (url === '/spaces/space-1/content-tree') return treeResponse('space-1');
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
      folderId: null,
      expectedTreeRevision: '43',
    }));
    expect(await screen.findByRole('heading', { name: 'Editing created page' })).toBeInTheDocument();
  });

  it('opens late-binding settings for an existing Page and Folder', async () => {
    const folder: ContentTreeNode = {
      kind: 'folder', id: 'folder-1', name: 'Project', path: '/Project', sortOrder: 0,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: true,
    };
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') return spaceResponse('space-1', 'Role Space', 'owner');
      if (url === '/spaces/space-1/content-tree') return treeResponse('space-1', [folder, pageNode('page-1', 'Brief')]);
      throw new Error(`Unexpected GET ${url}`);
    });
    renderSpaceView();

    fireEvent.click(await screen.findByTestId('content-agent-page-1'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Binding page: Brief');
    fireEvent.click(screen.getByRole('button', { name: 'Close binding' }));
    fireEvent.click(screen.getByTestId('content-agent-folder-1'));
    expect(screen.getByRole('dialog')).toHaveTextContent('Binding folder: Project');
  });

  it('keeps ordinary Page creation but hides composite binding and Folder-template writes when rollout is off', async () => {
    const folder: ContentTreeNode = {
      kind: 'folder', id: 'folder-1', name: 'Project', path: '/Project', sortOrder: 0,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: true,
    };
    mocks.listCompositeTemplates.mockResolvedValue({
      data: [], total: 0, skip: 0, take: 1,
      capabilities: { canManage: true, canCreate: false },
    });
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') return spaceResponse('space-1', 'Role Space', 'owner');
      if (url === '/spaces/space-1/content-tree') {
        return treeResponse('space-1', [folder, pageNode('page-1', 'Brief')]);
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    renderSpaceView();

    expect(await screen.findByRole('button', { name: '新建页面' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.listCompositeTemplates).toHaveBeenCalledWith('space-1', {
      locale: 'zh-CN', take: 1,
    }));
    expect(screen.queryByTestId('content-agent-page-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-agent-folder-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('content-save-template-folder-1')).not.toBeInTheDocument();
  });

  it.each([
    ['owner', true],
    ['admin', true],
    ['editor', false],
    ['viewer', false],
  ] as const)('shows Folder template saving for %s according to template-management permission', async (role, visible) => {
    const folder: ContentTreeNode = {
      kind: 'folder', id: 'folder-1', name: 'Project', path: '/Project', sortOrder: 0,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: true,
    };
    mocks.api.get.mockImplementation(async (url: string) => url === '/spaces/space-1'
      ? spaceResponse('space-1', 'Role Space', role)
      : treeResponse('space-1', [folder]));
    renderSpaceView();

    await screen.findByRole('heading', { name: 'Role Space' });
    const opener = screen.queryByTestId('content-save-template-folder-1');
    expect(opener !== null).toBe(visible);
    if (opener) {
      fireEvent.click(opener);
      expect(screen.getByRole('dialog')).toHaveTextContent('Save folder template: Project');
    }
  });

  it('archives a page with the page and tree compare-and-swap tokens in the DELETE body', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') return {
        data: { id: 'space-1', name: 'Role Space', members: [{ userId: 'user-1', role: 'owner' }] },
      };
      if (url === '/spaces/space-1/content-tree') return treeResponse('space-1', [pageNode('page-1', 'Delete me')]);
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.api.delete.mockResolvedValue({ data: {} });
    renderSpaceView();

    fireEvent.click(await screen.findByTestId('content-deletepage-page-1'));

    await waitFor(() => expect(mocks.api.delete).toHaveBeenCalledWith('/pages/page-1', {
      data: {
        expectedUpdatedAt: '2026-08-28T10:00:00.000Z',
        expectedTreeRevision: '43',
      },
    }));
    expect(mocks.getContentTreeRevision).toHaveBeenCalledWith('space-1', expect.any(AbortSignal));
    confirm.mockRestore();
  });

  it('returns focus to a connected parent after a successful folder delete refreshes the tree', async () => {
    const parent: ContentTreeNode = {
      kind: 'folder', id: 'parent', name: 'Parent', path: '/Parent', sortOrder: 0,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: true,
    };
    const folder: ContentTreeNode = {
      kind: 'folder', id: 'folder-1', name: 'Delete me', path: '/Parent/Delete me', sortOrder: 0,
      createdAt: '2026-09-05T00:00:00.000Z', updatedAt: '2026-09-05T00:00:00.000Z', hasChildren: false,
    };
    const refreshedTree = deferred<ReturnType<typeof treeResponse>>();
    let deleted = false;
    let deletedRootReads = 0;
    let explicitReloadSignal: AbortSignal | undefined;
    mocks.api.get.mockImplementation(async (url: string, config?: { params?: { parentFolderId?: string }; signal?: AbortSignal }) => {
      if (url === '/spaces/space-1') return spaceResponse('space-1', 'Owner Space', 'owner');
      if (url === '/spaces/space-1/content-tree') {
        if (config?.params?.parentFolderId === 'parent') return { data: {
          ...treeResponse('space-1', deleted ? [] : [folder]).data,
          parentFolderId: 'parent', treeRevision: deleted ? '8' : '7',
        } };
        if (!deleted) return treeResponse('space-1', [parent]);
        deletedRootReads += 1;
        if (deletedRootReads === 1) {
          explicitReloadSignal = config?.signal;
          return new Promise((_resolve, reject) => config?.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('explicit reload aborted'), { name: 'CanceledError' }));
          }, { once: true }));
        }
        return refreshedTree.promise;
      }
      if (url === '/spaces/space-1/folders/folder-1/delete-impact') return { data: {
        treeRevision: '7', rootUpdatedAt: folder.updatedAt, folderCount: 1, pageCount: 0, impactHash: 'impact-1',
      } };
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.api.delete.mockImplementation(async () => {
      deleted = true;
      return { data: {
        treeRevision: '8', syncRevisionId: 'sync-8',
        batch: { id: 'batch-1', folderCount: 1, pageCount: 0, impactHash: 'impact-1', createdAt: '2026-09-09T00:00:00.000Z' },
      } };
    });
    renderSpaceView();

    fireEvent.click(await screen.findByTestId('content-toggle-parent'));
    const trigger = await screen.findByTestId('content-deletefolder-folder-1');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByTestId('folder-delete-confirm'));

    await waitFor(() => expect(mocks.api.delete).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(explicitReloadSignal?.aborted).toBe(true));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(deletedRootReads).toBe(2);
    await act(async () => refreshedTree.resolve({
      ...treeResponse('space-1', [parent]),
      data: { ...treeResponse('space-1', [parent]).data, treeRevision: '8' },
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('content-deletefolder-folder-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('content-node-parent')).toHaveFocus();
  });

  it('does not DELETE after changing Space while the tree head is pending', async () => {
    const head = deferred<string>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.getContentTreeRevision.mockReturnValue(head.promise);
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-a') return spaceResponse('space-a', 'Owner A', 'owner');
      if (url === '/spaces/space-b') return spaceResponse('space-b', 'Owner B', 'owner');
      if (url === '/spaces/space-a/content-tree') return treeResponse('space-a', [pageNode('page-a', 'Archive A')]);
      if (url === '/spaces/space-b/content-tree') return treeResponse('space-b');
      throw new Error(`Unexpected GET ${url}`);
    });
    const { navigateTo } = renderNavigableSpaceView();

    fireEvent.click(await screen.findByTestId('content-deletepage-page-a'));
    await waitFor(() => expect(mocks.getContentTreeRevision).toHaveBeenCalledTimes(1));
    navigateTo('space-b');
    expect(await screen.findByRole('heading', { name: 'Owner B' })).toBeInTheDocument();

    await act(async () => head.resolve('43'));

    expect(mocks.api.delete).not.toHaveBeenCalled();
  });

  it('invalidates an old DELETE synchronously at the new Space render commit', async () => {
    const head = deferred<string>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.getContentTreeRevision.mockReturnValue(head.promise);
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-a') return spaceResponse('space-a', 'Owner A', 'owner');
      if (url === '/spaces/space-b') return spaceResponse('space-b', 'Owner B', 'owner');
      if (url === '/spaces/space-a/content-tree') return treeResponse('space-a', [pageNode('page-a', 'Archive A')]);
      if (url === '/spaces/space-b/content-tree') return treeResponse('space-b');
      throw new Error(`Unexpected GET ${url}`);
    });
    const harness = await renderCommitNavigableSpaceView();
    try {
    fireEvent.click(await screen.findByTestId('content-deletepage-page-a'));
      await waitFor(() => expect(mocks.getContentTreeRevision).toHaveBeenCalledTimes(1));
      harness.commitNavigateTo('space-b');
      head.resolve('43');

      await act(async () => Promise.resolve());
      expect(mocks.api.delete).not.toHaveBeenCalled();
    } finally {
      harness.dispose();
    }
  });

  it('coalesces repeated archive clicks into one head and one mutation', async () => {
    const head = deferred<string>();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.getContentTreeRevision.mockReturnValue(head.promise);
    mocks.api.get.mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') return spaceResponse('space-1', 'Owner Space', 'owner');
      if (url === '/spaces/space-1/content-tree') return treeResponse('space-1', [pageNode('page-1', 'Archive once')]);
      throw new Error(`Unexpected GET ${url}`);
    });
    mocks.api.delete.mockResolvedValue({ data: {} });
    renderSpaceView();

    const button = await screen.findByTestId('content-deletepage-page-1');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.getContentTreeRevision).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    await act(async () => head.resolve('43'));

    await waitFor(() => expect(mocks.api.delete).toHaveBeenCalledTimes(1));
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
      folderId: null,
      expectedTreeRevision: '43',
    }));
  });

  it.each([
    ['successful', false],
    ['failed', true],
  ] as const)('ignores a %s old-Space create completion after navigating to another Space', async (_case, reject) => {
    const createA = deferred<{ data: { id: string } }>();
    mockNavigableGets({
      'space-a': Promise.resolve(spaceResponse('space-a', 'Owner A', 'owner')),
      'space-b': Promise.resolve(spaceResponse('space-b', 'Owner B', 'owner')),
    });
    mocks.api.post.mockReturnValue(createA.promise);
    const { navigateTo } = renderNavigableSpaceView();

    fireEvent.click(await screen.findByRole('button', { name: '新建页面' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Late A page' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(mocks.api.post).toHaveBeenCalledWith('/pages', {
      title: 'Late A page',
      spaceId: 'space-a',
      folderId: null,
      expectedTreeRevision: '43',
    }));

    navigateTo('space-b');
    expect(await screen.findByRole('heading', { name: 'Owner B' })).toBeInTheDocument();
    await act(async () => {
      if (reject) createA.reject(new Error('old Space request failed'));
      else createA.resolve({ data: { id: 'late-page-a' } });
      try {
        await createA.promise;
      } catch {
        // The rejected old request is the behavior under test.
      }
    });

    expect(screen.getByRole('heading', { name: 'Owner B' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Editing created page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
