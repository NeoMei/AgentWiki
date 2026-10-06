import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import api from '../../api/client';
import { useAgentSessionRegistry } from './AgentSessionRegistry';
import type { AgentReference, AgentSessionDetail, AgentSessionSummary, AgentTurn, AgentTurnMode } from './agentSessionTypes';
import type { AssistRequest } from '../page/AgentAssistPanel';
import type { AssistTarget } from '../page/assistTargets';
import type { CandidateRecord } from './agentSessionCandidate';
export interface Composer { intent: string; mode: AgentTurnMode; targetKind: AssistTarget['kind']; references: AgentReference[]; staged?: { pageId: string; request: AssistRequest } }
const composer = (): Composer => ({ intent: '', mode: 'question', targetKind: 'document', references: [] });
interface State {
  sessions: AgentSessionSummary[]; selected: string | null; detail: AgentSessionDetail | null;
  loading: boolean; sending: boolean; cancelling: boolean; error: string | null; draft: Composer; revision: number;
}
function createStore() {
  let state: State = { sessions: [], selected: null, detail: null, loading: true, sending: false, cancelling: false, error: null, draft: composer(), revision: 0 };
  const listeners = new Set<() => void>();
  return {
    epoch: 0, cancelRequest: 0, candidates: new Map<string, CandidateRecord>(),
    // Content may be purged after access loss; operation history must still prevent replay after Undo.
    ledger: new Map<string, Pick<CandidateRecord['candidate'], 'status' | 'acceptedEditIds'>>(), drafts: new Map<string, Composer>(),
    retry: null as { signature: string; id: string } | null,
    get: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); },
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
export function useAgentSession(userId: string, spaceId: string) {
  const registry = useAgentSessionRegistry();
  const fallback = useRef(new Map<string, unknown>());
  const store = useMemo(() => {
    const spaces = registry?.userId === userId ? registry.spaces : fallback.current;
    const key = `${userId}\u0000${spaceId}`;
    if (!spaces.has(key)) spaces.set(key, createStore());
    return spaces.get(key) as SessionStore;
  }, [registry, userId, spaceId]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const activeStore = useRef<SessionStore | null>(store); activeStore.current = store;
  const lifetime = useRef(0), controller = useRef<AbortController | null>(null);
  const valid = (epoch: number) => activeStore.current === store && store.epoch === epoch && lifetime.current === epoch;
  const read = async (id: string, epoch: number, signal?: AbortSignal) => {
    const { data } = await api.get<AgentSessionDetail>(`/assist/sessions/${id}`, { signal });
    if (!valid(epoch) || signal?.aborted || store.get().selected !== id || data.spaceId !== spaceId || data.id !== id) return;
    store.set({ detail: data, loading: false, error: null, sessions: store.get().sessions.map((s) => s.id === id ? { ...s, title: data.title, updatedAt: data.updatedAt } : s) });
  };
  const fail = (error: unknown, epoch: number) => {
    if (!valid(epoch)) return;
    const reason = sessionError(error);
    if (reason === 'access') { store.candidates.clear(); store.set({ detail: null, sessions: store.get().sessions.filter((s) => s.id !== store.get().selected) }); }
    store.set({ loading: false, error: reason });
  };
  useEffect(() => {
    const epoch = ++store.epoch; lifetime.current = epoch; activeStore.current = store;
    const abort = new AbortController(); controller.current = abort;
    if (!userId || !spaceId) { store.set({ loading: false }); return; }
    store.cancelRequest++; store.set({ loading: true, cancelling: false });
    void (async () => {
      try {
        const { data } = await api.get<AgentSessionSummary[]>('/assist/sessions', { params: { spaceId }, signal: abort.signal });
        if (!valid(epoch) || abort.signal.aborted) return;
        const sessions = data.filter((s) => s.spaceId === spaceId);
        const previous = store.get().selected;
        // The list can omit an inaccessible or older session. Keep its unsent draft and verify it directly.
        const selected = previous ?? sessions[0]?.id ?? null;
        store.set({ sessions, selected, ...(previous && !sessions.some((s) => s.id === previous) ? { detail: null } : {}), ...(previous !== selected ? { detail: null, draft: store.drafts.get(selected ?? '') ?? composer() } : {}) });
        if (selected) await read(selected, epoch, abort.signal); else store.set({ detail: null, loading: false, error: null });
      } catch (error) { if (!abort.signal.aborted) fail(error, epoch); }
    })();
    return () => { abort.abort(); if (controller.current === abort) controller.current = null; controller.current?.abort(); lifetime.current = -1; if (activeStore.current === store) activeStore.current = null; };
  }, [store, userId, spaceId]);
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
    store.cancelRequest++;
    controller.current?.abort();
    const epoch = ++store.epoch; lifetime.current = epoch;
    const abort = new AbortController(); controller.current = abort;
    store.set({ selected, detail: null, draft: store.drafts.get(selected) ?? composer(), cancelling: false, loading: true, error: null });
    try { await read(selected, epoch, abort.signal); } catch (error) { if (!abort.signal.aborted) fail(error, epoch); }
  };
  const create = async (preserveDraft = false) => {
    const epoch = store.epoch;
    const { data } = await api.post<AgentSessionSummary>('/assist/sessions', { spaceId });
    if (!valid(epoch) || data.spaceId !== spaceId) return null;
    controller.current?.abort(); lifetime.current = ++store.epoch; store.cancelRequest++;
    store.set({ sessions: [data, ...store.get().sessions], selected: data.id, detail: { ...data, turns: [] }, draft: preserveDraft ? store.get().draft : composer(), cancelling: false, loading: false, error: null });
    store.drafts.set(data.id, store.get().draft);
    return data.id;
  };
  const newSession = async () => {
    if (store.get().sending) return;
    store.set({ loading: true, error: null });
    const epoch = store.epoch;
    try { await create(); } catch (error) { fail(error, epoch); }
  };
  const send = async (payload: Record<string, unknown>, onSent: (turn: AgentTurn) => void) => {
    if (store.get().sending || !userId || running) return false;
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
      if (!valid(epoch) || store.get().selected !== id || data.sessionId !== id) return false;
      store.retry = null;
      const detail = store.get().detail;
      if (detail?.id === id) store.set({ detail: { ...detail, turns: [...detail.turns.filter((t) => t.id !== data.id), data] } });
      onSent(data); updateDraft({ intent: '', staged: undefined, targetKind: 'document' });
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
  return { ...state, store, running, updateDraft, select, newSession, send, cancel };
}
