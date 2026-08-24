import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { agentPreparationApi, type OwnedAgentSummary } from '../agentPreparationApi';

export interface AgentPreparationLifecycleEpoch {
  epoch: number;
  active: boolean;
}

export type AgentPreparationLifecycleRef = MutableRefObject<AgentPreparationLifecycleEpoch>;

export const isCurrentLifecycle = (
  lifecycleRef: AgentPreparationLifecycleRef,
  epoch: number,
): boolean => lifecycleRef.current.active && lifecycleRef.current.epoch === epoch;

export const useOwnedAgents = (spaceId: string, targetId: string) => {
  const [agents, setAgents] = useState<OwnedAgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const lifecycleRef = useRef<AgentPreparationLifecycleEpoch>({ epoch: 0, active: false });

  useEffect(() => {
    const epoch = lifecycleRef.current.epoch + 1;
    lifecycleRef.current = { epoch, active: true };
    setAgents([]);
    setSelectedAgentId('');
    setLoading(true);
    setLoadFailed(false);

    void agentPreparationApi.listAgents().then((ownedAgents) => {
      if (!isCurrentLifecycle(lifecycleRef, epoch)) return;
      const availableAgents = ownedAgents.filter(
        (agent) => agent.revokedAt === null || agent.revokedAt === undefined,
      );
      setAgents(availableAgents);
      setSelectedAgentId(availableAgents[0]?.id ?? '');
    }).catch(() => {
      if (isCurrentLifecycle(lifecycleRef, epoch)) setLoadFailed(true);
    }).finally(() => {
      if (isCurrentLifecycle(lifecycleRef, epoch)) setLoading(false);
    });

    return () => {
      if (lifecycleRef.current.epoch === epoch) {
        lifecycleRef.current = { epoch: epoch + 1, active: false };
      }
    };
  }, [spaceId, targetId]);

  return {
    agents,
    lifecycleRef,
    loading,
    loadFailed,
    selectedAgent: agents.find((agent) => agent.id === selectedAgentId),
    selectedAgentId,
    setSelectedAgentId,
  };
};
