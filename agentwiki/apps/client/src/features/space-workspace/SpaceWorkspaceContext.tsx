import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clampDirectoryWidth, clampOutlineWidth, clampCollaborationWidth, defaultWorkspacePreferences, readWorkspacePreferences, writeWorkspacePreferences, type WorkspacePreferences, type PanelPreferences, type DirectorySelectionState } from './workspacePreferences';
import type { SpaceNavSection } from './workspaceNavigation';

export type SpaceWorkspaceMode = 'directory' | 'read' | 'edit' | 'versions' | 'section';

type BrowsingState = WorkspacePreferences;

interface WorkspaceRegistryValue {
  userId: string;
  stateFor: (spaceId: string) => BrowsingState;
  selectionFor: (spaceId: string) => DirectorySelectionState;
  updateState: (spaceId: string, update: (current: BrowsingState) => BrowsingState) => void;
}

export interface SpaceWorkspaceContextValue extends BrowsingState {
  directorySelection?: DirectorySelectionState;
  userId: string;
  spaceId: string | null;
  mode: SpaceWorkspaceMode;
  activeSection: SpaceNavSection;
  selectedFolderId: string | null;
  selectedPageId: string | null;
  selectedPageFolderId: string | null;
  pageRefreshRequest: number;
  pageDeleted?: boolean;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  setDirectoryScrollTop: (scrollTop: number) => void;
  setDirectoryWidth: (width: number) => void;
  setDirectoryCollapsed: (collapsed: boolean) => void;
  setPanelPreferences: (preferences: PanelPreferences) => void;
  selectFolder: (folderId: string | null) => void;
  reportPageIdentity: (pageId: string, spaceId: string | null, folderId?: string | null) => void;
  requestPageRefresh: (pageId: string, options?: { deleted?: boolean }) => void;
  directoryCrumbs: ReadonlyArray<{ id: string | null; name: string }>;
  reportDirectoryCrumbs: (crumbs: ReadonlyArray<{ id: string | null; name: string }>) => void;
}

const EMPTY_STATE = defaultWorkspacePreferences();

const WorkspaceRegistryContext = createContext<WorkspaceRegistryValue | null>(null);
const SpaceWorkspaceContext = createContext<SpaceWorkspaceContextValue | null>(null);

export const SpaceWorkspaceProvider: React.FC<{ userId: string; children: React.ReactNode }> = ({ userId, children }) => {
  const statesRef = useRef(new Map<string, BrowsingState>());
  const selectionsRef = useRef(new Map<string, DirectorySelectionState>());
  const [revision, setRevision] = useState(0);
  const scopeKey = useCallback((spaceId: string) => `${userId}\u0000${spaceId}`, [userId]);
  const stateFor = useCallback((spaceId: string) => {
    const key = scopeKey(spaceId);
    if (!statesRef.current.has(key)) statesRef.current.set(key, readWorkspacePreferences(userId, spaceId));
    return statesRef.current.get(key)!;
  }, [scopeKey, userId, revision]);
  const selectionFor = useCallback((spaceId: string) => {
    const key = scopeKey(spaceId);
    if (!selectionsRef.current.has(key)) selectionsRef.current.set(key, { scope: '', pageId: null, pending: { desktop: false, drawer: false } });
    return selectionsRef.current.get(key)!;
  }, [scopeKey]);
  const updateState = useCallback((spaceId: string, update: (current: BrowsingState) => BrowsingState) => {
    const key = scopeKey(spaceId);
    const current = statesRef.current.get(key) ?? readWorkspacePreferences(userId, spaceId);
    const next = update(current);
    statesRef.current.set(key, next);
    writeWorkspacePreferences(userId, spaceId, next);
    setRevision((value) => value + 1);
  }, [scopeKey, userId]);
  const value = useMemo(() => ({ userId, stateFor, selectionFor, updateState }), [stateFor, selectionFor, updateState, userId]);
  return <WorkspaceRegistryContext.Provider value={value}>{children}</WorkspaceRegistryContext.Provider>;
};

interface SpaceWorkspaceScopeProps {
  mode: SpaceWorkspaceMode;
  spaceId: string | null;
  activeSection: SpaceNavSection;
  selectedFolderId: string | null;
  selectedPageId: string | null;
  selectedPageFolderId: string | null;
  pageRefreshRequest: number;
  pageDeleted?: boolean;
  selectFolder: (folderId: string | null) => void;
  reportPageIdentity: (pageId: string, spaceId: string | null, folderId?: string | null) => void;
  requestPageRefresh: (pageId: string, options?: { deleted?: boolean }) => void;
  children: React.ReactNode;
}

