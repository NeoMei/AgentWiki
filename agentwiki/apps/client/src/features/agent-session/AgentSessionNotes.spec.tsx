import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AgentSessionPanel } from './AgentSessionPanel';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { usePersonalNotes } from '../page/usePersonalNotes';
import { captureAssistTarget } from '../page/assistTargets';
import { applyCandidateToDraft } from '../page/assistCandidate';
import { loadPersonalNotes } from '../page/reviewComments';
import type { AgentTurn } from './agentSessionTypes';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
const auth = vi.hoisted(() => ({ id: 'user-a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
const version = '2026-10-06T01:00:00.000Z', original = 'one\nkeep\ntwo\n';
const summary = { id: 'session-a', spaceId: 'space-a', title: 'Conversation A', createdAt: version, updatedAt: version };
let notes: ReturnType<typeof usePersonalNotes>, turns: AgentTurn[], content: string;
function Bridge({ pageId = 'page-a', spaceId = 'space-a', edit = false }: { pageId?: string; spaceId?: string; edit?: boolean }) {
  notes = usePersonalNotes({ scope: { userId: auth.id, spaceId, pageId }, canEdit: edit, enabled: true, stageForSession: true, source: content, updatedAt: version });
  return <><output data-testid="notes">{JSON.stringify(notes.notes)}</output><AgentSessionPanel pageId={pageId} spaceId={spaceId} pageTitle="Page A" snapshot={() => ({ title: 'Page A', content, updatedAt: version })} canEdit canAccept={edit} supportsScopedApply assistRequest={notes.assistRequest} onRequestHandled={notes.onRequestHandled} onNotesEvent={notes.onNotesEvent} notesReady={notes.loaded} onApply={(candidate, editId) => { const applied = applyCandidateToDraft(candidate, { userId: auth.id, spaceId, pageId, title: 'Page A', content, updatedAt: version, canEdit: edit }, editId); if (applied.status !== 'applied') return false; content = applied.content; return true; }} /></>;
}
const shell = (route = 'read') => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}><Bridge key={route} pageId={route === 'other' ? 'page-b' : 'page-a'} spaceId={route === 'other-space' ? 'space-b' : 'space-a'} edit={route === 'edit'} /></AgentSessionRegistryProvider></MemoryRouter>;
async function stageFirst() {
  await screen.findByText('Start a conversation about this document.');
  act(() => { notes.add(captureAssistTarget(content, 'selection', 0, 3, version)!, 'Fix one'); notes.add(captureAssistTarget(content, 'selection', 9, 12, version)!, 'Keep this note private'); });
  const ids = notes.notes.map((note) => note.id);
  act(() => { expect(notes.dispatch([ids[0]])).toBe(true); });
  expect(api.post).not.toHaveBeenCalled(); expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  return ids;
}
beforeEach(() => {
  localStorage.clear(); auth.id = 'user-a'; turns = []; content = original;
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary] : { ...summary, turns } }));
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
    const turn: AgentTurn = { ...data, id: 'sent-turn', sessionId: summary.id, status: 'queued', createdAt: version, pageSnapshot: data.snapshot, references: [], progressText: '', result: null, error: null };
    turns = [turn]; return { data: turn };
  });
});
afterEach(cleanup);
it.each(['read/edit', 'page roundtrip'])('binds only explicitly staged notes after %s and resolves only after accepted coverage', async (boundary) => {
  const view = render(shell()); const ids = await stageFirst();
  if (boundary === 'page roundtrip') { view.rerender(shell('other')); await screen.findByText('Start a conversation about this document.'); }
  view.rerender(shell('edit')); await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  expect(notes.assistRequest).toBeNull(); expect(notes.notes.map((note) => note.status)).toEqual(['pending', 'pending']);
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ id: ids[0], status: 'dispatched', taskId: 'sent-turn' }));
  expect(notes.notes[1]).toMatchObject({ id: ids[1], status: 'pending' }); expect(notes.notes[1].taskId).toBeUndefined();
  expect((vi.mocked(api.post).mock.calls[0][1] as any).noteIds).toEqual([ids[0]]);
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']); expect(api.patch).not.toHaveBeenCalled();
});
it('retains Pending notes on a failed remounted Send and links them only after successful retry', async () => {
  const view = render(shell()); await stageFirst(); view.rerender(shell('edit'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('alert');
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0].status).toBe('dispatched')); expect(notes.notes[1].status).toBe('pending');
});
it.each(['wrong page', 'unselected note', 'stale version', 'changed source', 'changed title', 'changed annotation', 'changed quote'])('does not bind restored notes for a successful response with %s', async (mismatch) => {
  const view = render(shell()); const ids = await stageFirst(); view.rerender(shell('edit'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation(async (...args) => {
    const response = await post(...args) as { data: AgentTurn };
    if (mismatch === 'wrong page') response.data.pageId = 'page-b';
    if (mismatch === 'unselected note') response.data.noteIds = [ids[1]];
    if (mismatch === 'stale version') response.data.pageSnapshot!.updatedAt = 'old';
    if (mismatch === 'changed source') response.data.pageSnapshot!.content = 'changed source';
    if (mismatch === 'changed title') response.data.pageSnapshot!.title = 'changed title';
    if (mismatch === 'changed annotation') response.data.annotations = [{ ...response.data.annotations![0], body: 'Different annotation' }];
    if (mismatch === 'changed quote') response.data.annotations = [{ ...response.data.annotations![0], quote: 'two' }];
    return response;
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('button', { name: 'Stop' });
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
});

it.each(['account', 'Space'])('ignores a successful old Send after a %s switch without binding either identity', async (boundary) => {
  const view = render(shell()); await stageFirst(); view.rerender(shell('edit'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  if (boundary === 'account') auth.id = 'user-b';
  view.rerender(shell(boundary === 'Space' ? 'other-space' : 'edit'));
  await act(async () => finish());
  expect(notes.notes).toEqual([]);
  const originalNotes = loadPersonalNotes({ userId: 'user-a', spaceId: 'space-a', pageId: 'page-a' });
  expect(originalNotes.status).toBe('loaded');
  if (originalNotes.status === 'loaded') expect(originalNotes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
});
it('keeps a locally staged request in its own conversation when the user switches sessions', async () => {
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  render(shell()); await stageFirst();
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-b' } });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''); expect(screen.queryByText('Annotations staged (not sent yet)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-a' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  expect(screen.getByText('Annotations staged (not sent yet)')).toBeVisible(); expect(screen.getByRole('combobox', { name: 'Edit scope' })).toHaveValue('selection');
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
});

it.each(['unrelated append', 'anchor change'])('binds sent notes to the immutable snapshot during a deferred POST with %s and guards acceptance', async (change) => {
  const view = render(shell('edit')); const ids = await stageFirst();
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  const manuallyEdited = change === 'unrelated append' ? original + 'Manual end\n' : original.replace('one', 'Manual beginning');
  content = manuallyEdited; view.rerender(shell('edit'));
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  await act(async () => finish());
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ id: ids[0], taskId: 'sent-turn', status: 'dispatched' }));
  expect(notes.notes[1]).toMatchObject({ id: ids[1], status: 'pending' }); expect(notes.notes[1].taskId).toBeUndefined();
  expect(turns[0].pageSnapshot?.content).toBe(original); expect(content).toBe(manuallyEdited);
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  if (change === 'unrelated append') {
    expect(notes.notes[0].status).toBe('resolved'); expect(content).toBe('ONE\nkeep\ntwo\nManual end\n');
  } else {
    expect(notes.notes[0].status).not.toBe('resolved'); expect(content).toBe(manuallyEdited);
  }
  expect(notes.notes[1].status).toBe('pending'); expect(api.patch).not.toHaveBeenCalled();
});

it.each(['read/edit', 'away during receipt', 'return before receipt'])('reconciles a successful pending Send across %s without repeating upload', async (boundary) => {
  const view = render(shell()); const ids = await stageFirst();
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  if (boundary !== 'read/edit') { view.rerender(shell('other')); await waitFor(() => expect(notes.notes).toEqual([])); }
  if (boundary !== 'away during receipt') view.rerender(shell('edit'));
  await act(async () => finish());
  if (boundary === 'away during receipt') {
    expect(notes.notes).toEqual([]);
    view.rerender(shell('edit'));
  }
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ id: ids[0], taskId: 'sent-turn', status: 'dispatched' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  expect(screen.queryByText('Annotations staged (not sent yet)')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  expect(content).toBe('ONE\nkeep\ntwo\n');
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']);
  expect(notes.notes[1].taskId).toBeUndefined(); expect(api.patch).not.toHaveBeenCalled();
});

it.each(['selection', 'document'])('rebinds explicitly regenerated %s notes after a remount conflict and successful retry', async (scope) => {
  const view = render(shell('edit')); const ids = await stageFirst();
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Edit scope' }), { target: { value: scope } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0].status).toBe('dispatched'));
  expect(turns[0].pageSnapshot?.assistTarget?.kind).toBe(scope);
  const first = { ...turns[0], status: 'done' as const, result: { changes: 'ONE\nkeep\ntwo\n' } };
  turns = [first];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  view.rerender(shell('other')); content = original + 'Manual end\n'; view.rerender(shell('edit'));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(screen.getByRole('combobox', { name: 'Edit scope' })).toHaveValue(scope);
  content += 'Typed after regenerate\n'; view.rerender(shell('edit'));
  expect(notes.notes[0]).toMatchObject({ status: 'awaiting-review', taskId: 'sent-turn' });
  expect(api.post).toHaveBeenCalledTimes(1);
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('alert');
  expect(notes.notes[0]).toMatchObject({ status: 'awaiting-review', taskId: 'sent-turn' });
  expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveValue('');
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
    const turn: AgentTurn = { ...data, id: 'regenerated-turn', sessionId: summary.id, status: 'queued', createdAt: version, pageSnapshot: data.snapshot, references: [], progressText: '', result: null, error: null };
    turns = [first, turn]; return { data: turn };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ id: ids[0], status: 'dispatched', taskId: 'regenerated-turn' }));
  expect(turns[1].noteIds).toEqual([ids[0]]); expect(turns[1].annotations).toEqual([{ id: ids[0], body: 'Fix one', quote: 'one' }]);
  expect(turns[1].pageSnapshot).toMatchObject({ content: 'one\nkeep\ntwo\nManual end\nTyped after regenerate\n', updatedAt: version, assistTarget: { kind: scope, quote: scope === 'document' ? 'one\nkeep\ntwo\nManual end\nTyped after regenerate\n' : 'one' } });
  const { candidateFromTurn } = await import('./agentSessionCandidate');
  const old = candidateFromTurn(first, 'user-a', 'space-a')!.candidate;
  act(() => {
    notes.onNotesEvent({ event: 'ready', taskId: old.taskId, noteIds: [ids[0]], candidate: old });
    notes.onNotesEvent({ event: 'accept', taskId: old.taskId, noteIds: [ids[0]], candidate: old, acceptedEditIds: old.editPlan!.edits.map((edit) => edit.id) });
  });
  expect(notes.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'regenerated-turn' });
  turns = [first, { ...turns[1], status: 'done', result: { changes: 'ONE\nkeep\ntwo\nManual end\nTyped after regenerate\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(within(screen.getByTestId('agent-turn-regenerated-turn')).getByRole('button', { name: 'Accept change 1' }));
  expect(content).toBe('ONE\nkeep\ntwo\nManual end\nTyped after regenerate\n');
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']);
  expect(notes.notes[1].taskId).toBeUndefined(); expect(api.patch).not.toHaveBeenCalled();
});

it.each(['new message', 'another conversation'])('consumes only the original composer after a deferred Send with %s', async (boundary) => {
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  render(shell('edit')); await stageFirst();
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  // Drive the production handlers even while inputs are disabled, covering an already queued
  // input/navigation event. The receipt must own its draft, independently of UI disable timing.
  if (boundary === 'another conversation') {
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-b' } });
    await screen.findByRole('option', { name: 'Conversation B' });
  }
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'My next message' } });
  await act(async () => finish());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('My next message'));
  expect(screen.queryByText('Annotations staged (not sent yet)')).not.toBeInTheDocument();
  if (boundary === 'another conversation') {
    expect(screen.queryByText('Annotations staged (not sent yet)')).not.toBeInTheDocument();
    expect(notes.notes[0].status).toBe('pending');
    fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-a' } });
    await waitFor(() => expect(notes.notes[0].status).toBe('dispatched'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  }
  expect(api.post).toHaveBeenCalledTimes(1); expect(api.patch).not.toHaveBeenCalled();
});

it('delivers the original receipt while retaining a newer staged request on the remounted page', async () => {
  const view = render(shell()); const ids = await stageFirst();
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); view.rerender(shell('edit'));
  await waitFor(() => expect(notes.notes).toHaveLength(2));
  act(() => { expect(notes.dispatch([ids[1]])).toBe(true); });
  const newerRequest = notes.assistRequest!;
  await act(async () => finish());
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'sent-turn' }));
  expect(notes.notes[1]).toMatchObject({ status: 'pending' }); expect(notes.notes[1].taskId).toBeUndefined();
  expect(notes.assistRequest?.id).toBe(newerRequest.id);
  expect(screen.getByText('Annotations staged (not sent yet)')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Please discuss the questions in these annotations.');
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(turns[0].noteIds).toEqual([ids[0]]);
});

