import { StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { nextNoteId, noteHighlightAttributes, noteIdsFromElement, type NoteHighlightSegment } from './noteHighlights';

class NoteMarkerWidget extends WidgetType {
  constructor(readonly ids: readonly string[], readonly activeId: string | null | undefined, readonly zh: boolean, readonly activate: (ids: readonly string[]) => void) { super(); }
  eq(other: NoteMarkerWidget) { return this.ids.join('\u0000') === other.ids.join('\u0000') && this.activeId === other.activeId && this.zh === other.zh && this.activate === other.activate; }
  toDOM() {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `personal-note-marker personal-note-editor-marker${this.activeId && this.ids.includes(this.activeId) ? ' personal-note-marker-active' : ''}`;
    button.contentEditable = 'false'; button.dataset.noteMarker = 'true'; button.dataset.noteIds = JSON.stringify(this.ids);
    if (this.ids.length > 1) button.dataset.noteCount = String(this.ids.length);
    const label = noteHighlightAttributes(this.ids, this.activeId, this.zh).title;
    button.title = label; button.setAttribute('aria-label', label);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z');
    icon.append(path); button.append(icon);
    button.onmousedown = (event) => event.preventDefault();
    button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); this.activate(this.ids); };
    return button;
  }
  ignoreEvent() { return true; }
}

function markerGroups(segments: readonly NoteHighlightSegment[], doc: Text) {
  const ends = new Map<string, number>();
  for (const segment of segments) for (const id of segment.ids) ends.set(id, segment.to);
  const lines = new Map<number, { at: number; ids: string[] }>();
  for (const [id, end] of ends) {
    const line = doc.lineAt(Math.max(0, end - 1));
    const at = Math.min(end, line.to), current = lines.get(line.number);
    if (current) { current.ids.push(id); current.at = Math.max(current.at, at); }
    else lines.set(line.number, { at, ids: [id] });
  }
  return [...lines.values()].map((group) => ({ ...group, ids: group.ids.sort() }));
}

/** Marks never mutate the document or intercept mousedown, so editing/selection remain native. */
export function noteHighlightExtension(
  segments: readonly NoteHighlightSegment[],
  activeNoteId: string | null | undefined,
  activate: (id: string) => void,
  zh: boolean,
): Extension {
  if (!segments.length) return [];
  let lastActivated = activeNoteId;
  let down: { x: number; y: number } | null = null;
  let dragged = false;
  const activateIds = (ids: readonly string[]) => { lastActivated = nextNoteId(ids, lastActivated); activate(lastActivated); };
  const field = StateField.define<readonly NoteHighlightSegment[]>({
    create: () => segments,
    update: (current, transaction) => {
      if (!transaction.docChanged) return current;
      // Invalidate the whole note, including its other overlapping fragments, before the
      // page's strict resolver receives the new source. Untouched notes still map normally.
      const invalid = new Set<string>();
      const bounds = new Map<string, { from: number; to: number }>();
      for (const segment of current) for (const id of segment.ids) {
        const previous = bounds.get(id);
        bounds.set(id, { from: previous?.from ?? segment.from, to: segment.to });
      }
      for (const [id, bound] of bounds) {
        transaction.changes.iterChangedRanges((from, to) => {
          if (from === to ? from > bound.from && from < bound.to : from < bound.to && to > bound.from) invalid.add(id);
        });
      }
      return current.flatMap((segment) => {
        const ids = segment.ids.filter((id) => !invalid.has(id));
        if (!ids.length) return [];
        const from = transaction.changes.mapPos(segment.from, 1), to = transaction.changes.mapPos(segment.to, -1);
        return from < to ? [{ from, to, ids }] : [];
      });
    },
    provide: (stateField) => EditorView.decorations.compute([stateField], (state) => {
      const current = state.field(stateField);
      return Decoration.set([
        ...current.map((segment) => Decoration.mark({ attributes: noteHighlightAttributes(segment.ids, activeNoteId, zh) }).range(segment.from, segment.to)),
        ...markerGroups(current, state.doc).map(({ at, ids }) => Decoration.widget({ widget: new NoteMarkerWidget(ids, activeNoteId, zh, activateIds), side: 1 }).range(at)),
      ], true);
    }),
  });
  return [field, EditorView.contentAttributes.of({ 'data-personal-notes': 'true' }), EditorView.domEventHandlers({
    mousedown: (event) => { down = { x: event.clientX, y: event.clientY }; dragged = false; return false; },
    mousemove: (event) => { if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) dragged = true; return false; },
    mouseup: () => { down = null; return false; },
    click: (event, view) => {
      if (dragged || !view.state.selection.main.empty || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const note = noteIdsFromElement(event.target);
      if (!note || !view.contentDOM.contains(note.element)) return false;
      activateIds(note.ids);
      return false;
    },
  })];
}
