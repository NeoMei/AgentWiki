import { useEffect, useRef, useState } from 'react';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import {
  existingAgentContextApi,
  hasActiveSpaceCredential,
  type ExecutableAgentRole,
  type OwnedAgentDetail,
  type OwnedAgentSummary,
} from '../agentPreparationApi';

export type ExistingAgentContextState =
  | { status: 'idle'; agentId: ''; spaceId: string }
  | { status: 'loading'; agentId: string; spaceId: string }
  | {
    status: 'ready';
    agentId: string;
    connected: boolean;
    detail: OwnedAgentDetail;
    grantRole: AgentAccessRole | null;
    spaceId: string;
  }
  | { status: 'unavailable'; agentId: string; spaceId: string };

export const executableRoleForGrant = (
  role: AgentAccessRole | null | undefined,
): ExecutableAgentRole => role === 'publisher' ? 'publisher' : 'editor';

export interface ExistingAgentContextView {
  agentStatus: 'active' | 'paused' | null;
  connection: 'loading' | 'connected' | 'disconnected' | 'unavailable';
  grantRole: AgentAccessRole | null | undefined;
  settled: boolean;
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
}

export const deriveExistingAgentContext = (
  context: ExistingAgentContextState,
  agent: OwnedAgentSummary | undefined,
  spaceId: string,
): ExistingAgentContextView => {
  if (!agent) {
    return {
      agentStatus: null,
      connection: 'loading',
      grantRole: undefined,
      settled: false,
      status: 'idle',
    };
  }

  const identityMatches = context.agentId === agent.id && context.spaceId === spaceId;
  if (identityMatches && context.status === 'ready') {
    return {
      agentStatus: context.detail.status === 'active' ? 'active' : 'paused',
      connection: context.connected ? 'connected' : 'disconnected',
      grantRole: context.grantRole,
      settled: true,
      status: 'ready',
    };
  }
  if (identityMatches && context.status === 'unavailable') {
    return {
      agentStatus: agent.status === 'active' ? 'active' : 'paused',
      connection: 'unavailable',
      grantRole: agent.grants.find((grant) => grant.spaceId === spaceId)?.role ?? null,
      settled: true,
      status: 'unavailable',
    };
  }
  return {
    agentStatus: agent.status === 'active' ? 'active' : 'paused',
    connection: 'loading',
    grantRole: undefined,
    settled: false,
    status: 'loading',
  };
};

export const useExistingAgentContext = ({
  agentId,
  enabled,
  spaceId,
}: {
  agentId: string;
  enabled: boolean;
  spaceId: string;
}): ExistingAgentContextState => {
  const [context, setContext] = useState<ExistingAgentContextState>({
    status: 'idle',
    agentId: '',
    spaceId,
  });
  const requestEpoch = useRef(0);

  useEffect(() => {
    const epoch = ++requestEpoch.current;
    if (!enabled || !agentId) {
      setContext({ status: 'idle', agentId: '', spaceId });
      return;
    }

    setContext({ status: 'loading', agentId, spaceId });
    void existingAgentContextApi.getAgent(agentId).then((detail) => {
      if (requestEpoch.current !== epoch) return;
      setContext({
        status: 'ready',
        agentId,
        connected: hasActiveSpaceCredential(detail, spaceId),
        detail,
        grantRole: detail.grants.find((grant) => grant.spaceId === spaceId)?.role ?? null,
        spaceId,
      });
    }).catch(() => {
      if (requestEpoch.current === epoch) {
        setContext({ status: 'unavailable', agentId, spaceId });
      }
    });

    return () => {
      if (requestEpoch.current === epoch) requestEpoch.current += 1;
    };
  }, [agentId, enabled, spaceId]);

  return context;
};