it('preserves staged notes and input after a failed pending Send across a real remount', async () => {
  const view = render(shell()); await stageFirst();
  let reject!: (error: Error) => void;
  vi.mocked(api.post).mockImplementationOnce(() => new Promise((_resolve, rejectPost) => { reject = rejectPost; }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); view.rerender(shell('edit'));
  await act(async () => reject(new Error('offline')));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Please discuss the questions in these annotations.');
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0].status).toBe('dispatched'));
  expect(notes.notes[1].status).toBe('pending'); expect(api.patch).not.toHaveBeenCalled();
});

it('waits for the current bridge authorization read before delivering an old-mount receipt', async () => {
  const view = render(shell()); await stageFirst();
  let finish!: () => void;
  vi.mocked(api.post).mockImplementation((_url, data: any) => {
    const turn: AgentTurn = { ...data, id: 'sent-turn', sessionId: summary.id, status: 'queued', createdAt: version, pageSnapshot: data.snapshot, references: [], progressText: '', result: null, error: null };
    turns = [turn];
    return new Promise((resolve) => { finish = () => resolve({ data: turn }); });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); view.rerender(shell('edit'));
  await screen.findByRole('button', { name: 'Stop' });
  vi.mocked(api.get).mockRejectedValue({ response: { status: 403 } });
  await act(async () => finish());
  await screen.findByRole('alert');
  expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  expect(screen.queryByTestId('agent-turn-sent-turn')).not.toBeInTheDocument();
  expect(api.patch).not.toHaveBeenCalled();
});
