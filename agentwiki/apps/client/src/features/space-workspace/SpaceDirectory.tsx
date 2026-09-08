import React, { useLayoutEffect, useRef } from 'react';
import { FilePlus2, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollRef.current && scrollRef.current.scrollTop !== directoryScrollTop) {
      scrollRef.current.scrollTop = directoryScrollTop;
    }
  }, [directoryScrollTop]);
  const childLevels = new Map<string, DirectoryLevel['nodes']>();
  for (const [parentFolderId, level] of levels) {
    if (parentFolderId) childLevels.set(parentFolderId, level.nodes);
  }
  return (
    <aside className="w-full border-b border-gray-200 bg-white lg:sticky lg:top-16 lg:flex lg:h-[calc(100vh-4rem)] lg:w-[260px] lg:shrink-0 lg:flex-col lg:self-start lg:border-b-0 lg:border-r" aria-label={t('folder.directoryLabel', { space: spaceName })}>
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
        <h2 className="truncate text-sm font-medium text-gray-600">{t('folder.treeTitle')}</h2>
        <Link to="/search" title={t('search.label')}
          className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <Search size={15} /> {t('search.label')}
        </Link>
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
      <div ref={scrollRef} data-testid="space-directory-scroll" onScroll={(event) => onDirectoryScrollTopChange?.(event.currentTarget.scrollTop)}
        className="max-h-[42vh] overflow-y-auto p-3 lg:min-h-0 lg:max-h-none lg:flex-1">
        {treeProps.error && onRetry ? <button type="button" onClick={onRetry} className="mb-2 text-sm font-medium text-blue-700 underline">{t('common.retry')}</button> : null}
        <ContentTree
          {...treeProps}
          nodes={levels.get(null)?.nodes ?? []}
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
    </aside>
  );
};
