import type { NotesAuthorFilter, NotesStatusFilter } from './notesDiscoveryApi';
export interface NotesFilters { scope: 'space' | 'all'; author: NotesAuthorFilter; status: NotesStatusFilter; query: string }
export const defaultNotesFilters = (): NotesFilters => ({ scope: 'space', author: 'all', status: 'all', query: '' });
export function parseNotesFilters(params: URLSearchParams): NotesFilters {
  const author = params.get('author'), status = params.get('status');
  return { scope: params.get('scope') === 'all' ? 'all' : 'space', author: author === 'me' || author === 'mentioned' ? author : 'all', status: status === 'open' || status === 'resolved' ? status : 'all', query: (params.get('query') ?? '').slice(0, 200) };
}
export function notesFiltersParams(filters: NotesFilters): URLSearchParams {
  const params = new URLSearchParams({ scope: filters.scope, author: filters.author, status: filters.status });
  if (filters.query) params.set('query', filters.query);
  return params;
}
export function notesReturnPath(spaceId: string, filters: NotesFilters): string {
  return `/spaces/${encodeURIComponent(spaceId)}/notes?${notesFiltersParams(filters)}`;
}
export function noteSourcePath(pageId: string, noteId: string, spaceId: string, filters: NotesFilters): string {
  const params = new URLSearchParams({ note: noteId, notesReturn: notesReturnPath(spaceId, filters) });
  return `/pages/${encodeURIComponent(pageId)}?${params}`;
}
