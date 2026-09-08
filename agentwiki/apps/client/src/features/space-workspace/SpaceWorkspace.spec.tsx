import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { PagePreview } from '../page/PagePreview';
import { SpaceWorkspace } from './SpaceWorkspace';
import {
  SpaceWorkspaceProvider,
  useSpaceWorkspace,
} from './SpaceWorkspaceContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', name: 'Owner' } }) }));

vi.mock('../../api/client', () => ({ default: {
  get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn(),
} }));

const WorkspaceProbe = () => {
  const workspace = useSpaceWorkspace();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="scope">{workspace.userId}:{workspace.spaceId}:{workspace.mode}</p>
      <p data-testid="expanded">{[...workspace.expandedFolderIds].sort().join(',')}</p>
      <p data-testid="directory-scroll">{workspace.directoryScrollTop}</p>
      <p data-testid="selected-folder">{workspace.selectedFolderId ?? 'root'}</p>
      <button type="button" onClick={() => workspace.setFolderExpanded('folder-a', true)}>expand</button>
      <button type="button" onClick={() => workspace.setDirectoryScrollTop(120)}>remember scroll</button>
      <button type="button" onClick={() => workspace.selectFolder('folder-next')}>select next</button>
      <button type="button" onClick={() => navigate(-1)}>history back</button>
      <button type="button" onClick={() => navigate('/pages/page-2/edit')}>edit next</button>
      <button type="button" onClick={() => navigate('/pages/page-2')}>read second</button>
      <button type="button" onClick={() => navigate('/pages/page-3')}>read third</button>
      <button type="button" onClick={() => navigate('/spaces/space-1/sources')}>open sources</button>
      <button type="button" onClick={() => navigate('/pages/page-1')}>return to page</button>
      <button type="button" onClick={() => navigate('/spaces/space-2')}>other space</button>
    </>
  );
};

const RoutedPreviewWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <SpaceWorkspace mode="read" pageId={id}>
      <WorkspaceProbe />
      <PagePreview />
    </SpaceWorkspace>
  );
};

const RoutedDeletionWorkspace = () => {
  const { id } = useParams<{ id: string }>();
  return <SpaceWorkspace mode="read" pageId={id} showDirectory><WorkspaceProbe /><PagePreview /></SpaceWorkspace>;
};

const PageRefreshProbe = () => {
  const workspace = useSpaceWorkspace();
  return <button type="button" onClick={() => workspace.requestPageRefresh('page-refresh')}>refresh current page</button>;
};

