import { applyScopedCandidate, createCandidateEdits, acceptCandidateEdit, type AssistTarget, type CandidateEditPlan } from './assistTargets';
export interface AssistSnapshot {
  title: string;
  content: string;
  updatedAt?: string;
  draftRevision?: number;
  remoteRevision?: number;
  remoteConflict?: boolean;
  assistTarget?: AssistTarget;
}
export interface AssistCandidate {
  taskId: string;
  pageId: string;
  spaceId: string;
  userId: string;
  baseTitle: string;
  baseContent: string;
  baseUpdatedAt?: string;
  baseDraftRevision?: number;
  baseRemoteRevision?: number;
  content: string;
  summary?: string;
  assistTarget?: AssistTarget;
  editPlan?: CandidateEditPlan;
  acceptedEditIds?: string[];
  noteIds?: string[];
  status: 'generating' | 'ready' | 'accepted' | 'discarded' | 'conflict' | 'failed' | 'empty';
}
export interface AssistCurrent extends AssistSnapshot {
  pageId: string;
  spaceId: string;
  userId: string;
  canEdit: boolean;
  remoteConflict?: boolean;
}
/** Immutable task identity and saved-page version remain mandatory for every hunk. */
const authorizedCandidate = (candidate: AssistCandidate, current: AssistCurrent) => candidate.status === 'ready'
  && candidate.content.trim().length > 0 && current.canEdit && !current.remoteConflict
  && candidate.pageId === current.pageId && candidate.spaceId === current.spaceId && candidate.userId === current.userId
  && candidate.baseUpdatedAt === current.updatedAt && candidate.baseTitle === current.title
  && candidate.baseRemoteRevision === current.remoteRevision;
export function completeAssistCandidate(candidate: AssistCandidate, content: string, summary?: string): AssistCandidate {
  const completed: AssistCandidate = { ...candidate, content, summary, status: content.trim() ? 'ready' : 'empty' };
  if (!candidate.assistTarget || completed.status !== 'ready') return completed;
  if (candidate.assistTarget.baseUpdatedAt !== candidate.baseUpdatedAt) return { ...completed, status: 'conflict' };
  const plan = createCandidateEdits(candidate.baseContent, content, candidate.assistTarget);
  return plan.status !== 'ready' ? { ...completed, status: 'conflict' }
    : { ...completed, editPlan: plan, acceptedEditIds: [], status: plan.edits.length ? 'ready' : 'empty' };
}
export type CandidateApplication = { status: 'applied'; content: string; acceptedEditIds: string[] } | { status: 'refused' };
/** Recompute from the live draft. The caller commits this content and accepted ledger in one synchronous operation. */
export function applyCandidateToDraft(candidate: AssistCandidate, current: AssistCurrent, editId?: string): CandidateApplication {
  if (!authorizedCandidate(candidate, current)) return { status: 'refused' };
  if (!candidate.assistTarget) {
    if (editId || candidate.baseContent !== current.content || candidate.baseDraftRevision !== current.draftRevision) return { status: 'refused' };
    return { status: 'applied', content: candidate.content, acceptedEditIds: [] };
  }
  if (candidate.assistTarget.baseUpdatedAt !== candidate.baseUpdatedAt) return { status: 'refused' };
  const plan = createCandidateEdits(candidate.baseContent, candidate.content, candidate.assistTarget);
  if (plan.status !== 'ready') return { status: 'refused' };
  const acceptedIds = candidate.acceptedEditIds ?? [];
  if (editId) {
    const result = acceptCandidateEdit(current.content, plan, editId, acceptedIds);
    return result.status === 'applied' ? { status: 'applied', content: result.content, acceptedEditIds: result.acceptedIds } : { status: 'refused' };
  }
  if (!acceptedIds.length) {
    if (candidate.assistTarget.kind === 'document' && candidate.baseDraftRevision !== current.draftRevision) return { status: 'refused' };
    const result = applyScopedCandidate(candidate.baseContent, candidate.content, candidate.assistTarget, current.content);
    return result.status === 'applied' ? { status: 'applied', content: result.content, acceptedEditIds: plan.edits.map((edit) => edit.id) } : { status: 'refused' };
  }
  let content = current.content, nextIds = [...acceptedIds];
  for (const edit of plan.edits.filter((e) => !acceptedIds.includes(e.id))) {
    const result = acceptCandidateEdit(content, plan, edit.id, nextIds);
    if (result.status !== 'applied') return { status: 'refused' };
    content = result.content; nextIds = result.acceptedIds;
  }
  return { status: 'applied', content, acceptedEditIds: nextIds };
}
/** Legacy whole-document candidates keep exact draft/revision guards; scoped candidates require unchanged contextual anchors. */
export function canAcceptCandidate(candidate: AssistCandidate, current: AssistCurrent, editId?: string): boolean {
  return applyCandidateToDraft(candidate, current, editId).status === 'applied';
}
