import api from '../../api/client';
import type { AssistTarget } from './assistTargets';
import type { NoteAuthor, PersonalNote, PersonalNoteStatus, PersonalNotesScope } from './reviewComments';

export interface PageNoteDto {
  id: string; spaceId: string; pageId: string; body: string; target: AssistTarget;
  status: PersonalNoteStatus; taskId?: string; author: NoteAuthor; canEdit: boolean;
  createdAt: string; updatedAt: string; clientNoteId?: string;
}
export interface CreatePageNote { clientNoteId: string; body: string; target: AssistTarget; status?: PersonalNoteStatus; taskId?: string }
const path = (scope: PersonalNotesScope) => `/spaces/${encodeURIComponent(scope.spaceId)}/pages/${encodeURIComponent(scope.pageId)}/notes`;
export function fromPageNote(note: PageNoteDto, scope: PersonalNotesScope): PersonalNote {
  if (!note || note.spaceId !== scope.spaceId || note.pageId !== scope.pageId || !note.author?.id || !['user', 'agent'].includes(note.author.type)) throw new Error('Invalid page note scope');
  return { ...note, schemaVersion: 1, userId: note.author.type === 'user' ? note.author.id : `agent:${note.author.id}` };
}
export const pageNotesApi = {
  async list(scope: PersonalNotesScope, signal?: AbortSignal) {
    const { data } = await api.get<{ notes: PageNoteDto[]; canCreate: boolean }>(path(scope), { signal });
    return { notes: data.notes.map((note) => fromPageNote(note, scope)), canCreate: data.canCreate };
  },
  async create(scope: PersonalNotesScope, input: CreatePageNote, signal?: AbortSignal) {
    return fromPageNote((await api.post<PageNoteDto>(path(scope), input, { signal })).data, scope);
  },
  async update(scope: PersonalNotesScope, id: string, input: { expectedUpdatedAt: string; body?: string; status?: PersonalNoteStatus; taskId?: string | null }, signal?: AbortSignal) {
    const token = localStorage.getItem('token');
    return fromPageNote((await api.patch<PageNoteDto>(`${path(scope)}/${encodeURIComponent(id)}`, input, {
      signal, timeout: 15_000,
      // Axios applies its auth interceptor asynchronously. Never let a queued old-author write
      // borrow the token of an account that signed in before the request reaches its adapter.
      transformRequest: [(data: unknown) => {
        if (localStorage.getItem('token') !== token) throw new Error('Page note session changed');
        return JSON.stringify(data);
      }],
    })).data, scope);
  },
};
