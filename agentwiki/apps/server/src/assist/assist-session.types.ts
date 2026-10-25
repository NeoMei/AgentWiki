import { AgentExecutionProgress } from './assist-progress';

export type AgentTurnMode = 'auto' | 'question' | 'proposal';
export type AgentAction = 'answer' | 'update' | 'create';
export interface AgentDocumentReceipt { operation: 'updated' | 'created'; pageId: string; title: string; updatedAt: string; url: string }
export type AgentAutoResult = { action: 'answer'; summary: string } | { action: 'update'; summary: string; changes: string } | { action: 'create'; summary: string; title: string; changes: string };
export type AgentTurnStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
/** Safe, provider-independent reasons that may cross the session API boundary. */
export type AgentFailureCode = 'timeout' | 'invalid_output' | 'service_unavailable' | 'rate_limited' | 'output_limit';
const AGENT_FAILURE_MESSAGES: Record<AgentFailureCode, string> = {
  timeout: 'Assistant execution timed out. No document changes were saved. This does not indicate missing document permissions.',
  invalid_output: 'Assistant returned an invalid response format; no document changes were saved.',
  service_unavailable: 'Assistant service is unavailable; no document changes were saved.',
  rate_limited: 'Assistant service is busy or rate limited; no document changes were saved.',
  output_limit: 'Assistant response exceeded the output limit; no document changes were saved.',
};
export const safeAgentFailureMessage = (code: AgentFailureCode): string => AGENT_FAILURE_MESSAGES[code];

/** Validate persisted categories; arbitrary provider text is never a message. */
export function safeAgentFailureCode(value: unknown): AgentFailureCode | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AGENT_FAILURE_MESSAGES, value)
    ? value as AgentFailureCode : undefined;
}
export interface AgentSessionSummary { id: string; spaceId: string; title: string; createdAt: string; updatedAt: string }
export interface AgentTurnAnnotation { id: string; body: string; quote: string }
export interface AgentTurnRequest {
  clientRequestId: string; intent: string; mode?: AgentTurnMode; pageId?: string | null;
  directory?: { folderId: string | null; recursive?: boolean };
  snapshot?: { title: string; content: string; updatedAt?: string; draftRevision?: number; remoteRevision?: number; assistTarget?: unknown };
  referencePageIds?: string[]; noteIds?: string[]; annotations?: AgentTurnAnnotation[];
}
export interface AgentDirectoryContext {
  unavailableReason?: string;
  folderId: string | null; title: string; recursive: boolean;
  documents: { pageId: string; title: string; content: string; updatedAt: string; folderId: string | null }[];
}
export interface AgentDirectoryScope { unavailableReason?: string; folderId: string | null; title: string; recursive: boolean; pageCount: number }
export const AGENT_DIRECTORY_LIMITS = Object.freeze({ documents: 1000, characters: 5_000_000, folders: 10_000 });
export interface AgentTurnView {
  directory?: AgentDirectoryScope;
  id: string; sessionId: string; pageId: string | null; mode: AgentTurnMode; intent: string;
  status: AgentTurnStatus; createdAt: string; pageSnapshot: Record<string, unknown> | null;
  references: { pageId: string; title: string; updatedAt: string }[];
  noteIds: string[]; annotations?: AgentTurnAnnotation[]; progressText: string;
  progress?: AgentExecutionProgress;
  result: { action?: AgentAction; summary?: string; changes?: string; document?: AgentDocumentReceipt } | null; error: string | null; failureCode?: AgentFailureCode;
}
export interface AgentSessionDetail extends AgentSessionSummary { turns: AgentTurnView[] }
export const AGENT_SESSION_LIMITS = Object.freeze({
  turns: 100, sessions: 50, references: 5, intent: 10_000, snapshot: 50_000,
  context: 100_000, historyTurns: 10, history: 120_000, noteIds: 100, annotations: 10_000, answer: 50_000, output: 100_000,
});
export interface AgentSessionContext {
  pageId: string | null;
  directory?: AgentDirectoryContext;
  references: { pageId: string; title: string; content: string; updatedAt: string }[];
  noteIds: string[];
  annotations?: AgentTurnAnnotation[];
}
export interface AgentHistoryTurn {
  /** Terminal state of the prior turn. Failed/cancelled turns are replayed so a follow-up can retry them. */
  status?: AgentTurnStatus;
  failureCode?: AgentFailureCode;
  /** Sanitized failure marker; raw provider/database errors never enter model history. */
  error?: string;
  directory?: AgentDirectoryScope;
  /** Captured at send time; never replaced with current Page bodies. */
  pageSnapshot: Record<string, unknown> | null;
  references: AgentSessionContext['references'];
  action?: AgentAction; document?: AgentDocumentReceipt;
  intent: string; answer: string; mode: AgentTurnMode; pageId: string | null; changes?: string; annotations?: AgentTurnAnnotation[];
}

export const AGENT_OUTPUT_LIMIT_ERROR = 'Assistant output exceeds the limit (answer 50000; total 100000 characters)';
