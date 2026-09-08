import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SpaceNavSection } from './workspaceNavigation';

export type SpaceWorkspaceMode = 'directory' | 'read' | 'edit' | 'versions' | 'section';

interface BrowsingState {
  expandedFolderIds: ReadonlySet<string>;
  directoryScrollTop: number;
}

interface WorkspaceRegistryValue {
  userId: string;
  stateFor: (spaceId: string) => BrowsingState;
  updateState: (spaceId: string, update: (current: BrowsingState) => BrowsingState) => void;
}

export interface SpaceWorkspaceContextValue extends BrowsingState {
  userId: string;
  spaceId: string | null;
  mode: SpaceWorkspaceMode;
  activeSection: SpaceNavSection;
  selectedFolderId: string | null;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  setDirectoryScrollTop: (scrollTop: number) => void;
  selectFolder: (folderId: string | null) => void;
  reportPageIdentity: (pageId: string, spaceId: string | null) => void;
}

const EMPTY_STATE: BrowsingState = {
  expandedFolderIds: new Set<string>(),
  directoryScrollTop: 0,
};

const WorkspaceRegistryContext = createContext<WorkspaceRegistryValue | null>(null);
const SpaceWorkspaceContext = createContext<SpaceWorkspaceContextValue | null>(null);

export const SpaceWorkspaceProvider: React.FC<{ userId: string; children: React.ReactNode }> = ({ userId, children }) => {
  const [states, setStates] = useState<ReadonlyMap<string, BrowsingState>>(() => new Map());
  useEffect(() => {
    setStates(new Map());
  }, [userId]);
  const scopeKey = useCallback((spaceId: string) => `${userId}\u0000${spaceId}`, [userId]);
  const stateFor = useCallback((spaceId: string) => states.get(scopeKey(spaceId)) ?? EMPTY_STATE, [scopeKey, states]);
  const updateState = useCallback((spaceId: string, update: (current: BrowsingState) => BrowsingState) => {
    const key = scopeKey(spaceId);
    setStates((currentStates) => {
      const current = currentStates.get(key) ?? EMPTY_STATE;
      const next = new Map(currentStates);
      next.set(key, update(current));
      return next;
    });
  }, [scopeKey]);
  const value = useMemo(() => ({ userId, stateFor, updateState }), [stateFor, updateState, userId]);
  return <WorkspaceRegistryContext.Provider value={value}>{children}</WorkspaceRegistryContext.Provider>;
};

interface SpaceWorkspaceScopeProps {
  mode: SpaceWorkspaceMode;
  spaceId: string | null;
  activeSection: SpaceNavSection;
  selectedFolderId: string | null;
  selectFolder: (folderId: string | null) => void;
  reportPageIdentity: (pageId: string, spaceId: string | null) => void;
  children: React.ReactNode;
}

export const SpaceWorkspaceScope: React.FC<SpaceWorkspaceScopeProps> = ({
  mode,
  spaceId,
  activeSection,
  selectedFolderId,
  selectFolder,
  reportPageIdentity,
  children,
}) => {
  const registry = useContext(WorkspaceRegistryContext);
  if (!registry) throw new Error('SpaceWorkspace must be rendered within SpaceWorkspaceProvider');
  const browsingState = spaceId ? registry.stateFor(spaceId) : EMPTY_STATE;
  const setFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    if (!spaceId) return;
    registry.updateState(spaceId, (current) => {
      const expandedFolderIds = new Set(current.expandedFolderIds);
      if (expanded) expandedFolderIds.add(folderId);
      else expandedFolderIds.delete(folderId);
      return { ...current, expandedFolderIds };
    });
  }, [registry, spaceId]);
  const setDirectoryScrollTop = useCallback((directoryScrollTop: number) => {
    if (!spaceId) return;
    registry.updateState(spaceId, (current) => ({ ...current, directoryScrollTop }));
  }, [registry, spaceId]);
  const value = useMemo<SpaceWorkspaceContextValue>(() => ({
    ...browsingState,
    userId: registry.userId,
    spaceId,
    mode,
    activeSection,
    selectedFolderId,
    setFolderExpanded,
    setDirectoryScrollTop,
    selectFolder,
    reportPageIdentity,
  }), [
    activeSection,
    browsingState,
    mode,
    registry.userId,
    reportPageIdentity,
    selectFolder,
    selectedFolderId,
    setDirectoryScrollTop,
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

const ignorePageIdentity = () => undefined;

export const usePageWorkspaceIdentity = (): SpaceWorkspaceContextValue['reportPageIdentity'] => (
  useContext(SpaceWorkspaceContext)?.reportPageIdentity ?? ignorePageIdentity
);
