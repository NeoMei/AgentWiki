import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FilePlus2, FolderTree, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { ModalDialog } from '../../components/ModalDialog';
import { useLanguage } from '../../context/LanguageContext';
import { clampDirectoryWidth, type DirectorySelectionState } from './workspacePreferences';
import { ContentTree, InlineTreeName, type ContentTreeProps } from '../content-tree/ContentTree';
import type { DirectoryLevel } from './useSpaceDirectory';

export interface SpaceDirectoryProps extends Omit<ContentTreeProps,
  'nodes' | 'levelParentFolderId' | 'currentPageId' | 'selectedFolderId' | 'expandedFolderIds' | 'childLevels' | 'onToggleFolder' | 'onOpenFolder' | 'pageDeleteDisabled' | 'emptyText'> {
  spaceName: string;
  preferenceScopeKey?: string;
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
  directorySelection?: DirectorySelectionState;
  onDirectoryScrollTopChange?: (scrollTop: number) => void;
  directoryWidth?: number;
  onDirectoryWidthChange?: (width: number) => void;
  directoryCollapsed?: boolean;
  onDirectoryCollapsedChange?: (collapsed: boolean) => void;
  onRevealCurrent?: () => void;
  onCreateFolderAtSelection?: (name: string) => Promise<void>;
  onCreatePageAtSelection?: (title: string) => Promise<void>;
}

