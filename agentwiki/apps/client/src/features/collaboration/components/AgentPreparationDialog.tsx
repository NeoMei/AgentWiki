import React, { useEffect, useRef, useState } from 'react';
import { ModalDialog } from '../../../components/ModalDialog';
import { useLanguage } from '../../../context/LanguageContext';
import {
  apiResponseStatus,
  agentPreparationApi,
  type ExecutableAgentRole,
} from '../agentPreparationApi';
import {
  AgentPreparationFailure,
  prepareAgent,
  type AgentPreparationProgress,
  type PreparationStage,
} from '../prepareAgent';
import { AgentCandidateForm, type AgentCandidateMode } from './AgentCandidateForm';
import { ConnectionInstructionPanel } from './ConnectionInstructionPanel';
import { useAgentConnectionLifecycle } from './useAgentConnectionLifecycle';
import { isCurrentLifecycle, useOwnedAgents } from './useOwnedAgents';

export interface PreparedAgentSelection {
  agentId: string;
  agentName: string;
  connection: 'connected' | 'pending';
}

export interface AgentPreparationTarget {
  id: string;
  name: string;
}

export interface AgentPreparationDialogProps {
  spaceId: string;
  target: AgentPreparationTarget;
  onClose: () => void;
  onPrepared: (result: PreparedAgentSelection) => Promise<void>;
  onAuthorizationLost: () => Promise<void>;
}

const safeStageErrorKey = (stage: PreparationStage): string => stage === 'issuing_instruction'
  ? 'collaboration.agentPreparation.instructionFailed'
  : `collaboration.agentPreparation.error.${stage}`;

