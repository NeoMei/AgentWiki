import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import type { MarkdownWorkspaceHandle } from '../../components/MarkdownWorkspace';
import { LanguageProvider } from '../../context/LanguageContext';
import { AgentSessionRegistryProvider } from '../agent-session/AgentSessionRegistry';
import { PageEditor } from '../page/PageEditor';
import { PagePreview } from '../page/PagePreview';
import { SpaceWorkspace } from './SpaceWorkspace';
import { SpaceWorkspaceProvider } from './SpaceWorkspaceContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'mutation-user', name: 'Editor' } }) }));
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), connected: true }) }));

const workspaceRef: { current: MarkdownWorkspaceHandle | null } = { current: null };
const timestamp = '2026-10-15T00:00:00.000Z';
const initialPage = {
  kind: 'page', id: 'mutable-page', title: 'Original title', folderId: 'folder-a', spaceId: 'mutation-space',
  content: 'Original body', format: 'markdown', path: '/folder-a/mutable-page', sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp, capabilities: { canEdit: true },
};
const folder = { kind: 'folder', id: 'folder-a', name: 'Folder A', parentId: null, path: '/folder-a', sortOrder: 0, hasChildren: true, createdAt: timestamp, updatedAt: timestamp };
const siblingPage = { ...initialPage, id: 'sibling-page', title: 'Sibling page' };

// App keeps this same route-shell component mounted between read/edit/directory.
function MutationRoute() {
  const { id } = useParams<{ id: string }>();
  const { pathname } = useLocation();
  const mode = pathname.startsWith('/spaces/') ? 'directory' : pathname.endsWith('/edit') ? 'edit' : 'read';
  return <><Link to="/spaces/other-space">Other space</Link><SpaceWorkspace mode={mode} spaceId={mode === 'directory' ? id : 'mutation-space'} pageId={mode === 'directory' ? undefined : id} showDirectory>
    {mode === 'edit' ? <PageEditor workspaceRef={workspaceRef} /> : mode === 'read' ? <PagePreview /> : null}
  </SpaceWorkspace></>;
}

function renderWorkspace(path: string) {
  return render(<LanguageProvider><AgentSessionRegistryProvider userId="mutation-user">
    <MemoryRouter initialEntries={[path]}><SpaceWorkspaceProvider userId="mutation-user"><Routes>
      <Route path="/pages/:id" element={<MutationRoute />} />
      <Route path="/pages/:id/edit" element={<MutationRoute />} />
      <Route path="/spaces/:id" element={<MutationRoute />} />
    </Routes></SpaceWorkspaceProvider></MemoryRouter>
  </AgentSessionRegistryProvider></LanguageProvider>);
}

