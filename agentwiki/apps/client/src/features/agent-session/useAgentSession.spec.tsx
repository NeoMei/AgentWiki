import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { AgentSessionRegistryProvider } from './AgentSessionRegistry';
import { useAgentSession } from './useAgentSession';
import type { AgentSessionDetail, AgentTurn } from './agentSessionTypes';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const timestamp = '2026-10-26T01:00:00.000Z';
const summary = { id: 'session-a', spaceId: 'space-a', title: 'Conversation A', createdAt: timestamp, updatedAt: timestamp };
const queued: AgentTurn = { id: 'turn-a', sessionId: summary.id, pageId: 'page-a', mode: 'auto', intent: 'Save this update', status: 'queued', createdAt: timestamp, pageSnapshot: { title: 'Page A', content: 'Before', updatedAt: timestamp }, references: [], noteIds: [], progressText: '', result: null, error: null };
const completed: AgentTurn = { ...queued, status: 'done', result: { action: 'update', summary: 'Saved update', changes: 'After', document: { operation: 'updated', pageId: 'page-a', title: 'Page A', updatedAt: '2026-10-26T01:01:00.000Z', url: '/pages/page-a' } } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function wrapper({ children }: { children: ReactNode }) {
  return <AgentSessionRegistryProvider userId="user-a">{children}</AgentSessionRegistryProvider>;
}
const mount = () => renderHook(({ spaceId }) => useAgentSession('user-a', spaceId), { wrapper, initialProps: { spaceId: 'space-a' } });
beforeEach(() => { localStorage.clear(); });

describe('session transport ordering', () => {
  it.each(['success', 'failure'] as const)('keeps the latest canonical history when a pre-receipt read finishes with %s', async (outcome) => {
    const oldRead = deferred<{ data: AgentSessionDetail }>();
    const send = deferred<{ data: AgentTurn }>();
    let reads = 0;
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === '/assist/sessions') return { data: (config?.params as { spaceId?: string } | undefined)?.spaceId === 'space-a' ? [summary] : [] };
      reads++;
      if (reads === 2) return oldRead.promise;
      return { data: { ...summary, turns: reads >= 3 ? [completed] : [] } };
    });
    vi.mocked(api.post).mockReturnValue(send.promise as never);
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let sending!: Promise<boolean>;
    act(() => { sending = result.current.send({ intent: queued.intent }, () => {}); });
    rerender({ spaceId: 'space-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ spaceId: 'space-a' });
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => { send.resolve({ data: queued }); await sending; });
    await waitFor(() => expect(result.current.detail?.turns[0]?.status).toBe('done'));

    await act(async () => {
      if (outcome === 'success') oldRead.resolve({ data: { ...summary, turns: [] } });
      else oldRead.reject({ response: { status: 403 } });
    });
    expect(result.current.detail?.turns[0]?.result?.summary).toBe('Saved update');
    expect(result.current.error).toBeNull();
  });

  it('recovers loading after navigation aborts the latest read while an older read is pending', async () => {
    const oldRead = deferred<{ data: AgentSessionDetail }>();
    const latestRead = deferred<{ data: AgentSessionDetail }>();
    const send = deferred<{ data: AgentTurn }>();
    let reads = 0, latestSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation(async (url, config) => {
      if (url === '/assist/sessions') return { data: (config?.params as { spaceId?: string } | undefined)?.spaceId === 'space-a' ? [summary] : [] };
      reads++;
      if (reads === 2) return oldRead.promise;
      if (reads === 3) { latestSignal = config?.signal as AbortSignal; return latestRead.promise; }
      return { data: { ...summary, turns: reads > 3 ? [completed] : [] } };
    });
    vi.mocked(api.post).mockReturnValue(send.promise as never);
    const { result, rerender } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let sending!: Promise<boolean>;
    act(() => { sending = result.current.send({ intent: queued.intent }, () => {}); });
    rerender({ spaceId: 'space-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ spaceId: 'space-a' });
    await waitFor(() => expect(reads).toBe(2));
    await act(async () => { send.resolve({ data: queued }); await sending; });
    await waitFor(() => expect(reads).toBe(3));
    rerender({ spaceId: 'space-b' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(latestSignal?.aborted).toBe(true);
    rerender({ spaceId: 'space-a' });
    await waitFor(() => expect(result.current.detail?.turns[0]?.status).toBe('done'));
    await act(async () => {
      oldRead.resolve({ data: { ...summary, turns: [] } });
      latestRead.reject(new Error('Aborted old transport'));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.loadingSessions).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.detail?.turns[0]?.result?.summary).toBe('Saved update');
  });

  it('does not let an in-flight poll resurrect a turn after cancellation succeeds', async () => {
    const poll = deferred<{ data: AgentSessionDetail }>();
    const cancel = deferred<{ data: AgentTurn }>();
    let reads = 0;
    const running: AgentTurn = { ...queued, status: 'running' };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/assist/sessions') return { data: [summary] };
      return ++reads === 1 ? { data: { ...summary, turns: [running] } } : poll.promise;
    });
    vi.mocked(api.post).mockReturnValue(cancel.promise as never);
    const { result } = mount();
    await waitFor(() => expect(result.current.running).toBe(true));
    await waitFor(() => expect(reads).toBe(2), { timeout: 1500 });
    await act(async () => {
      const cancelling = result.current.cancel(running);
      cancel.resolve({ data: { ...running, status: 'cancelled' } });
      poll.resolve({ data: { ...summary, turns: [running] } });
      await cancelling;
    });
    expect(result.current.detail?.turns[0]?.status).toBe('cancelled');
    expect(result.current.running).toBe(false);
  });

  it.each([401, 403, 400])('does not restore history from an old poll when cancellation reports access loss with %s', async (status) => {
    const poll = deferred<{ data: AgentSessionDetail }>();
    const cancel = deferred<{ data: AgentTurn }>();
    let reads = 0;
    const running: AgentTurn = { ...queued, status: 'running' };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/assist/sessions') return { data: [summary] };
      return ++reads === 1 ? { data: { ...summary, turns: [running] } } : poll.promise;
    });
    vi.mocked(api.post).mockReturnValue(cancel.promise as never);
    const { result } = mount();
    await waitFor(() => expect(result.current.running).toBe(true));
    await waitFor(() => expect(reads).toBe(2), { timeout: 1500 });
    await act(async () => {
      const cancelling = result.current.cancel(running);
      cancel.reject({ response: { status, data: { message: 'Session source is no longer available' } } });
      poll.resolve({ data: { ...summary, turns: [running] } });
      await cancelling;
    });
    expect(result.current.error).toBe('access');
    expect(result.current.detail).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('preserves another conversation\'s save receipt when one source becomes inaccessible', async () => {
    const other = { ...summary, id: 'session-b', title: 'Removed source' };
    let sent = false;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/assist/sessions') return { data: [summary, other] };
      if (url.endsWith(other.id)) throw { response: { status: 400, data: { message: 'Session source is no longer available' } } };
      return { data: { ...summary, turns: sent ? [completed] : [] } };
    });
    vi.mocked(api.post).mockImplementation(async () => { sent = true; return { data: queued }; });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.send({ intent: queued.intent }, (turn) => {
      result.current.store.writtenTurns.set(turn.id, { sessionId: turn.sessionId, scope: 'page-a', awaitingRead: true, snapshot: turn.pageSnapshot });
      result.current.store.receipts.set(turn.id, { sessionId: turn.sessionId, awaitingRead: true, credential: {
        userId: 'user-a', spaceId: 'space-a', pageId: 'page-a', request: { id: 'annotation-request', intent: queued.intent }, snapshot: queued.pageSnapshot!,
      } });
    }); });
    await act(async () => { await result.current.select(other.id); });
    expect(result.current.error).toBe('access');
    expect(result.current.detail).toBeNull();
    await act(async () => { await result.current.select(summary.id); });
    expect(result.current.detail?.turns[0]?.result?.document?.operation).toBe('updated');
    expect(result.current.store.writtenTurns.get(queued.id)).toMatchObject({ sessionId: summary.id, awaitingRead: false });
    expect(result.current.store.receipts.get(queued.id)).toMatchObject({ sessionId: summary.id, awaitingRead: false });
  });

  it.each([401, 403])('clears all local receipts when authentication or Space permission fails with %s', async (status) => {
    const other = { ...summary, id: 'session-b', title: 'Denied source' };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/assist/sessions') return { data: [summary, other] };
      if (url.endsWith(other.id)) throw { response: { status } };
      return { data: { ...summary, turns: [] } };
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.store.receipts.set('other-receipt', { sessionId: summary.id, awaitingRead: true, credential: {
      userId: 'user-a', spaceId: 'space-a', pageId: 'page-a', request: { id: 'permission-request', intent: 'Read' }, snapshot: queued.pageSnapshot!,
    } });
    await act(async () => { await result.current.select(other.id); });
    expect(result.current.error).toBe('access');
    expect(result.current.store.receipts.size).toBe(0);
  });

  it.each([
    ['Selected directory is no longer available in this Space', 'access'],
    ['Session directory documents are no longer available in the selected directory', 'access'],
    ['Selected directory ancestry cannot be verified', 'access'],
    ['Selected context is too large (100000 characters)', 'limits'],
  ])('handles the real directory response %s without retaining inaccessible history', async (message, reason) => {
    let reads = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/assist/sessions') return { data: [summary] };
      if (++reads > 1) throw { response: { status: 400, data: { message } } };
      return { data: { ...summary, turns: [{ ...queued, status: 'running' }] } };
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.running).toBe(true));
    act(() => result.current.updateDraft({ intent: 'Keep this unsent draft' }));
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 1500 });
    expect(result.current.error).toBe(reason);
    expect(result.current.detail === null).toBe(reason === 'access');
    expect(result.current.draft.intent).toBe('Keep this unsent draft');
  });
});
