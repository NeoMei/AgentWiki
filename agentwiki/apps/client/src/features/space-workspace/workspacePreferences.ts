export interface WorkspacePreferences {
  expandedFolderIds: ReadonlySet<string>;
  directoryScrollTop: number;
  directoryWidth: number;
  directoryCollapsed: boolean;
}
export const clampDirectoryWidth = (width: number): number => Math.max(220, Math.min(420, Number.isFinite(width) ? width : 260));
export const defaultWorkspacePreferences = (): WorkspacePreferences => ({ expandedFolderIds: new Set(), directoryScrollTop: 0, directoryWidth: 260, directoryCollapsed: false });
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
    };
  } catch { return fallback; }
};
export const writeWorkspacePreferences = (userId: string, spaceId: string, value: WorkspacePreferences): void => {
  try { localStorage.setItem(keyFor(userId, spaceId), JSON.stringify({ schemaVersion: 1, ...value, expandedFolderIds: [...value.expandedFolderIds] })); } catch { /* Preferences remain available in memory if storage is blocked or full. */ }
};
