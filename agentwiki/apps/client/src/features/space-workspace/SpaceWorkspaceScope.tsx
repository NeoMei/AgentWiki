import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { clampDirectoryWidth, clampOutlineWidth, clampCollaborationWidth, defaultWorkspacePreferences, type PanelPreferences } from './workspacePreferences';
import { SpaceWorkspaceContext, WorkspaceRegistryContext, type SpaceWorkspaceContextValue, type SpaceWorkspaceMode } from './SpaceWorkspaceContext';
import type { SpaceNavSection } from './workspaceNavigation';

const EMPTY_STATE = defaultWorkspacePreferences();

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
  reportPageIdentity: SpaceWorkspaceContextValue['reportPageIdentity'];
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
  const [directoryRefreshRequest, setDirectoryRefreshRequest] = useState(0);
  const directoryScope = `${registry.userId}\u0000${spaceId}`;
  const activeDirectoryScopeRef = useRef(directoryScope);
  activeDirectoryScopeRef.current = directoryScope;
  const requestDirectoryRefresh = useCallback(() => {
    if (activeDirectoryScopeRef.current === directoryScope) setDirectoryRefreshRequest((current) => current + 1);
  }, [directoryScope]);
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
    directoryRefreshRequest,
    requestDirectoryRefresh,
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
    directoryRefreshRequest,
    requestDirectoryRefresh,
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
