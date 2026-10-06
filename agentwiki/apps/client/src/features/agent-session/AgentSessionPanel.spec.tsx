import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import api from '../../api/client';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { AgentSessionPanel } from './AgentSessionPanel';
import type { AgentSessionPanelProps, AgentTurn } from './agentSessionTypes';
import { captureAssistTarget } from '../page/assistTargets';
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
const auth = vi.hoisted(() => ({ id: 'user-a' }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: auth }) }));
const version = '2026-10-06T01:00:00.000Z';
const summary = { id: 'session-a', spaceId: 'space-a', title: 'Conversation A', createdAt: version, updatedAt: version };
const turn: AgentTurn = { id: 'turn-a', sessionId: summary.id, pageId: 'page-a', mode: 'question', intent: 'Earlier question', status: 'done', createdAt: version, pageSnapshot: { title: 'Original A', content: 'Original source', updatedAt: version }, references: [{ pageId: 'ref-a', title: 'Original reference', updatedAt: version }], noteIds: [], progressText: '', result: { summary: 'Earlier answer' }, error: null };
const defaults: AgentSessionPanelProps = { pageId: 'page-a', spaceId: 'space-a', pageTitle: 'Page A', snapshot: () => ({ title: 'Page A', content: 'unsaved current draft', updatedAt: version, draftRevision: 1, remoteRevision: 0 }), canEdit: true, canAccept: true };
function tree(props: Partial<AgentSessionPanelProps> = {}, user = auth.id) { return <MemoryRouter><AgentSessionRegistryProvider userId={user}><AgentSessionPanel {...defaults} {...props} /></AgentSessionRegistryProvider></MemoryRouter>; }
let turns: AgentTurn[];
beforeEach(() => {
  auth.id = 'user-a'; turns = [turn];
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary] : url === '/assist/sessions/session-a' ? { ...summary, turns } : { results: [{ page: { id: 'page-b', title: 'Reference B', spaceId: 'space-a' } }] } }));
  vi.mocked(api.post).mockImplementation(async (url, data: any) => url === '/assist/sessions' ? { data: { ...summary, id: 'session-new', title: 'New conversation' } } : { data: { ...turn, ...data, id: 'turn-new', sessionId: summary.id, status: 'queued', pageSnapshot: data.snapshot, references: [], result: null } });
});
afterEach(cleanup);
describe('durable Agent session document bridge', () => {
  it('keeps history across pages/read mode and explicitly sends current draft plus selected references', async () => {
    const applyToWrongPage = vi.fn(); const rendered = render(tree());
    expect(await screen.findByText('Earlier answer')).toBeVisible();
    rendered.rerender(tree({ pageId: 'page-b', pageTitle: 'Page B', canAccept: false, onApply: applyToWrongPage }));
    expect(screen.getByText('Earlier answer')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: 'Find reference pages' }), { target: { value: 'Reference' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add Reference B' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const sent = vi.mocked(api.post).mock.calls.find(([url]) => url.endsWith('/turns'))?.[1] as any;
    expect(sent.referencePageIds).toEqual(['page-b']); expect(sent.snapshot.content).toBe('unsaved current draft'); expect(sent.pageId).toBe('page-b');
    expect(applyToWrongPage).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
    fireEvent.click(screen.getAllByText('Sources and versions at send')[0]);
    expect(screen.getByText('Original A')).toBeVisible(); expect(screen.getByText('Original reference')).toBeVisible();
  });
  it('retains failed send intent and references, shows recovery, and supports a fresh empty conversation', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'));
    render(tree()); await screen.findByText('Earlier answer');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep my message' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/retry/i);
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep my message');
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await waitFor(() => expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument());
    expect(screen.getByText('Start a conversation about this document.')).toBeVisible();
  });
  it('allows reader questions, stages immutable private annotations until explicit Send and never resolves on response', async () => {
    const onNotesEvent = vi.fn(), onRequestHandled = vi.fn();
    render(tree({ canEdit: false, canAccept: false, assistRequest: { id: 'req', intent: 'Explain my notes', autoSubmit: true, noteIds: ['note-a'], annotations: [{ id: 'note-a', quote: 'unsaved', body: 'Why?' }] }, onNotesEvent, onRequestHandled }));
    await screen.findByText('Earlier answer');
    expect(api.post).not.toHaveBeenCalled(); expect(screen.getByRole('option', { name: 'Propose changes' })).toBeDisabled();
    expect(screen.getByText('Why?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onRequestHandled).toHaveBeenCalledWith('req'));
    const payload = vi.mocked(api.post).mock.calls[0][1] as any;
    expect(payload.mode).toBe('question'); expect(payload.annotations).toEqual([{ id: 'note-a', quote: 'unsaved', body: 'Why?' }]);
    expect(onNotesEvent.mock.calls[0][0].event).toBe('dispatch'); expect(onNotesEvent.mock.invocationCallOrder[0]).toBeLessThan(onRequestHandled.mock.invocationCallOrder[0]);
    expect(onNotesEvent.mock.calls.some(([e]) => e.event === 'accept')).toBe(false);
  });
});

it('preserves a staged composer when first session creation succeeds but its first send fails', async () => {
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.post).mockImplementation(async (url) => { if (url === '/assist/sessions') return { data: { ...summary, id: 'new' } }; throw new Error('offline'); });
  render(tree({ assistRequest: { id: 'first-request', intent: 'Keep annotations', noteIds: ['n'], annotations: [{ id: 'n', quote: 'unsaved', body: 'keep note' }] } }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep annotations'); expect(screen.getByText('keep note')).toBeVisible();
});
it('clears an inaccessible historical source on 400 while keeping the unsent composer recoverable', async () => {
  render(tree()); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Still here' } });
  vi.mocked(api.get).mockRejectedValue({ response: { status: 400, data: { message: 'Session page must exist in the selected Space' } } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-a' } });
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer accessible');
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Still here');
});
it('does not send stale failures into a newly selected conversation', async () => {
  let reject!: (error: unknown) => void;
  const delayed = new Promise((_, rejectPromise) => { reject = rejectPromise; });
  vi.mocked(api.post).mockReturnValue(delayed as any);
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
  const rendered = render(tree()); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Delayed' } }); fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  // A new document mount is permitted while POST is outstanding, even with the selector disabled.
  rendered.rerender(tree({ spaceId: 'space-b' }));
  await act(async () => reject(new Error('old send')));
  expect(screen.queryByText('Request failed. Your message is preserved. Please retry.')).not.toBeInTheDocument();
});

it('switches sessions without allowing an older fetch to overwrite the selected history', async () => {
  let resolveA!: (value: any) => void;
  const delayed = new Promise((resolve) => { resolveA = resolve; });
  const second = { ...summary, id: 'session-b', title: 'Conversation B' };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/assist/sessions') return { data: [summary, second] };
    if (url.endsWith('session-a')) return delayed as any;
    return { data: { ...second, turns: [{ ...turn, id: 'turn-b', sessionId: 'session-b', result: { summary: 'Answer B' } }] } };
  });
  render(tree()); await screen.findByRole('option', { name: 'Conversation B' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-b' } });
  await screen.findByText('Answer B');
  await act(async () => resolveA({ data: { ...summary, turns: [turn] } }));
  expect(screen.getByText('Answer B')).toBeVisible(); expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
});
it('recovers server history after refresh and clears all visible history on account and Space switches', async () => {
  const first = render(tree()); await screen.findByText('Earlier answer'); first.unmount();
  const restored = render(tree()); expect(await screen.findByText('Earlier answer')).toBeVisible();
  vi.mocked(api.get).mockResolvedValue({ data: [] }); auth.id = 'user-b';
  restored.rerender(tree({}, 'user-b'));
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  await screen.findByText('Start a conversation about this document.');
  restored.rerender(tree({ spaceId: 'other-space' }, 'user-b'));
  expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  expect(localStorage.getItem('agent-session')).toBeNull();
});
it('fences cancellation responses after navigating to another Space', async () => {
  turns = [{ ...turn, status: 'running', result: null }];
  let resolveCancel!: (value: any) => void;
  vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveCancel = resolve; }) as any);
  const rendered = render(tree()); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  expect(api.post).toHaveBeenCalledWith('/assist/tasks/turn-a/cancel');
  vi.mocked(api.get).mockResolvedValue({ data: [] }); rendered.rerender(tree({ spaceId: 'another' }));
  await act(async () => resolveCancel({ data: { ...turn, status: 'cancelled' } }));
  expect(screen.queryByText('Stopped')).not.toBeInTheDocument(); expect(screen.queryByText('Earlier question')).not.toBeInTheDocument();
});
it('polls real queued/running state and displays only returned progress and answers', async () => {
  turns = [{ ...turn, status: 'running', result: null, progressText: 'Actual answer progress' }];
  render(tree()); await screen.findByText('Actual answer progress');
  turns = [{ ...turn, result: { summary: 'Finished answer' } }];
  expect(await screen.findByText('Finished answer', {}, { timeout: 2000 })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
});
it('never applies a historical candidate to another page and regenerates with its original scope and annotations', async () => {
  const snapshot = { title: 'Page A', content: 'unsaved current draft', updatedAt: version, assistTarget: { kind: 'selection' as const, from: 0, to: 7, quote: 'unsaved', prefix: '', suffix: ' current draft', baseUpdatedAt: version } };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: snapshot, noteIds: ['n'], annotations: [{ id: 'n', body: 'Explain change', quote: 'unsaved' }], result: { changes: 'changed current draft' } }];
  const onApply = vi.fn(); const rendered = render(tree({ pageId: 'other-page', onApply, supportsScopedApply: true }));
  expect(await screen.findByRole('button', { name: 'Accept to draft' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Accept to draft' })); expect(onApply).not.toHaveBeenCalled();
  rendered.rerender(tree({ onApply, supportsScopedApply: true, snapshot: () => ({ ...snapshot, content: 'different draft', draftRevision: 7 }) }));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(screen.getByRole('combobox', { name: 'Edit scope' })).toHaveValue('selection'); expect(screen.getByText('Explain change', { selector: '.agent-session-composer p' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); expect(api.post).not.toHaveBeenCalled(); expect(screen.getAllByRole('alert').some((e) => e.textContent?.includes('Selection or version changed'))).toBe(true);
});
it('waits for the current local notes bridge before replaying a historical ready event', async () => {
  turns = [{ ...turn, mode: 'proposal', noteIds: ['note'], result: { changes: 'changed source' } }];
  const onNotesEvent = vi.fn(); const rendered = render(tree({ notesReady: false, onNotesEvent }));
  await screen.findByRole('region', { name: 'Candidate review' });
  expect(onNotesEvent).not.toHaveBeenCalled();
  rendered.rerender(tree({ notesReady: true, onNotesEvent }));
  await waitFor(() => expect(onNotesEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'ready', noteIds: ['note'] })));
});
it('allows stopping a later turn after an old cancellation completes while its Space is unmounted', async () => {
  turns = [{ ...turn, status: 'running', result: null }];
  let resolveCancel!: (value: any) => void;
  vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolveCancel = resolve; }) as any);
  const rendered = render(tree()); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
  const read = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockResolvedValue({ data: [] }); rendered.rerender(tree({ spaceId: 'other' }));
  await act(async () => resolveCancel({ data: { ...turn, status: 'cancelled' } }));
  turns = [{ ...turn, id: 'later-turn', status: 'running', result: null }]; vi.mocked(api.get).mockImplementation(read); rendered.rerender(tree());
  expect(await screen.findByRole('button', { name: 'Stop' })).toBeEnabled();
});
it('regenerates a conflicted whole-document proposal from the current source without inventing annotation attachments', async () => {
  const original = 'unsaved current draft';
  const target = { kind: 'document' as const, from: 0, to: original.length, quote: original, prefix: '', suffix: '', baseUpdatedAt: version };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: { title: 'Page A', content: original, updatedAt: version, assistTarget: target }, references: [], noteIds: [], annotations: [], result: { changes: 'Candidate content' } }];
  const manual = 'Manually changed current draft';
  render(tree({ supportsScopedApply: true, snapshot: () => ({ title: 'Page A', content: manual, updatedAt: version, draftRevision: 4, remoteRevision: 0 }) }));
  fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  expect(screen.queryByText('Annotations staged (not sent yet)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  const payload = vi.mocked(api.post).mock.calls[0][1] as any;
  expect(payload.mode).toBe('proposal'); expect(payload.snapshot.content).toBe(manual); expect(payload.snapshot.assistTarget).toMatchObject({ kind: 'document', quote: manual, to: manual.length }); expect(payload.annotations).toEqual([]);
});
it('keeps an unsent composer when route remount discovers its selected session was omitted from the accessible list', async () => {
  const shell = (show: boolean) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{show ? <AgentSessionPanel {...defaults} /> : null}</AgentSessionRegistryProvider></MemoryRouter>;
  const rendered = render(shell(true)); await screen.findByText('Earlier answer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Recover this unsent intent' } });
  rendered.rerender(shell(false));
  vi.mocked(api.get).mockImplementation(async (url) => { if (url === '/assist/sessions') return { data: [] }; throw { response: { status: 400, data: { message: 'Session source is no longer available' } } }; });
  rendered.rerender(shell(true));
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer accessible');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Recover this unsent intent'); expect(screen.queryByText('Earlier answer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New conversation' })).toBeEnabled();
});
it('preserves the no-replay acceptance ledger when another conversation loses source access', async () => {
  const original = 'Original source', originalSnapshot = { title: 'Original A', content: original, updatedAt: version, draftRevision: 0, remoteRevision: 0, assistTarget: { kind: 'document' as const, from: 0, to: original.length, quote: original, prefix: '', suffix: '', baseUpdatedAt: version } };
  turns = [{ ...turn, mode: 'proposal', pageSnapshot: originalSnapshot, result: { changes: 'Changed source' } }];
  const second = { ...summary, id: 'inaccessible', title: 'Lost source' };
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/assist/sessions') return { data: [summary, second] };
    if (url.endsWith('/inaccessible')) throw { response: { status: 400, data: { message: 'Session source is no longer available' } } };
    return { data: { ...summary, turns } };
  });
  let content = original;
  render(tree({ supportsScopedApply: true, snapshot: () => ({ ...originalSnapshot, content }), onApply: () => { content = 'Changed source'; return true; } }));
  fireEvent.click(await screen.findByRole('button', { name: 'Accept change 1' }));
  expect(screen.getByRole('button', { name: 'Accept change 1' })).toBeDisabled();
  content = original; // Editor Undo changes source; accepted history must never rewind.
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'inaccessible' } }); await screen.findByRole('alert');
  fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-a' } });
  expect(await screen.findByRole('button', { name: 'Accept change 1' })).toBeDisabled();
});