export const AgentPreparationDialog: React.FC<AgentPreparationDialogProps> = ({
  spaceId,
  target,
  onClose,
  onPrepared,
  onAuthorizationLost,
}) => {
  const { t } = useLanguage();
  const ownedAgents = useOwnedAgents(spaceId, target.id);
  const connection = useAgentConnectionLifecycle({
    lifecycleRef: ownedAgents.lifecycleRef,
    onAuthorizationLost,
    onClose,
    onPrepared,
    spaceId,
    targetId: target.id,
  });
  const [mode, setMode] = useState<AgentCandidateMode>('existing');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<ExecutableAgentRole>('editor');
  const [stage, setStage] = useState<PreparationStage | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparationErrorKey, setPreparationErrorKey] = useState<string | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<AgentPreparationProgress | null>(null);
  const [createdAgent, setCreatedAgent] = useState<{ id: string; name: string } | null>(null);
  const preparationTokenRef = useRef<symbol | null>(null);

  useEffect(() => {
    preparationTokenRef.current = null;
    setMode('existing');
    setName('');
    setDescription('');
    setRole('editor');
    setStage(null);
    setPreparing(false);
    setPreparationErrorKey(null);
    setPreparationProgress(null);
    setCreatedAgent(null);
  }, [spaceId, target.id]);

  const busy = preparing || connection.busy;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || connection.authorizationLost) return;
    if (!preparationProgress && mode === 'existing' && !ownedAgents.selectedAgent) return;
    if (!preparationProgress && mode === 'new' && !name.trim()) return;

    const lifecycleEpoch = ownedAgents.lifecycleRef.current.epoch;
    const preparationToken = Symbol('agent-preparation');
    preparationTokenRef.current = preparationToken;
    let latestStage: PreparationStage = preparationProgress?.resumeFrom
      ?? (mode === 'new' ? 'creating' : 'granting');
    const source = preparationProgress?.source ?? (mode === 'new' ? 'created' : 'existing');
    setPreparing(true);
    setStage(latestStage);
    setPreparationErrorKey(null);
    connection.reset();
    try {
      const preparationInput = preparationProgress
        ? { resume: preparationProgress }
        : {
          candidate: mode === 'existing'
            ? { kind: 'existing' as const, agent: ownedAgents.selectedAgent! }
            : { kind: 'new' as const, name, description },
          spaceId,
          role,
        };
      const prepared = await prepareAgent(preparationInput, agentPreparationApi, (nextStage) => {
        latestStage = nextStage;
        if (preparationTokenRef.current === preparationToken
          && isCurrentLifecycle(ownedAgents.lifecycleRef, lifecycleEpoch)) {
          setStage(nextStage);
        }
      });
      if (preparationTokenRef.current !== preparationToken
        || !isCurrentLifecycle(ownedAgents.lifecycleRef, lifecycleEpoch)) return;
      if (source === 'created') {
        setCreatedAgent({ id: prepared.agentId, name: prepared.agentName });
      }
      setStage(null);
      await connection.acceptPrepared(prepared);
    } catch (error) {
      if (preparationTokenRef.current !== preparationToken
        || !isCurrentLifecycle(ownedAgents.lifecycleRef, lifecycleEpoch)) return;
      if (error instanceof AgentPreparationFailure && apiResponseStatus(error.cause) === 403) {
        await connection.loseAuthorization();
        return;
      }
      const failedStage = error instanceof AgentPreparationFailure ? error.stage : latestStage;
      if (error instanceof AgentPreparationFailure && error.progress) {
        setPreparationProgress(error.progress);
        if (error.progress.source === 'created') {
          setCreatedAgent({ id: error.progress.agent.id, name: error.progress.agent.name });
        }
      }
      setPreparationErrorKey(safeStageErrorKey(failedStage));
    } finally {
      if (preparationTokenRef.current === preparationToken
        && isCurrentLifecycle(ownedAgents.lifecycleRef, lifecycleEpoch)) {
        preparationTokenRef.current = null;
        setPreparing(false);
      }
    }
  };

  const resetCandidateResult = () => {
    connection.reset();
    setStage(null);
    setPreparationErrorKey(null);
    setPreparationProgress(null);
    setCreatedAgent(null);
  };

  const handleModeChange = (nextMode: AgentCandidateMode) => {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    resetCandidateResult();
  };

  const handleSelectedAgentChange = (agentId: string) => {
    ownedAgents.setSelectedAgentId(agentId);
    resetCandidateResult();
  };

  const handleRoleChange = (nextRole: ExecutableAgentRole) => {
    setRole(nextRole);
    resetCandidateResult();
  };

  const canSubmit = !busy
    && !connection.authorizationLost
    && (preparationProgress
      ? true
      : mode === 'existing' ? Boolean(ownedAgents.selectedAgent) : Boolean(name.trim()));
  const lockedAgent = preparationProgress?.agent ?? createdAgent ?? undefined;
  const lockedAgentWasCreated = preparationProgress?.source === 'created' || createdAgent !== null;
  const visibleErrorKey = connection.authorizationLost
    ? null
    : preparationErrorKey
      ?? connection.errorKey
      ?? (mode === 'existing' && ownedAgents.loadFailed
        ? 'collaboration.agentPreparation.loadFailed'
        : null);
  const title = t('collaboration.agentPreparation.title', { role: target.name });
  const titleId = `agent-preparation-title-${target.id}`;

  return (
    <ModalDialog
      labelledBy={titleId}
      onRequestClose={onClose}
      closeDisabled={busy}
      className="max-h-[calc(100vh-2rem)] w-full min-w-0 max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 id={titleId} className="min-w-0 break-words text-xl font-semibold">{title}</h2>
        <button
          type="button"
          aria-label={t('common.close')}
          disabled={busy}
          onClick={onClose}
          className="min-h-8 shrink-0 rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('common.close')}
        </button>
      </div>

      <AgentCandidateForm
        agents={ownedAgents.agents}
        busy={busy}
        canSubmit={canSubmit}
        description={description}
        loadFailed={ownedAgents.loadFailed}
        loading={ownedAgents.loading}
        lockedAgent={lockedAgent}
        lockedAgentWasCreated={lockedAgentWasCreated}
        mode={mode}
        name={name}
        onDescriptionChange={setDescription}
        onModeChange={handleModeChange}
        onNameChange={setName}
        onRoleChange={handleRoleChange}
        onSelectedAgentIdChange={handleSelectedAgentChange}
        onSubmit={(event) => void handleSubmit(event)}
        role={role}
        retryingPreparation={preparationProgress !== null}
        selectedAgent={ownedAgents.selectedAgent}
        selectedAgentId={ownedAgents.selectedAgentId}
        showPrepare={!connection.result && !connection.authorizationLost}
        spaceId={spaceId}
        tabListLabel={title}
      />

      {stage && preparing && !connection.result ? (
        <p role="status" className="mt-4 text-sm text-gray-500">{t('common.loading')}</p>
      ) : null}

      {connection.authorizationLost ? (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.ownerRequired')}
        </p>
      ) : null}

      {visibleErrorKey ? (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {t(visibleErrorKey)}
          {visibleErrorKey === 'collaboration.agentPreparation.refreshFailed'
            && connection.result?.connection.kind === 'connected' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void connection.retryCompletion()}
                className="ml-2 underline disabled:opacity-50"
              >
                {t('common.retry')}
              </button>
            ) : null}
        </div>
      ) : null}

      <ConnectionInstructionPanel
        busy={busy}
        copied={connection.copied}
        expired={connection.expired}
        onCheckNow={() => void connection.checkNow()}
        onConnectLater={() => void connection.connectLater()}
        onCopy={() => void connection.copyInstruction()}
        onRetryInstruction={() => void connection.retryInstruction()}
        remaining={connection.remaining}
        result={connection.result}
      />
    </ModalDialog>
  );
};
