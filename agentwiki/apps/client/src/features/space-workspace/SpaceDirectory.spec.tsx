import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FC, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
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

  it('reveals an offscreen selected item on initial load only when no scroll position was saved', () => {
    const scrollIntoView = vi.fn();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.getAttribute('role') === 'treeitem' ? new DOMRect(0, 400, 240, 40) : new DOMRect(0, 100, 260, 200);
    });
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

describe('directory tools', () => {
  const levels = new Map<string | null, DirectoryLevel>([[null, { parentFolderId: null, treeRevision: '3', nodes: [folder] }], ['guide', { parentFolderId: 'guide', treeRevision: '3', nodes: [page] }]]);
  const props = { spaceName: 'Wiki', levels, expandedFolderIds: new Set<string>(), selectedFolderId: null, selectedPageId: 'page-a', loading: false, error: null, canEdit: true, onToggleFolder: vi.fn(), onSelectFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(), onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn() };
  it('filters loaded items with ancestor context, disables reorder, and restores expansion', () => {
    render(<Providers><SpaceDirectory {...props} /></Providers>); expect(screen.queryByTestId('content-node-page-a')).not.toBeInTheDocument(); const filter = screen.getByRole('searchbox', { name: 'Filter loaded items' }); fireEvent.change(filter, { target: { value: 'Same title' } }); expect(screen.getByTestId('content-node-guide')).toBeInTheDocument(); expect(screen.getByTestId('content-node-page-a').querySelector('mark')).toHaveTextContent('Same title'); expect(screen.getByTestId('content-row-page-a')).toHaveAttribute('draggable', 'false'); fireEvent.change(filter, { target: { value: '' } }); expect(screen.queryByTestId('content-node-page-a')).not.toBeInTheDocument(); expect(props.onToggleFolder).not.toHaveBeenCalled();
  });
  it('keeps the saved scroll position while browsing filter results', () => {
    const onDirectoryScrollTopChange = vi.fn(); render(<Providers><SpaceDirectory {...props} directoryScrollTop={145} onDirectoryScrollTopChange={onDirectoryScrollTopChange} /></Providers>);
    const scroller = screen.getByTestId('space-directory-scroll'); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Same' } }); scroller.scrollTop = 20; fireEvent.scroll(scroller);
    expect(onDirectoryScrollTopChange).not.toHaveBeenCalled(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } }); expect(scroller.scrollTop).toBe(145);
  });
  it('resizes via pointer drag, clamps the maximum, and stops on pointer release', () => {
    const onDirectoryWidthChange = vi.fn(); render(<Providers><SpaceDirectory {...props} directoryWidth={260} onDirectoryWidthChange={onDirectoryWidthChange} /></Providers>);
    const separator = screen.getByRole('separator', { name: 'Resize directory' });
    const pointer = (kind: 'pointerDown' | 'pointerMove' | 'pointerUp', clientX: number) => {
      const event = createEvent[kind](separator); Object.defineProperties(event, { clientX: { value: clientX }, pointerId: { value: 7 }, button: { value: 0 } }); fireEvent(separator, event);
    };
    pointer('pointerDown', 100); pointer('pointerMove', 160); expect(onDirectoryWidthChange).toHaveBeenLastCalledWith(320);
    pointer('pointerMove', 500); expect(onDirectoryWidthChange).toHaveBeenLastCalledWith(420);
    pointer('pointerUp', 500); onDirectoryWidthChange.mockClear(); pointer('pointerMove', 170); expect(onDirectoryWidthChange).not.toHaveBeenCalled();
  });
  it('reveals current document by clearing the filter and requesting its ancestry', () => {
    const onRevealCurrent = vi.fn(); render(<Providers><SpaceDirectory {...props} onRevealCurrent={onRevealCurrent} /></Providers>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } }); fireEvent.click(screen.getByRole('button', { name: 'Reveal current document' }));
    expect(screen.getByRole('searchbox')).toHaveValue(''); expect(onRevealCurrent).toHaveBeenCalledTimes(1);
  });
  it('resizes via keyboard within bounds and exposes width', () => {
    const onDirectoryWidthChange = vi.fn(); render(<Providers><SpaceDirectory {...props} directoryWidth={415} onDirectoryWidthChange={onDirectoryWidthChange} /></Providers>); const separator = screen.getByRole('separator', { name: 'Resize directory' }); expect(separator).toHaveAttribute('aria-valuenow', '415'); fireEvent.keyDown(separator, { key: 'ArrowRight' }); expect(onDirectoryWidthChange).toHaveBeenLastCalledWith(420); fireEvent.keyDown(separator, { key: 'Home' }); expect(onDirectoryWidthChange).toHaveBeenLastCalledWith(220);
  });
});


