import { beforeEach, describe, expect, it } from 'vitest';
import { addPersonalNote, transitionPersonalNotes, loadPersonalNotes, savePersonalNotes, personalNotesKey, notesForDispatch } from './reviewComments';
import { captureAssistTarget } from './assistTargets';
const scope = { userId: 'u', spaceId: 's', pageId: 'p' };
const target = captureAssistTarget('before quote after', 'selection', 7, 12, '2026-10-06T00:00:00Z')!;
describe('personal anchored review notes', () => {
  beforeEach(() => localStorage.clear());
  it('persists private notes in user Space page scope and keeps original orphan quote', () => {
    const note = addPersonalNote(scope, target, 'Explain', 'note-1');
    expect(savePersonalNotes(scope, [note], localStorage).status).toBe('saved');
    expect(loadPersonalNotes(scope, localStorage)).toMatchObject({ status: 'loaded', notes: [{ body: 'Explain', target: { quote: 'quote' } }] });
    for (const changed of [{ userId: 'other' }, { spaceId: 'other' }, { pageId: 'other' }]) expect(loadPersonalNotes({ ...scope, ...changed }, localStorage)).toEqual({ status: 'loaded', notes: [] });
  });
  it('never resolves on send or completion, requires matching task acceptance, and reopens failures/discard', () => {
    const note = addPersonalNote(scope, target, 'Explain', 'note-1');
    const dispatched = transitionPersonalNotes([note], ['note-1'], 'dispatch', 'task-1');
    expect(dispatched[0].status).toBe('dispatched');
    expect(transitionPersonalNotes(dispatched, ['note-1'], 'accept', 'task-1')[0].status).toBe('dispatched');
    const ready = transitionPersonalNotes(dispatched, ['note-1'], 'ready', 'task-1');
    expect(ready[0].status).toBe('awaiting-review');
    expect(transitionPersonalNotes(ready, ['note-1'], 'accept', 'other')[0].status).toBe('awaiting-review');
    expect(transitionPersonalNotes(ready, ['note-1'], 'accept', 'task-1')[0].status).toBe('resolved');
    for (const event of ['fail', 'discard', 'reopen'] as const) expect(transitionPersonalNotes(ready, ['note-1'], event, 'task-1')[0]).toMatchObject({ status: 'pending', taskId: undefined });
  });
  it('refuses corrupt or cross-account records and reports failed persistence', () => {
    localStorage.setItem(personalNotesKey(scope), JSON.stringify([addPersonalNote({ ...scope, userId: 'wrong' }, target, 'secret', 'id')]));
    expect(loadPersonalNotes(scope, localStorage).status).toBe('invalid');
    expect(savePersonalNotes(scope, [addPersonalNote({ ...scope, spaceId: 'wrong' }, target, 'text', 'id')], localStorage).status).toBe('invalid');
    expect(savePersonalNotes(scope, [], { getItem: () => null, setItem: () => { throw new Error('quota'); } }).status).toBe('unavailable');
  });
  it('batches only selected pending notes with a unique live anchor', () => {
    const note = addPersonalNote(scope, target, 'Explain', 'note-1');
    expect(notesForDispatch([note], ['note-1'], 'before quote after')).toMatchObject({ status: 'ready', notes: [{ id: 'note-1' }] });
    expect(notesForDispatch([note], ['note-1'], 'orphan').status).toBe('conflict');
    const sent = transitionPersonalNotes([note], ['note-1'], 'dispatch', 'task-1');
    expect(notesForDispatch(sent, ['note-1'], 'before quote after').status).toBe('conflict');
  });
});

it('treats malformed persisted note ranges and JSON as invalid without overwriting them', () => {
  localStorage.clear();
  const note = addPersonalNote(scope, target, 'Explain', 'id');
  const raw = JSON.stringify([{ ...note, target: { ...target, to: 999 } }]);
  localStorage.setItem(personalNotesKey(scope), raw);
  expect(loadPersonalNotes(scope, localStorage).status).toBe('invalid');
  expect(localStorage.getItem(personalNotesKey(scope))).toBe(raw);
  localStorage.setItem(personalNotesKey(scope), '{');
  expect(loadPersonalNotes(scope, localStorage).status).toBe('invalid');
});

it.each([
  { label: 'fractional', from: 7.5, to: 12.5 },
  { label: 'numeric strings', from: '7', to: '12' },
  { label: 'mixed numeric string', from: '7', to: 12 },
  { label: 'negative', from: -1, to: 4 },
  { label: 'reversed', from: 12, to: 7 },
  { label: 'unsafe integers', from: 2 ** 53, to: 2 ** 53 + 4, quote: 'quot' },
  { label: 'positive infinity', from: Infinity, to: Infinity },
  { label: 'negative infinity', from: -Infinity, to: -Infinity },
  { label: 'NaN', from: NaN, to: NaN },
])('rejects $label original note offsets on both load and save without replacing stored bytes', ({ from, to, quote }) => {
  localStorage.clear();
  const note = addPersonalNote(scope, target, 'Explain', 'id');
  const malformed = { ...note, target: { ...target, from, to, quote: quote ?? target.quote } } as unknown as typeof note;
  const raw = JSON.stringify([malformed]);
  localStorage.setItem(personalNotesKey(scope), raw);
  expect(loadPersonalNotes(scope, localStorage).status).toBe('invalid');
  expect(savePersonalNotes(scope, [malformed], localStorage).status).toBe('invalid');
  expect(localStorage.getItem(personalNotesKey(scope))).toBe(raw);
});