export const SpaceWorkspaceScope: React.FC<SpaceWorkspaceScopeProps> = ({
  mode,
  spaceId,
  activeSection,
  selectedFolderId,
  selectedPageId,
  selectedPageFolderId,
  pageRefreshRequest,
  pageDeleted = false,
  selectFolder,
  reportPageIdentity,
  requestPageRefresh,
  children,
}) => {
  const registry = useContext(WorkspaceRegistryContext);
  if (!registry) throw new Error('SpaceWorkspace must be rendered within SpaceWorkspaceProvider');
  const browsingState = spaceId ? registry.stateFor(spaceId) : EMPTY_STATE;
  const [directoryCrumbs, setDirectoryCrumbs] = useState<ReadonlyArray<{ id: string | null; name: string }>>([]);
  useEffect(() => setDirectoryCrumbs([]), [spaceId]);
  const setFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    if (!spaceId) return;
    registry.updateState(spaceId, (current) => {
      const expandedFolderIds = new Set(current.expandedFolderIds);
      if (expanded) expandedFolderIds.add(folderId);
      else expandedFolderIds.delete(folderId);
      return { ...current, expandedFolderIds };
    });
  }, [registry.updateState, spaceId]);
  const setDirectoryScrollTop = useCallback((directoryScrollTop: number) => {
    if (!spaceId) return;
    registry.updateState(spaceId, (current) => ({ ...current, directoryScrollTop }));
  }, [registry.updateState, spaceId]);
  const setDirectoryWidth = useCallback((width: number) => {
    if (spaceId) registry.updateState(spaceId, (current) => ({ ...current, directoryWidth: clampDirectoryWidth(width) }));
  }, [registry.updateState, spaceId]);
  const setDirectoryCollapsed = useCallback((directoryCollapsed: boolean) => {
    if (spaceId) registry.updateState(spaceId, (current) => ({ ...current, directoryCollapsed }));
  }, [registry.updateState, spaceId]);
  const setPanelPreferences = useCallback((preferences: PanelPreferences) => {
    if (spaceId) registry.updateState(spaceId, (current) => ({
      ...current, ...preferences,
      outlineWidth: clampOutlineWidth(preferences.outlineWidth ?? current.outlineWidth),
      collaborationWidth: clampCollaborationWidth(preferences.collaborationWidth ?? current.collaborationWidth),
    }));
  }, [registry.updateState, spaceId]);
  const value = useMemo<SpaceWorkspaceContextValue>(() => ({
    ...browsingState,
    directorySelection: spaceId ? registry.selectionFor(spaceId) : undefined,
    userId: registry.userId,
    spaceId,
    mode,
    activeSection,
    selectedFolderId,
    selectedPageId,
    selectedPageFolderId,
    pageRefreshRequest,
    pageDeleted,
    setFolderExpanded,
    setDirectoryScrollTop,
    setDirectoryCollapsed,
    setDirectoryWidth,
    setPanelPreferences,
    selectFolder,
    reportPageIdentity,
    requestPageRefresh,
    directoryCrumbs,
    reportDirectoryCrumbs: setDirectoryCrumbs,
  }), [
    activeSection,
    browsingState,
    directoryCrumbs,
    mode,
    pageRefreshRequest,
    pageDeleted,
    registry.userId,
    registry.selectionFor,
    reportPageIdentity,
    requestPageRefresh,
    selectFolder,
    selectedFolderId,
    selectedPageId,
    selectedPageFolderId,
    setDirectoryScrollTop,
    setDirectoryCollapsed,
    setDirectoryWidth,
    setPanelPreferences,
    setFolderExpanded,
    spaceId,
  ]);
  return <SpaceWorkspaceContext.Provider value={value}>{children}</SpaceWorkspaceContext.Provider>;
};

export const useSpaceWorkspace = (): SpaceWorkspaceContextValue => {
  const value = useContext(SpaceWorkspaceContext);
  if (!value) throw new Error('useSpaceWorkspace must be used within SpaceWorkspace');
  return value;
};

export const useOptionalSpaceWorkspace = (): SpaceWorkspaceContextValue | null => useContext(SpaceWorkspaceContext);

const ignorePageIdentity = () => undefined;

export const usePageWorkspaceIdentity = (): SpaceWorkspaceContextValue['reportPageIdentity'] => (
  useContext(SpaceWorkspaceContext)?.reportPageIdentity ?? ignorePageIdentity
);
