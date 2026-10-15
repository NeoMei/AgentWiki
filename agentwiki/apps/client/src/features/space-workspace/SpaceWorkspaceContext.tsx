import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { readWorkspacePreferences, writeWorkspacePreferences, type WorkspacePreferences, type PanelPreferences, type DirectorySelectionState } from './workspacePreferences';
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
  directoryRefreshRequest?: number;
  requestDirectoryRefresh?: () => void;
  pageDeleted?: boolean;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  setDirectoryScrollTop: (scrollTop: number) => void;
  setDirectoryWidth: (width: number) => void;
  setDirectoryCollapsed: (collapsed: boolean) => void;
  setPanelPreferences: (preferences: PanelPreferences) => void;
  selectFolder: (folderId: string | null) => void;
  reportPageIdentity: (pageId: string, spaceId: string | null, folderId?: string | null, accessDenied?: boolean) => void;
  requestPageRefresh: (pageId: string, options?: { deleted?: boolean }) => void;
  directoryCrumbs: ReadonlyArray<{ id: string | null; name: string }>;
  reportDirectoryCrumbs: (crumbs: ReadonlyArray<{ id: string | null; name: string }>) => void;
}

export const WorkspaceRegistryContext = createContext<WorkspaceRegistryValue | null>(null);
export const SpaceWorkspaceContext = createContext<SpaceWorkspaceContextValue | null>(null);

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
