import { useEffect, useRef, useState } from 'react';
import { pageNotesApi } from './pageNotesApi';
import type { AssistRequest, AssistNotesEvent } from './AgentAssistPanel';
import { captureAssistTarget, resolveAssistTarget, validateAssistTarget, type AssistTarget, type CandidateEdit } from './assistTargets';
import { addPersonalNote, loadPersonalNotes, notesForDispatch, personalNotesKey, savePersonalNotes, transitionPersonalNotes, type PersonalNote, type PersonalNotesScope } from './reviewComments';
interface Props { scope: PersonalNotesScope | null; canEdit: boolean; enabled?: boolean; stageForSession?: boolean; source: string; updatedAt?: string; language?: string }
interface QueueState { loaded: boolean; notes: PersonalNote[]; assistRequest: AssistRequest | null; storageUnavailable: boolean; conflict: boolean; syncing: boolean; canCreate: boolean }
const empty = (): QueueState => ({ loaded: false, notes: [], assistRequest: null, storageUnavailable: false, conflict: false, syncing: false, canCreate: false });
interface TaskBinding { noteIds: string[]; coverage: Map<string, string[]>; uncertain: Set<string> }
/** Evidence of source change, not the enclosing line-hunk extent. Ambiguous retained excerpts stay unresolved. */
const editPassageEvidence = (edit: CandidateEdit, passage: { from: number; to: number }): 'unchanged' | 'changed' | 'uncertain' => {
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(edit.before.length, edit.after.length) && edit.before[prefix] === edit.after[prefix]) prefix++;
  while (suffix < Math.min(edit.before.length, edit.after.length) - prefix && edit.before[edit.before.length - suffix - 1] === edit.after[edit.after.length - suffix - 1]) suffix++;
  const from = edit.from + prefix, to = edit.to - suffix;
  if (from === to) return edit.after.length > edit.before.length && from > passage.from && from < passage.to ? 'changed' : 'unchanged';
  const overlapFrom = Math.max(from, passage.from), overlapTo = Math.min(to, passage.to);
  if (overlapFrom >= overlapTo) return 'unchanged';
  const original = edit.before.slice(overlapFrom - edit.from, overlapTo - edit.from);
  // If the overlapping excerpt survives anywhere, correspondence is uncertain; do not claim the note solved.
  return !original || edit.after.includes(original) ? 'uncertain' : 'changed';
};

const accessDenied = (error: unknown) => [401, 403, 404].includes((error as { response?: { status?: number } } | null)?.response?.status ?? 0);
const sessionToken = () => { try { return localStorage.getItem('token'); } catch { return null; } };
interface PendingNoteWrites { userId: string; token: string | null; controller: AbortController; tail: Promise<void>; confirmed: Map<string, PersonalNote> }
// Only explicitly submitted status writes outlive their view. A new view reads after this receipt barrier.
const pendingNoteWrites = new Map<string, PendingNoteWrites>();
const cancelNoteWrites = (key: string, lane: PendingNoteWrites) => { lane.controller.abort(); if (pendingNoteWrites.get(key) === lane) pendingNoteWrites.delete(key); };


