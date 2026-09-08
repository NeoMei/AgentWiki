import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listFolderAncestry, listTreeChildren } from '../content-tree/contentTreeApi';
import { crumbsForFolder, registerFolders, type Crumb, type FolderIndex } from '../content-tree/contentTreeState';
import type { ContentTreeNode } from '../content-tree/contentTreeTypes';

export interface DirectoryLevel {
  parentFolderId: string | null;
  nodes: ContentTreeNode[];
  treeRevision: string;
}

interface UseSpaceDirectoryOptions {
  spaceId: string | null;
  targetFolderId: string | null;
  expandedFolderIds: ReadonlySet<string>;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  rootLabel?: string;
}

export interface SpaceDirectoryState {
  levels: ReadonlyMap<string | null, DirectoryLevel>;
  folderIndex: FolderIndex;
  treeRevision: string | null;
  locating: boolean;
  error: string | null;
  crumbs: Crumb[];
  toggleFolder: (folderId: string) => Promise<void>;
  retry: () => void;
  reloadLevel: (parentFolderId: string | null) => Promise<void>;
  acceptTreeRevision: (treeRevision: string) => void;
}

const SNAPSHOT_ATTEMPTS = 2;

export class DirectoryRevisionChangedError extends Error {
  constructor() {
    super('The directory changed while it was loading. Please retry.');
  }
}

const errorMessage = (error: unknown) => (
  error instanceof Error && error.message ? error.message : 'Unable to load directory'
);

const responseStatus = (error: unknown): number | undefined => (
  (error as { response?: { status?: number } } | null)?.response?.status
);

export const useSpaceDirectory = ({
  spaceId,
  targetFolderId,
  expandedFolderIds,
  setFolderExpanded,
  rootLabel = '',
}: UseSpaceDirectoryOptions): SpaceDirectoryState => {
  const generationRef = useRef(0);
  const revisionRef = useRef<string | null>(null);
  const levelsRef = useRef<ReadonlyMap<string | null, DirectoryLevel>>(new Map());
  const indexRef = useRef<FolderIndex>(new Map());
  const [levels, setLevels] = useState<ReadonlyMap<string | null, DirectoryLevel>>(new Map());
  const [folderIndex, setFolderIndex] = useState<FolderIndex>(new Map());
  const [treeRevision, setTreeRevision] = useState<string | null>(null);
  const [locating, setLocating] = useState(Boolean(spaceId));
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const clearDirectory = useCallback((revision: string | null = null) => {
    revisionRef.current = revision;
    levelsRef.current = new Map();
    indexRef.current = new Map();
    setTreeRevision(revision);
    setLevels(new Map());
    setFolderIndex(new Map());
  }, []);

  const installSnapshot = useCallback((
    nextLevels: ReadonlyMap<string | null, DirectoryLevel>,
    nextIndex: FolderIndex,
    revision: string,
    generation: number,
  ) => {
    if (generationRef.current !== generation) return;
    revisionRef.current = revision;
    levelsRef.current = nextLevels;
    indexRef.current = nextIndex;
    setTreeRevision(revision);
    setLevels(nextLevels);
    setFolderIndex(nextIndex);
  }, []);

  const installLevel = useCallback((level: DirectoryLevel, generation: number) => {
    if (generationRef.current !== generation) return;
    if (revisionRef.current !== null && revisionRef.current !== level.treeRevision) {
      clearDirectory(null);
      setRetryKey((value) => value + 1);
      return;
    }
    const nextLevels = new Map(levelsRef.current);
    const nextIndex = new Map(indexRef.current);
    nextLevels.set(level.parentFolderId, level);
    registerFolders(nextIndex, level.nodes, level.parentFolderId);
    installSnapshot(nextLevels, nextIndex, level.treeRevision, generation);
  }, [clearDirectory, installSnapshot]);

  const reloadLevel = useCallback(async (parentFolderId: string | null) => {
    if (!spaceId) return;
    const generation = generationRef.current;
    setError(null);
    try {
      const response = await listTreeChildren(spaceId, parentFolderId);
      installLevel({ parentFolderId, nodes: response.data, treeRevision: response.treeRevision }, generation);
    } catch (loadError) {
      if (generationRef.current !== generation) return;
      if (responseStatus(loadError) === 401 || responseStatus(loadError) === 403) clearDirectory(null);
      setError(errorMessage(loadError));
    }
  }, [clearDirectory, installLevel, spaceId]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    clearDirectory(null);
    setError(null);
    setLocating(Boolean(spaceId));
    if (!spaceId) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
          const ancestry = targetFolderId
            ? await listFolderAncestry(spaceId, targetFolderId, controller.signal)
            : null;
          if (generationRef.current !== generation) return;
          const ancestorIds = ancestry?.ancestorIds ?? [];
          const nextLevels = new Map<string | null, DirectoryLevel>();
          const nextIndex = new Map(ancestry?.folders ?? []);
          let revision = ancestry?.treeRevision || null;
          let changed = false;

          for (const parentFolderId of [null, ...ancestorIds] as Array<string | null>) {
            const response = await listTreeChildren(spaceId, parentFolderId, controller.signal);
            if (generationRef.current !== generation) return;
            revision ??= response.treeRevision;
            if (response.treeRevision !== revision) {
              changed = true;
              break;
            }
            const level = { parentFolderId, nodes: response.data, treeRevision: response.treeRevision };
            nextLevels.set(parentFolderId, level);
            registerFolders(nextIndex, response.data, parentFolderId);
          }

          if (changed) {
            if (attempt + 1 === SNAPSHOT_ATTEMPTS) throw new DirectoryRevisionChangedError();
            continue;
          }
          if (!revision) throw new Error('The directory response did not include a revision.');
          installSnapshot(nextLevels, nextIndex, revision, generation);
          for (const ancestorId of ancestorIds) setFolderExpanded(ancestorId, true);
          return;
        }
      } catch (loadError) {
        if (!controller.signal.aborted && generationRef.current === generation) {
          if (responseStatus(loadError) === 401 || responseStatus(loadError) === 403) clearDirectory(null);
          setError(errorMessage(loadError));
        }
      } finally {
        if (!controller.signal.aborted && generationRef.current === generation) setLocating(false);
      }
    })();
    return () => controller.abort();
  }, [clearDirectory, installSnapshot, retryKey, setFolderExpanded, spaceId, targetFolderId]);

  const toggleFolder = useCallback(async (folderId: string) => {
    const expanded = expandedFolderIds.has(folderId);
    setFolderExpanded(folderId, !expanded);
    if (!expanded && !levelsRef.current.has(folderId)) await reloadLevel(folderId);
  }, [expandedFolderIds, reloadLevel, setFolderExpanded]);

  const acceptTreeRevision = useCallback((revision: string) => {
    if (revisionRef.current === revision) return;
    clearDirectory(revision);
    setRetryKey((value) => value + 1);
  }, [clearDirectory]);

  const crumbs = useMemo(() => crumbsForFolder(folderIndex, targetFolderId, rootLabel), [folderIndex, rootLabel, targetFolderId]);

  return {
    levels, folderIndex, treeRevision, locating, error, crumbs,
    toggleFolder,
    retry: () => setRetryKey((value) => value + 1),
    reloadLevel,
    acceptTreeRevision,
  };
};
