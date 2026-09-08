import React, { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SpaceNav } from '../../components/SpaceNav';
import { SpaceWorkspaceScope, type SpaceWorkspaceMode } from './SpaceWorkspaceContext';
import {
  folderIdFromSearch,
  spaceFolderHref,
  workspaceSectionFromPath,
  type SpaceNavSection,
} from './workspaceNavigation';
import { SpaceView } from '../space/SpaceView';

export interface SpaceWorkspaceProps {
  mode: SpaceWorkspaceMode;
  spaceId?: string;
  pageId?: string;
  children: React.ReactNode;
  activeSection?: SpaceNavSection;
  showNavigation?: boolean;
  showDirectory?: boolean;
}

export const SpaceWorkspace: React.FC<SpaceWorkspaceProps> = ({
  mode,
  spaceId,
  pageId,
  children,
  activeSection,
  showNavigation = mode === 'read' || mode === 'edit' || mode === 'versions',
  showDirectory = false,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [pageResolution, setPageResolution] = useState<{ pageId: string; spaceId: string; folderId: string | null } | null>(null);
  const resolvedSpaceId = spaceId ?? (
    pageResolution && pageResolution.pageId === pageId ? pageResolution.spaceId : null
  );
  const resolvedSection = activeSection ?? workspaceSectionFromPath(location.pathname) ?? 'pages';
  const selectedFolderId = folderIdFromSearch(location.search);
  const useSharedSpaceShell = showDirectory || mode === 'section';

  const reportPageIdentity = useCallback((reportedPageId: string, reportedSpaceId: string | null, folderId: string | null = null) => {
    if (!pageId || reportedPageId !== pageId) return;
    setPageResolution((current) => {
      if (!reportedSpaceId) return current?.pageId === reportedPageId ? null : current;
      if (current?.pageId === reportedPageId && current.spaceId === reportedSpaceId && current.folderId === folderId) return current;
      return { pageId: reportedPageId, spaceId: reportedSpaceId, folderId };
    });
  }, [pageId]);

  const selectFolder = useCallback((folderId: string | null) => {
    if (resolvedSpaceId) navigate(spaceFolderHref(resolvedSpaceId, folderId));
  }, [navigate, resolvedSpaceId]);

  return (
    <SpaceWorkspaceScope
      mode={mode}
      spaceId={resolvedSpaceId}
      activeSection={resolvedSection}
      selectedFolderId={selectedFolderId}
      selectedPageId={pageId ?? null}
      selectedPageFolderId={pageResolution && pageResolution.pageId === pageId ? pageResolution.folderId : null}
      selectFolder={selectFolder}
      reportPageIdentity={reportPageIdentity}
    >
      <div data-space-workspace={mode} data-space-id={resolvedSpaceId ?? undefined}>
        {showNavigation && resolvedSpaceId && !useSharedSpaceShell ? <SpaceNav spaceId={resolvedSpaceId} activeSection={resolvedSection} /> : null}
        {useSharedSpaceShell
          ? <SpaceView spaceId={resolvedSpaceId} workspaceContent={mode === 'directory' ? undefined : children} showDirectory={showDirectory} />
          : children}
      </div>
    </SpaceWorkspaceScope>
  );
};
