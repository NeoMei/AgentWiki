import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageProvider } from '../../context/LanguageContext';
import { PagePreview } from '../page/PagePreview';
import { SpaceWorkspace } from './SpaceWorkspace';
import { SpaceWorkspaceProvider } from './SpaceWorkspaceContext';

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'navigation-user', name: 'Reader' } }) }));
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

// Match App's page-route ownership hint, supplied by real directory navigation.
function PageRoute() {
  const { id } = useParams<{ id: string }>();
  const { state } = useLocation();
  return <SpaceWorkspace mode="read" pageId={id} spaceId={state?.workspaceSpaceId} showDirectory><PagePreview /></SpaceWorkspace>;
}

const timestamp = '2026-10-15T00:00:00.000Z';
const folder = (id: string) => ({ kind: 'folder', id, name: id, path: `/${id}`, sortOrder: 0, hasChildren: true, createdAt: timestamp, updatedAt: timestamp });
const page = (id: string, folderId: string) => ({ kind: 'page', id, folderId, title: id, path: `/${folderId}/${id}`, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp });
const pageNodes = [page('page-one', 'folder-a'), page('page-two', 'folder-a'), page('page-three', 'folder-b')];
const documentResponse = (id: string) => ({ data: {
  ...pageNodes.find((node) => node.id === id), spaceId: 'navigation-space', content: `Body of ${id}`, format: 'markdown', capabilities: { canEdit: false },
} });

describe('directory page navigation', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('agentwiki.language.v1', 'en');
    localStorage.setItem('agentwiki.workspace.v1:navigation-user:navigation-space', JSON.stringify({
      schemaVersion: 1, expandedFolderIds: ['folder-a', 'folder-b'],
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it.each(['page-two', 'page-three'])('keeps the loaded directory visible without rereading it while opening %s', async (destination) => {
    let finishDocument!: (response: ReturnType<typeof documentResponse>) => void;
    const pendingDocument = new Promise<ReturnType<typeof documentResponse>>((resolve) => { finishDocument = resolve; });
    vi.mocked(api.get).mockImplementation(async (url: string, config?: any) => {
      if (url === `/pages/${destination}`) return pendingDocument;
      if (url === '/pages/page-one') return documentResponse('page-one');
      if (url === '/spaces/navigation-space') return { data: { id: 'navigation-space', name: 'Navigation space', members: [{ userId: 'navigation-user', role: 'viewer' }] } };
      if (url.endsWith('/folders')) return { data: {
        spaceId: 'navigation-space', treeRevision: '7', data: ['folder-a', 'folder-b'].map((id) => ({ ...folder(id), parentId: null })), nextCursor: null,
      } };
      if (url.endsWith('/content-tree')) {
        const parentFolderId = config?.params?.parentFolderId ?? null;
        return { data: { spaceId: 'navigation-space', treeRevision: '7', parentFolderId, nextCursor: null,
          data: parentFolderId ? pageNodes.filter((node) => node.folderId === parentFolderId) : [folder('folder-a'), folder('folder-b')],
        } };
      }
      if (url.includes('/page-templates/composite')) return { data: { templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false } } };
      if (url.startsWith('/knowledge/related/')) return { data: [] };
      throw new Error(`Unexpected GET ${url}`);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={[{ pathname: '/pages/page-one', state: { workspaceSpaceId: 'navigation-space' } }]}>
      <SpaceWorkspaceProvider userId="navigation-user"><Routes><Route path="/pages/:id" element={<PageRoute />} /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);

    await screen.findByRole('heading', { name: 'page-one' });
    await screen.findByTestId('content-item-page-three');
    const directoryReads = () => vi.mocked(api.get).mock.calls.filter(([url]) => /\/(?:content-tree|folders)$/u.test(url)).length;
    const readsBeforeNavigation = directoryReads();
    fireEvent.click(screen.getByRole('button', { name: destination }));

    // The outgoing document's folder identity is temporarily unknown during
    // this real route transition. That must not blank the installed directory.
    expect(screen.getByTestId('content-item-page-one')).toBeVisible();
    expect(screen.getByTestId('content-item-page-three')).toBeVisible();
    expect(screen.queryByRole('heading', { name: destination })).not.toBeInTheDocument();
    expect(directoryReads()).toBe(readsBeforeNavigation);

    await act(async () => finishDocument(documentResponse(destination)));
    await screen.findByRole('heading', { name: destination });
    await waitFor(() => expect(screen.getByTestId(`content-item-${destination}`)).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByTestId('content-item-folder-a')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('content-item-folder-b')).toHaveAttribute('aria-expanded', 'true');
    expect(directoryReads()).toBe(readsBeforeNavigation);
  });

  it.each([401, 403])('clears the cached directory when the next document denies access with %s', async (status) => {
    vi.mocked(api.get).mockImplementation(async (url: string, config?: any) => {
      if (url === '/pages/page-two') throw { response: { status } };
      if (url === '/pages/page-one') return documentResponse('page-one');
      if (url === '/spaces/navigation-space') return { data: { id: 'navigation-space', name: 'Navigation space', members: [{ userId: 'navigation-user', role: 'viewer' }] } };
      if (url.endsWith('/folders')) return { data: { spaceId: 'navigation-space', treeRevision: '7', data: [{ ...folder('folder-a'), parentId: null }], nextCursor: null } };
      if (url.endsWith('/content-tree')) {
        const parentFolderId = config?.params?.parentFolderId ?? null;
        return { data: { spaceId: 'navigation-space', treeRevision: '7', parentFolderId, nextCursor: null,
          data: parentFolderId ? pageNodes.filter((node) => node.folderId === parentFolderId) : [folder('folder-a')],
        } };
      }
      if (url.includes('/page-templates/composite')) return { data: { templates: [], total: 0, skip: 0, take: 1, capabilities: { canCreate: false } } };
      if (url.startsWith('/knowledge/related/')) return { data: [] };
      throw new Error(`Unexpected GET ${url}`);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={[{ pathname: '/pages/page-one', state: { workspaceSpaceId: 'navigation-space' } }]}>
      <SpaceWorkspaceProvider userId="navigation-user"><Routes><Route path="/pages/:id" element={<PageRoute />} /></Routes></SpaceWorkspaceProvider>
    </MemoryRouter></LanguageProvider>);
    await screen.findByTestId('content-item-page-two');
    fireEvent.click(screen.getByRole('button', { name: 'page-two' }));
    await waitFor(() => expect(screen.queryByTestId('content-item-page-one')).not.toBeInTheDocument());
    expect(screen.queryByRole('tree')).not.toBeInTheDocument();
  });
});
