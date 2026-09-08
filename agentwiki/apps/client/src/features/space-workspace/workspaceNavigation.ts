export type SpaceNavSection = 'pages' | 'graph' | 'sources' | 'runs' | 'collaboration' | 'members' | 'settings';

const segment = (value: string) => encodeURIComponent(value);

export const folderIdFromSearch = (search: string | URLSearchParams): string | null => {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const folderId = params.get('folder');
  return folderId || null;
};

export const spaceFolderHref = (spaceId: string, folderId: string | null | undefined): string => {
  const pathname = `/spaces/${segment(spaceId)}`;
  return folderId ? `${pathname}?folder=${segment(folderId)}` : pathname;
};

export const isWorkspacePath = (pathname: string): boolean => (
  /^\/spaces\/[^/]+(?:\/|$)/u.test(pathname)
  || /^\/pages\/[^/]+(?:\/|$)/u.test(pathname)
);

export const workspaceSectionFromPath = (pathname: string): SpaceNavSection | null => {
  if (/^\/pages\/[^/]+(?:\/|$)/u.test(pathname)) return 'pages';
  const match = pathname.match(/^\/spaces\/[^/]+(?:\/([^/]+))?/u);
  if (!match) return null;
  const section = match[1];
  if (!section) return 'pages';
  return (['graph', 'sources', 'runs', 'collaboration', 'members', 'settings'] as const)
    .find((candidate) => candidate === section) ?? null;
};
