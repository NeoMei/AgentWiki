import type { AssistSnapshot, AssistCandidate } from '../page/assistCandidate';
import type { AssistRequest, AssistNotesEvent } from '../page/AgentAssistPanel';
import type { AssistTarget } from '../page/assistTargets';
export type AgentTurnMode = 'auto' | 'question' | 'proposal';
export type AgentFailureCode = 'timeout' | 'invalid_output' | 'service_unavailable' | 'rate_limited' | 'output_limit';
export interface AgentDocumentReceipt { operation: 'updated' | 'created'; pageId: string; title: string; updatedAt: string; url: string }
export interface AgentAnnotation { id: string; body: string; quote: string }
export interface AgentReference { pageId: string; title: string; updatedAt?: string; path?: string }
export interface AgentSessionSummary { id: string; spaceId: string; title: string; createdAt: string; updatedAt: string }
export interface AgentTurn {
  id: string; sessionId: string; pageId: string | null; mode: AgentTurnMode; intent: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; createdAt: string;
  pageSnapshot: AssistSnapshot | null; references: AgentReference[]; noteIds: string[]; annotations?: AgentAnnotation[];
  directory?: { folderId: string | null; title: string; recursive: boolean; pageCount: number; unavailableReason?: string };
  progress?: { phase: 'preparing' | 'waiting' | 'generating' | 'finalizing'; attempt?: number };
  failureCode?: AgentFailureCode;
  progressText: string; result: { summary?: string; action?: 'answer' | 'update' | 'create'; changes?: string; document?: AgentDocumentReceipt } | null; error: string | null;
}
export interface AgentSessionDetail extends AgentSessionSummary { turns: AgentTurn[] }
export interface AgentSessionPanelProps {
  pageId: string | null; spaceId: string; pageTitle: string; snapshot?: () => AssistSnapshot;
  /** Document turns resolve their parent directory on the server. */
  directory?: { folderId: string | null; recursive?: boolean };
  canEdit?: boolean; canAccept?: boolean; supportsScopedApply?: boolean; acceptUnavailableReason?: string;
  onApply?: (candidate: AssistCandidate, editId?: string) => boolean;
  /** A newly submitted turn was saved by the server; never performs a client-side write. */
  onDocumentWritten?: (receipt: AgentDocumentReceipt, submittedSnapshot: AssistSnapshot | null) => void;
  assistTargets?: { selection?: AssistTarget | null; section?: AssistTarget | null };
  assistRequest?: AssistRequest | null; onRequestHandled?: (id: string) => void;
  notesReady?: boolean;
  visible?: boolean;
  autoFocus?: boolean;
  focusRequest?: string;
  onNotesEvent?: (event: AssistNotesEvent) => void;
}
