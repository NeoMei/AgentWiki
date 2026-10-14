import type { NoteHighlight } from '../../components/markdown/noteHighlights';
import { resolveAssistTarget } from './assistTargets';
import type { PersonalNote } from './reviewComments';

/** Visual anchors use the same exact contextual proof as note dispatch. Never guess from the quote alone. */
export function resolvePersonalNoteHighlights(source: string, notes: readonly PersonalNote[]): NoteHighlight[] {
  return notes.flatMap((note) => {
    const location = resolveAssistTarget(source, note.target);
    return location.status === 'found' ? [{ id: note.id, from: location.from, to: location.to }] : [];
  });
}

/** A rendered span can belong to multiple overlapping notes. */
export function locateReadingNote(root: HTMLElement | null, id: string): boolean {
  const marker = Array.from(root?.querySelectorAll<HTMLElement>('[data-note-ids]') ?? []).find((element) => {
    try { return (JSON.parse(element.dataset.noteIds ?? '[]') as string[]).includes(id); } catch { return false; }
  });
  if (!marker) return false;
  for (let ancestor = marker.parentElement; ancestor && root?.contains(ancestor); ancestor = ancestor.parentElement) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
  }
  marker.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  marker.focus({ preventScroll: true });
  return true;
}
