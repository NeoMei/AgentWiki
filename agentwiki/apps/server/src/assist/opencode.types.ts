import { AgentHistoryTurn, AgentSessionContext, AgentTurnMode } from './assist-session.types';
export type ModelTier = 'free' | 'paid';
export type FailureCode =
  | 'auth_failed' | 'binary_unavailable' | 'budget_exhausted' | 'cancelled'
  | 'configuration_error' | 'invalid_output' | 'model_unavailable'
  | 'no_models' | 'output_limit' | 'process_error' | 'rate_limited' | 'timeout';

export type StreamChunkCallback = (chunk: string) => void;

export interface AssistInput {
  intent: string;
  mode?: AgentTurnMode;
  context?: AgentSessionContext;
  history?: AgentHistoryTurn[];
  historyWindow?: { included: number; omitted: number; maxTurns: number; maxCharacters: number };
  signal?: AbortSignal;
  /** Validated answer summary only, never reasoning/tool/provider event payloads. */
  onAnswerText?: StreamChunkCallback;
  pageSnapshot: unknown;
  leaseExpiresAtMs?: number;
  isActive?: () => Promise<boolean>;
  onStreamChunk?: StreamChunkCallback;
}
export interface ModelUsage {
  input: number; output: number; reasoning: number;
  cacheRead: number; cacheWrite: number; total: number;
}
export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface ModelCandidate { id: string; tier: ModelTier; price: ModelPrice; estimatedCost: number }
export interface OpencodeAttemptResult {
  summary: string; changes?: string; raw?: string; usage: ModelUsage; cost: number;
}
export interface AssistAttemptSummary {
  model: string; tier: ModelTier; durationMs: number; status: 'succeeded' | 'failed';
  errorCode?: FailureCode; usage: ModelUsage; cost: number;
}
export interface AssistRunResult {
  summary: string; changes?: string; proposedChangeSetId?: string; raw?: string;
  model?: string; modelTier?: ModelTier; attemptCount?: number;
  usage?: ModelUsage; cost?: number; attempts?: AssistAttemptSummary[];
}
export interface OpencodeRunner { run(task: AssistInput): Promise<AssistRunResult> }

export class OpencodeExecutionError extends Error {
  constructor(
    message: string,
    readonly code: FailureCode,
    readonly scope: 'model' | 'global',
    readonly usage: ModelUsage,
    readonly cost = 0,
  ) { super(message); }
}

export class OpencodeRoutingError extends Error {
  constructor(message: string, readonly result: AssistRunResult) { super(message); }
}

export const EMPTY_USAGE: ModelUsage = {
  input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0,
};
