import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import api from '../../api/client';
import { useAgentSessionRegistry } from './AgentSessionRegistry';
import type { AgentComposerMode, AgentReference, AgentSessionDetail, AgentSessionSummary, AgentTurn } from './agentSessionTypes';
import type { AssistNotesEvent, AssistRequest } from '../page/AgentAssistPanel';
import type { AssistTarget } from '../page/assistTargets';
import type { CandidateRecord } from './agentSessionCandidate';
export interface Composer { intent: string; mode: AgentComposerMode; targetKind: AssistTarget['kind']; references: AgentReference[]; staged?: { pageId: string; request: AssistRequest } }
const composer = (): Composer => ({ intent: '', mode: 'question', targetKind: 'document', references: [] });
interface State {
  sessions: AgentSessionSummary[]; openSessionIds: string[] | null; selected: string | null; detail: AgentSessionDetail | null;
  loading: boolean; loadingSessions: boolean; creating: boolean; sending: boolean; cancelling: boolean; error: string | null; draft: Composer; revision: number; sentRevision: number;
}
function createStore(userId: string, spaceId: string, contextKey: string) {
  // Persist tab layout only. Conversation content, credentials and composers stay in memory.
  const storageKey = `agentwiki:session-tabs:v1:${encodeURIComponent(userId)}:${encodeURIComponent(spaceId)}${contextKey ? `:${encodeURIComponent(contextKey)}` : ''}`;
  let restored: Pick<State, 'openSessionIds' | 'selected'> = { openSessionIds: null, selected: null };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && typeof value === 'object' && 'openSessionIds' in value && 'selected' in value) {
      const { openSessionIds, selected } = value;
      if (Array.isArray(openSessionIds) && openSessionIds.every((id) => typeof id === 'string' && id.length > 0)
        && new Set(openSessionIds).size === openSessionIds.length
        && (selected === null || typeof selected === 'string')
        && (openSessionIds.length ? typeof selected === 'string' && openSessionIds.includes(selected) : selected === null)) {
        restored = { openSessionIds, selected };
      }
    }
  } catch { /* Disabled or corrupt storage must not prevent in-memory conversations. */ }
  let state: State = { sessions: [], ...restored, detail: null, loading: true, loadingSessions: true, creating: false, sending: false, cancelling: false, error: null, draft: composer(), revision: 0, sentRevision: 0 };
  const listeners = new Set<() => void>();
  return {
    epoch: 0, cancelRequest: 0, candidates: new Map<string, CandidateRecord>(),
    receipts: new Map<string, { sessionId: string; awaitingRead: boolean; credential: NonNullable<AssistNotesEvent['dispatchRequest']> }>(),
    // Content may be purged after access loss; operation history must still prevent replay after Undo.
    ledger: new Map<string, Pick<CandidateRecord['candidate'], 'status' | 'acceptedEditIds'>>(), drafts: new Map<string, Composer>(),
    retry: null as { signature: string; id: string } | null,
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (patch: Partial<State>) => {
      state = { ...state, ...patch };
      if (state.openSessionIds !== null && ('openSessionIds' in patch || 'selected' in patch)) {
        try { localStorage.setItem(storageKey, JSON.stringify({ openSessionIds: state.openSessionIds, selected: state.selected })); } catch { /* Keep the registry usable when storage is unavailable. */ }
      }
      listeners.forEach((listener) => listener());
    },
  };
}
export type SessionStore = ReturnType<typeof createStore>;
export function sessionError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } })?.response;
  const status = response?.status;
  if (status === 400 && ['Session source is no longer available', 'Session page must exist in the selected Space'].includes(String(response?.data?.message))) return 'access';
  if (status === 401 || status === 403 || status === 404) return 'access';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 413) return 'limits';
  if (status === 429) return 'quota';
  return 'network';
}
/** REST is authoritative. Each mounted bridge and session switch fences outstanding responses. */
export function useAgentSession(userId: string, spaceId: string, contextKey = '') {
  const registry = useAgentSessionRegistry();
  const fallback = useRef(new Map<string, unknown>());
  const store = useMemo(() => {
    const spaces = registry?.userId === userId ? registry.spaces : fallback.current;
    const key = `${userId}\u0000${spaceId}${contextKey ? `\u0000${contextKey}` : ''}`;
    if (!spaces.has(key)) spaces.set(key, createStore(userId, spaceId, contextKey));
    return spaces.get(key) as SessionStore;
  }, [registry, userId, spaceId, contextKey]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const activeStore = useRef<SessionStore | null>(store); activeStore.current = store;
  const lifetime = useRef(0), controller = useRef<AbortController | null>(null);
  const valid = (epoch: number) => activeStore.current === store && store.epoch === epoch && lifetime.current === epoch;
  const read = async (id: string, epoch: number, signal?: AbortSignal) => {
    // Only receipts present when this authorized read STARTS may be verified by it. A queued
    // history read started before a late POST receipt cannot vouch for that receipt's current access.
    const receipts = [...store.receipts.entries()].filter(([, receipt]) => receipt.sessionId === id);
    const { data } = await api.get<AgentSessionDetail>(`/assist/sessions/${id}`, { signal });
    if (!valid(epoch) || signal?.aborted || store.get().selected !== id || data.spaceId !== spaceId || data.id !== id) return;
    for (const [taskId, receipt] of receipts) if (store.receipts.get(taskId) === receipt && data.turns.some((turn) => turn.id === taskId)) receipt.awaitingRead = false;
    const sessions = store.get().sessions;
    const summary: AgentSessionSummary = { id: data.id, spaceId: data.spaceId, title: data.title, createdAt: data.createdAt, updatedAt: data.updatedAt };
    store.set({ detail: data, loading: false, error: null, sessions: sessions.some((s) => s.id === id) ? sessions.map((s) => s.id === id ? summary : s) : [...sessions, summary] });
  };
  const fail = (error: unknown, epoch: number) => {
    if (!valid(epoch)) return;
    const reason = sessionError(error);
    if (reason === 'access') { store.candidates.clear(); store.receipts.clear(); store.set({ detail: null, sessions: store.get().sessions.filter((s) => s.id !== store.get().selected) }); }
    store.set({ loading: false, loadingSessions: false, error: reason });
  };
  useEffect(() => {
    const epoch = ++store.epoch; lifetime.current = epoch; activeStore.current = store;
    const abort = new AbortController(); controller.current = abort;
    if (!userId || !spaceId) { store.set({ loading: false, loadingSessions: false }); return; }
    store.cancelRequest++; store.set({ loading: true, loadingSessions: true, cancelling: false });
    void (async () => {
      try {
        const { data } = await api.get<AgentSessionSummary[]>('/assist/sessions', { params: { spaceId }, signal: abort.signal });
        if (!valid(epoch) || abort.signal.aborted) return;
        const sessions = data.filter((s) => s.spaceId === spaceId);
        const previous = store.get().selected;
        // The list can omit an inaccessible or older session. Keep its unsent draft and verify it directly.
        // null means first visit; [] means the user explicitly closed every tab.
        const openSessionIds = store.get().openSessionIds ?? (contextKey ? [] : sessions.slice(0, 3).map((session) => session.id));
        const selected = previous && openSessionIds.includes(previous) ? previous : openSessionIds[0] ?? null;
        store.set({ sessions, openSessionIds, selected, loadingSessions: false, ...(previous && !sessions.some((s) => s.id === previous) ? { detail: null } : {}), ...(previous !== selected ? { detail: null, draft: store.drafts.get(selected ?? '') ?? composer() } : {}) });
        if (selected) await read(selected, epoch, abort.signal); else store.set({ detail: null, loading: false, error: null });
      } catch (error) { if (!abort.signal.aborted) fail(error, epoch); }
    })();
    return () => { abort.abort(); if (controller.current === abort) controller.current = null; controller.current?.abort(); lifetime.current = -1; if (activeStore.current === store) activeStore.current = null; };
  }, [store, userId, spaceId]);
  // A completed send belongs to the registry, not its originating bridge. Re-read through the
  // CURRENT bridge's authorization/lifetime fence, including when the POST outlived a remount.
  useEffect(() => {
    if (!state.sentRevision || !state.selected) return;
    const abort = new AbortController(), epoch = store.epoch;
    void read(state.selected, epoch, abort.signal).catch((error) => { if (!abort.signal.aborted) fail(error, epoch); });
    return () => abort.abort();
  }, [store, state.sentRevision]);
  const running = state.detail?.turns.some((turn) => turn.status === 'queued' || turn.status === 'running') ?? false;
  useEffect(() => {
    if (!running || !state.selected) return;
    let disposed = false, delay = 800;
    const abort = new AbortController(), epoch = store.epoch, id = state.selected;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (disposed || !valid(epoch)) return;
      try { await read(id, epoch, abort.signal); delay = 800; }
      catch (error) { if (!disposed) { fail(error, epoch); delay = Math.min(delay * 2, 8000); } }
      if (!disposed && valid(epoch)) timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, delay);
    return () => { disposed = true; abort.abort(); clearTimeout(timer); };
  }, [running, state.selected, store, state.loading]);
  const updateDraft = (patch: Partial<Composer>) => {
    const draft = { ...store.get().draft, ...patch };
    store.drafts.set(store.get().selected ?? '', draft); store.set({ draft });
  };
  const select = async (selected: string) => {
    if (store.get().loadingSessions || store.get().creating) return;
    store.cancelRequest++;
    controller.current?.abort();
    const epoch = ++store.epoch; lifetime.current = epoch;
    const abort = new AbortController(); controller.current = abort;
    const openSessionIds = store.get().openSessionIds ?? [];
    store.set({ selected, openSessionIds: openSessionIds.includes(selected) ? openSessionIds : [...openSessionIds, selected], detail: null, draft: store.drafts.get(selected) ?? composer(), cancelling: false, loading: true, error: null });
    try { await read(selected, epoch, abort.signal); } catch (error) { if (!abort.signal.aborted) fail(error, epoch); }
  };
  const close = (id: string) => {
    const current = store.get(), index = current.openSessionIds?.indexOf(id) ?? -1;
    if (current.sending || current.loadingSessions || current.creating || index < 0) return false;
    const openSessionIds = current.openSessionIds!.filter((openId) => openId !== id);
    if (current.selected !== id) { store.set({ openSessionIds }); return true; }
    // Closing is a view operation: retain drafts, candidates, ledgers and server tasks.
    const selected = openSessionIds[index] ?? openSessionIds[index - 1] ?? null;
    store.set({ openSessionIds, selected });
    if (selected) void select(selected);
    else {
      controller.current?.abort(); lifetime.current = ++store.epoch; store.cancelRequest++;
      store.set({ detail: null, draft: store.drafts.get('') ?? composer(), cancelling: false, loading: false, error: null });
    }
    return true;
  };
  const create = async (preserveDraft = false) => {
    const epoch = store.epoch;
    const { data } = await api.post<AgentSessionSummary>('/assist/sessions', { spaceId });
    if (!valid(epoch) || data.spaceId !== spaceId) return null;
    controller.current?.abort(); lifetime.current = ++store.epoch; store.cancelRequest++;
    store.set({ sessions: [data, ...store.get().sessions.filter((session) => session.id !== data.id)], openSessionIds: [...(store.get().openSessionIds ?? []).filter((id) => id !== data.id), data.id], selected: data.id, detail: { ...data, turns: [] }, draft: preserveDraft ? store.get().draft : composer(), cancelling: false, loading: false, error: null });
    store.drafts.set(data.id, store.get().draft);
    // The first Send transfers the empty-state composer to the created session.
    // Keep it there on send failure, without replaying it after the tab is closed.
    if (preserveDraft) store.drafts.delete('');
    return data.id;
  };
  const newSession = async () => {
    if (store.get().sending || store.get().creating || store.get().loadingSessions) return;
    store.set({ loading: true, creating: true, error: null });
    const epoch = store.epoch;
    try { await create(); } catch (error) { fail(error, epoch); }
    finally { store.set({ creating: false }); }
  };
  const send = async (payload: Record<string, unknown>, onSent: (turn: AgentTurn) => void) => {
    if (store.get().sending || !userId || running) return false;
    const sentDraft = store.get().draft;
    store.set({ sending: true, error: null });
    let ownedEpoch = store.epoch;
    try {
      const id = store.get().selected ?? await create(true);
      if (!id) return false;
      const epoch = store.epoch; ownedEpoch = epoch;
      const signature = JSON.stringify({ id, payload });
      const clientRequestId = store.retry?.signature === signature ? store.retry.id : crypto.randomUUID();
      store.retry = { signature, id: clientRequestId };
      const { data } = await api.post<AgentTurn>(`/assist/sessions/${id}/turns`, { ...payload, clientRequestId });
      if (data.sessionId !== id) return false;
      store.retry = null;
      const detail = store.get().detail;
      // This callback records facts only in the originating user/Space store. No old page
      // callbacks may run here; a live matching bridge delivers receipts after a canonical read.
      onSent(data);
      const receipt = store.receipts.get(data.id);
      if (receipt) receipt.awaitingRead = !valid(epoch);
      const storedDraft = store.drafts.get(id) ?? (store.get().selected === id ? store.get().draft : undefined);
      const consumed = storedDraft ? { ...storedDraft,
        ...(storedDraft === sentDraft ? { intent: '' } : {}),
        ...(storedDraft.staged === sentDraft.staged ? { staged: undefined, ...(storedDraft.targetKind === sentDraft.targetKind ? { targetKind: 'document' as const } : {}) } : {}),
      } : undefined;
      if (consumed) store.drafts.set(id, consumed);
      store.set({
        ...(valid(epoch) && detail?.id === id ? { detail: { ...detail, turns: [...detail.turns.filter((t) => t.id !== data.id), data] } } : {}),
        ...(consumed && store.get().selected === id && store.get().draft === storedDraft ? { draft: consumed } : {}),
        sentRevision: store.get().sentRevision + (valid(epoch) ? 0 : 1),
      });
      return true;
    } catch (error) { if (valid(ownedEpoch)) fail(error, ownedEpoch); return false; }
    finally { store.set({ sending: false }); }
  };
  const cancel = async (turn: AgentTurn) => {
    if (store.get().cancelling || !running || turn.sessionId !== store.get().selected) return;
    const epoch = store.epoch, request = ++store.cancelRequest; store.set({ cancelling: true, error: null });
    try {
      const { data } = await api.post<AgentTurn>(`/assist/tasks/${turn.id}/cancel`);
      const detail = store.get().detail;
      if (valid(epoch) && detail?.id === turn.sessionId && data.id === turn.id && data.sessionId === turn.sessionId) store.set({ detail: { ...detail, turns: detail.turns.map((t) => t.id === turn.id ? data : t) } });
    } catch (error) { fail(error, epoch); }
    finally { if (store.cancelRequest === request) store.set({ cancelling: false }); }
  };
  return { ...state, store, running, updateDraft, select, close, newSession, send, cancel };
}