export const SpaceDirectory: React.FC<SpaceDirectoryProps> = ({
  spaceName,
  preferenceScopeKey = spaceName,
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
  directorySelection,
  onDirectoryScrollTopChange,
  directoryWidth = 260,
  onDirectoryWidthChange,
  directoryCollapsed = false,
  onDirectoryCollapsedChange,
  onRevealCurrent,
  onCreateFolderAtSelection,
  onCreatePageAtSelection,
  ...treeProps
}) => {
  const { t, language } = useLanguage();
  const copy = (zh: string, en: string) => language === 'zh-CN' ? zh : en;
  const [filter, setFilter] = useState('');
  const [creation, setCreation] = useState<'folder' | 'page' | null>(null);
  const localSelectionRef = useRef<DirectorySelectionState>({ scope: '', pageId: null, pending: { desktop: false, drawer: false } });
  const selectionState = directorySelection ?? localSelectionRef.current;
  const scrollRestorationRef = useRef(new WeakMap<HTMLElement, { scope: string; scrollTop: number; query: string; restoring: boolean }>());
  const resizeRef = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const width = clampDirectoryWidth(directoryWidth);
  const query = filter.trim().toLocaleLowerCase();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenerRef = useRef<HTMLButtonElement>(null);
  const openedAtLocationRef = useRef<string | null>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const drawerScrollRef = useRef<HTMLDivElement>(null);
  const locationKey = `${location.pathname}${location.search}${location.hash}`;
  const rootLevel = levels.get(null);
  useEffect(() => { if (!treeProps.canEdit) setCreation(null); }, [treeProps.canEdit]);
  useEffect(() => { setFilter(''); setCreation(null); }, [preferenceScopeKey]);
  useEffect(() => { setCreation(null); }, [treeProps.mutationScopeKey]);
  const selectedItemIn = useCallback((scroller: HTMLElement) => {
    if (!selectedPageId && !selectedFolderId) return null;
    return scroller.querySelector<HTMLElement>(selectedPageId
      ? '[role="treeitem"][aria-selected="true"]:not([aria-expanded])'
      : '[role="treeitem"][aria-selected="true"][aria-expanded]');
  }, [selectedFolderId, selectedPageId]);
  const restoreAndReveal = useCallback(() => {
    for (const [surface, scroller] of [['desktop', desktopScrollRef.current], ['drawer', drawerScrollRef.current]] as const) {
      if (!scroller) continue;
      const previous = scrollRestorationRef.current.get(scroller);
      const loading = !rootLevel || treeProps.loading;
      const viewport = scroller.getBoundingClientRect();
      const hidden = viewport.height === 0 || viewport.width === 0;
      // Replay saved scroll only for a new surface/scope, changed preference, completed
      // initial/hidden layout, or return from filtering. A tree refresh must not undo user scroll.
      if (!previous || previous.scope !== preferenceScopeKey || previous.scrollTop !== directoryScrollTop
        || previous.restoring || (previous.query && !query)) {
        if (!query && scroller.scrollTop !== directoryScrollTop) scroller.scrollTop = directoryScrollTop;
      }
      scrollRestorationRef.current.set(scroller, { scope: preferenceScopeKey, scrollTop: directoryScrollTop, query, restoring: loading || hidden });
      if (!selectionState.pending[surface] || loading) continue;
      const selected = selectedItemIn(scroller);
      // Hidden desktop trees and closed drawers cannot consume another surface's reveal.
      if (!selected || hidden) continue;
      const row = selected.getBoundingClientRect();
      if (row.top < viewport.top || row.bottom > viewport.bottom) selected.scrollIntoView?.({ block: 'nearest' });
      selectionState.pending[surface] = false;
    }
  }, [directoryScrollTop, preferenceScopeKey, query, rootLevel, selectedItemIn, selectionState, treeProps.loading]);
  useLayoutEffect(() => {
    const previous = selectionState;
    if (previous.scope !== preferenceScopeKey) {
      selectionState.pending = { desktop: directoryScrollTop === 0, drawer: directoryScrollTop === 0 };
    } else if (previous.pageId !== selectedPageId) {
      selectionState.pending = { desktop: Boolean(selectedPageId), drawer: Boolean(selectedPageId) };
      if (selectedPageId && query && ![desktopScrollRef.current, drawerScrollRef.current].some((scroller) => scroller && selectedItemIn(scroller))) setFilter('');
    }
    selectionState.scope = preferenceScopeKey;
    selectionState.pageId = selectedPageId;
    restoreAndReveal();
  }, [preferenceScopeKey, selectedPageId, directoryScrollTop, query, selectedItemIn, selectionState, restoreAndReveal, directoryCollapsed, drawerOpen, levels, expandedFolderIds]);
  useEffect(() => {
    const resize = () => {

      restoreAndReveal();
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [restoreAndReveal]);
  useEffect(() => {
    if (drawerOpen && openedAtLocationRef.current !== locationKey) setDrawerOpen(false);
  }, [drawerOpen, locationKey]);
  const childLevels = new Map<string, DirectoryLevel['nodes']>();
  for (const [parentFolderId, level] of levels) {
    if (parentFolderId) childLevels.set(parentFolderId, level.nodes);
  }
  // Filter only nodes already loaded through authorized tree requests. Never fetch hidden branches to imply Space-wide coverage.
  const filteredLevels = new Map<string | null, DirectoryLevel['nodes']>();
  const filterExpanded = new Set<string>();
  const visit = (parent: string | null, seen = new Set<string>()): DirectoryLevel['nodes'] => {
    const result: DirectoryLevel['nodes'] = [];
    for (const node of levels.get(parent)?.nodes ?? []) {
      const children = node.kind === 'folder' && !seen.has(node.id) ? visit(node.id, new Set(seen).add(node.id)) : [];
      const matches = (node.kind === 'page' ? node.title : node.name).toLocaleLowerCase().includes(query);
      if (matches || children.length) {
        result.push(node);
        if (node.kind === 'folder') {
          filteredLevels.set(node.id, children);
          if (children.length) filterExpanded.add(node.id);
        }
      }
    }
    return result;
  };
  const visibleRoots = query ? visit(null) : rootLevel?.nodes ?? [];
  const revealCurrent = () => {
    selectionState.pending = { desktop: true, drawer: true };
    setFilter('');
    onRevealCurrent?.();
    if (!query) restoreAndReveal();
  };
  const renderDirectory = (scrollRef: React.RefObject<HTMLDivElement>, scrollTestId: string, titleId?: string) => <>
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
        <h2 id={titleId} className="truncate text-sm font-medium text-gray-600">{t('folder.treeTitle')}</h2>
        {titleId ? <button type="button" onClick={() => setDrawerOpen(false)} aria-label={t('folder.closeDirectory')}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <X size={17} />
        </button> : null}
      </div>
      {treeProps.canEdit && (onCreatePage || onCreateFolder || onCreateFolderAtSelection) ? <div className="grid grid-cols-2 gap-2 border-b border-gray-100 p-3">
        {onCreatePage ? <button type="button" onClick={() => onCreatePageAtSelection ? setCreation('page') : onCreatePage?.()}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
          <FilePlus2 size={15} /> {t('page.new')}
        </button> : null}
        {onCreateFolder || onCreateFolderAtSelection ? <button type="button" onClick={() => onCreateFolderAtSelection ? setCreation('folder') : onCreateFolder?.()}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-gray-300 px-2 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
          {t('folder.createTitle')}
        </button> : null}
        {onCreatePageAtSelection && onCreatePage ? <button type="button" onClick={onCreatePage} className="col-span-2 min-h-8 text-left text-xs text-gray-600">{copy('模板…', 'Templates…')}</button> : null}
      </div> : null}
      <div className="space-y-2 border-b border-gray-100 px-3 py-2">
        <label className="block text-xs text-gray-500">{copy('过滤已加载项目', 'Filter loaded items')}
          <input aria-label={copy('过滤已加载项目', 'Filter loaded items')} value={filter} onChange={(event) => setFilter(event.target.value)} type="search"
            className="mt-1 min-h-8 w-full rounded border border-gray-200 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </label>
        <p className="text-xs text-gray-400">{copy('仅包含已加载目录，未加载分支不在范围内。', 'Only loaded items; unloaded branches are excluded.')}</p>
        <div className="flex flex-wrap gap-2 text-xs text-gray-600">
          {selectedPageId ? <button type="button" onClick={revealCurrent}>{copy('定位当前文档', 'Reveal current document')}</button> : null}
          {!titleId && onDirectoryCollapsedChange ? <button type="button" onClick={() => onDirectoryCollapsedChange(true)}>{copy('收起目录', 'Collapse directory')}</button> : null}
        </div>
        {creation === 'page' && onCreatePageAtSelection ? <InlineTreeName key={`page:${treeProps.mutationScopeKey}:${selectedFolderId}:${selectedPageId}`} label={t('page.new')} onSubmit={onCreatePageAtSelection} onCancel={() => setCreation(null)} /> : null}
        {creation === 'folder' && onCreateFolderAtSelection ? <InlineTreeName key={`folder:${treeProps.mutationScopeKey}:${selectedFolderId}:${selectedPageId}`} label={t('folder.createTitle')} onSubmit={onCreateFolderAtSelection} onCancel={() => setCreation(null)} /> : null}
      </div>
      <div ref={scrollRef} data-testid={scrollTestId} data-content-tree-scrollport
        onScroll={(event) => {
        if (!treeProps.loading && !query) onDirectoryScrollTopChange?.(event.currentTarget.scrollTop);
      }}
        className="min-h-0 flex-1 overflow-y-auto p-3">
        {treeProps.error && onRetry ? <button type="button" onClick={onRetry} className="mb-2 text-sm font-medium text-blue-700 underline">{t('common.retry')}</button> : null}
        <ContentTree
          {...treeProps}
          nodes={visibleRoots}
          highlightQuery={filter}
          levelParentFolderId={null}
          currentPageId={selectedPageId ?? undefined}
          selectedFolderId={selectedFolderId}
          expandedFolderIds={query ? filterExpanded : expandedFolderIds}
          childLevels={query ? new Map([...filteredLevels].flatMap(([id, nodes]) => id ? [[id, nodes] as const] : [])) : childLevels}
          reorderDisabled={Boolean(query)}
          onToggleFolder={query ? undefined : onToggleFolder}
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
    {directoryCollapsed ? <button type="button" onClick={() => onDirectoryCollapsedChange?.(false)} className="hidden self-start px-2 py-3 text-xs text-gray-600 lg:block">{copy('展开目录', 'Expand directory')}</button> : <aside style={{ width }} className="sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col self-start border-r border-gray-200 bg-white lg:flex" aria-label={t('folder.directoryLabel', { space: spaceName })}>
      {renderDirectory(desktopScrollRef, 'space-directory-scroll')}
    </aside>}
    {!directoryCollapsed ? <div role="separator" aria-label={copy('调整目录宽度', 'Resize directory')} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={420} aria-valuenow={width}
      tabIndex={0} className="sticky top-16 hidden h-[calc(100vh-4rem)] w-1 shrink-0 cursor-col-resize touch-none bg-gray-100 hover:bg-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:block"
      onKeyDown={(event) => {
        const next = event.key === 'ArrowLeft' ? width - 10 : event.key === 'ArrowRight' ? width + 10 : event.key === 'Home' ? 220 : event.key === 'End' ? 420 : null;
        if (next !== null) { event.preventDefault(); onDirectoryWidthChange?.(clampDirectoryWidth(next)); }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        resizeRef.current = { x: event.clientX, width, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const start = resizeRef.current;
        if (start && start.pointerId === event.pointerId) onDirectoryWidthChange?.(clampDirectoryWidth(start.width + event.clientX - start.x));
      }}
      onPointerUp={(event) => { resizeRef.current = null; event.currentTarget.releasePointerCapture?.(event.pointerId); }}
      onPointerCancel={() => { resizeRef.current = null; }}
    /> : null}
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
