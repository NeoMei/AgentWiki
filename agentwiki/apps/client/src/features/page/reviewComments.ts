import { resolveAssistTarget, validateAssistTarget, type AssistTarget } from './assistTargets';
export interface PersonalNotesScope { userId: string; spaceId: string; pageId: string }
export type PersonalNoteStatus = 'pending' | 'dispatched' | 'awaiting-review' | 'resolved';
export interface PersonalNote extends PersonalNotesScope { schemaVersion: 1; id: string; body: string; target: AssistTarget; status: PersonalNoteStatus; taskId?: string }
type NotesStorage = Pick<Storage, 'getItem' | 'setItem'>;
const validText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const validScope = (s: PersonalNotesScope) => validText(s.userId) && validText(s.spaceId) && validText(s.pageId);
const sameScope = (a: PersonalNotesScope, b: PersonalNotesScope) => a.userId === b.userId && a.spaceId === b.spaceId && a.pageId === b.pageId;
const validNote = (n: PersonalNote, scope: PersonalNotesScope) => n && n.schemaVersion === 1 && sameScope(n, scope) && validText(n.id) && validText(n.body)
  && ['pending', 'dispatched', 'awaiting-review', 'resolved'].includes(n.status)
  && (n.status === 'pending' ? n.taskId === undefined : validText(n.taskId)) && n.target?.kind === 'selection'
  && typeof n.target.quote === 'string' && n.target.quote.length > 0 && typeof n.target.prefix === 'string' && typeof n.target.suffix === 'string'
  && n.target.from >= n.target.prefix.length && n.target.to - n.target.from === n.target.quote.length
  && validateAssistTarget(n.target.prefix + n.target.quote + n.target.suffix, { ...n.target, from: n.target.prefix.length, to: n.target.prefix.length + n.target.quote.length });
const browserStorage = (): NotesStorage | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
export const personalNotesKey = (s: PersonalNotesScope) => `agentwiki.personal-notes.v1:${encodeURIComponent(s.userId)}:${encodeURIComponent(s.spaceId)}:${encodeURIComponent(s.pageId)}`;
export function addPersonalNote(scope: PersonalNotesScope, target: AssistTarget, body: string, id: string = crypto.randomUUID()): PersonalNote {
  const note: PersonalNote = { ...scope, schemaVersion: 1, id, body: body.trim(), target: { ...target, kind: 'selection' }, status: 'pending' };
  if (!validScope(scope) || !validNote(note, scope)) throw new Error('Invalid personal note');
  return note;
}
export function loadPersonalNotes(scope: PersonalNotesScope, storage: NotesStorage | null = browserStorage()): { status: 'loaded'; notes: PersonalNote[] } | { status: 'invalid' | 'unavailable' } {
  if (!validScope(scope)) return { status: 'invalid' };
  if (!storage) return { status: 'unavailable' };
  try {
    const raw = storage.getItem(personalNotesKey(scope));
    if (raw === null) return { status: 'loaded', notes: [] };
    let notes: unknown;
    try { notes = JSON.parse(raw); } catch { return { status: 'invalid' }; }
    return Array.isArray(notes) && notes.every((n) => validNote(n, scope)) && new Set(notes.map((n) => n.id)).size === notes.length ? { status: 'loaded', notes } : { status: 'invalid' };
  } catch { return { status: 'unavailable' }; }
}
export function savePersonalNotes(scope: PersonalNotesScope, notes: PersonalNote[], storage: NotesStorage | null = browserStorage()): { status: 'saved' | 'invalid' | 'unavailable' } {
  if (!validScope(scope) || !notes.every((n) => validNote(n, scope)) || new Set(notes.map((n) => n.id)).size !== notes.length) return { status: 'invalid' };
  if (!storage) return { status: 'unavailable' };
  try { storage.setItem(personalNotesKey(scope), JSON.stringify(notes)); return { status: 'saved' }; } catch { return { status: 'unavailable' }; }
}
export type PersonalNoteEvent = 'dispatch' | 'ready' | 'accept' | 'fail' | 'discard' | 'reopen';
/** Dispatch only after a successful create task response; completion is awaiting review, not resolution. */
export function transitionPersonalNotes(notes: PersonalNote[], ids: readonly string[], event: PersonalNoteEvent, taskId?: string): PersonalNote[] {
  return notes.map((note) => {
    if (!ids.includes(note.id)) return note;
    if (event === 'dispatch') return note.status === 'pending' && validText(taskId) ? { ...note, status: 'dispatched', taskId } : note;
    if (event === 'reopen' && (!taskId || note.taskId === taskId)) return { ...note, status: 'pending', taskId: undefined };
    if (!taskId || note.taskId !== taskId) return note;
    if ((event === 'fail' || event === 'discard') && note.status !== 'resolved') return { ...note, status: 'pending', taskId: undefined };
    if (event === 'ready' && note.status === 'dispatched') return { ...note, status: 'awaiting-review' };
    if (event === 'accept' && note.status === 'awaiting-review') return { ...note, status: 'resolved' };
    return note;
  });
}
export function notesForDispatch(notes: PersonalNote[], ids: readonly string[], source: string): { status: 'ready'; notes: PersonalNote[] } | { status: 'conflict' } {
  const selected = notes.filter((n) => ids.includes(n.id));
  return selected.length > 0 && selected.length === new Set(ids).size && selected.every((n) => n.status === 'pending' && resolveAssistTarget(source, n.target).status === 'found')
    ? { status: 'ready', notes: selected } : { status: 'conflict' };
}
