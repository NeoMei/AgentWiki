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
  constructor(readonly stage: PreparationStage, readonly cause: unknown) {
    super(`Agent preparation failed during ${stage}`);
  }
}

export async function prepareAgent(
  input: {
    candidate: AgentCandidate;
    spaceId: string;
    role: ExecutableAgentRole;
    now?: number;
  },
  api: AgentPreparationApi,
  onStage: (stage: PreparationStage) => void = () => undefined,
): Promise<PreparedAgent> {
  let agent: AgentIdentity;
  let stage: PreparationStage = input.candidate.kind === 'new' ? 'creating' : 'granting';

  try {
    if (input.candidate.kind === 'new') {
      stage = 'creating';
      onStage(stage);
      agent = await api.createAgent({
        name: input.candidate.name.trim(),
        description: input.candidate.description.trim(),
      });
    } else {
      agent = input.candidate.agent;
      if (agent.status !== 'active') {
        stage = 'activating';
        onStage(stage);
        agent = await api.activateAgent(agent.id);
      }
    }

    stage = 'granting';
    onStage(stage);
    await api.upsertGrant(agent.id, input.spaceId, input.role);

    stage = 'checking_connection';
    onStage(stage);
    const detail = await api.getAgent(agent.id);
    if (hasActiveSpaceCredential(detail, input.spaceId, input.now)) {
      return {
        agentId: agent.id,
        agentName: agent.name,
        role: input.role,
        connection: { kind: 'connected' },
      };
    }
  } catch (error) {
    throw new AgentPreparationFailure(stage, error);
  }

  stage = 'issuing_instruction';
  onStage(stage);
  try {
    const installation = await api.createInstallation(agent.id, input.spaceId, input.role);
    return {
      agentId: agent.id,
      agentName: agent.name,
      role: input.role,
      connection: { kind: 'waiting', installation },
    };
  } catch (error) {
    return {
      agentId: agent.id,
      agentName: agent.name,
      role: input.role,
      connection: {
        kind: 'instruction_failed',
        status: apiResponseStatus(error),
      },
    };
  }
}