describe('directory selection continuity', () => {
  const nextPage = { ...page, id: 'page-b', title: 'Next document' };
  const levels = new Map<string | null, DirectoryLevel>([
    [null, { parentFolderId: null, treeRevision: '3', nodes: [folder] }],
    ['guide', { parentFolderId: 'guide', treeRevision: '3', nodes: [page, nextPage] }],
  ]);
  const props = {
    spaceName: 'Wiki', preferenceScopeKey: 'user-a:space-a', levels,
    expandedFolderIds: new Set(['guide']), selectedFolderId: null, selectedPageId: 'page-a',
    loading: false, error: null, canEdit: false, directoryScrollTop: 245,
    onToggleFolder: vi.fn(), onSelectFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(),
    onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn(),
  };
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let rowTop: number;
  let desktopVisible: boolean;
  beforeEach(() => {
    rowTop = 400;
    desktopVisible = true;
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') === 'space-directory-scroll' && !desktopVisible) return new DOMRect();
      return this.getAttribute('role') === 'treeitem' ? new DOMRect(0, rowTop, 240, 40) : new DOMRect(0, 100, 260, 200);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('reveals a new offscreen page despite saved scroll without moving focus or mutating the tree', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    const filter = screen.getByRole('searchbox'); filter.focus();
    expect(screen.getByTestId('space-directory-scroll').scrollTop).toBe(245);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('content-item-page-b'));
    expect(filter).toHaveFocus();
    expect(props.onToggleFolder).not.toHaveBeenCalled(); expect(props.onMove).not.toHaveBeenCalled();
  });

  it('does not scroll a newly selected fully visible row or reveal it again after a later refresh', () => {
    rowTop = 180;
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled(); rowTop = 400;
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" levels={new Map(levels)} /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('preserves same-page manual scrolling on unrelated refreshes, including a saved zero', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} directoryScrollTop={0} /></Providers>);
    scrollIntoView.mockClear(); const scroller = screen.getByTestId('space-directory-scroll');
    scroller.scrollTop = 680; fireEvent.scroll(scroller);
    rerender(<Providers><SpaceDirectory {...props} directoryScrollTop={0} levels={new Map(levels)} /></Providers>);
    expect(scroller.scrollTop).toBe(680); expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('waits for loaded ancestry and expansion, then consumes the new-page reveal once', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    const rootOnly = new Map<string | null, DirectoryLevel>([[null, levels.get(null)!]]);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" levels={rootOnly} expandedFolderIds={new Set()} loading /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" levels={levels} expandedFolderIds={new Set()} /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" levels={new Map(levels)} /></Providers>);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('clears a filter hiding the new current page before revealing it', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Same title' } });
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByTestId('content-item-page-b')).toHaveAttribute('aria-selected', 'true');
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('retains a filter that includes the new current page', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Next' } });
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(screen.getByRole('searchbox')).toHaveValue('Next');
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('keeps a pending page change until the collapsed directory reopens', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} directoryCollapsed /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" directoryCollapsed /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
  });

  it('waits for the mobile drawer when desktop is hidden and reveals once on reopening', () => {
    desktopVisible = false;
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open directory' }));
    const dialog = screen.getByRole('dialog', { name: 'Directory' });
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    expect(scrollIntoView.mock.instances[0]).toBe(within(dialog).getByTestId('content-item-page-b'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close directory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open directory' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('replays initial saved scroll when a hidden desktop surface first becomes measurable', () => {
    desktopVisible = false;
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const scroller = screen.getByTestId('space-directory-scroll');
    // display:none cannot retain a browser scroll offset until it has layout.
    scroller.scrollTop = 0;
    desktopVisible = true;
    fireEvent.resize(window);
    expect(scroller.scrollTop).toBe(245);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('reveals a pending current row when a hidden desktop directory becomes visible on resize', () => {
    desktopVisible = false;
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="page-b" /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    desktopVisible = true;
    fireEvent.resize(window);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
    fireEvent.resize(window);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('restores saved unfiltered scroll before manual reveal even when the filter includes the current page', () => {
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const scroller = screen.getByTestId('space-directory-scroll');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Same' } });
    scroller.scrollTop = 20;
    const scrollAtReveal: number[] = [];
    scrollIntoView.mockImplementation(() => { scrollAtReveal.push(scroller.scrollTop); scroller.scrollTop = 600; });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal current document' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(scrollAtReveal).toEqual([245]);
    expect(scroller.scrollTop).toBe(600);
  });

  it('drops old pending reveal on scope change and restores the new saved position', () => {
    const { rerender } = render(<Providers><SpaceDirectory {...props} /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} selectedPageId="missing" /></Providers>);
    rerender(<Providers><SpaceDirectory {...props} preferenceScopeKey="user-b:space-b" selectedPageId="page-b" directoryScrollTop={80} /></Providers>);
    expect(screen.getByTestId('space-directory-scroll').scrollTop).toBe(80);
    expect(scrollIntoView).not.toHaveBeenCalled();
    rerender(<Providers><SpaceDirectory {...props} preferenceScopeKey="user-b:space-b" selectedPageId="page-b" directoryScrollTop={80} levels={new Map(levels)} /></Providers>);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('directory action menu placement', () => {
  const levels = new Map<string | null, DirectoryLevel>([[null, { parentFolderId: null, treeRevision: '3', nodes: [page] }]]);
  const props = {
    spaceName: 'Wiki', levels, expandedFolderIds: new Set<string>(), selectedFolderId: null, selectedPageId: null,
    loading: false, error: null, canEdit: true, directoryScrollTop: 245,
    onToggleFolder: vi.fn(), onSelectFolder: vi.fn(), onOpenPage: vi.fn(), onEditPage: vi.fn(),
    onDeletePage: vi.fn(), onCreateSubfolder: vi.fn(), onRenameFolder: vi.fn(), onDeleteFolder: vi.fn(), onMove: vi.fn(),
  };
  let summaryTop: number;
  let menuHeight: number;
  beforeEach(() => {
    summaryTop = 674;
    menuHeight = 100;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('aria-haspopup') === 'menu') return new DOMRect(190, summaryTop, 28, 28);
      if (this.getAttribute('role') === 'menu') return new DOMRect(42, summaryTop + 32, 176, menuHeight);
      return new DOMRect(0, 280, 260, 440);
    });
  });
  afterEach(() => vi.restoreAllMocks());
  const menuElements = () => {
    const summary = screen.getByLabelText('Actions: Same title');
    const details = summary.parentElement!;
    const menu = details.querySelector<HTMLElement>('[role="menu"]')!;
    return { summary, details, menu };
  };

  it('opens a bottom row menu above its trigger inside the scrollport', () => {
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const { summary, menu } = menuElements();
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(menu).toHaveStyle({ top: 'auto', bottom: '98px', maxHeight: '390px', overflowY: 'auto' });
    expect(props.onEditPage).not.toHaveBeenCalled();
  });

  it('keeps enough downward room and caps tall menus to the larger available side', () => {
    summaryTop = 300;
    menuHeight = 600;
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const { summary, menu } = menuElements();
    fireEvent.click(summary);
    expect(menu).toHaveStyle({ top: '332px', bottom: 'auto', maxHeight: '388px', overflowY: 'auto' });
  });

  it('positions keyboard-opened menus before focusing actions, retains Escape, and closes on directory scrolling', () => {
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const { summary, menu } = menuElements();
    summary.focus();
    fireEvent.keyDown(summary, { key: 'ArrowDown' });
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(menu).toHaveStyle({ bottom: '98px' });
    expect(within(menu).getByRole('button', { name: 'Edit page' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(summary).toHaveAttribute('aria-expanded', 'false'); expect(summary).toHaveFocus();
    fireEvent.keyDown(summary, { key: 'Enter' });
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    fireEvent.scroll(screen.getByTestId('space-directory-scroll'));
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('allows scrolling within a tall action menu without dismissing it', () => {
    menuHeight = 600;
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const { summary, menu } = menuElements();
    fireEvent.click(summary);
    fireEvent.scroll(menu);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
  });

  it('dismisses an open menu when pointer interaction leaves the menu', () => {
    render(<Providers><SpaceDirectory {...props} /></Providers>);
    const { summary } = menuElements();
    fireEvent.click(summary);
    fireEvent.pointerDown(screen.getByRole('searchbox'));
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });
});