const scopedRoutes = ['remount', 'read/edit', 'page roundtrip', 'session switch'] as const;
it.each(['selection', 'section'] as const)('preserves regenerated %s context through every composer lifetime boundary', async (kind) => {
  for (const boundary of scopedRoutes) {
    cleanup(); vi.mocked(api.post).mockClear();
    const content = '# One\none\n# Two\ntwo\n', target = captureAssistTarget(content, kind, 6, 9, version)!;
    turns = [{ ...turn, mode: 'proposal', status: 'failed', result: null, pageSnapshot: { title: 'Page A', content, updatedAt: version, assistTarget: target } }];
    const second = { ...summary, id: 'session-b', title: 'Conversation B' };
    vi.mocked(api.get).mockImplementation(async (url) => ({ data: url === '/assist/sessions' ? [summary, second] : url.endsWith('session-b') ? { ...second, turns: [] } : { ...summary, turns } }));
    const shell = (route = 'edit') => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{route === 'hidden' ? null : <AgentSessionPanel key={route} {...defaults} pageId={route === 'other' ? 'page-b' : 'page-a'} canAccept={route !== 'read'} snapshot={() => ({ title: 'Page A', content, updatedAt: version })} supportsScopedApply />}</AgentSessionRegistryProvider></MemoryRouter>;
    const view = render(shell());
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
    if (boundary === 'session switch') {
      fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-b' } });
      await screen.findByText('Start a conversation about this document.');
      expect(screen.getByRole('combobox', { name: 'Edit scope' })).toHaveValue('document');
      fireEvent.change(screen.getByRole('combobox', { name: 'Conversation' }), { target: { value: 'session-a' } });
    } else {
      view.rerender(shell(boundary === 'remount' ? 'hidden' : boundary === 'read/edit' ? 'read' : 'other'));
      if (boundary !== 'remount') await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
      view.rerender(shell());
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    expect(screen.getByRole('combobox', { name: 'Edit scope' }), boundary).toHaveValue(kind);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((vi.mocked(api.post).mock.calls[0][1] as any).snapshot.assistTarget, boundary).toEqual(target);
  }
});
it.each(['selection', 'section'] as const)('refuses a stale restored %s until explicit reselection, without widening it', async (kind) => {
  const content = '# One\none\n# Two\ntwo\n', target = captureAssistTarget(content, kind, 6, 9, version)!;
  turns = [{ ...turn, mode: 'proposal', status: 'failed', result: null, pageSnapshot: { title: 'Page A', content, updatedAt: version, assistTarget: target } }];
  const changed = '# One\nnew\n# Two\ntwo\n', currentTarget = captureAssistTarget(changed, kind, 6, 9, version)!;
  const shell = (route: string) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}>{route === 'hidden' ? null : <AgentSessionPanel key={route} {...defaults} snapshot={() => ({ title: 'Page A', content: route === 'original' ? content : changed, updatedAt: version })} assistTargets={{ [kind]: currentTarget }} supportsScopedApply />}</AgentSessionRegistryProvider></MemoryRouter>;
  const view = render(shell('original')); fireEvent.click(await screen.findByRole('button', { name: 'Regenerate from current draft' }));
  view.rerender(shell('hidden')); view.rerender(shell('changed'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(api.post).not.toHaveBeenCalled(); expect(screen.getByText('Selection or version changed. Select the source and annotations again.')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Edit scope' })).toHaveValue(kind);
  fireEvent.click(screen.getByRole('button', { name: kind === 'selection' ? 'Use current selection' : 'Use current section' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect((vi.mocked(api.post).mock.calls[0][1] as any).snapshot.assistTarget).toEqual(currentTarget);
});
it('consumes a sent scope so a new follow-up on another page uses that current document', async () => {
  const target = captureAssistTarget('unsaved current draft', 'selection', 0, 7, version)!;
  const shell = (other = false) => <MemoryRouter><AgentSessionRegistryProvider userId={auth.id}><AgentSessionPanel key={String(other)} {...defaults} pageId={other ? 'page-b' : 'page-a'} assistRequest={other ? null : { id: 'scope-request', intent: 'Discuss this selection', assistTarget: target }} /></AgentSessionRegistryProvider></MemoryRouter>;
  vi.mocked(api.post).mockImplementation(async (_url, data: any) => ({ data: { ...turn, ...data, id: 'followup', pageSnapshot: data.snapshot, references: [], status: 'done' } }));
  const view = render(shell()); await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
  view.rerender(shell(true)); await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Explain this other page' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect((vi.mocked(api.post).mock.calls[1][1] as any).snapshot.assistTarget.kind).toBe('document');
});
