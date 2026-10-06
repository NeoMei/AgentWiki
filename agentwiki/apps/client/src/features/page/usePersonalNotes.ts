import { useEffect, useRef, useState } from 'react';
import type { AssistRequest, AssistNotesEvent } from './AgentAssistPanel';
import { captureAssistTarget, resolveAssistTarget, validateAssistTarget, type AssistTarget, type CandidateEdit } from './assistTargets';
import { addPersonalNote, loadPersonalNotes, notesForDispatch, personalNotesKey, savePersonalNotes, transitionPersonalNotes, type PersonalNote, type PersonalNotesScope } from './reviewComments';
interface Props { scope: PersonalNotesScope | null; canEdit: boolean; enabled?: boolean; stageForSession?: boolean; source: string; updatedAt?: string; language?: string }
interface QueueState { loaded: boolean; notes: PersonalNote[]; assistRequest: AssistRequest | null; storageUnavailable: boolean; conflict: boolean }
const empty = (): QueueState => ({ loaded: false, notes: [], assistRequest: null, storageUnavailable: false, conflict: false });
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

/** Owns only personal notes and request/event linkage. Parent remains the sole Markdown writer. */
export function usePersonalNotes({ scope, canEdit, enabled = canEdit, stageForSession = false, source, updatedAt, language = 'en' }: Props) {
  const latestRef = useRef({ source, updatedAt, language }); latestRef.current = { source, updatedAt, language };
  const key = scope ? personalNotesKey(scope) : '';
  const identity = `${key}:${enabled}`;
  const identityRef = useRef(identity), generationRef = useRef(0);
  const stateRef = useRef<QueueState>(empty()), bindingsRef = useRef(new Map<string, TaskBinding>());
  const [, setState] = useState<QueueState>(empty());
  const mountedRef = useRef(true);
  if (identityRef.current !== identity) { identityRef.current = identity; generationRef.current++; stateRef.current = empty(); bindingsRef.current.clear(); }
  const generation = generationRef.current;
  const active = () => mountedRef.current && generationRef.current === generation && identityRef.current === identity && enabled && !!scope;
  const publish = (next: QueueState, persist = false) => {
    if (!active()) return;
    if (persist && scope) next = { ...next, storageUnavailable: savePersonalNotes(scope, next.notes).status !== 'saved' };
    stateRef.current = next; setState(next);
  };
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; generationRef.current++; bindingsRef.current.clear(); }; }, []);
  useEffect(() => {
    const next = empty();
    if (scope && enabled) {
      const loaded = loadPersonalNotes(scope);
      if (loaded.status === 'loaded') next.notes = loaded.notes;
      else next.storageUnavailable = true;
    }
    next.loaded = true; stateRef.current = next; setState(next);
  }, [identity]);
  const add = (target: AssistTarget, body: string): boolean => {
    if (!active() || !scope || target.baseUpdatedAt !== latestRef.current.updatedAt || resolveAssistTarget(latestRef.current.source, target).status !== 'found') return false;
    try { const note = addPersonalNote(scope, target, body); publish({ ...stateRef.current, notes: [...stateRef.current.notes, note] }, true); return true; } catch { return false; }
  };
  const dispatch = (ids: string[]): boolean => {
    const { source: liveSource, updatedAt: liveVersion, language: liveLanguage } = latestRef.current;
    if (!active() || !liveVersion || stateRef.current.assistRequest) return false;
    const selected = notesForDispatch(stateRef.current.notes, ids, liveSource);
    if (selected.status !== 'ready') { publish({ ...stateRef.current, conflict: true }); return false; }
    const located = selected.notes.map((note) => ({ note, position: resolveAssistTarget(liveSource, note.target) }));
    if (located.some(({ position }) => position.status !== 'found')) return false;
    const from = Math.min(...located.map(({ position }) => position.status === 'found' ? position.from : Infinity));
    const to = Math.max(...located.map(({ position }) => position.status === 'found' ? position.to : -Infinity));
    const target = captureAssistTarget(liveSource, 'selection', from, to, liveVersion);
    if (!target) return false;
    const instructions = liveLanguage === 'zh-CN' ? '按以下个人笔记修改引用原文，仅修改指定范围，保留其余 Markdown。每条笔记的原文和上下文用于精确定位：' : 'Address the personal notes below in their quoted passages. Edit only the specified scope and preserve all other Markdown. Use each quote and context to locate its passage:';
    const passages = located.map(({ note, position }) => ({ note: note.body, quote: note.target.quote, prefix: note.target.prefix, suffix: note.target.suffix, from: position.status === 'found' ? position.from : 0, to: position.status === 'found' ? position.to : 0 }));
    const legacyIntent = instructions + '\n' + JSON.stringify(passages);
    const annotations = selected.notes.map((note) => ({ id: note.id, body: note.body, quote: note.target.quote }));
    const intent = stageForSession ? (liveLanguage === 'zh-CN' ? '请讨论这些批注中的问题。' : 'Please discuss the questions in these annotations.') : legacyIntent;
    if (intent.length > 10_000 || (stageForSession && JSON.stringify(annotations).length > 10_000)) { publish({ ...stateRef.current, conflict: true }); return false; }
    const request: AssistRequest = { id: crypto.randomUUID(), intent, autoSubmit: !stageForSession, ...(stageForSession ? { annotations } : {}), assistTarget: target, noteIds: selected.notes.map((note) => note.id) };
    publish({ ...stateRef.current, assistRequest: request, conflict: false }); return true;
  };
  const onRequestHandled = (id: string) => { if (active() && stateRef.current.assistRequest?.id === id) publish({ ...stateRef.current, assistRequest: null }); };
  const reopen = (id: string) => {
    if (!active()) return;
    publish({ ...stateRef.current, notes: transitionPersonalNotes(stateRef.current.notes, [id], 'reopen'), assistRequest: null, conflict: false }, true);
  };
  const onNotesEvent = (event: AssistNotesEvent) => {
    if (!active() || !scope || event.candidate.userId !== scope.userId || event.candidate.spaceId !== scope.spaceId || event.candidate.pageId !== scope.pageId || event.taskId !== event.candidate.taskId) return;
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
        const eligibleIds = event.noteIds.filter((id) => stateRef.current.notes.some((note) => note.id === id && note.status !== 'resolved'));
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
    let ids = event.noteIds;
    if (event.event === 'accept') {
      const accepted = event.acceptedEditIds ?? event.candidate.acceptedEditIds ?? [];
      ids = ids.filter((id) => { const changes = binding.coverage.get(id); return !binding.uncertain.has(id) && !!changes?.length && changes.every((change) => accepted.includes(change)); });
    }
    const notes = transitionPersonalNotes(stateRef.current.notes, ids, event.event, event.taskId);
    publish({ ...stateRef.current, notes }, true);
  };
  const visible = identityRef.current === identity && enabled && scope ? stateRef.current : empty();
  // Refs let sequential callbacks observe synchronous queue changes; setState triggers UI updates.
  return { ...visible, add, dispatch, reopen, onNotesEvent, onRequestHandled, identityKey: key };
}
