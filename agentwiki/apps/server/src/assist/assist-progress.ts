/** Public execution state; never derived from provider text or tool payloads. */
export interface AgentExecutionProgress {
  phase: 'preparing' | 'waiting' | 'generating' | 'finalizing';
  attempt?: number;
}

export function sanitizeAgentProgress(value: unknown): AgentExecutionProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { phase, attempt } = value as Record<string, unknown>;
  if (phase !== 'preparing' && phase !== 'waiting' && phase !== 'generating' && phase !== 'finalizing') return undefined;
  if (attempt !== undefined && (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1 || attempt > 100)) return undefined;
  return { phase, ...(attempt !== undefined ? { attempt: attempt as number } : {}) };
}
