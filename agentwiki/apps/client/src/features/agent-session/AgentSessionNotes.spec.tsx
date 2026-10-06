import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AgentSessionPanel } from './AgentSessionPanel';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { usePersonalNotes } from '../page/usePersonalNotes';
import { captureAssistTarget } from '../page/assistTargets';
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
  return <><output data-testid="notes">{JSON.stringify(notes.notes)}</output><AgentSessionPanel pageId={pageId} spaceId={spaceId} pageTitle="Page A" snapshot={() => ({ title: 'Page A', content, updatedAt: version })} canEdit canAccept={edit} supportsScopedApply assistRequest={notes.assistRequest} onRequestHandled={notes.onRequestHandled} onNotesEvent={notes.onNotesEvent} notesReady={notes.loaded} onApply={() => { content = 'ONE\nkeep\ntwo\n'; return true; }} /></>;
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
it.each(['wrong page', 'unselected note', 'stale version', 'changed source'])('does not bind restored notes for a successful response with %s', async (mismatch) => {
  const view = render(shell()); const ids = await stageFirst(); view.rerender(shell('edit'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  const post = vi.mocked(api.post).getMockImplementation()!;
  vi.mocked(api.post).mockImplementation(async (...args) => {
    const response = await post(...args) as { data: AgentTurn };
    if (mismatch === 'wrong page') response.data.pageId = 'page-b';
    if (mismatch === 'unselected note') response.data.noteIds = [ids[1]];
    if (mismatch === 'stale version') response.data.pageSnapshot!.updatedAt = 'old';
    if (mismatch === 'changed source') response.data.pageSnapshot!.content = 'changed source';
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
