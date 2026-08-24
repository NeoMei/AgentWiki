import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ModalDialog } from '../../../components/ModalDialog';
import { useLanguage } from '../../../context/LanguageContext';
import {
  agentPreparationApi,
  apiResponseStatus,
  hasActiveSpaceCredential,
  type ExecutableAgentRole,
  type OwnedAgentSummary,
} from '../agentPreparationApi';
import {
  AgentPreparationFailure,
  prepareAgent,
  type PreparationStage,
  type PreparedAgent,
} from '../prepareAgent';

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

type Mode = 'existing' | 'new';

const safeStageErrorKey = (stage: PreparationStage): string => {
  if (stage === 'issuing_instruction') {
    return 'collaboration.agentPreparation.instructionFailed';
  }
  return `collaboration.agentPreparation.error.${stage}`;
};

export const AgentPreparationDialog: React.FC<AgentPreparationDialogProps> = ({
  spaceId,
  target,
  onClose,
  onPrepared,
  onAuthorizationLost,
}) => {
  const { t } = useLanguage();
  const [agents, setAgents] = useState<OwnedAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>('existing');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<ExecutableAgentRole>('editor');
  const [result, setResult] = useState<PreparedAgent | null>(null);
  const [stage, setStage] = useState<PreparationStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const requestEpochRef = useRef(0);
  const checkingRef = useRef<symbol | null>(null);
  const completionRef = useRef(false);

  useEffect(() => {
    const epoch = ++requestEpochRef.current;
    setAgents([]);
    setLoading(true);
    setMode('existing');
    setSelectedAgentId('');
    setName('');
    setDescription('');
    setRole('editor');
    setResult(null);
    setStage(null);
    setBusy(false);
    setErrorKey(null);
    setAuthorizationLost(false);
    setCopied(false);
    checkingRef.current = null;
    completionRef.current = false;

    void agentPreparationApi.listAgents().then((ownedAgents) => {
      if (epoch !== requestEpochRef.current) return;
      const availableAgents = ownedAgents.filter((agent) => !agent.revokedAt);
      setAgents(availableAgents);
      setSelectedAgentId(availableAgents[0]?.id ?? '');
    }).catch(() => {
      if (epoch === requestEpochRef.current) {
        setErrorKey('collaboration.agentPreparation.loadFailed');
      }
    }).finally(() => {
      if (epoch === requestEpochRef.current) setLoading(false);
    });

    return () => {
      requestEpochRef.current += 1;
      checkingRef.current = null;
      completionRef.current = false;
    };
  }, [spaceId, target.id]);

  const completeSelection = useCallback(async (
    selection: PreparedAgentSelection,
    markConnected: boolean,
  ) => {
    if (completionRef.current) return;
    completionRef.current = true;
    const epoch = requestEpochRef.current;
    if (markConnected) {
      setResult((current) => current && current.agentId === selection.agentId
        ? { ...current, connection: { kind: 'connected' } }
        : current);
    }
    setBusy(true);
    setErrorKey(null);
    try {
      await onPrepared(selection);
      if (epoch === requestEpochRef.current) onClose();
    } catch {
      if (epoch === requestEpochRef.current) {
        setErrorKey('collaboration.agentPreparation.refreshFailed');
      }
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false);
      completionRef.current = false;
    }
  }, [onClose, onPrepared]);

  const loseAuthorization = useCallback(async () => {
    const epoch = requestEpochRef.current;
    setAuthorizationLost(true);
    setResult(null);
    setErrorKey(null);
    setBusy(true);
    try {
      await onAuthorizationLost();
    } catch {
      // Parent refresh errors are intentionally not rendered with raw details.
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false);
    }
  }, [onAuthorizationLost]);

  const waitingConnection = result?.connection.kind === 'waiting'
    ? result.connection
    : null;
  const waitingInstallationId = waitingConnection?.installation.installationId ?? '';
  const waitingExpiresAt = waitingConnection?.installation.expiresAt ?? '';
  const expiryTimestamp = waitingExpiresAt ? Date.parse(waitingExpiresAt) : Number.NaN;
  const remainingSeconds = Number.isFinite(expiryTimestamp)
    ? Math.max(0, Math.ceil((expiryTimestamp - now) / 1_000))
    : 0;
  const expired = waitingConnection !== null && remainingSeconds === 0;

  useEffect(() => {
    if (!waitingInstallationId || expired) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [expired, waitingExpiresAt, waitingInstallationId]);

  const pollingAgentId = waitingConnection ? result?.agentId ?? '' : '';
  const pollingAgentName = waitingConnection ? result?.agentName ?? '' : '';

  useEffect(() => {
    if (!pollingAgentId || !waitingInstallationId || expired || authorizationLost) return;
    let cancelled = false;
    const epoch = requestEpochRef.current;

    const check = async () => {
      if (cancelled || checkingRef.current !== null) return;
      const pollExpiry = Date.parse(waitingExpiresAt);
      if (!Number.isFinite(pollExpiry) || pollExpiry <= Date.now()) return;
      const checkingToken = Symbol('connection-check');
      checkingRef.current = checkingToken;
      try {
        const detail = await agentPreparationApi.getAgent(pollingAgentId);
        if (cancelled || epoch !== requestEpochRef.current) return;
        setErrorKey((current) => current === 'collaboration.agentPreparation.error.checking_connection'
          ? null
          : current);
        if (hasActiveSpaceCredential(detail, spaceId)) {
          await completeSelection({
            agentId: pollingAgentId,
            agentName: pollingAgentName,
            connection: 'connected',
          }, true);
        }
      } catch {
        if (!cancelled && epoch === requestEpochRef.current) {
          setErrorKey('collaboration.agentPreparation.error.checking_connection');
        }
      } finally {
        if (checkingRef.current === checkingToken) checkingRef.current = null;
      }
    };

    const interval = window.setInterval(() => void check(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    authorizationLost,
    completeSelection,
    expired,
    pollingAgentId,
    pollingAgentName,
    spaceId,
    waitingExpiresAt,
    waitingInstallationId,
  ]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || authorizationLost) return;
    const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
    if (mode === 'existing' && !selectedAgent) return;
    if (mode === 'new' && !name.trim()) return;

    const epoch = requestEpochRef.current;
    let latestStage: PreparationStage = mode === 'new' ? 'creating' : 'granting';
    setBusy(true);
    setResult(null);
    setStage(latestStage);
    setErrorKey(null);
    setCopied(false);
    try {
      const prepared = await prepareAgent({
        candidate: mode === 'existing'
          ? { kind: 'existing', agent: selectedAgent! }
          : { kind: 'new', name, description },
        spaceId,
        role,
      }, agentPreparationApi, (nextStage) => {
        latestStage = nextStage;
        if (epoch === requestEpochRef.current) setStage(nextStage);
      });
      if (epoch !== requestEpochRef.current) return;
      setStage(null);
      if (prepared.connection.kind === 'instruction_failed' && prepared.connection.status === 403) {
        await loseAuthorization();
        return;
      }
      setNow(Date.now());
      setResult(prepared);
      if (prepared.connection.kind === 'connected') {
        await completeSelection({
          agentId: prepared.agentId,
          agentName: prepared.agentName,
          connection: 'connected',
        }, true);
      }
    } catch (error) {
      if (epoch !== requestEpochRef.current) return;
      if (error instanceof AgentPreparationFailure && apiResponseStatus(error.cause) === 403) {
        await loseAuthorization();
        return;
      }
      const failedStage = error instanceof AgentPreparationFailure ? error.stage : latestStage;
      setErrorKey(safeStageErrorKey(failedStage));
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false);
    }
  };

  const handleRetryInstruction = async () => {
    if (!result || busy || authorizationLost) return;
    const epoch = requestEpochRef.current;
    setBusy(true);
    setErrorKey(null);
    setCopied(false);
    try {
      const nextInstallation = await agentPreparationApi.createInstallation(
        result.agentId,
        spaceId,
        result.role,
      );
      if (epoch !== requestEpochRef.current) return;
      setNow(Date.now());
      setResult((current) => current && current.agentId === result.agentId
        ? { ...current, connection: { kind: 'waiting', installation: nextInstallation } }
        : current);
    } catch (error) {
      if (epoch !== requestEpochRef.current) return;
      if (apiResponseStatus(error) === 403) {
        await loseAuthorization();
        return;
      }
      setResult((current) => current && current.agentId === result.agentId
        ? { ...current, connection: { kind: 'instruction_failed' } }
        : current);
    } finally {
      if (epoch === requestEpochRef.current) setBusy(false);
    }
  };

  const handleCheckNow = async () => {
    if (!result || result.connection.kind !== 'waiting' || expired || checkingRef.current !== null) return;
    const epoch = requestEpochRef.current;
    const checkingToken = Symbol('connection-check');
    checkingRef.current = checkingToken;
    setBusy(true);
    setErrorKey(null);
    try {
      const detail = await agentPreparationApi.getAgent(result.agentId);
      if (epoch !== requestEpochRef.current) return;
      if (hasActiveSpaceCredential(detail, spaceId)) {
        await completeSelection({
          agentId: result.agentId,
          agentName: result.agentName,
          connection: 'connected',
        }, true);
      }
    } catch {
      if (epoch === requestEpochRef.current) {
        setErrorKey('collaboration.agentPreparation.error.checking_connection');
      }
    } finally {
      if (checkingRef.current === checkingToken) checkingRef.current = null;
      if (epoch === requestEpochRef.current) setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!waitingConnection || expired) return;
    try {
      await navigator.clipboard.writeText(waitingConnection.installation.instructions);
      setCopied(true);
      setErrorKey(null);
    } catch {
      setCopied(false);
      setErrorKey('collaboration.agentPreparation.copyFailed');
    }
  };

  const handleModeChange = (nextMode: Mode) => {
    if (busy || nextMode === mode) return;
    setMode(nextMode);
    setResult(null);
    setStage(null);
    setErrorKey(null);
    setCopied(false);
  };

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const currentGrant = selectedAgent?.grants.find((grant) => grant.spaceId === spaceId);
  const roleName = t(`agent.role.${role}.name`);
  const canSubmit = !busy
    && !authorizationLost
    && (mode === 'existing' ? Boolean(selectedAgent) : Boolean(name.trim()));
  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
  const titleId = `agent-preparation-title-${target.id}`;

  return (
    <ModalDialog
      labelledBy={titleId}
      onRequestClose={onClose}
      closeDisabled={busy}
      className="max-h-[calc(100vh-2rem)] w-full min-w-0 max-w-2xl overflow-y-auto rounded-[14px] bg-white p-4 shadow-xl sm:p-6"
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 id={titleId} className="min-w-0 break-words text-xl font-semibold">
          {t('collaboration.agentPreparation.title', { role: target.name })}
        </h2>
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

      <div role="tablist" className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'existing'}
          onClick={() => handleModeChange('existing')}
          className={`min-h-10 rounded-lg border px-3 text-sm font-medium ${mode === 'existing' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-600'}`}
        >
          {t('collaboration.agentPreparation.existing')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'new'}
          onClick={() => handleModeChange('new')}
          className={`min-h-10 rounded-lg border px-3 text-sm font-medium ${mode === 'new' ? 'bg-gray-100 text-gray-900' : 'bg-white text-gray-600'}`}
        >
          {t('collaboration.agentPreparation.create')}
        </button>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 min-w-0 space-y-4">
        {mode === 'existing' ? (
          <div role="tabpanel" className="min-w-0 space-y-3">
            {loading ? <p role="status" className="text-sm text-gray-500">{t('common.loading')}</p> : null}
            {!loading && agents.length === 0 && !errorKey ? (
              <p className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">
                {t('collaboration.agentPreparation.noOwnedAgents')}
              </p>
            ) : null}
            {agents.length > 0 ? (
              <label className="block text-sm font-medium">
                {t('collaboration.dashboard.agent')}
                <select
                  data-modal-autofocus
                  aria-label={t('collaboration.dashboard.agent')}
                  value={selectedAgentId}
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedAgentId(event.target.value);
                    setErrorKey(null);
                    setResult(null);
                  }}
                  className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : (
          <div role="tabpanel" className="grid min-w-0 grid-cols-1 gap-4">
            <label className="block text-sm font-medium">
              {t('common.name')}
              <input
                data-modal-autofocus
                aria-label={t('common.name')}
                required
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
              />
            </label>
            <label className="block text-sm font-medium">
              {t('common.description')}
              <textarea
                aria-label={t('common.description')}
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full min-w-0 rounded-lg border p-3 text-sm disabled:bg-gray-100"
              />
            </label>
          </div>
        )}

        <label className="block text-sm font-medium">
          {t('collaboration.agentPreparation.role')}
          <select
            aria-label={t('collaboration.agentPreparation.role')}
            value={role}
            disabled={busy}
            onChange={(event) => {
              setRole(event.target.value as ExecutableAgentRole);
              setErrorKey(null);
              setResult(null);
            }}
            className="mt-1 h-10 w-full min-w-0 rounded-lg border px-3 text-sm disabled:bg-gray-100"
          >
            <option value="editor">{t('agent.role.editor.name')}</option>
            <option value="publisher">{t('agent.role.publisher.name')}</option>
          </select>
        </label>

        {mode === 'existing' && selectedAgent?.status !== 'active' ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {t('collaboration.agentPreparation.pausedResume')}
          </p>
        ) : null}
        {mode === 'existing' && currentGrant?.role === 'reader' ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {t('collaboration.agentPreparation.readerUpgrade', { role: roleName })}
          </p>
        ) : null}

        {!result && !authorizationLost ? (
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-10 w-full rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {busy ? t('common.loading') : t('collaboration.agentPreparation.prepare')}
          </button>
        ) : null}
      </form>

      {stage && busy && !result ? (
        <p role="status" className="mt-4 text-sm text-gray-500">{t('common.loading')}</p>
      ) : null}

      {authorizationLost ? (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.ownerRequired')}
        </p>
      ) : null}

      {errorKey ? (
        <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {t(errorKey)}
          {errorKey === 'collaboration.agentPreparation.refreshFailed' && result?.connection.kind === 'connected' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void completeSelection({
                agentId: result.agentId,
                agentName: result.agentName,
                connection: 'connected',
              }, true)}
              className="ml-2 underline disabled:opacity-50"
            >
              {t('common.retry')}
            </button>
          ) : null}
        </div>
      ) : null}

      {result?.connection.kind === 'instruction_failed' && !authorizationLost ? (
        <section className="mt-5 min-w-0 rounded-[14px] border bg-gray-50 p-4">
          <p role="alert" className="text-sm text-red-700">
            {t('collaboration.agentPreparation.instructionFailed')}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRetryInstruction()}
            className="mt-3 min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
          >
            {t('collaboration.agentPreparation.retryInstruction')}
          </button>
        </section>
      ) : null}

      {waitingConnection ? (
        <section className="mt-5 min-w-0 rounded-[14px] border bg-gray-50 p-4">
          <p role="status" className="text-sm font-medium text-gray-900">
            {t('collaboration.agentPreparation.waiting')}
          </p>
          <p className={`mt-1 text-sm ${expired ? 'text-red-700' : 'text-gray-500'}`}>
            {expired
              ? t('collaboration.agentPreparation.expired')
              : t('agent.localSync.expiresIn', { remaining })}
          </p>
          <pre className="mt-3 max-h-52 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border bg-white p-3 text-xs [overflow-wrap:anywhere]">
            {waitingConnection.installation.instructions}
          </pre>
          <div className="mt-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={busy || expired}
              onClick={() => void handleCopy()}
              className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {copied
                ? t('collaboration.agentPreparation.copied')
                : t('collaboration.agentPreparation.copy')}
            </button>
            {expired ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRetryInstruction()}
                className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
              >
                {t('collaboration.agentPreparation.retryInstruction')}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCheckNow()}
                className="min-h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:opacity-50 sm:w-auto"
              >
                {t('collaboration.agentPreparation.checkNow')}
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void completeSelection({
                agentId: pollingAgentId,
                agentName: pollingAgentName,
                connection: 'pending',
              }, false)}
              className="min-h-10 w-full rounded-lg bg-blue-600 px-3 text-sm font-medium text-white disabled:opacity-50 sm:w-auto"
            >
              {t('collaboration.agentPreparation.connectLater')}
            </button>
          </div>
        </section>
      ) : null}

      {result?.connection.kind === 'connected' ? (
        <p role="status" className="mt-5 rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800">
          {t('collaboration.agentPreparation.connected')}
        </p>
      ) : null}
    </ModalDialog>
  );
};
