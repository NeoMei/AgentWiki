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

export interface SpaceWorkspaceProps {
  mode: SpaceWorkspaceMode;
  spaceId?: string;
  pageId?: string;
  children: React.ReactNode;
  activeSection?: SpaceNavSection;
  showNavigation?: boolean;
}

export const SpaceWorkspace: React.FC<SpaceWorkspaceProps> = ({
  mode,
  spaceId,
  pageId,
  children,
  activeSection,
  showNavigation = mode === 'read' || mode === 'edit' || mode === 'versions',
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [pageResolution, setPageResolution] = useState<{ pageId: string; spaceId: string } | null>(null);
  const resolvedSpaceId = spaceId ?? (
    pageResolution && pageResolution.pageId === pageId ? pageResolution.spaceId : null
  );
  const resolvedSection = activeSection ?? workspaceSectionFromPath(location.pathname) ?? 'pages';
  const selectedFolderId = folderIdFromSearch(location.search);

  const reportPageIdentity = useCallback((reportedPageId: string, reportedSpaceId: string | null) => {
    if (!pageId || reportedPageId !== pageId) return;
    setPageResolution((current) => {
      if (!reportedSpaceId) return current?.pageId === reportedPageId ? null : current;
      if (current?.pageId === reportedPageId && current.spaceId === reportedSpaceId) return current;
      return { pageId: reportedPageId, spaceId: reportedSpaceId };
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
      selectFolder={selectFolder}
      reportPageIdentity={reportPageIdentity}
    >
      <div data-space-workspace={mode} data-space-id={resolvedSpaceId ?? undefined}>
        {showNavigation && resolvedSpaceId ? <SpaceNav spaceId={resolvedSpaceId} activeSection={resolvedSection} /> : null}
        {children}
      </div>
    </SpaceWorkspaceScope>
  );
};
