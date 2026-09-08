import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { LanguageProvider } from '../../context/LanguageContext';
import type { DirectoryLevel } from './useSpaceDirectory';
import { SpaceDirectory } from './SpaceDirectory';

const folder = { kind: 'folder' as const, id: 'guide', name: 'Guide', path: '/Guide', sortOrder: 0, createdAt: 'now', updatedAt: 'now', hasChildren: true };
const page = { kind: 'page' as const, id: 'page-a', folderId: 'guide', title: 'Same title', path: '/Guide/Same title', sortOrder: 0, createdAt: 'now', updatedAt: 'now' };
const Providers: FC<{ children: ReactNode }> = ({ children }) => (
  <LanguageProvider><MemoryRouter>{children}</MemoryRouter></LanguageProvider>
);

describe('SpaceDirectory', () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
  it('renders a persistent nested tree and expansion does not select the folder', () => {
    const levels = new Map<string | null, DirectoryLevel>([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [folder] }],
      ['guide', { parentFolderId: 'guide', treeRevision: '3', nodes: [page] }],
    ]);
    const onToggleFolder = vi.fn();
    const onSelectFolder = vi.fn();
    render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={levels} expandedFolderIds={new Set(['guide'])}
      selectedFolderId={null} selectedPageId="page-a" loading={false} error={null} canEdit={false}
      onToggleFolder={onToggleFolder} onSelectFolder={onSelectFolder} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);

    expect(screen.getByRole('heading', { name: 'Directory' })).toBeInTheDocument();
    expect(screen.getByTestId('content-item-page-a')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('content-toggle-guide'));
    expect(onToggleFolder).toHaveBeenCalledWith('guide');
    expect(onSelectFolder).not.toHaveBeenCalled();
  });

  it('shows retry inside a failed expanded branch without replacing navigable siblings', () => {
    const onOpenPage = vi.fn();
    const onRetryBranch = vi.fn();
    render(<Providers><SpaceDirectory spaceName="Wiki" levels={new Map([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [folder, page] }],
    ])} expandedFolderIds={new Set(['guide'])} selectedFolderId={null} selectedPageId={null}
      loading={false} error={null} canEdit={false} branchErrors={new Map([['guide', 'Branch unavailable']])}
      onRetryBranch={onRetryBranch} onToggleFolder={() => undefined} onSelectFolder={() => undefined}
      onOpenPage={onOpenPage} onEditPage={() => undefined} onDeletePage={() => undefined}
      onCreateSubfolder={() => undefined} onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);
    const branch = screen.getByTestId('content-item-guide');
    expect(within(branch).getByText('Branch unavailable')).toBeInTheDocument();
    fireEvent.click(within(branch).getByRole('button', { name: 'Retry' }));
    expect(onRetryBranch).toHaveBeenCalledWith('guide');
    fireEvent.click(screen.getByTestId('content-node-page-a'));
    expect(onOpenPage).toHaveBeenCalledWith(page);
  });

  it('exposes the shared new-page intent from a page route', () => {
    const onCreatePage = vi.fn();
    const onCreateFolder = vi.fn();
    render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId="page-a" loading={false} error={null} canEdit
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined}
      onCreatePage={onCreatePage} onCreateFolder={onCreateFolder} />
    </Providers>);

    fireEvent.click(screen.getByRole('button', { name: 'New page' }));
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(onCreatePage).toHaveBeenCalledTimes(1);
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
  });

  it('restores and reports the workspace-owned scroll position', () => {
    const onDirectoryScrollTopChange = vi.fn();
    const { rerender } = render(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId={null} loading={false} error={null} canEdit={false}
      directoryScrollTop={120} onDirectoryScrollTopChange={onDirectoryScrollTopChange}
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);
    const scroller = screen.getByTestId('space-directory-scroll');
    expect(scroller.scrollTop).toBe(120);
    scroller.scrollTop = 245;
    fireEvent.scroll(scroller);
    expect(onDirectoryScrollTopChange).toHaveBeenLastCalledWith(245);

    rerender(<Providers><SpaceDirectory spaceName="Product Wiki" levels={new Map()} expandedFolderIds={new Set()}
      selectedFolderId={null} selectedPageId={null} loading={false} error={null} canEdit={false}
      directoryScrollTop={80} onDirectoryScrollTopChange={onDirectoryScrollTopChange}
      onToggleFolder={() => undefined} onSelectFolder={() => undefined} onOpenPage={() => undefined}
      onEditPage={() => undefined} onDeletePage={() => undefined} onCreateSubfolder={() => undefined}
      onRenameFolder={() => undefined} onDeleteFolder={() => undefined} onMove={() => undefined} />
    </Providers>);
    expect(scroller.scrollTop).toBe(80);
  });

  it('replays a persisted scroll position after the directory levels finish loading', () => {
    const onDirectoryScrollTopChange = vi.fn();
    const commonProps = {
      spaceName: 'Product Wiki', expandedFolderIds: new Set<string>(), selectedFolderId: null,
      selectedPageId: 'page-a', error: null, canEdit: false, directoryScrollTop: 245,
      onDirectoryScrollTopChange, onToggleFolder: () => undefined, onSelectFolder: () => undefined,
      onOpenPage: () => undefined, onEditPage: () => undefined, onDeletePage: () => undefined,
      onCreateSubfolder: () => undefined, onRenameFolder: () => undefined,
      onDeleteFolder: () => undefined, onMove: () => undefined,
    };
    const { rerender } = render(<Providers><SpaceDirectory {...commonProps} levels={new Map()} loading /></Providers>);
    const scroller = screen.getByTestId('space-directory-scroll');
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(onDirectoryScrollTopChange).not.toHaveBeenCalled();

    rerender(<Providers><SpaceDirectory {...commonProps} levels={new Map([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [page] }],
    ])} loading={false} /></Providers>);

    expect(scroller.scrollTop).toBe(245);
  });

  it('reveals the selected item only when no directory scroll position has been saved', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const levels = new Map<string | null, DirectoryLevel>([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [page] }],
    ]);
    const commonProps = {
      spaceName: 'Product Wiki', levels, expandedFolderIds: new Set<string>(), selectedFolderId: null,
      selectedPageId: 'page-a', loading: false, error: null, canEdit: false,
      onToggleFolder: () => undefined, onSelectFolder: () => undefined, onOpenPage: () => undefined,
      onEditPage: () => undefined, onDeletePage: () => undefined, onCreateSubfolder: () => undefined,
      onRenameFolder: () => undefined, onDeleteFolder: () => undefined, onMove: () => undefined,
    };
    const { rerender } = render(<Providers><SpaceDirectory {...commonProps} directoryScrollTop={0} /></Providers>);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

    scrollIntoView.mockClear();
    rerender(<Providers><SpaceDirectory {...commonProps} selectedPageId="page-b" directoryScrollTop={245} /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens the mobile directory as a modal drawer, closes on navigation, and restores focus on Escape', async () => {
    const levels = new Map<string | null, DirectoryLevel>([
      [null, { parentFolderId: null, treeRevision: '3', nodes: [folder] }],
      ['guide', { parentFolderId: 'guide', treeRevision: '3', nodes: [page] }],
    ]);
    const Harness = () => {
      const navigate = useNavigate();
      return <SpaceDirectory spaceName="Product Wiki" levels={levels} expandedFolderIds={new Set(['guide'])}
        selectedFolderId={null} selectedPageId={null} loading={false} error={null} canEdit={false}
        onToggleFolder={() => undefined} onSelectFolder={(folderId) => navigate(`/spaces/space-1?folder=${folderId}`)}
        onOpenPage={(selectedPage) => navigate(`/pages/${selectedPage.id}`)} onEditPage={() => undefined}
        onDeletePage={() => undefined} onCreateSubfolder={() => undefined} onRenameFolder={() => undefined}
        onDeleteFolder={() => undefined} onMove={() => undefined} />;
    };
    render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/space-1']}><Routes>
      <Route path="/spaces/:id" element={<Harness />} />
      <Route path="/pages/:id" element={<p>Article route</p>} />
    </Routes></MemoryRouter></LanguageProvider>);

    const opener = screen.getByRole('button', { name: 'Open directory' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Directory' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close directory' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Directory' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    const reopenedDialog = screen.getByRole('dialog', { name: 'Directory' });
    fireEvent.click(reopenedDialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Directory' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Directory' })).getByTestId('content-node-guide'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Directory' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());

    fireEvent.click(opener);
    const dialogBeforeCancelledNavigation = screen.getByRole('dialog', { name: 'Directory' });
    fireEvent.click(within(dialogBeforeCancelledNavigation).getByTestId('content-node-guide'));
    expect(dialogBeforeCancelledNavigation).toBeInTheDocument();

    fireEvent.click(within(dialogBeforeCancelledNavigation).getByTestId('content-node-page-a'));
    expect(await screen.findByText('Article route')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Directory' })).not.toBeInTheDocument();
  });
});
