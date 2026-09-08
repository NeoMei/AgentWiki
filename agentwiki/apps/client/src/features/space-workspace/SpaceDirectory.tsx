import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FilePlus2, FolderTree, Search, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { ContentTree, type ContentTreeProps } from '../content-tree/ContentTree';
import type { DirectoryLevel } from './useSpaceDirectory';

export interface SpaceDirectoryProps extends Omit<ContentTreeProps,
  'nodes' | 'levelParentFolderId' | 'currentPageId' | 'selectedFolderId' | 'expandedFolderIds' | 'childLevels' | 'onToggleFolder' | 'onOpenFolder' | 'pageDeleteDisabled' | 'emptyText'> {
  spaceName: string;
  levels: ReadonlyMap<string | null, DirectoryLevel>;
  expandedFolderIds: ReadonlySet<string>;
  selectedFolderId: string | null;
  selectedPageId: string | null;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  pageDeleteDisabled?: boolean;
  onCreatePage?: () => void;
  onCreateFolder?: () => void;
  onRetry?: () => void;
  directoryScrollTop?: number;
  onDirectoryScrollTopChange?: (scrollTop: number) => void;
}

export const SpaceDirectory: React.FC<SpaceDirectoryProps> = ({
  spaceName,
  levels,
  expandedFolderIds,
  selectedFolderId,
  selectedPageId,
  onToggleFolder,
  onSelectFolder,
  pageDeleteDisabled = false,
  onCreatePage,
  onCreateFolder,
  onRetry,
  directoryScrollTop = 0,
  onDirectoryScrollTopChange,
  ...treeProps
}) => {
  const { t } = useLanguage();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenerRef = useRef<HTMLButtonElement>(null);
  const openedAtLocationRef = useRef<string | null>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const drawerScrollRef = useRef<HTMLDivElement>(null);
  const locationKey = `${location.pathname}${location.search}${location.hash}`;
  const rootLevel = levels.get(null);
  useLayoutEffect(() => {
    for (const scrollElement of [desktopScrollRef.current, drawerScrollRef.current]) {
      if (scrollElement && scrollElement.scrollTop !== directoryScrollTop) {
        scrollElement.scrollTop = directoryScrollTop;
      }
      if (scrollElement && rootLevel && directoryScrollTop === 0 && (selectedPageId || selectedFolderId)) {
        const selectedItem = scrollElement.querySelector<HTMLElement>('[role="treeitem"][aria-selected="true"]');
        if (typeof selectedItem?.scrollIntoView === 'function') selectedItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [directoryScrollTop, drawerOpen, rootLevel, selectedFolderId, selectedPageId]);
  useEffect(() => {
    if (drawerOpen && openedAtLocationRef.current !== locationKey) setDrawerOpen(false);
  }, [drawerOpen, locationKey]);
  const childLevels = new Map<string, DirectoryLevel['nodes']>();
  for (const [parentFolderId, level] of levels) {
    if (parentFolderId) childLevels.set(parentFolderId, level.nodes);
  }
  const renderDirectory = (scrollRef: React.RefObject<HTMLDivElement>, scrollTestId: string, titleId?: string) => <>
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
        <h2 id={titleId} className="truncate text-sm font-medium text-gray-600">{t('folder.treeTitle')}</h2>
        <Link to="/search" title={t('search.label')}
          className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <Search size={15} /> {t('search.label')}
        </Link>
        {titleId ? <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t('folder.closeDirectory')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <X size={17} />
        </button> : null}
      </div>
      {treeProps.canEdit && (onCreatePage || onCreateFolder) ? <div className="grid grid-cols-2 gap-2 border-b border-gray-100 p-3">
        {onCreatePage ? <button type="button" onClick={onCreatePage}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
          <FilePlus2 size={15} /> {t('page.new')}
        </button> : null}
        {onCreateFolder ? <button type="button" onClick={onCreateFolder}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
          {t('folder.createTitle')}
        </button> : null}
      </div> : null}
      <div ref={scrollRef} data-testid={scrollTestId} onScroll={(event) => {
        if (!treeProps.loading) onDirectoryScrollTopChange?.(event.currentTarget.scrollTop);
      }}
        className="min-h-0 flex-1 overflow-y-auto p-3">
        {treeProps.error && onRetry ? <button type="button" onClick={onRetry} className="mb-2 text-sm font-medium text-blue-700 underline">{t('common.retry')}</button> : null}
        <ContentTree
          {...treeProps}
          nodes={rootLevel?.nodes ?? []}
          levelParentFolderId={null}
          currentPageId={selectedPageId ?? undefined}
          selectedFolderId={selectedFolderId}
          expandedFolderIds={expandedFolderIds}
          childLevels={childLevels}
          onToggleFolder={onToggleFolder}
          onOpenFolder={onSelectFolder}
          pageDeleteDisabled={pageDeleteDisabled}
          emptyText=""
        />
      </div>
    </>;

  return <>
    <div className="border-b border-gray-200 bg-white px-3 py-2 lg:hidden">
      <button
        ref={drawerOpenerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
        onClick={() => {
          openedAtLocationRef.current = locationKey;
          setDrawerOpen(true);
        }}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <FolderTree size={17} /> {t('folder.openDirectory')}
      </button>
    </div>
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[260px] shrink-0 flex-col self-start border-r border-gray-200 bg-white lg:flex" aria-label={t('folder.directoryLabel', { space: spaceName })}>
      {renderDirectory(desktopScrollRef, 'space-directory-scroll')}
    </aside>
    {drawerOpen ? <ModalDialog
      labelledBy="space-directory-drawer-title"
      onRequestClose={() => setDrawerOpen(false)}
      returnFocusTo={drawerOpenerRef.current}
      overlayClassName="fixed inset-0 z-50 flex items-stretch justify-start bg-black/50 p-0"
      className="flex h-full w-[min(22rem,calc(100vw-2rem))] max-w-full flex-col bg-white shadow-2xl"
    >
      {renderDirectory(drawerScrollRef, 'space-directory-drawer-scroll', 'space-directory-drawer-title')}
    </ModalDialog> : null}
  </>;
};
