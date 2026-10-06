/** Session-only state: survives directory loading unmounts, never written to storage. */
export interface DirectorySelectionState {
  scope: string;
  pageId: string | null;
  pending: { desktop: boolean; drawer: boolean };
}
export interface PanelPreferences {
  outlineOpen?: boolean;
  outlineWidth?: number;
  collaborationOpen?: boolean;
  collaborationTab?: 'assist' | 'notes';
  collaborationWidth?: number;
}
export interface WorkspacePreferences extends PanelPreferences {
  expandedFolderIds: ReadonlySet<string>;
  directoryScrollTop: number;
  directoryWidth: number;
  directoryCollapsed: boolean;
}
export const clampDirectoryWidth = (width: number): number => Math.max(220, Math.min(420, Number.isFinite(width) ? width : 260));
export const clampOutlineWidth = (width?: number): number => Math.max(200, Math.min(360, typeof width === 'number' && Number.isFinite(width) ? width : 280));
export const clampCollaborationWidth = (width?: number): number => Math.max(320, Math.min(520, typeof width === 'number' && Number.isFinite(width) ? width : 320));
export const defaultWorkspacePreferences = (): WorkspacePreferences => ({ expandedFolderIds: new Set(), directoryScrollTop: 0, directoryWidth: 260, directoryCollapsed: false, outlineOpen: undefined, outlineWidth: 280, collaborationOpen: false, collaborationTab: 'assist', collaborationWidth: 320 });
const keyFor = (userId: string, spaceId: string) => `agentwiki.workspace.v1:${encodeURIComponent(userId)}:${encodeURIComponent(spaceId)}`;
export const readWorkspacePreferences = (userId: string, spaceId: string): WorkspacePreferences => {
  const fallback = defaultWorkspacePreferences();
  try {
    const raw = localStorage.getItem(keyFor(userId, spaceId));
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (value?.schemaVersion !== 1) return fallback;
    return {
      expandedFolderIds: new Set(Array.isArray(value.expandedFolderIds) ? value.expandedFolderIds.filter((id: unknown) => typeof id === 'string' && id.length <= 200).slice(0, 5000) : []),
      directoryScrollTop: typeof value.directoryScrollTop === 'number' && Number.isFinite(value.directoryScrollTop) ? Math.max(0, value.directoryScrollTop) : 0,
      directoryWidth: clampDirectoryWidth(value.directoryWidth),
      directoryCollapsed: value.directoryCollapsed === true,
      outlineOpen: typeof value.outlineOpen === 'boolean' ? value.outlineOpen : undefined,
      outlineWidth: clampOutlineWidth(value.outlineWidth),
      collaborationOpen: value.collaborationOpen === true,
      collaborationTab: value.collaborationTab === 'notes' ? 'notes' : 'assist',
      collaborationWidth: clampCollaborationWidth(value.collaborationWidth),
    };
  } catch { return fallback; }
};
export const writeWorkspacePreferences = (userId: string, spaceId: string, value: WorkspacePreferences): void => {
  try { localStorage.setItem(keyFor(userId, spaceId), JSON.stringify({
    schemaVersion: 1, expandedFolderIds: [...value.expandedFolderIds], directoryScrollTop: value.directoryScrollTop,
    directoryWidth: value.directoryWidth, directoryCollapsed: value.directoryCollapsed,
    outlineOpen: value.outlineOpen, outlineWidth: clampOutlineWidth(value.outlineWidth),
    collaborationOpen: value.collaborationOpen === true, collaborationTab: value.collaborationTab === 'notes' ? 'notes' : 'assist',
    collaborationWidth: clampCollaborationWidth(value.collaborationWidth),
  })); } catch { /* Preferences remain available in memory if storage is blocked or full. */ }
};