/** Owns server page notes and request/event linkage. Parent remains the sole Markdown writer. */
export function usePersonalNotes({ scope, canEdit, enabled = canEdit, stageForSession = false, source, updatedAt, language = 'en' }: Props) {
  const latestRef = useRef({ source, updatedAt, language }); latestRef.current = { source, updatedAt, language };
  const key = scope ? personalNotesKey(scope) : '';
  const identity = `${key}:${enabled}`;
  const identityRef = useRef(identity), generationRef = useRef(0);
  const stateRef = useRef<QueueState>(empty()), bindingsRef = useRef(new Map<string, TaskBinding>());
  const [, setState] = useState<QueueState>(empty());
  const mountedRef = useRef(true);
  const controllerRef = useRef(new AbortController());
  const accessDeniedRef = useRef(false);
  const confirmedRef = useRef(new Map<string, PersonalNote>());
  const pendingWritesRef = useRef(0);
  const mutationRef = useRef(0), readSequenceRef = useRef(0), requestEpochRef = useRef(0);
  const draftIdsRef = useRef(new Map<string, string>());
  if (identityRef.current !== identity) {
    controllerRef.current.abort(); controllerRef.current = new AbortController();
    identityRef.current = identity; generationRef.current++; requestEpochRef.current++; accessDeniedRef.current = false; stateRef.current = empty(); bindingsRef.current.clear();
    confirmedRef.current.clear(); draftIdsRef.current.clear(); pendingWritesRef.current = 0; mutationRef.current++;
  }
  for (const [writeKey, lane] of pendingNoteWrites) {
    if (scope && lane.userId !== scope.userId || lane.token !== sessionToken() || scope && !enabled && writeKey === key) cancelNoteWrites(writeKey, lane);
  }
  const generation = generationRef.current, actionEpoch = requestEpochRef.current;
  const active = () => mountedRef.current && generationRef.current === generation && identityRef.current === identity && enabled && !!scope;
  const actionActive = () => active() && requestEpochRef.current === actionEpoch;
  const commit = (next: QueueState) => { if (active()) { stateRef.current = next; setState(next); } };
  const denyAccess = () => {
    if (!active()) return;
    // Fence every in-flight receipt and queued write. A later fresh read may restore access.
    accessDeniedRef.current = true; requestEpochRef.current++; controllerRef.current.abort(); controllerRef.current = new AbortController();
    bindingsRef.current.clear(); confirmedRef.current.clear();
    const lane = pendingNoteWrites.get(key); if (lane) cancelNoteWrites(key, lane);
    pendingWritesRef.current = 0; mutationRef.current++; readSequenceRef.current++;
    commit({ ...empty(), loaded: true, storageUnavailable: true });
  };
  const publish = (next: QueueState, persist = false) => {
    if (!actionActive()) return;
    if (!persist || !scope) { commit(next); return; }
    // Only the authenticated author may change shared state. Other authors remain usable as Agent context.
    const changes = next.notes.filter((note) => note.canEdit && note.updatedAt && stateRef.current.notes.find((old) => old.id === note.id) !== note);
    const changedIds = new Set(changes.map((note) => note.id));
    next = { ...next, notes: next.notes.map((note) => changedIds.has(note.id) ? note : stateRef.current.notes.find((old) => old.id === note.id) ?? note) };
    if (!changes.length) { commit(next); return; }
    mutationRef.current++; pendingWritesRef.current++;
    commit({ ...next, syncing: true });
    const epoch = requestEpochRef.current, current = () => active() && requestEpochRef.current === epoch;
    let lane = pendingNoteWrites.get(key);
    if (!lane) {
      lane = { userId: scope.userId, token: sessionToken(), controller: new AbortController(), tail: Promise.resolve(), confirmed: new Map(confirmedRef.current) };
      pendingNoteWrites.set(key, lane);
    } else {
      // A create may finish while this lane is busy. Admit its server receipt without
      // overwriting the concurrency tokens already advanced by queued status writes.
      for (const [id, note] of confirmedRef.current) if (!lane.confirmed.has(id)) lane.confirmed.set(id, note);
    }
    const writeLane = lane;
    const canPersist = () => {
      if (writeLane.token !== sessionToken()) cancelNoteWrites(key, writeLane);
      if (writeLane.controller.signal.aborted && current()) denyAccess();
      return !writeLane.controller.signal.aborted;
    };
    const queued = writeLane.tail.then(async () => {
      if (!canPersist()) return;
      try {
        for (const desired of changes) {
          if (!canPersist()) return;
          const previous = writeLane.confirmed.get(desired.id);
          if (!previous?.updatedAt || !previous.canEdit) continue;
          const saved = await pageNotesApi.update(scope, desired.id, { expectedUpdatedAt: previous.updatedAt, status: desired.status, taskId: desired.taskId ?? null }, writeLane.controller.signal);
          if (!canPersist()) return;
          writeLane.confirmed.set(saved.id, saved);
          if (!current()) continue;
          confirmedRef.current.set(saved.id, saved);
          // Preserve a newer queued transition while advancing its concurrency token.
          commit({ ...stateRef.current, notes: stateRef.current.notes.map((note) => note.id !== saved.id ? note : note.status === desired.status && note.taskId === desired.taskId ? saved : { ...note, updatedAt: saved.updatedAt }), storageUnavailable: false });
        }
      } catch (error) {
        if (!canPersist()) return;
        if (accessDenied(error)) { cancelNoteWrites(key, writeLane); if (current()) denyAccess(); return; }
        if (current()) commit({ ...stateRef.current, storageUnavailable: true, notes: stateRef.current.notes.map((note) => changedIds.has(note.id) ? confirmedRef.current.get(note.id) ?? note : note) });
      } finally { if (current()) { pendingWritesRef.current--; commit({ ...stateRef.current, syncing: pendingWritesRef.current > 0 }); } }
    });
    writeLane.tail = queued;
    void queued.finally(() => { if (pendingNoteWrites.get(key) === writeLane && writeLane.tail === queued) pendingNoteWrites.delete(key); });
  };
  const refresh = async (migrate = false) => {
    if (!active() || !scope || pendingWritesRef.current) return;
    const mutation = mutationRef.current, readSequence = ++readSequenceRef.current, epoch = requestEpochRef.current;
    const current = () => active() && requestEpochRef.current === epoch;
    try {
      for (let lane = pendingNoteWrites.get(key); lane; lane = pendingNoteWrites.get(key)) {
        await lane.tail;
        if (!current()) return;
      }
      const remote = await pageNotesApi.list(scope, controllerRef.current.signal);
      if (!current() || readSequence !== readSequenceRef.current || mutation !== mutationRef.current || pendingWritesRef.current) return;
      accessDeniedRef.current = false;
      remote.notes.forEach((note) => confirmedRef.current.set(note.id, note));
      const legacy = loadPersonalNotes(scope);
      let local = legacy.status === 'loaded' ? legacy.notes : [];
      commit({ ...stateRef.current, ...remote, loaded: true, storageUnavailable: legacy.status !== 'loaded', notes: [...remote.notes, ...local.filter((note) => !remote.notes.some((saved) => saved.author?.type === 'user' && saved.author.id === scope.userId && saved.clientNoteId === note.id)).map((note) => ({ ...note, syncState: 'unsynced' as const }))] });
      if (!migrate || !local.length || !remote.canCreate) return;
      pendingWritesRef.current++; mutationRef.current++; commit({ ...stateRef.current, syncing: true });
      let failed = false;
      try {
        for (const note of [...local]) {
          if (!current()) return;
          try {
            const saved = await pageNotesApi.create(scope, { clientNoteId: note.id, body: note.body, target: note.target, status: note.status, ...(note.taskId ? { taskId: note.taskId } : {}) }, controllerRef.current.signal);
            if (!current()) return;
            confirmedRef.current.set(saved.id, saved);
            local = local.filter((item) => item.id !== note.id);
            // The server receipt is the only authority for removing the legacy entry.
            if (savePersonalNotes(scope, local).status !== 'saved') failed = true;
            commit({ ...stateRef.current, notes: [...stateRef.current.notes.filter((item) => item.id !== note.id && item.id !== saved.id), saved] });
          } catch (error) { if (current() && accessDenied(error)) { denyAccess(); return; } failed = true; }
        }
      } finally { if (current()) { pendingWritesRef.current--; commit({ ...stateRef.current, syncing: pendingWritesRef.current > 0, storageUnavailable: failed || local.length > 0 }); } }
    } catch (error) {
      if (!current() || readSequence !== readSequenceRef.current) return;
      if (accessDenied(error)) { denyAccess(); return; }
      if (mutation !== mutationRef.current) return;
      const legacy = loadPersonalNotes(scope);
      commit({ ...stateRef.current, loaded: true, storageUnavailable: true, notes: stateRef.current.notes.length ? stateRef.current.notes : !accessDeniedRef.current && legacy.status === 'loaded' ? legacy.notes.map((note) => ({ ...note, syncState: 'unsynced' as const })) : [] });
    }
  };
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; controllerRef.current.abort(); bindingsRef.current.clear(); }; }, []);
  useEffect(() => {
    if (controllerRef.current.signal.aborted) controllerRef.current = new AbortController();
    if (!scope || !enabled) { stateRef.current = { ...empty(), loaded: true }; setState(stateRef.current); return; }
    void refresh(true);
    const onFocus = () => { void refresh(true); };
    const interval = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(true); }, 30_000);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(interval); window.removeEventListener('focus', onFocus); };
  }, [identity]);
  const add = async (target: AssistTarget, body: string, _options?: { requirePersistence?: boolean }): Promise<boolean> => {
    if (!actionActive() || !scope || !stateRef.current.canCreate || target.baseUpdatedAt !== latestRef.current.updatedAt || resolveAssistTarget(latestRef.current.source, target).status !== 'found') return false;
    const epoch = requestEpochRef.current, current = () => active() && requestEpochRef.current === epoch;
    let counted = false;
    try {
      const fingerprint = JSON.stringify([target, body.trim()]);
      const id = draftIdsRef.current.get(fingerprint) ?? crypto.randomUUID(); draftIdsRef.current.set(fingerprint, id);
      const note = addPersonalNote(scope, target, body, id);
      pendingWritesRef.current++; counted = true; mutationRef.current++; commit({ ...stateRef.current, syncing: true });
      const saved = await pageNotesApi.create(scope, { clientNoteId: id, body: note.body, target: note.target }, controllerRef.current.signal);
      if (!current()) return false;
      confirmedRef.current.set(saved.id, saved); draftIdsRef.current.delete(fingerprint);
      commit({ ...stateRef.current, notes: [...stateRef.current.notes.filter((item) => item.id !== saved.id), saved], storageUnavailable: false });
      return true;
    } catch (error) { if (current()) { if (accessDenied(error)) denyAccess(); else commit({ ...stateRef.current, storageUnavailable: true }); } return false; }
    finally { if (current() && counted) { pendingWritesRef.current = Math.max(0, pendingWritesRef.current - 1); commit({ ...stateRef.current, syncing: pendingWritesRef.current > 0 }); } }
  };
  const dispatch = (ids: string[]): boolean => {
    const { source: liveSource, updatedAt: liveVersion, language: liveLanguage } = latestRef.current;
    if (!actionActive() || !liveVersion || stateRef.current.assistRequest) return false;
    const selected = notesForDispatch(stateRef.current.notes, ids, liveSource);
    if (selected.status !== 'ready') { publish({ ...stateRef.current, conflict: true }); return false; }
    const located = selected.notes.map((note) => ({ note, position: resolveAssistTarget(liveSource, note.target) }));
    if (located.some(({ position }) => position.status !== 'found')) return false;
    const from = Math.min(...located.map(({ position }) => position.status === 'found' ? position.from : Infinity));
    const to = Math.max(...located.map(({ position }) => position.status === 'found' ? position.to : -Infinity));
    const target = captureAssistTarget(liveSource, 'selection', from, to, liveVersion);
    if (!target) return false;
    const instructions = liveLanguage === 'zh-CN' ? '按以下页面笔记修改引用原文，仅修改指定范围，保留其余 Markdown。每条笔记的原文和上下文用于精确定位：' : 'Address the page notes below in their quoted passages. Edit only the specified scope and preserve all other Markdown. Use each quote and context to locate its passage:';
    const passages = located.map(({ note, position }) => ({ note: note.body, quote: note.target.quote, prefix: note.target.prefix, suffix: note.target.suffix, from: position.status === 'found' ? position.from : 0, to: position.status === 'found' ? position.to : 0 }));
    const legacyIntent = instructions + '\n' + JSON.stringify(passages);
    const annotations = selected.notes.map((note) => ({ id: note.id, body: note.body, quote: note.target.quote }));
    const intent = stageForSession ? (liveLanguage === 'zh-CN' ? '请讨论这些批注中的问题。' : 'Please discuss the questions in these annotations.') : legacyIntent;
    if (intent.length > 10_000 || (stageForSession && JSON.stringify(annotations).length > 10_000)) { publish({ ...stateRef.current, conflict: true }); return false; }
    const request: AssistRequest = { id: crypto.randomUUID(), intent, autoSubmit: !stageForSession, ...(stageForSession ? { annotations } : {}), assistTarget: target, noteIds: selected.notes.map((note) => note.id) };
    publish({ ...stateRef.current, assistRequest: request, conflict: false }); return true;
  };
  const onRequestHandled = (id: string) => { if (actionActive() && stateRef.current.assistRequest?.id === id) publish({ ...stateRef.current, assistRequest: null }); };
  const reopen = (id: string) => {
    if (!actionActive() || !stateRef.current.notes.some((note) => note.id === id && note.canEdit)) return;
    publish({ ...stateRef.current, notes: transitionPersonalNotes(stateRef.current.notes, [id], 'reopen'), assistRequest: null, conflict: false }, true);
  };
  const onNotesEvent = (input: AssistNotesEvent) => {
    const aliases = new Map(stateRef.current.notes.filter((note) => note.author?.type === 'user' && note.author.id === scope?.userId && note.clientNoteId).map((note) => [note.clientNoteId!, note.id]));
    const ids = (values: string[]) => values.map((id) => aliases.get(id) ?? id);
    const annotations = (values: AssistRequest['annotations']) => values?.map((note) => ({ ...note, id: aliases.get(note.id) ?? note.id }));
    const request = (value: AssistRequest): AssistRequest => ({ ...value, noteIds: value.noteIds && ids(value.noteIds), annotations: annotations(value.annotations), ...(value.supersedes ? { supersedes: { ...value.supersedes, noteIds: ids(value.supersedes.noteIds), annotations: annotations(value.supersedes.annotations)! } } : {}) });
    const event: AssistNotesEvent = { ...input, noteIds: ids(input.noteIds), candidate: { ...input.candidate, noteIds: input.candidate.noteIds && ids(input.candidate.noteIds) }, annotations: annotations(input.annotations), ...(input.dispatchRequest ? { dispatchRequest: { ...input.dispatchRequest, request: request(input.dispatchRequest.request) } } : {}) };
    if (!actionActive() || !scope || event.candidate.userId !== scope.userId || event.candidate.spaceId !== scope.spaceId || event.candidate.pageId !== scope.pageId || event.taskId !== event.candidate.taskId) return;
    const matchesAnnotations = (annotations: AssistRequest['annotations'], content: string, version?: string) => annotations?.length === event.noteIds.length && event.noteIds.every((id) => {
      const note = stateRef.current.notes.find((item) => item.id === id), annotation = annotations.find((item) => item.id === id);
      return !!note && !!annotation && note.body === annotation.body && note.target.quote === annotation.quote
        && note.target.baseUpdatedAt === version && resolveAssistTarget(content, note.target).status === 'found';
    });
    // Session events carry the whole canonical context, including immutable resolved annotations.
    // Validate it before choosing which notes may transition or recovering a route's coverage map.
    if (stageForSession && (event.candidate.noteIds?.length !== event.noteIds.length || new Set(event.noteIds).size !== event.noteIds.length
      || event.noteIds.some((id) => !event.candidate.noteIds?.includes(id)) || event.candidate.baseUpdatedAt !== latestRef.current.updatedAt
      || !matchesAnnotations(event.annotations, event.candidate.baseContent, event.candidate.baseUpdatedAt))) return;
    if (event.event === 'dispatch') {
      const localRequest = stateRef.current.assistRequest, credential = event.dispatchRequest;
      // A registry-held request survives route mounts. Only a successful explicit Send supplies this
      // credential; compare returned source to that send-time snapshot, not a draft still being edited.
      if (credential && (credential.userId !== scope.userId || credential.spaceId !== scope.spaceId || credential.pageId !== scope.pageId
        || !stageForSession && localRequest && localRequest.id !== credential.request.id)) return;
      // The live composer may already hold the NEXT request after a remount. The registry's
      // immutable successful-send receipt owns the dispatched IDs, annotations and source proof.
      const request = stageForSession ? credential?.request : localRequest;
      const supersedes = stageForSession ? credential?.request.supersedes : undefined;
      if (stateRef.current.notes.some((note) => event.noteIds.includes(note.id) && note.status !== 'pending'
        && (!supersedes || note.status !== 'resolved' && note.taskId !== supersedes.taskId))) return;
      if (stageForSession) {
        if (!credential || !request?.id || event.candidate.baseContent !== credential.snapshot.content
          || event.candidate.baseTitle !== credential.snapshot.title || event.candidate.baseUpdatedAt !== credential.snapshot.updatedAt
          || !request.assistTarget || request.assistTarget.baseUpdatedAt !== latestRef.current.updatedAt
          || !validateAssistTarget(event.candidate.baseContent, request.assistTarget)
          || !matchesAnnotations(request.annotations, event.candidate.baseContent, event.candidate.baseUpdatedAt)) return;
      }
      if (!request || !event.noteIds.length || request.noteIds?.length !== event.noteIds.length || event.noteIds.some((id) => !request.noteIds?.includes(id)) || event.candidate.baseUpdatedAt !== latestRef.current.updatedAt) return;
      if (supersedes) {
        if (supersedes.taskId === event.taskId || supersedes.snapshot.updatedAt !== event.candidate.baseUpdatedAt
          || supersedes.snapshot.title !== event.candidate.baseTitle || supersedes.noteIds.length !== event.noteIds.length
          || new Set(supersedes.noteIds).size !== event.noteIds.length || event.noteIds.some((id) => !supersedes.noteIds.includes(id))
          || !matchesAnnotations(supersedes.annotations, supersedes.snapshot.content, supersedes.snapshot.updatedAt)) return;
        // Reopen only unresolved notes after successful explicit regeneration. Resolved context
        // keeps its historical task; old callbacks stay fenced by each transferred note's new task.
        const eligibleIds = event.noteIds.filter((id) => stateRef.current.notes.some((note) => note.id === id && note.canEdit && note.status !== 'resolved'));
        if (!eligibleIds.length) return;
        stateRef.current = { ...stateRef.current, notes: transitionPersonalNotes(stateRef.current.notes, eligibleIds, 'reopen', supersedes.taskId) };
      }
      bindingsRef.current.set(event.taskId, { noteIds: [...event.noteIds], coverage: new Map(), uncertain: new Set() });
    }
    // Recover the full event set, but require current-task linkage for every unresolved note.
    // Session resolved context was checked above and may still belong to an earlier generation.
    if (event.event !== 'dispatch' && !bindingsRef.current.has(event.taskId) && event.noteIds.length
      && event.noteIds.some((id) => stateRef.current.notes.some((note) => note.id === id && note.taskId === event.taskId))
      && event.noteIds.every((id) => stateRef.current.notes.some((note) => note.id === id && (note.taskId === event.taskId || stageForSession && note.status === 'resolved')))) {
      bindingsRef.current.set(event.taskId, { noteIds: [...event.noteIds], coverage: new Map(), uncertain: new Set() });
    }
    const binding = bindingsRef.current.get(event.taskId);
    if (!binding || event.noteIds.some((id) => !binding.noteIds.includes(id))) return;
    if ((event.event === 'ready' || event.event === 'accept') && event.candidate.editPlan) {
      for (const note of stateRef.current.notes.filter((n) => binding.noteIds.includes(n.id) && n.taskId === event.taskId)) {
        const position = resolveAssistTarget(event.candidate.baseContent, note.target);
        if (position.status !== 'found') continue;
        const evidence = event.candidate.editPlan.edits.map((edit) => ({ id: edit.id, evidence: editPassageEvidence(edit, position) }));
        const covered = evidence.filter((edit) => edit.evidence !== 'unchanged').map((edit) => edit.id);
        if (covered.length) binding.coverage.set(note.id, covered);
        if (evidence.some((edit) => edit.evidence === 'uncertain')) binding.uncertain.add(note.id);
      }
    }
    let eligibleIds = event.noteIds;
    if (event.event === 'accept') {
      const accepted = event.acceptedEditIds ?? event.candidate.acceptedEditIds ?? [];
      eligibleIds = eligibleIds.filter((id) => { const changes = binding.coverage.get(id); return !binding.uncertain.has(id) && !!changes?.length && changes.every((change) => accepted.includes(change)); });
    }
    const notes = transitionPersonalNotes(stateRef.current.notes, eligibleIds, event.event, event.taskId);
    publish({ ...stateRef.current, notes }, true);
  };
  const visible = identityRef.current === identity && enabled && scope ? stateRef.current : empty();
  // Refs let sequential callbacks observe synchronous queue changes; setState triggers UI updates.
  return { ...visible, add, dispatch, reopen, onNotesEvent, onRequestHandled, retrySync: () => refresh(true), identityKey: key };
}
