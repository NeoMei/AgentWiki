import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const UserHarness = () => {
  const [userId, setUserId] = useState('user-1');
  return (
    <SpaceWorkspaceProvider userId={userId}>
      <button type="button" onClick={() => setUserId((current) => current === 'user-1' ? 'user-2' : 'user-1')}>other user</button>
      <Routes>
        <Route path="/pages/:id" element={<SpaceWorkspace mode="read" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/pages/:id/edit" element={<SpaceWorkspace mode="edit" spaceId="space-1"><WorkspaceProbe /></SpaceWorkspace>} />
        <Route path="/spaces/space-2" element={<SpaceWorkspace mode="directory" spaceId="space-2"><WorkspaceProbe /></SpaceWorkspace>} />
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
