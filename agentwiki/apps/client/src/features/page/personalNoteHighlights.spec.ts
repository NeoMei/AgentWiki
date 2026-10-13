import { describe, expect, it, vi } from 'vitest';
import { captureAssistTarget } from './assistTargets';
import { addPersonalNote } from './reviewComments';
import { locateReadingNote, resolvePersonalNoteHighlights } from './personalNoteHighlights';

const scope = { userId: 'u', spaceId: 's', pageId: 'p' };
const target = captureAssistTarget('before quote after', 'selection', 7, 12, '2026-10-14T00:00:00Z')!;
const note = addPersonalNote(scope, target, 'Private thought', 'note');
describe('personal note highlight locations', () => {
  it('relocates an intact exact contextual anchor after insertion without changing the stored note', () => {
    expect(resolvePersonalNoteHighlights('new before quote after', [note])).toEqual([{ id: 'note', from: 11, to: 16 }]);
    expect(note.target).toMatchObject({ from: 7, to: 12 });
  });
  it('never highlights a surviving quote when its context is stale or repeated', () => {
    expect(resolvePersonalNoteHighlights('changed quote after', [note])).toEqual([]);
    expect(resolvePersonalNoteHighlights('before quote after before quote after', [note])).toEqual([]);
  });
  it('keeps resolved and dispatched annotations visible without changing their status', () => {
    expect(resolvePersonalNoteHighlights('before quote after', [
      { ...note, id: 'done', status: 'resolved', taskId: 'task' },
      { ...note, id: 'sent', status: 'dispatched', taskId: 'task' },
    ])).toEqual([{ id: 'done', from: 7, to: 12 }, { id: 'sent', from: 7, to: 12 }]);
  });
  it('locates the second overlapping annotation only within the current article', () => {
    const root = document.createElement('div'), marker = document.createElement('span');
    marker.tabIndex = 0; marker.dataset.noteIds = '["first","second"]';
    const scroll = vi.fn(); marker.scrollIntoView = scroll;
    root.append(marker); document.body.append(root);
    try {
      expect(locateReadingNote(root, 'second')).toBe(true);
      expect(document.activeElement).toBe(marker);
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'smooth' });
      expect(locateReadingNote(document.createElement('div'), 'second')).toBe(false);
      expect(locateReadingNote(root, 'orphan')).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(1);
    } finally { root.remove(); }
  });
  it('opens nested details containing the note before scrolling and focusing without changing other folds', () => {
    const root = document.createElement('div'), outer = document.createElement('details'), inner = document.createElement('details');
    const untouchedClosed = document.createElement('details'), untouchedOpen = document.createElement('details');
    untouchedOpen.open = true;
    const marker = document.createElement('span'); marker.tabIndex = 0; marker.dataset.noteIds = '["nested"]';
    const scroll = vi.fn(() => { expect(outer.open).toBe(true); expect(inner.open).toBe(true); });
    marker.scrollIntoView = scroll;
    inner.append(marker); outer.append(inner); root.append(outer, untouchedClosed, untouchedOpen); document.body.append(root);
    try {
      expect(locateReadingNote(root, 'nested')).toBe(true);
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'smooth' });
      expect(document.activeElement).toBe(marker);
      expect(untouchedClosed.open).toBe(false); expect(untouchedOpen.open).toBe(true);
    } finally { root.remove(); }
  });
});
