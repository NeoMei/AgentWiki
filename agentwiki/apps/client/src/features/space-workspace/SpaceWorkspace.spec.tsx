import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { SpaceWorkspace } from './SpaceWorkspace';
import {
  SpaceWorkspaceProvider,
  useSpaceWorkspace,
} from './SpaceWorkspaceContext';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));

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
      <button type="button" onClick={() => navigate('/spaces/space-2')}>other space</button>
    </>
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

  it('resolves a page route from the page response space id before presenting space navigation', async () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.mocked(api.get).mockResolvedValue({ data: { id: 'page-77', spaceId: 'space-real' } });

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-77']}>
          <SpaceWorkspaceProvider userId="user-1">
            <SpaceWorkspace mode="read" pageId="page-77"><WorkspaceProbe /></SpaceWorkspace>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('scope')).toHaveTextContent('user-1:space-real:read'));
    expect(api.get).toHaveBeenCalledWith('/pages/page-77', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-real');
  });
});