const UserHarness = () => {
  const [userId, setUserId] = useState('user-1');
  return (
    <SpaceWorkspaceProvider userId={userId}>
      <button type="button" onClick={() => setUserId((current) => current === 'user-1' ? 'user-2' : 'user-1')}>other user</button>
      <Routes>
        <Route path="/pages/:id" element={<SpaceWorkspace mode="read" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/pages/:id/edit" element={<SpaceWorkspace mode="edit" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/spaces/space-2" element={<SpaceWorkspace mode="directory" spaceId="space-2"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/spaces/space-1/sources" element={<SpaceWorkspace mode="section" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/spaces/:id" element={<SpaceWorkspace mode="directory" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
      </Routes>
    </SpaceWorkspaceProvider>
  );
};

describe('SpaceWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps Pages active when a reader moves to the edit route', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <UserHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'edit next' }));
    expect(screen.getByTestId('scope')).toHaveTextContent('user-1:space-1:edit');
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps expanded folders across pages in one space but not across spaces or users', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <UserHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'remember scroll' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('folder-a');
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('120');

    fireEvent.click(screen.getByRole('button', { name: 'edit next' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('folder-a');
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('120');

    fireEvent.click(screen.getByRole('button', { name: 'other user' }));
    expect(screen.getByTestId('scope')).toHaveTextContent('user-2:space-1:edit');
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement();
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'other user' }));
    expect(screen.getByTestId('scope')).toHaveTextContent('user-1:space-1:edit');
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement();
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('0');

    fireEvent.click(screen.getByRole('button', { name: 'other space' }));
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement();
  });

  it('restores the Space browse state after visiting a wide section without loading its directory', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1') return { data: {
        id: 'space-1', name: 'Space one', description: '', members: [],
      } };
      throw new Error(`unexpected get ${url}`);
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <UserHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'remember scroll' }));
    fireEvent.click(screen.getByRole('button', { name: 'open sources' }));
    expect(await screen.findByRole('heading', { name: 'Space one' })).toBeVisible();
    expect(screen.getByTestId('expanded')).toHaveTextContent('folder-a');
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('120');
    expect(vi.mocked(api.get).mock.calls.map(([url]) => url)).toEqual(['/spaces/space-1']);

    fireEvent.click(screen.getByRole('button', { name: 'return to page' }));
    expect(screen.getByTestId('expanded')).toHaveTextContent('folder-a');
    expect(screen.getByTestId('directory-scroll')).toHaveTextContent('120');
  });

  it('follows the folder query when browser history moves backward', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/spaces/space-1?folder=folder-first']}>
          <UserHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(screen.getByTestId('selected-folder')).toHaveTextContent('folder-first');
    fireEvent.click(screen.getByRole('button', { name: 'select next' }));
    expect(screen.getByTestId('selected-folder')).toHaveTextContent('folder-next');
    fireEvent.click(screen.getByRole('button', { name: 'history back' }));
    await waitFor(() => expect(screen.getByTestId('selected-folder')).toHaveTextContent('folder-first'));
  });

  it('uses the successful content load as the only page identity request', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-77') return { data: {
        id: 'page-77', title: 'Loaded content', content: 'Body', format: 'markdown',
        spaceId: 'space-real', createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z',
        capabilities: { canEdit: true },
      } };
      if (url === '/knowledge/related/page-77') return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-77']}>
          <SpaceWorkspaceProvider userId="user-1">
            <Routes>
              <Route path="/pages/:id" element={
                <SpaceWorkspace mode="read" pageId="page-77"><PagePreview /></SpaceWorkspace>
              } />
            </Routes>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Loaded content' })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-77')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-real');
  });

  it('keeps an authoritative workspace identity on transient refresh failure and clears it on auth loss', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    let pageLoads = 0;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-refresh') {
        pageLoads += 1;
        if (pageLoads === 1) return { data: {
          id: 'page-refresh', title: 'Known page', content: 'Body', format: 'markdown',
          spaceId: 'space-known', folderId: null, createdAt: 'now', updatedAt: 'now', capabilities: { canEdit: false },
        } };
        if (pageLoads === 2) throw new Error('network unavailable');
        throw { response: { status: 403, data: { message: 'Access revoked' } } };
      }
      if (url === '/spaces/space-known') return { data: {
        id: 'space-known', name: 'Known Space', description: '', members: [{ userId: 'user-1', role: 'viewer' }],
      } };
      if (url === '/knowledge/related/page-refresh') return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-refresh']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes><Route path="/pages/:id" element={
        <SpaceWorkspace mode="read" pageId="page-refresh">
          <PageRefreshProbe />
          <PagePreview />
        </SpaceWorkspace>
      } /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Known page' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-known');
    fireEvent.click(screen.getByRole('button', { name: 'refresh current page' }));
    expect(await screen.findByText('Failed to load page')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-known');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Access revoked')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Pages' })).not.toBeInTheDocument();
  });

  it('ignores a late same-page refresh response after a newer retry is accepted', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    let resolveOldRefresh!: (value: any) => void;
    const oldRefresh = new Promise<any>((resolve) => { resolveOldRefresh = resolve; });
    let pageLoads = 0;
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-refresh') {
        pageLoads += 1;
        if (pageLoads === 1) return { data: {
          id: 'page-refresh', title: 'Initial page', content: 'Body', format: 'markdown',
          spaceId: 'space-1', folderId: null, createdAt: 'now', updatedAt: 'initial', capabilities: { canEdit: false },
        } };
        if (pageLoads === 2) return oldRefresh;
        return { data: {
          id: 'page-refresh', title: 'Newest page', content: 'Fresh', format: 'markdown',
          spaceId: 'space-1', folderId: null, createdAt: 'now', updatedAt: 'newest', capabilities: { canEdit: false },
        } };
      }
      if (url === '/knowledge/related/page-refresh') return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-refresh']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes><Route path="/pages/:id" element={
        <SpaceWorkspace mode="read" pageId="page-refresh">
          <PageRefreshProbe />
          <PagePreview />
        </SpaceWorkspace>
      } /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Initial page' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'refresh current page' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh current page' }));
    expect(await screen.findByRole('heading', { name: 'Newest page' })).toBeVisible();

    await act(async () => resolveOldRefresh({ data: {
      id: 'page-refresh', title: 'Late stale page', content: 'Stale', format: 'markdown',
      spaceId: 'space-1', folderId: null, createdAt: 'now', updatedAt: 'stale', capabilities: { canEdit: false },
    } }));
    expect(screen.getByRole('heading', { name: 'Newest page' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Late stale page' })).not.toBeInTheDocument();
  });

  it('keeps directory requests bounded after a page identity installs its folder', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-deep') return { data: {
        id: 'page-deep', title: 'Deep page', content: 'Body', format: 'markdown',
        spaceId: 'space-real', folderId: 'folder-b', createdAt: 'now', updatedAt: 'now', capabilities: { canEdit: true },
      } };
      if (url === '/spaces/space-real') return { data: {
        id: 'space-real', name: 'Space real', description: '', members: [{ userId: 'user-1', role: 'viewer' }],
      } };
      if (url === '/spaces/space-real/folders') return { data: {
        spaceId: 'space-real', treeRevision: '7', data: [
          { id: 'folder-a', parentId: null, name: 'A', path: '/A', createdAt: 'now', updatedAt: 'now' },
          { id: 'folder-b', parentId: 'folder-a', name: 'B', path: '/A/B', createdAt: 'now', updatedAt: 'now' },
        ], nextCursor: null,
      } };
      if (url === '/spaces/space-real/content-tree') return { data: {
        spaceId: 'space-real', treeRevision: '7', parentFolderId: null, data: [], nextCursor: null,
      } };
      if (url === '/spaces/space-real/page-templates/composite') return { data: {
        templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false },
      } };
      if (url === '/knowledge/related/page-deep') return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });

    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-deep']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes><Route path="/pages/:id" element={
        <SpaceWorkspace mode="read" pageId="page-deep" showDirectory><PagePreview /></SpaceWorkspace>
      } /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Deep page' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Space real' })).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-deep')).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/spaces/space-real')).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/spaces/space-real/folders')).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/spaces/space-real/content-tree')).toHaveLength(3);
  });

  it.each(['page', 'ancestor', 'unrelated', 'late'])('reconciles the mounted article after confirmed directory deletion: %s', async (target) => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let deleted = false;
    let finishDelete!: () => void;
    const pendingDelete = new Promise<void>((resolve) => { finishDelete = resolve; });
    const folder = { id: 'parent', parentId: null, name: 'Parent', path: '/Parent', createdAt: 'now', updatedAt: 'now' };
    const child = { ...folder, id: 'child', parentId: 'parent', name: 'Child', path: '/Parent/Child' };
    const folderNode = (f: Omit<typeof folder, 'parentId'> & { parentId: string | null }) => ({ ...f, kind: 'folder', sortOrder: 0, hasChildren: true });
    const node = (id: string) => ({ kind: 'page', id, title: id, folderId: 'child', path: `/${id}`, sortOrder: 0, createdAt: 'now', updatedAt: 'now' });
    vi.mocked(api.get).mockImplementation(async (url: string, config?: { params?: { parentFolderId?: string } }) => {
      if (url === '/pages/page-2') return { data: { id: 'page-2', title: 'Second article', content: 'Unrelated active article', format: 'markdown', spaceId: 'space-1', folderId: null, updatedAt: 'now', capabilities: { canEdit: true } } };
      if (url === '/pages/deletion-current') return { data: { id: 'deletion-current', title: 'Live article', content: 'Mounted editable article body', format: 'markdown', spaceId: 'space-1', folderId: 'child', updatedAt: 'now', capabilities: { canEdit: true } } };
      if (url === '/spaces/space-1') return { data: { id: 'space-1', name: 'Wiki', members: [{ userId: 'user-1', role: 'owner' }] } };
      if (url === '/spaces/space-1/folders') return { data: { spaceId: 'space-1', treeRevision: deleted ? '8' : '7', data: [folder, child], nextCursor: null } };
      if (url === '/spaces/space-1/content-tree') {
        const parent = config?.params?.parentFolderId ?? null;
        return { data: { spaceId: 'space-1', treeRevision: deleted ? '8' : '7', parentFolderId: parent, nextCursor: null,
          data: parent === null ? (deleted && target === 'ancestor' ? [] : [folderNode(folder)])
            : parent === 'parent' ? [folderNode(child)] : [node('deletion-current'), node('other-page')].filter((n) => !deleted || n.id !== (target === 'page' || target === 'late' ? 'deletion-current' : 'other-page')) } };
      }
      if (url.endsWith('/delete-impact')) return { data: { treeRevision: '7', rootUpdatedAt: 'now', folderCount: 2, pageCount: 2, impactHash: 'impact' } };
      if (url.includes('/page-templates/composite')) return { data: { templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false } } };
      if (url.startsWith('/knowledge/related')) return { data: [] };
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(api.delete).mockImplementation(async () => { if (target === 'late') await pendingDelete; deleted = true; return { data: { treeRevision: '8', batch: { id: 'deleted-batch' } } }; });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/deletion-current']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes>
        <Route path="/pages/:id" element={<RoutedDeletionWorkspace />} />
        <Route path="/spaces/space-1" element={<p>Valid Space root</p>} />
      </Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);
    await screen.findByText('Mounted editable article body');
    const testId = target === 'ancestor' ? 'content-deletefolder-parent' : `content-deletepage-${target === 'page' || target === 'late' ? 'deletion-current' : 'other-page'}`;
    fireEvent.click(await screen.findByTestId(testId));
    if (target === 'ancestor') fireEvent.click(await screen.findByTestId('folder-delete-confirm'));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    if (target === 'late') {
      fireEvent.click(screen.getByRole('button', { name: 'read second' }));
      await screen.findByText('Unrelated active article');
      await act(async () => finishDelete());
      expect(screen.getByText('Unrelated active article')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    } else if (target === 'unrelated') {
      await waitFor(() => expect(screen.queryByTestId('content-node-other-page')).not.toBeInTheDocument());
      expect(screen.getByText('Mounted editable article body')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    } else {
      expect(await screen.findByText('Valid Space root')).toBeVisible();
      expect(screen.queryByText('Mounted editable article body')).not.toBeInTheDocument();
    }
  });

  it('refreshes the accepted current Page after moving it to a different real parent', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    let moved = false;
    let pageLoads = 0;
    let resolveMove!: (value: any) => void;
    const moveResult = new Promise<any>((resolve) => {
      resolveMove = resolve;
    });
    const folder = (id: string, name: string) => ({
      id, parentId: null, name, path: `/${name}`, createdAt: 'now', updatedAt: 'now',
    });
    const folderNode = (id: string, name: string) => ({
      kind: 'folder' as const, id, name, path: `/${name}`, sortOrder: 0,
      createdAt: 'now', updatedAt: 'now', hasChildren: true,
    });
    const currentPageNode = (folderId: string) => ({
      kind: 'page' as const, id: 'page-current', folderId, title: 'Current page',
      path: folderId === 'folder-new' ? '/New parent/Current page' : '/Old parent/Current page',
      sortOrder: 0, createdAt: 'now', updatedAt: moved ? 'moved-at' : 'old-at',
    });
    vi.mocked(api.get).mockImplementation(async (url: string, config?: { params?: { parentFolderId?: string } }) => {
      if (url === '/pages/page-current') {
        pageLoads += 1;
        return { data: {
          id: 'page-current', title: 'Current page', content: '- [ ] keep version current', format: 'markdown',
          spaceId: 'space-1', folderId: moved ? 'folder-new' : 'folder-old',
          createdAt: 'now', updatedAt: moved ? 'moved-at' : 'old-at', capabilities: { canEdit: true },
        } };
      }
      if (url === '/spaces/space-1') return { data: {
        id: 'space-1', name: 'Move Space', description: '', members: [{ userId: 'user-1', role: 'owner' }],
      } };
      if (url === '/spaces/space-1/folders') return { data: {
        spaceId: 'space-1', treeRevision: moved ? '8' : '7',
        data: [folder('folder-old', 'Old parent'), folder('folder-new', 'New parent')], nextCursor: null,
      } };
      if (url === '/spaces/space-1/content-tree') {
        const parentFolderId = config?.params?.parentFolderId ?? null;
        const nodes = parentFolderId === null
          ? [folderNode('folder-old', 'Old parent'), folderNode('folder-new', 'New parent')]
          : parentFolderId === (moved ? 'folder-new' : 'folder-old') ? [currentPageNode(parentFolderId)] : [];
        return { data: {
          spaceId: 'space-1', treeRevision: moved ? '8' : '7', parentFolderId, data: nodes, nextCursor: null,
        } };
      }
      if (url === '/spaces/space-1/page-templates/composite') return { data: {
        templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false },
      } };
      if (url === '/knowledge/related/page-current') return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });
    vi.mocked(api.patch).mockImplementation(async (url: string) => {
      if (url === '/spaces/space-1/content-tree/move') {
        return moveResult;
      }
      if (url === '/pages/page-current') return { data: {
        id: 'page-current', title: 'Current page', content: '- [x] keep version current', format: 'markdown',
        spaceId: 'space-1', folderId: 'folder-new', createdAt: 'now', updatedAt: 'checked-at',
      } };
      throw new Error(`unexpected patch ${url}`);
    });

    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-current']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes><Route path="/pages/:id" element={
        <SpaceWorkspace mode="read" pageId="page-current" showDirectory><PagePreview /></SpaceWorkspace>
      } /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Current page' })).toBeVisible();
    await screen.findByTestId('content-node-folder-old');
    const currentPage = await screen.findByTestId('content-node-page-current');
    const newParentRow = screen.getByTestId('content-row-folder-new');
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none', dropEffect: 'none' };
    fireEvent.dragStart(currentPage.closest('[draggable="true"]')!, { dataTransfer });
    fireEvent.dragOver(newParentRow, { dataTransfer, clientY: 0 });
    fireEvent.drop(newParentRow, { dataTransfer, clientY: 0 });

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/spaces/space-1/content-tree/move', {
      kind: 'page', id: 'page-current', targetParentFolderId: 'folder-new',
      expectedTreeRevision: '7', expectedUpdatedAt: 'old-at',
    }, { signal: undefined }));
    expect(pageLoads).toBe(1);
    moved = true;
    await act(async () => resolveMove({ data: {
      spaceId: 'space-1', treeRevision: '8', parentFolderId: 'folder-new', data: [], nextCursor: null,
    } }));
    await waitFor(() => expect(pageLoads).toBe(2));
    const breadcrumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(breadcrumbs).getByRole('link', { name: 'New parent' })).toBeVisible();
    expect(within(breadcrumbs).queryByRole('link', { name: 'Old parent' })).not.toBeInTheDocument();
    expect(await screen.findByTestId('content-node-page-current')).toBeVisible();
    expect(screen.getByTestId('content-item-folder-new')).toHaveAttribute('aria-expanded', 'true');

    const [checkbox] = screen.getAllByRole('checkbox');
    await act(async () => fireEvent.click(checkbox));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-current', {
      content: '- [x] keep version current', expectedUpdatedAt: 'moved-at',
    }));
  });

  it('keeps page content mounted when Space metadata access fails', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-locked') return { data: {
        id: 'page-locked', title: 'Still readable', content: 'Body', format: 'markdown',
        spaceId: 'space-locked', folderId: 'folder-private', createdAt: 'now', updatedAt: 'now', capabilities: { canEdit: false },
      } };
      if (url === '/spaces/space-locked') throw { response: { status: 403, data: { message: 'Space forbidden' } } };
      if (url === '/knowledge/related/page-locked') return { data: [] };
      if (url === '/spaces/space-locked/page-templates/composite') return { data: {
        templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false },
      } };
      throw new Error(`unexpected get ${url}`);
    });

    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-locked']}>
      <SpaceWorkspaceProvider userId="user-1"><Routes><Route path="/pages/:id" element={
        <SpaceWorkspace mode="read" pageId="page-locked" showDirectory><PagePreview /></SpaceWorkspace>
      } /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    expect(await screen.findByRole('heading', { name: 'Still readable' })).toBeInTheDocument();
    expect(await screen.findByText('Space forbidden')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Still readable' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-locked')).toHaveLength(1);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/spaces/space-locked')).toHaveLength(1);
  });

  it('preserves browse state across two loaded pages in one Space and isolates a third page in another', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    let resolveThird!: (value: any) => void;
    const thirdPage = new Promise<any>((resolve) => { resolveThird = resolve; });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      const match = url.match(/^\/pages\/(page-[123])$/u);
      if (match) {
        const pageId = match[1];
        const response = { data: {
          id: pageId,
          title: `Title ${pageId}`,
          content: 'Body',
          format: 'markdown',
          spaceId: pageId === 'page-3' ? 'space-b' : 'space-a',
          createdAt: '2026-09-08T00:00:00Z',
          updatedAt: '2026-09-08T00:00:00Z',
          capabilities: { canEdit: true },
        } };
        return pageId === 'page-3' ? thirdPage : response;
      }
      if (url.startsWith('/knowledge/related/')) return { data: [] };
      throw new Error(`unexpected get ${url}`);
    });

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1']}>
          <SpaceWorkspaceProvider userId="user-1">
            <Routes><Route path="/pages/:id" element={<RoutedPreviewWorkspace />} /></Routes>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Title page-1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'read second' }));
    expect(await screen.findByRole('heading', { name: 'Title page-2' })).toBeInTheDocument();
    expect(screen.getByTestId('expanded')).toHaveTextContent('folder-a');
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-a');

    fireEvent.click(screen.getByRole('button', { name: 'read third' }));
    expect(screen.queryByRole('navigation', { name: 'Space navigation' })).not.toBeInTheDocument();
    resolveThird({ data: {
      id: 'page-3', title: 'Title page-3', content: 'Body', format: 'markdown', spaceId: 'space-b',
      createdAt: '2026-09-08T00:00:00Z', updatedAt: '2026-09-08T00:00:00Z', capabilities: { canEdit: true },
    } });
    expect(await screen.findByRole('heading', { name: 'Title page-3' })).toBeInTheDocument();
    expect(screen.getByTestId('expanded')).toBeEmptyDOMElement();
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-b');
  });
});
