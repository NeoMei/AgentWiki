import type { AssistSnapshot, AssistCandidate } from '../page/assistCandidate';
import type { AssistRequest, AssistNotesEvent } from '../page/AgentAssistPanel';
import type { AssistTarget } from '../page/assistTargets';
export type AgentTurnMode = 'question' | 'proposal';
export interface AgentAnnotation { id: string; body: string; quote: string }
export interface AgentReference { pageId: string; title: string; updatedAt?: string }
export interface AgentSessionSummary { id: string; spaceId: string; title: string; createdAt: string; updatedAt: string }
export interface AgentTurn {
  id: string; sessionId: string; pageId: string | null; mode: AgentTurnMode; intent: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string;
  pageSnapshot: AssistSnapshot | null; references: AgentReference[]; noteIds: string[]; annotations?: AgentAnnotation[];
  progressText: string; result: { summary?: string; changes?: string } | null; error: string | null;
}
export interface AgentSessionDetail extends AgentSessionSummary { turns: AgentTurn[] }
export interface AgentSessionPanelProps {
  pageId: string; spaceId: string; pageTitle: string; snapshot: () => AssistSnapshot;
  canEdit?: boolean; canAccept?: boolean; supportsScopedApply?: boolean; acceptUnavailableReason?: string;
  onApply?: (candidate: AssistCandidate, editId?: string) => boolean;
  assistTargets?: { selection?: AssistTarget | null; section?: AssistTarget | null };
  assistRequest?: AssistRequest | null; onRequestHandled?: (id: string) => void;
  notesReady?: boolean;
  onNotesEvent?: (event: AssistNotesEvent) => void;
}
