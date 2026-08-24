import {
  apiResponseStatus,
  hasActiveSpaceCredential,
  type AgentIdentity,
  type AgentInstallation,
  type AgentPreparationApi,
  type ExecutableAgentRole,
  type OwnedAgentSummary,
} from './agentPreparationApi';

export type AgentCandidate =
  | { kind: 'existing'; agent: OwnedAgentSummary }
  | { kind: 'new'; name: string; description: string };

export type PreparationStage =
  | 'creating'
  | 'activating'
  | 'granting'
  | 'checking_connection'
  | 'issuing_instruction';

export type PreparationResumeStage = Exclude<PreparationStage, 'creating' | 'issuing_instruction'>;

export interface AgentPreparationProgress {
  agent: AgentIdentity;
  resumeFrom: PreparationResumeStage;
  role: ExecutableAgentRole;
  source: 'created' | 'existing';
  spaceId: string;
}

export type PreparedConnection =
  | { kind: 'connected' }
  | { kind: 'waiting'; installation: AgentInstallation }
  | { kind: 'instruction_failed'; status?: number };

export interface PreparedAgent {
  agentId: string;
  agentName: string;
  role: ExecutableAgentRole;
  connection: PreparedConnection;
}

export class AgentPreparationFailure extends Error {
  constructor(
    readonly stage: PreparationStage,
    readonly cause: unknown,
    readonly progress?: AgentPreparationProgress,
  ) {
    super(`Agent preparation failed during ${stage}`);
  }
}

export type AgentPreparationInput =
  | {
    candidate: AgentCandidate;
    spaceId: string;
    role: ExecutableAgentRole;
    now?: number;
    resume?: never;
  }
  | {
    candidate?: never;
    spaceId?: never;
    role?: never;
    now?: number;
    resume: AgentPreparationProgress;
  };

export async function prepareAgent(
  input: AgentPreparationInput,
  api: AgentPreparationApi,
  onStage: (stage: PreparationStage) => void = () => undefined,
): Promise<PreparedAgent> {
  let agent: AgentIdentity | undefined = input.resume?.agent;
  let source: AgentPreparationProgress['source'] = input.resume?.source
    ?? (input.candidate?.kind === 'new' ? 'created' : 'existing');
  const context = input.resume ?? input;
  const { role, spaceId } = context;
  let stage: PreparationStage = input.resume?.resumeFrom
    ?? (input.candidate?.kind === 'new' ? 'creating' : 'granting');

  try {
    if (input.resume?.resumeFrom === 'activating') {
      stage = 'activating';
      onStage(stage);
      agent = await api.activateAgent(input.resume.agent.id);
    } else if (input.candidate?.kind === 'new') {
      stage = 'creating';
      onStage(stage);
      agent = await api.createAgent({
        name: input.candidate.name.trim(),
        description: input.candidate.description.trim(),
      });
      source = 'created';
    } else if (input.candidate?.kind === 'existing') {
      agent = input.candidate.agent;
      source = 'existing';
      if (agent.status !== 'active') {
        stage = 'activating';
        onStage(stage);
        agent = await api.activateAgent(agent.id);
      }
    }

    if (!agent) throw new Error('Agent identity is unavailable');

    if (input.resume?.resumeFrom !== 'checking_connection') {
      stage = 'granting';
      onStage(stage);
      await api.upsertGrant(agent.id, spaceId, role);
    }

    stage = 'checking_connection';
    onStage(stage);
    const detail = await api.getAgent(agent.id);
    if (hasActiveSpaceCredential(detail, spaceId, input.now)) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        role,
        connection: { kind: 'connected' },
      };
    }
  } catch (error) {
    const progress = agent && stage !== 'creating'
      ? { agent, resumeFrom: stage as PreparationResumeStage, role, source, spaceId }
      : undefined;
    throw new AgentPreparationFailure(stage, error, progress);
  }

  if (!agent) throw new Error('Agent identity is unavailable');
  stage = 'issuing_instruction';
  onStage(stage);
  try {
    const installation = await api.createInstallation(agent.id, spaceId, role);
    return {
      agentId: agent.id,
      agentName: agent.name,
      role,
      connection: { kind: 'waiting', installation },
    };
  } catch (error) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      role,
      connection: {
        kind: 'instruction_failed',
        status: apiResponseStatus(error),
      },
    };
  }
}
