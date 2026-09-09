export function newContentHref(spaceId: string, folderId?: string | null, from?: 'collaboration'): string {
  const params = new URLSearchParams();
  if (folderId) params.set('folder', folderId);
  if (from) params.set('from', from);
  const query = params.toString();
  return `/spaces/${encodeURIComponent(spaceId)}/new${query ? `?${query}` : ''}`;
}
