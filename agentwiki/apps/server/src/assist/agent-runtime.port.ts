import { AssistInput, AssistRunResult } from './opencode.types';
export interface AgentRuntimeCapabilities {
  questions: boolean; proposals: boolean; cancellation: boolean;
  tools: boolean; permissions: boolean; resume: boolean;
}
/** Runtime replay uses server-owned history; resume means native provider resume. */
export interface AgentRuntimePort {
  readonly capabilities: AgentRuntimeCapabilities;
  run(input: AssistInput): Promise<AssistRunResult>;
}
export const BUILTIN_RUNTIME_CAPABILITIES: Readonly<AgentRuntimeCapabilities> = Object.freeze({
  questions: true, proposals: true, cancellation: true, tools: false, permissions: false, resume: false,
});