describe('directory invalidation after page mutations', () => {
  let savedPage = { ...initialPage };
  let deleted = false;
  let revision = '7';
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const directoryReads = () => vi.mocked(api.get).mock.calls.filter(([url, config]) =>
    url.endsWith('/folders') || url.endsWith('/content-tree') && (config?.params as { take?: number } | undefined)?.take !== 1).length;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRef.current = null;
    savedPage = { ...initialPage };
    deleted = false;
    revision = '7';
    localStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'en');
    localStorage.setItem('agentwiki.workspace.v1:mutation-user:mutation-space', JSON.stringify({ schemaVersion: 1, expandedFolderIds: ['folder-a'] }));
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.get).mockImplementation(async (url: string, config?: any) => {
      if (url === '/pages/mutable-page') return { data: { ...savedPage } };
      if (url === '/pages/sibling-page') return { data: siblingPage };
      if (url === '/spaces/other-space') return { data: { id: 'other-space', name: 'Other space', members: [{ userId: 'mutation-user', role: 'editor' }] } };
      if (url === '/spaces/other-space/content-tree') return { data: { spaceId: 'other-space', treeRevision: '1', parentFolderId: null, nextCursor: null, data: [{ ...folder, id: 'other-folder', name: 'Other folder' }] } };
      if (url === '/spaces/mutation-space') return { data: { id: 'mutation-space', name: 'Mutation space', members: [{ userId: 'mutation-user', role: 'editor' }] } };
      if (url.endsWith('/folders')) return { data: { spaceId: 'mutation-space', treeRevision: revision, data: [folder], nextCursor: null } };
      if (url.endsWith('/content-tree')) {
        const parentFolderId = config?.params?.parentFolderId ?? null;
        return { data: { spaceId: 'mutation-space', treeRevision: revision, parentFolderId, nextCursor: null,
          data: parentFolderId ? deleted ? [siblingPage] : [{ ...savedPage }, siblingPage] : [folder],
        } };
      }
      if (url.includes('/page-templates/composite')) return { data: { data: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false } } };
      if (url.endsWith('/page-templates')) return { data: { system: [], space: [], totalSpace: 0, skip: 0, take: 1, capabilities: { canManage: false } } };
      if (url.endsWith('/notes')) return { data: { notes: [], canCreate: false } };
      if (url.startsWith('/knowledge/related/') || url === '/assist/sessions') return { data: [] };
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(api.patch).mockImplementation(async (url: string, input: any) => {
      if (url !== '/pages/mutable-page') throw new Error(`Unexpected PATCH ${url}`);
      if (input.expectedUpdatedAt !== savedPage.updatedAt) throw { response: { status: 409 } };
      savedPage = { ...savedPage, ...input, updatedAt: '2026-10-15T00:01:00.000Z' };
      if (input.title !== undefined) revision = '8';
      return { data: { ...savedPage } };
    });
    vi.mocked(api.delete).mockImplementation(async (url: string) => {
      if (url !== '/pages/mutable-page') throw new Error(`Unexpected DELETE ${url}`);
      deleted = true;
      revision = '8';
      return { data: { success: true } };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('removes a deleted page from the retained directory when returning from its preview', async () => {
    renderWorkspace('/pages/mutable-page');
    await screen.findByRole('heading', { name: 'Original title' });
    await screen.findByTestId('content-item-mutable-page');
    const previousReads = directoryReads();
    fireEvent.click(screen.getByRole('tab', { name: 'Page information' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Original title' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.queryAllByTestId('content-item-mutable-page')).toHaveLength(0));
    expect(screen.getAllByTestId('content-item-folder-a')[0]).toBeVisible();
    expect(directoryReads()).toBeGreaterThan(previousReads);
  });

  it('updates the retained directory title after saving the editor title', async () => {
    renderWorkspace('/pages/mutable-page/edit');
    await screen.findByRole('textbox', { name: 'Page title' });
    await screen.findByTestId('content-item-mutable-page');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), { target: { value: 'Renamed page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved');
    await waitFor(() => expect(within(screen.getByTestId('content-item-mutable-page')).getByRole('button', { name: 'Renamed page' })).toBeVisible());
    expect(screen.queryByRole('button', { name: 'Original title' })).not.toBeInTheDocument();
  });

  it('refreshes the directory revision used by a later rename after a body-only save', async () => {
    renderWorkspace('/pages/mutable-page/edit');
    await screen.findByRole('textbox', { name: 'Page title' });
    await screen.findByTestId('content-item-mutable-page');
    const previousReads = directoryReads();
    act(() => workspaceRef.current?.simulateChange('Updated body'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved');
    expect(workspaceRef.current?.currentValue()).toBe('Updated body');
    await waitFor(() => expect(directoryReads()).toBeGreaterThan(previousReads));
    fireEvent.click(await screen.findByTestId('content-rename-mutable-page'));
    const name = screen.getByRole('textbox', { name: 'Rename: Original title' });
    fireEvent.change(name, { target: { value: 'Renamed after body save' } });
    fireEvent.submit(name.closest('form')!);
    await screen.findByRole('button', { name: 'Renamed after body save' });
    expect(api.patch).toHaveBeenLastCalledWith('/pages/mutable-page', {
      title: 'Renamed after body save', expectedUpdatedAt: '2026-10-15T00:01:00.000Z', expectedTreeRevision: '7',
    });
  });

  it('refreshes directory metadata after a task checkbox saves from the preview', async () => {
    savedPage.content = '- [ ] First task';
    renderWorkspace('/pages/mutable-page');
    await screen.findByTestId('content-item-mutable-page');
    const previousReads = directoryReads();
    fireEvent.click(await screen.findByRole('checkbox'));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
    await waitFor(() => expect(directoryReads()).toBeGreaterThan(previousReads));

    fireEvent.click(await screen.findByTestId('content-rename-mutable-page'));
    const name = screen.getByRole('textbox', { name: 'Rename: Original title' });
    fireEvent.change(name, { target: { value: 'Renamed after task save' } });
    fireEvent.submit(name.closest('form')!);
    await screen.findByRole('button', { name: 'Renamed after task save' });
    expect(api.patch).toHaveBeenLastCalledWith('/pages/mutable-page', {
      title: 'Renamed after task save', expectedUpdatedAt: '2026-10-15T00:01:00.000Z', expectedTreeRevision: '7',
    });
  });

  it('refreshes a completed deletion after navigating to another document in the same Space', async () => {
    let finishDelete!: () => void;
    vi.mocked(api.delete).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishDelete = resolve; });
      deleted = true; revision = '8';
      return { data: { success: true } };
    });
    renderWorkspace('/pages/mutable-page');
    await screen.findByRole('heading', { name: 'Original title' });
    await screen.findByTestId('content-item-mutable-page');
    fireEvent.click(screen.getByRole('tab', { name: 'Page information' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Sibling page' }));
    await screen.findByRole('heading', { name: 'Sibling page' });
    await act(async () => finishDelete());

    await waitFor(() => expect(screen.queryAllByTestId('content-item-mutable-page')).toHaveLength(0));
    expect(screen.getByRole('heading', { name: 'Sibling page' })).toBeVisible();
  });

  it('does not refresh a different Space when an earlier document deletion finishes', async () => {
    let finishDelete!: () => void;
    vi.mocked(api.delete).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishDelete = resolve; });
      deleted = true; revision = '8';
      return { data: { success: true } };
    });
    renderWorkspace('/pages/mutable-page');
    await screen.findByRole('heading', { name: 'Original title' });
    await screen.findByTestId('content-item-mutable-page');
    fireEvent.click(screen.getByRole('tab', { name: 'Page information' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('link', { name: 'Other space' }));
    await screen.findAllByTestId('content-item-other-folder');
    const reads = directoryReads();
    await act(async () => finishDelete());

    expect(screen.getAllByTestId('content-item-other-folder')[0]).toBeVisible();
    expect(directoryReads()).toBe(reads);
  });
});
