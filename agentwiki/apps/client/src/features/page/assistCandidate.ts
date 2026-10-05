export interface AssistSnapshot {
  title: string;
  content: string;
  updatedAt?: string;
  draftRevision?: number;
  remoteRevision?: number;
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
  status: 'generating' | 'ready' | 'accepted' | 'discarded' | 'conflict' | 'failed' | 'empty';
}
export interface AssistCurrent extends AssistSnapshot {
  pageId: string;
  spaceId: string;
  userId: string;
  canEdit: boolean;
  remoteConflict?: boolean;
}
/** A whole-document candidate is tied to the exact authorized submitted draft. */
export function canAcceptCandidate(candidate: AssistCandidate, current: AssistCurrent): boolean {
  return candidate.status === 'ready'
    && candidate.content.trim().length > 0
    && current.canEdit && !current.remoteConflict
    && candidate.pageId === current.pageId && candidate.spaceId === current.spaceId
    && candidate.userId === current.userId
    && candidate.baseUpdatedAt === current.updatedAt
    && candidate.baseTitle === current.title && candidate.baseContent === current.content
    && candidate.baseDraftRevision === current.draftRevision
    && candidate.baseRemoteRevision === current.remoteRevision;
}
