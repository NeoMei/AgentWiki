/** Source offsets are supplied by the page's strict personal-note anchor resolver. */
export interface NoteHighlight { id: string; from: number; to: number }
export interface NoteHighlightSegment { from: number; to: number; ids: readonly string[] }
export interface NoteHighlightProps {
  noteHighlights?: readonly NoteHighlight[];
  activeNoteId?: string | null;
  onNoteActivate?: (id: string) => void;
}
export const EMPTY_NOTE_HIGHLIGHTS: readonly NoteHighlight[] = [];

export function noteHighlightSegments(notes: readonly NoteHighlight[], length: number): NoteHighlightSegment[] {
  const events = new Map<number, { add: string[]; remove: string[] }>();
  const seen = new Set<string>();
  for (const note of notes) {
    if (!note.id || seen.has(note.id) || !Number.isSafeInteger(note.from) || !Number.isSafeInteger(note.to)
      || note.from < 0 || note.to <= note.from || note.to > length) continue;
    seen.add(note.id);
    for (const offset of [note.from, note.to]) if (!events.has(offset)) events.set(offset, { add: [], remove: [] });
    events.get(note.from)!.add.push(note.id); events.get(note.to)!.remove.push(note.id);
  }
  const offsets = [...events.keys()].sort((a, b) => a - b), active = new Set<string>();
  const segments: NoteHighlightSegment[] = [];
  for (let i = 0; i < offsets.length; i += 1) {
    const from = offsets[i], event = events.get(from)!;
    for (const id of event.remove) active.delete(id);
    for (const id of event.add) active.add(id);
    const to = offsets[i + 1];
    if (active.size && to !== undefined) segments.push({ from, to, ids: [...active].sort() });
  }
  return segments;
}

/** Includes unmarked gaps, without searching for displayed text or guessing transformed offsets. */
export function sliceNoteHighlightSegments(segments: readonly NoteHighlightSegment[], from: number, to: number): NoteHighlightSegment[] {
  let low = 0, high = segments.length;
  while (low < high) { const middle = (low + high) >>> 1; if (segments[middle].to <= from) low = middle + 1; else high = middle; }
  const pieces: NoteHighlightSegment[] = []; let cursor = from;
  for (let i = low; i < segments.length && segments[i].from < to; i += 1) {
    const segment = segments[i], start = Math.max(cursor, segment.from), end = Math.min(to, segment.to);
    if (cursor < start) pieces.push({ from: cursor, to: start, ids: [] });
    if (start < end) pieces.push({ from: start, to: end, ids: segment.ids });
    cursor = end;
  }
  if (cursor < to) pieces.push({ from: cursor, to, ids: [] });
  return pieces;
}

export function noteHighlightAttributes(ids: readonly string[], activeId: string | null | undefined, zh: boolean): Record<string, string> {
  const active = Boolean(activeId && ids.includes(activeId));
  const title = ids.length > 1
    ? zh ? `${ids.length} 条个人笔记 · 点击依次查看` : `${ids.length} personal notes · Click to cycle`
    : zh ? '查看个人笔记' : 'View personal note';
  return {
    class: `personal-note-highlight${active ? ' personal-note-highlight-active' : ''}`,
    'data-note-id': active ? activeId! : ids[0],
    'data-note-ids': JSON.stringify(ids),
    title,
  };
}

export function noteIdsFromElement(target: EventTarget | null): { element: HTMLElement; ids: string[] } | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-note-ids]') : null;
  if (!element) return null;
  try {
    const ids: unknown = JSON.parse(element.dataset.noteIds ?? '');
    return Array.isArray(ids) && ids.length && ids.every((id) => typeof id === 'string') ? { element, ids } : null;
  } catch { return null; }
}

export function nextNoteId(ids: readonly string[], current?: string | null): string {
  return ids[(ids.indexOf(current ?? '') + 1) % ids.length];
}
