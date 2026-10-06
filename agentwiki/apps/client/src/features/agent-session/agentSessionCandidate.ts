import { completeAssistCandidate, type AssistCandidate, type AssistCurrent } from '../page/assistCandidate';
import type { AgentTurn } from './agentSessionTypes';
export interface CandidateRecord { candidate: AssistCandidate; mount: object | null }
/** Original source/version always comes from the immutable turn, never the current page. */
export function candidateFromTurn(turn: AgentTurn, userId: string, spaceId: string): CandidateRecord | null {
  const source = turn.pageSnapshot;
  if (turn.mode !== 'proposal' || !turn.pageId || !source || typeof source.title !== 'string' || typeof source.content !== 'string') return null;
  let candidate: AssistCandidate = { taskId: turn.id, pageId: turn.pageId, spaceId, userId,
    baseTitle: source.title, baseContent: source.content, baseUpdatedAt: source.updatedAt,
    baseDraftRevision: source.draftRevision, baseRemoteRevision: source.remoteRevision,
    assistTarget: source.assistTarget, noteIds: turn.noteIds, content: '', status: 'generating' };
  if (turn.status === 'done') candidate = completeAssistCandidate(candidate, turn.result?.changes ?? '', turn.result?.summary);
  if (turn.status === 'failed' || turn.status === 'cancelled') candidate.status = 'failed';
  return { candidate, mount: null };
}
/** A local revision has meaning only within its original editor mount. Fail closed on remount drift. */
export function bindCandidate(record: CandidateRecord, current: AssistCurrent, mount: object): AssistCandidate {
  const candidate = record.candidate;
  if (record.mount === mount || candidate.status !== 'ready') return candidate;
  let expected = candidate.baseContent;
  for (const edit of (candidate.editPlan?.edits ?? []).filter((e) => candidate.acceptedEditIds?.includes(e.id)).sort((a, b) => b.from - a.from)) expected = expected.slice(0, edit.from) + edit.after + expected.slice(edit.to);
  if (!current.canEdit || current.remoteConflict || candidate.pageId !== current.pageId || candidate.spaceId !== current.spaceId || candidate.userId !== current.userId
    || candidate.baseTitle !== current.title || candidate.baseUpdatedAt !== current.updatedAt || expected !== current.content) return { ...candidate, status: 'conflict' };
  record.mount = mount;
  record.candidate = { ...candidate, baseDraftRevision: current.draftRevision, baseRemoteRevision: current.remoteRevision };
  return record.candidate;
}
