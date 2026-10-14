import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AgentSessionPanel } from './AgentSessionPanel';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { usePersonalNotes } from '../page/usePersonalNotes';
import { captureAssistTarget } from '../page/assistTargets';
import { applyCandidateToDraft } from '../page/assistCandidate';
import type { PageNoteDto } from '../page/pageNotesApi';
import type { AgentTurn } from './agentSessionTypes';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
const auth = vi.hoisted(() => ({ id: 'user-a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
const version = '2026-10-06T01:00:00.000Z', original = 'one\nkeep\ntwo\n';
const summary = { id: 'session-a', spaceId: 'space-a', title: 'Conversation A', createdAt: version, updatedAt: version };

let serverNotes: PageNoteDto[] = [], noteRevision = 0;
const noteRoute = /^\/spaces\/([^/]+)\/pages\/([^/]+)\/notes(?:\/([^/]+))?$/;
const notesGet = (url: string) => {
  const route = noteRoute.exec(url); if (!route) return null;
  return Promise.resolve({ data: { notes: structuredClone(serverNotes.filter((note) => note.spaceId === route[1] && note.pageId === route[2]).map((note) => ({ ...note, canEdit: note.author.type === 'user' && note.author.id === auth.id }))), canCreate: true } });
};
const notesPost = (url: string, input: any) => {
  const route = noteRoute.exec(url); if (!route) return null;
  const existing = serverNotes.find((note) => note.clientNoteId === input.clientNoteId && note.author.id === auth.id && note.pageId === route[2] && note.spaceId === route[1]);
  if (existing) return Promise.resolve({ data: structuredClone(existing) });
  const note: PageNoteDto = { ...input, id: `server-${input.clientNoteId}`, spaceId: route[1], pageId: route[2], status: input.status ?? 'pending', author: { type: 'user', id: auth.id, name: auth.id }, canEdit: true, createdAt: version, updatedAt: String(++noteRevision) };
  serverNotes.push(note); return Promise.resolve({ data: structuredClone(note) });
};
const notesPatch = async (url: string, input: any) => {
  const route = noteRoute.exec(url);
  const index = serverNotes.findIndex((note) => note.id === route?.[3] && note.spaceId === route?.[1] && note.pageId === route?.[2] && note.author.type === 'user' && note.author.id === auth.id);
  if (index < 0 || serverNotes[index].updatedAt !== input.expectedUpdatedAt) throw new Error('Invalid note update or stale version');
  serverNotes[index] = { ...serverNotes[index], status: input.status ?? serverNotes[index].status, taskId: input.taskId ?? undefined, updatedAt: String(++noteRevision) };
  return { data: structuredClone(serverNotes[index]) };
};
const agentPostCalls = () => vi.mocked(api.post).mock.calls.filter(([url]) => url.startsWith('/assist/'));
const pagePatchCalls = () => vi.mocked(api.patch).mock.calls.filter(([url]) => !noteRoute.test(url));
const notesSettled = async () => { await waitFor(() => expect(notes.loaded && !notes.syncing).toBe(true)); };
const editScope = () => {
  const select = screen.getByRole('combobox', { name: 'Edit scope', hidden: true });
  if (!select.closest('details')?.open) fireEvent.click(screen.getByLabelText('Context settings'));
  expect(select).toBeVisible(); return select;
};
const inspectStagedNotes = (body: string) => {
  const label = screen.getByText('These page notes will be included with your message.');
  const details = label.closest('details')!;
  if (!details.open) fireEvent.click(details.querySelector('summary')!);
  expect(label).toBeVisible();
  expect(within(details).getByText(body)).toBeVisible();
};
let notes: ReturnType<typeof usePersonalNotes>, turns: AgentTurn[], content: string;
function Bridge({ pageId = 'page-a', spaceId = 'space-a', edit = false }: { pageId?: string; spaceId?: string; edit?: boolean }) {
  notes = usePersonalNotes({ scope: { userId: auth.id, spaceId, pageId }, canEdit: edit, enabled: true, stageForSession: true, source: content, updatedAt: version });
  return <><output data-testid="notes">{JSON.stringify(notes.notes)}</output><AgentSessionPanel pageId={pageId} spaceId={spaceId} pageTitle="Page A" snapshot={() => ({ title: 'Page A', content, updatedAt: version })} canEdit canAccept={edit} supportsScopedApply assistRequest={notes.assistRequest} onRequestHandled={notes.onRequestHandled} onNotesEvent={notes.onNotesEvent} notesReady={notes.loaded} onApply={(candidate, editId) => { const applied = applyCandidateToDraft(candidate, { userId: auth.id, spaceId, pageId, title: 'Page A', content, updatedAt: version, canEdit: edit }, editId); if (applied.status !== 'applied') return false; content = applied.content; return true; }} /></>;
}
const shell = (route = 'read') => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}><Bridge key={route} pageId={route === 'other' ? 'page-b' : 'page-a'} spaceId={route === 'other-space' ? 'space-b' : 'space-a'} edit={route === 'edit'} /></AgentSessionRegistryProvider></MemoryRouter>;
async function stageFirst() {
  await screen.findByText('Start a conversation about this document.');
  await notesSettled();
  await act(async () => { expect(await notes.add(captureAssistTarget(content, 'selection', 0, 3, version)!, 'Fix one')).toBe(true); expect(await notes.add(captureAssistTarget(content, 'selection', 9, 12, version)!, 'Do not stage this note')).toBe(true); });
  const ids = notes.notes.map((note) => note.id);
  act(() => { expect(notes.dispatch([ids[0]])).toBe(true); });
  expect(agentPostCalls()).toHaveLength(0); expect(notes.notes.every((note) => note.status === 'pending' && !note.taskId)).toBe(true);
  return ids;
}
beforeEach(() => {
  localStorage.clear(); auth.id = 'user-a'; turns = []; content = original; serverNotes = []; noteRevision = 0;
  vi.mocked(api.patch).mockImplementation(notesPatch);
  vi.mocked(api.get).mockImplementation(async (url) => notesGet(url) ?? ({ data: url === '/assist/sessions' ? [summary] : { ...summary, turns } }));
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
    const noteResponse = notesPost(_url, data); if (noteResponse) return noteResponse;
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
  expect((agentPostCalls()[0][1] as any).noteIds).toEqual([ids[0]]);
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']); expect(pagePatchCalls()).toHaveLength(0);
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
  await notesSettled();
  if (boundary === 'Space') expect(notes.notes).toEqual([]);
  else { expect(notes.notes).toHaveLength(2); expect(notes.notes.every((note) => note.author?.id === 'user-a' && note.canEdit === false && note.status === 'pending' && !note.taskId)).toBe(true); }
  expect(serverNotes).toHaveLength(2);
  expect(serverNotes.every((note) => note.author.id === 'user-a' && note.status === 'pending' && !note.taskId)).toBe(true);
});
it('keeps a locally staged request in its own conversation when the user switches sessions', async () => {
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => notesGet(url) ?? ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  render(shell()); await stageFirst();
  fireEvent.click(screen.getByRole('tab', { name: 'Conversation B' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''); expect(screen.queryByText('These page notes will be included with your message.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Conversation A' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  inspectStagedNotes('Fix one'); expect(editScope()).toHaveValue('selection');
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
  expect(notes.notes[1].status).toBe('pending'); expect(pagePatchCalls()).toHaveLength(0);
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
  expect(screen.queryByText('These page notes will be included with your message.')).not.toBeInTheDocument();
  expect(agentPostCalls()).toHaveLength(1);
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  expect(content).toBe('ONE\nkeep\ntwo\n');
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']);
  expect(notes.notes[1].taskId).toBeUndefined(); expect(pagePatchCalls()).toHaveLength(0);
});

it.each(['selection', 'document'])('rebinds explicitly regenerated %s notes after a remount conflict and successful retry', async (scope) => {
  const view = render(shell('edit')); const ids = await stageFirst();
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.change(editScope(), { target: { value: scope } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0].status).toBe('dispatched'));
  expect(turns[0].pageSnapshot?.assistTarget?.kind).toBe(scope);
  const first = { ...turns[0], status: 'done' as const, result: { changes: 'ONE\nkeep\ntwo\n' } };
  turns = [first];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  view.rerender(shell('other')); content = original + 'Manual end\n'; view.rerender(shell('edit'));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(editScope()).toHaveValue(scope);
  content += 'Typed after regenerate\n'; view.rerender(shell('edit'));
  expect(notes.notes[0]).toMatchObject({ status: 'awaiting-review', taskId: 'sent-turn' });
  expect(agentPostCalls()).toHaveLength(1);
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByRole('alert');
  expect(notes.notes[0]).toMatchObject({ status: 'awaiting-review', taskId: 'sent-turn' });
  expect(screen.getByRole('textbox', { name: 'Message' })).not.toHaveValue('');
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
    const noteResponse = notesPost(_url, data); if (noteResponse) return noteResponse;
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
    notes.onNotesEvent({ event: 'ready', taskId: old.taskId, noteIds: [ids[0]], candidate: old, annotations: first.annotations });
    notes.onNotesEvent({ event: 'accept', taskId: old.taskId, noteIds: [ids[0]], candidate: old, annotations: first.annotations, acceptedEditIds: old.editPlan!.edits.map((edit) => edit.id) });
  });
  expect(notes.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'regenerated-turn' });
  turns = [first, { ...turns[1], status: 'done', result: { changes: 'ONE\nkeep\ntwo\nManual end\nTyped after regenerate\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(within(screen.getByTestId('agent-turn-regenerated-turn')).getByRole('button', { name: 'Accept change 1' }));
  expect(content).toBe('ONE\nkeep\ntwo\nManual end\nTyped after regenerate\n');
  expect(notes.notes.map((note) => note.status)).toEqual(['resolved', 'pending']);
  expect(notes.notes[1].taskId).toBeUndefined(); expect(pagePatchCalls()).toHaveLength(0);
});

it.each([{ resolvedIndex: 0, regenerateAgain: false }, { resolvedIndex: 1, regenerateAgain: true }])('regenerates mixed Document notes after partial acceptance and Undo (resolved index $resolvedIndex)', async ({ resolvedIndex, regenerateAgain }) => {
  const view = render(shell('edit'));
  await screen.findByText('Start a conversation about this document.');
  await notesSettled();
  await act(async () => {
    expect(await notes.add(captureAssistTarget(content, 'selection', 0, 3, version)!, 'Fix one')).toBe(true);
    expect(await notes.add(captureAssistTarget(content, 'selection', 9, 12, version)!, 'Fix two')).toBe(true);
    expect(await notes.add(captureAssistTarget(content, 'selection', 4, 8, version)!, 'Do not stage')).toBe(true);
  });
  const ids = notes.notes.slice(0, 2).map((note) => note.id), unresolvedIndex = 1 - resolvedIndex;
  const unstagedNote = structuredClone(notes.notes[2]);
  act(() => { expect(notes.dispatch(ids)).toBe(true); });
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.change(editScope(), { target: { value: 'document' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[unresolvedIndex].status).toBe('dispatched'));
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\nTWO\n' } }];
  await waitFor(() => expect(notes.notes[unresolvedIndex].status).toBe('awaiting-review'), { timeout: 2000 });
  fireEvent.click(screen.getByRole('button', { name: `Accept change ${resolvedIndex + 1}` }));
  expect(content).toBe(resolvedIndex === 0 ? 'ONE\nkeep\ntwo\n' : 'one\nkeep\nTWO\n');
  // The server concurrency token may advance after this optimistic snapshot; all semantic fields must remain unchanged.
  const resolvedNote = structuredClone(notes.notes[resolvedIndex]);
  expect(resolvedNote).toMatchObject({ status: 'resolved', taskId: 'sent-turn' });
  // Component evidence only: byte-exact reset models standard editor Undo; historical note status stays resolved.
  content = original;
  expect(notes.notes[resolvedIndex]).toEqual({ ...resolvedNote, updatedAt: expect.any(String) });
  content += 'Manual end\n';
  let previousId = 'sent-turn';
  for (const nextId of regenerateAgain ? ['regenerated-turn', 'regenerated-again'] : ['regenerated-turn']) {
    view.rerender(shell('other')); view.rerender(shell('edit'));
    const previous = await screen.findByTestId(`agent-turn-${previousId}`);
    expect(within(previous).getByRole('alert')).toHaveTextContent('Page, permissions, version or draft changed. Please regenerate.');
    fireEvent.click(within(previous).getByRole('button', { name: 'Regenerate from current draft' }));
    expect(editScope()).toHaveValue('document');
    expect(notes.notes[unresolvedIndex]).toMatchObject({ status: 'awaiting-review', taskId: previousId });
    const beforeSend = structuredClone(notes.notes);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText('Request failed. Your message is preserved. Please retry.');
    expect(notes.notes).toEqual(beforeSend);
    vi.mocked(api.post).mockImplementation(async (_url, data: any) => {
    const noteResponse = notesPost(_url, data); if (noteResponse) return noteResponse;
      const turn: AgentTurn = { ...data, id: nextId, sessionId: summary.id, status: 'queued', createdAt: version, pageSnapshot: data.snapshot, references: [], progressText: '', result: null, error: null };
      turns = [...turns, turn]; return { data: turn };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(notes.notes[unresolvedIndex]).toMatchObject({ status: 'dispatched', taskId: nextId }));
    expect(notes.notes[resolvedIndex]).toEqual({ ...resolvedNote, updatedAt: expect.any(String) });
    expect(turns[turns.length - 1]).toMatchObject({ noteIds: ids, annotations: [{ id: ids[0], body: 'Fix one', quote: 'one' }, { id: ids[1], body: 'Fix two', quote: 'two' }] });
    // Rebuild the hook after the successful receipt was consumed, before candidate coverage arrives.
    view.rerender(shell('other')); view.rerender(shell('edit'));
    await screen.findByTestId(`agent-turn-${nextId}`);
    const proposed = content.replace(unresolvedIndex === 0 ? 'one' : 'two', unresolvedIndex === 0 ? 'ONE' : 'TWO');
    turns = turns.map((turn) => turn.id === nextId ? { ...turn, status: 'done', result: { changes: proposed } } : turn);
    await waitFor(() => expect(notes.notes[unresolvedIndex]).toMatchObject({ status: 'awaiting-review', taskId: nextId }), { timeout: 2000 });
    if (regenerateAgain && nextId === 'regenerated-turn') content += 'Another manual end\n';
    previousId = nextId;
  }
  fireEvent.click(within(screen.getByTestId(`agent-turn-${previousId}`)).getByRole('button', { name: 'Accept change 1' }));
  expect(notes.notes[unresolvedIndex]).toMatchObject({ status: 'resolved', taskId: previousId });
  expect(notes.notes[resolvedIndex]).toEqual({ ...resolvedNote, updatedAt: expect.any(String) });
  expect(notes.notes[2]).toEqual(unstagedNote);
  expect(content).toBe(resolvedIndex === 0 ? 'one\nkeep\nTWO\nManual end\n' : 'ONE\nkeep\ntwo\nManual end\nAnother manual end\n');
  expect(pagePatchCalls()).toHaveLength(0);
});

it.each(['new message', 'another conversation'])('consumes only the original composer after a deferred Send with %s', async (boundary) => {
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => notesGet(url) ?? ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  render(shell('edit')); await stageFirst();
  let finish!: () => void;
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation((...args) => new Promise((resolve) => { finish = () => { void Promise.resolve(post(...args)).then(resolve); }; }));
  // Drive the production handlers even while inputs are disabled, covering an already queued
  // input/navigation event. The receipt must own its draft, independently of UI disable timing.
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    if (boundary === 'another conversation') fireEvent.click(screen.getByRole('tab', { name: 'Conversation B' }));
  });
  if (boundary === 'another conversation') {
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Conversation B' })).toHaveAttribute('aria-selected', 'true'));
  }
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'My next message' } });
  await act(async () => finish());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('My next message'));
  expect(screen.queryByText('These page notes will be included with your message.')).not.toBeInTheDocument();
  if (boundary === 'another conversation') {
    expect(screen.queryByText('These page notes will be included with your message.')).not.toBeInTheDocument();
    expect(notes.notes[0].status).toBe('pending');
    fireEvent.click(screen.getByRole('tab', { name: 'Conversation A' }));
    await waitFor(() => expect(notes.notes[0].status).toBe('dispatched'));
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
  }
  expect(agentPostCalls()).toHaveLength(1); expect(pagePatchCalls()).toHaveLength(0);
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
  inspectStagedNotes('Do not stage this note');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Please discuss the questions in these annotations.');
  expect(agentPostCalls()).toHaveLength(1);
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
  expect(notes.notes[1].status).toBe('pending'); expect(pagePatchCalls()).toHaveLength(0);
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
  expect(pagePatchCalls()).toHaveLength(0);
});


it('persists an accepted note across a route roundtrip while its server PATCH receipt is pending', async () => {
  const view = render(shell('edit')); const ids = await stageFirst();
  fireEvent.change(screen.getByRole('combobox', { name: 'Message mode' }), { target: { value: 'proposal' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ status: 'dispatched', taskId: 'sent-turn' }));
  turns = [{ ...turns[0], status: 'done', result: { changes: 'ONE\nkeep\ntwo\n' } }];
  await waitFor(() => expect(notes.notes[0].status).toBe('awaiting-review'), { timeout: 2000 });
  let finish!: () => void;
  vi.mocked(api.patch).mockImplementation((url, input: any, config) => {
    if (input.status !== 'resolved') return notesPatch(url, input);
    return new Promise((resolve, reject) => {
      finish = () => {
        if (config?.signal?.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
        void notesPatch(url, input).then(resolve, reject);
      };
    });
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(notes.notes[0]).toMatchObject({ id: ids[0], status: 'resolved', taskId: 'sent-turn' });
  expect(serverNotes[0].status).toBe('awaiting-review');
  view.rerender(shell('other'));
  await waitFor(() => expect(notes.loaded).toBe(true));
  expect(notes.notes).toEqual([]);
  view.rerender(shell('edit'));
  await act(async () => finish());
  await waitFor(() => expect(notes.notes[0]).toMatchObject({ id: ids[0], status: 'resolved', taskId: 'sent-turn' }));
  expect(serverNotes[0]).toMatchObject({ id: ids[0], status: 'resolved', taskId: 'sent-turn' });
  expect(notes.notes[1]).toMatchObject({ id: ids[1], status: 'pending' });
  expect(content).toBe('ONE\nkeep\ntwo\n');
  expect(agentPostCalls()).toHaveLength(1);
  expect(vi.mocked(api.patch).mock.calls.filter(([, input]) => (input as any).status === 'resolved')).toHaveLength(1);
  expect(pagePatchCalls()).toHaveLength(0);
});
