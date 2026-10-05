import { useEffect, useRef, useState } from 'react';
import type { AssistRequest, AssistNotesEvent } from './AgentAssistPanel';
import { captureAssistTarget, resolveAssistTarget, type AssistTarget, type CandidateEdit } from './assistTargets';
import { addPersonalNote, loadPersonalNotes, notesForDispatch, personalNotesKey, savePersonalNotes, transitionPersonalNotes, type PersonalNote, type PersonalNotesScope } from './reviewComments';
interface Props { scope: PersonalNotesScope | null; canEdit: boolean; source: string; updatedAt?: string; language?: string }
interface QueueState { notes: PersonalNote[]; assistRequest: AssistRequest | null; storageUnavailable: boolean; conflict: boolean }
const empty = (): QueueState => ({ notes: [], assistRequest: null, storageUnavailable: false, conflict: false });
interface TaskBinding { noteIds: string[]; coverage: Map<string, string[]> }
/** Evidence of source change, not the enclosing line-hunk extent. Ambiguous retained excerpts stay unresolved. */
const editChangesPassage = (edit: CandidateEdit, passage: { from: number; to: number }) => {
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(edit.before.length, edit.after.length) && edit.before[prefix] === edit.after[prefix]) prefix++;
  while (suffix < Math.min(edit.before.length, edit.after.length) - prefix && edit.before[edit.before.length - suffix - 1] === edit.after[edit.after.length - suffix - 1]) suffix++;
  const from = edit.from + prefix, to = edit.to - suffix;
  if (from === to) return edit.after.length > edit.before.length && from > passage.from && from < passage.to;
  const overlapFrom = Math.max(from, passage.from), overlapTo = Math.min(to, passage.to);
  if (overlapFrom >= overlapTo) return false;
  const original = edit.before.slice(overlapFrom - edit.from, overlapTo - edit.from);
  // If the overlapping excerpt survives anywhere, correspondence is uncertain; do not claim the note solved.
  return !!original && !edit.after.includes(original);
};

/** Owns only personal notes and request/event linkage. Parent remains the sole Markdown writer. */
export function usePersonalNotes({ scope, canEdit, source, updatedAt, language = 'en' }: Props) {
  const latestRef = useRef({ source, updatedAt, language }); latestRef.current = { source, updatedAt, language };
  const key = scope ? personalNotesKey(scope) : '';
  const identity = `${key}:${canEdit}`;
  const identityRef = useRef(identity), generationRef = useRef(0);
  const stateRef = useRef<QueueState>(empty()), bindingsRef = useRef(new Map<string, TaskBinding>());
  const [, setState] = useState<QueueState>(empty());
  const mountedRef = useRef(true);
  if (identityRef.current !== identity) { identityRef.current = identity; generationRef.current++; stateRef.current = empty(); bindingsRef.current.clear(); }
  const generation = generationRef.current;
  const active = () => mountedRef.current && generationRef.current === generation && identityRef.current === identity && canEdit && !!scope;
  const publish = (next: QueueState, persist = false) => {
    if (!active()) return;
    if (persist && scope) next = { ...next, storageUnavailable: savePersonalNotes(scope, next.notes).status !== 'saved' };
    stateRef.current = next; setState(next);
  };
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; generationRef.current++; bindingsRef.current.clear(); }; }, []);
  useEffect(() => {
    const next = empty();
    if (scope && canEdit) {
      const loaded = loadPersonalNotes(scope);
      if (loaded.status === 'loaded') next.notes = loaded.notes;
      else next.storageUnavailable = true;
    }
    stateRef.current = next; setState(next);
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
    const intent = instructions + '\n' + JSON.stringify(passages);
    if (intent.length > 10_000) { publish({ ...stateRef.current, conflict: true }); return false; }
    const request: AssistRequest = { id: crypto.randomUUID(), intent, autoSubmit: true, assistTarget: target, noteIds: selected.notes.map((note) => note.id) };
    publish({ ...stateRef.current, assistRequest: request, conflict: false }); return true;
  };
  const onRequestHandled = (id: string) => { if (active() && stateRef.current.assistRequest?.id === id) publish({ ...stateRef.current, assistRequest: null }); };
  const reopen = (id: string) => {
    if (!active()) return;
    publish({ ...stateRef.current, notes: transitionPersonalNotes(stateRef.current.notes, [id], 'reopen'), assistRequest: null, conflict: false }, true);
  };
  const onNotesEvent = (event: AssistNotesEvent) => {
    if (!active() || !scope || event.candidate.userId !== scope.userId || event.candidate.spaceId !== scope.spaceId || event.candidate.pageId !== scope.pageId || event.taskId !== event.candidate.taskId) return;
    if (event.event === 'dispatch') {
      if (stateRef.current.notes.some((n) => event.noteIds.includes(n.id) && n.status !== 'pending')) return;
      const request = stateRef.current.assistRequest;
      if (!request || !event.noteIds.length || request.noteIds?.length !== event.noteIds.length || event.noteIds.some((id) => !request.noteIds?.includes(id)) || event.candidate.baseUpdatedAt !== latestRef.current.updatedAt) return;
      bindingsRef.current.set(event.taskId, { noteIds: [...event.noteIds], coverage: new Map() });
    }
    const binding = bindingsRef.current.get(event.taskId);
    if (!binding || event.noteIds.some((id) => !binding.noteIds.includes(id))) return;
    if (event.event === 'ready' && event.candidate.editPlan) {
      for (const note of stateRef.current.notes.filter((n) => binding.noteIds.includes(n.id) && n.taskId === event.taskId)) {
        const position = resolveAssistTarget(event.candidate.baseContent, note.target);
        if (position.status !== 'found') continue;
        const covered = event.candidate.editPlan.edits.filter((edit) => editChangesPassage(edit, position)).map((edit) => edit.id);
        if (covered.length) binding.coverage.set(note.id, covered);
      }
    }
    let ids = event.noteIds;
    if (event.event === 'accept') {
      const accepted = event.acceptedEditIds ?? event.candidate.acceptedEditIds ?? [];
      ids = ids.filter((id) => { const changes = binding.coverage.get(id); return !!changes?.length && changes.every((change) => accepted.includes(change)); });
    }
    const notes = transitionPersonalNotes(stateRef.current.notes, ids, event.event, event.taskId);
    publish({ ...stateRef.current, notes }, true);
  };
  const visible = identityRef.current === identity && canEdit && scope ? stateRef.current : empty();
  // Refs let sequential callbacks observe synchronous queue changes; setState triggers UI updates.
  return { ...visible, add, dispatch, reopen, onNotesEvent, onRequestHandled, identityKey: key };
}
