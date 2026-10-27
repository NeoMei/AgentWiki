import api from '../../api/client';
import type { PageNoteDto } from '../page/pageNotesApi';

export type NotesAuthorFilter = 'all' | 'me' | 'mentioned';
export type NotesStatusFilter = 'all' | 'open' | 'resolved';
export interface DiscoveredNote extends PageNoteDto {
  page: { id: string; title: string; folderPath: string[] };
  space: { id: string; name: string };
}
export interface NotesSearchInput { spaceId?: string; query?: string; author: NotesAuthorFilter; status: NotesStatusFilter; cursor?: string; limit?: number }
export interface NotesSearchResult { notes: DiscoveredNote[]; total: number; nextCursor: string | null; accessRevision?: string }
export const notesDiscoveryApi = {
  async list(input: NotesSearchInput, signal?: AbortSignal): Promise<NotesSearchResult> {
    const { data } = await api.get<NotesSearchResult>('/page-notes', { params: { ...input, limit: input.limit ?? 20 }, signal });
    return data;
  },
};
