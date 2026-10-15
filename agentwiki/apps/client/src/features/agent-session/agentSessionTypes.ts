import type { AssistSnapshot, AssistCandidate } from '../page/assistCandidate';
import type { AssistRequest, AssistNotesEvent } from '../page/AgentAssistPanel';
import type { AssistTarget } from '../page/assistTargets';
export type AgentTurnMode = 'question' | 'proposal';
export type AgentComposerMode = AgentTurnMode | 'direct';
export interface AgentAnnotation { id: string; body: string; quote: string }
export interface AgentReference { pageId: string; title: string; updatedAt?: string; path?: string }
export interface AgentSessionSummary { id: string; spaceId: string; title: string; createdAt: string; updatedAt: string }
export interface AgentTurn {
  id: string; sessionId: string; pageId: string | null; mode: AgentTurnMode; intent: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string;
  pageSnapshot: AssistSnapshot | null; references: AgentReference[]; noteIds: string[]; annotations?: AgentAnnotation[];
  progress?: { phase: 'preparing' | 'waiting' | 'generating' | 'finalizing'; attempt?: number };
  progressText: string; result: { summary?: string; changes?: string } | null; error: string | null;
}
export interface AgentSessionDetail extends AgentSessionSummary { turns: AgentTurn[] }
export interface AgentSessionPanelProps {
  pageId: string; spaceId: string; pageTitle: string; snapshot: () => AssistSnapshot;
  canEdit?: boolean; canAccept?: boolean; supportsScopedApply?: boolean; acceptUnavailableReason?: string;
  onApply?: (candidate: AssistCandidate, editId?: string) => boolean;
  /** Apply a completed candidate directly to the saved page. The callback must enforce its own CAS. */
  onDirectApply?: (candidate: AssistCandidate, content: string) => boolean | Promise<boolean>;
  assistTargets?: { selection?: AssistTarget | null; section?: AssistTarget | null };
  assistRequest?: AssistRequest | null; onRequestHandled?: (id: string) => void;
  notesReady?: boolean;
  visible?: boolean;
  autoFocus?: boolean;
  focusRequest?: string;
  onNotesEvent?: (event: AssistNotesEvent) => void;
}
