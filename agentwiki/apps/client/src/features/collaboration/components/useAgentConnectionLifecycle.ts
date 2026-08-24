import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agentPreparationApi,
  apiResponseStatus,
  hasActiveSpaceCredential,
  type AgentInstallation,
} from '../agentPreparationApi';
import type { PreparedAgent } from '../prepareAgent';
import {
  isCurrentLifecycle,
  type AgentPreparationLifecycleRef,
} from './useOwnedAgents';

interface PreparedSelection {
  agentId: string;
  agentName: string;
  connection: 'connected' | 'pending';
}

interface ResultState {
  prepared: PreparedAgent;
  lifecycleEpoch: number;
  installationGeneration: number;
}

interface InstructionSnapshot {
  agentId: string;
  agentName: string;
  expiresAt: string;
  installationId: string;
  installationGeneration: number;
  instructions: string;
  lifecycleEpoch: number;
  spaceId: string;
}

interface GenerationLock {
  generation: number;
  token: symbol;
}

interface CompletionLock {
  key: string;
  lifecycleEpoch: number;
  token: symbol;
}

interface LatestCallbacks {
  onAuthorizationLost: () => Promise<void>;
  onClose: () => void;
  onPrepared: (selection: PreparedSelection) => Promise<void>;
}

const checkingErrorKey = 'collaboration.agentPreparation.error.checking_connection';
const refreshErrorKey = 'collaboration.agentPreparation.refreshFailed';

export const useAgentConnectionLifecycle = ({
  lifecycleRef,
  onAuthorizationLost,
  onClose,
  onPrepared,
  spaceId,
  targetId,
}: LatestCallbacks & {
  lifecycleRef: AgentPreparationLifecycleRef;
  spaceId: string;
  targetId: string;
}) => {
  const [resultState, setResultState] = useState<ResultState | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [authorizationLost, setAuthorizationLost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const stableLifecycleRef = useRef(lifecycleRef).current;
  const callbacksRef = useRef<LatestCallbacks>({ onAuthorizationLost, onClose, onPrepared });
  callbacksRef.current = { onAuthorizationLost, onClose, onPrepared };
  const resultRef = useRef<ResultState | null>(null);
  const instructionGenerationRef = useRef(0);
  const instructionRef = useRef<InstructionSnapshot | null>(null);
  const checkLockRef = useRef<GenerationLock | null>(null);
  const completionLockRef = useRef<CompletionLock | null>(null);
  const completedSelectionRef = useRef<{ key: string; lifecycleEpoch: number } | null>(null);
  const busyTokensRef = useRef<Set<symbol>>(new Set());

  const beginBusy = useCallback(() => {
    const token = Symbol('connection-operation');
    busyTokensRef.current.add(token);
    setBusy(true);
    return token;
  }, []);

  const endBusy = useCallback((token: symbol) => {
    if (!busyTokensRef.current.delete(token)) return;
    setBusy(busyTokensRef.current.size > 0);
  }, []);

  const instructionIsCurrent = useCallback((snapshot: InstructionSnapshot) => {
    const current = instructionRef.current;
    return isCurrentLifecycle(stableLifecycleRef, snapshot.lifecycleEpoch)
      && current?.lifecycleEpoch === snapshot.lifecycleEpoch
      && current.installationGeneration === snapshot.installationGeneration
      && current.installationId === snapshot.installationId
      && current.spaceId === snapshot.spaceId;
  }, []);

  const instructionIsCurrentAndUnexpired = useCallback((
    snapshot: InstructionSnapshot,
    checkedAt: number,
  ) => {
    const expiresAt = Date.parse(snapshot.expiresAt);
    return instructionIsCurrent(snapshot)
      && Number.isFinite(expiresAt)
      && expiresAt > checkedAt;
  }, [instructionIsCurrent]);

  const loseAuthorization = useCallback(async () => {
    const lifecycleEpoch = stableLifecycleRef.current.epoch;
    if (!isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)) return;
    instructionGenerationRef.current += 1;
    instructionRef.current = null;
    checkLockRef.current = null;
    completionLockRef.current = null;
    completedSelectionRef.current = null;
    resultRef.current = null;
    setResultState(null);
    setAuthorizationLost(true);
    setErrorKey(null);
    const busyToken = beginBusy();
    try {
      await callbacksRef.current.onAuthorizationLost();
    } catch {
      // Keep the safe owner-required state and never expose parent errors.
    } finally {
      endBusy(busyToken);
    }
  }, [beginBusy, endBusy]);

  const completeSelection = useCallback(async (
    selection: PreparedSelection,
    lifecycleEpoch: number,
    markConnected: boolean,
  ) => {
    if (!isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)) return;
    const key = `${lifecycleEpoch}:${selection.agentId}`;
    if (completedSelectionRef.current?.lifecycleEpoch === lifecycleEpoch
      && completedSelectionRef.current.key === key) return;
    if (completionLockRef.current?.lifecycleEpoch === lifecycleEpoch
      && completionLockRef.current.key === key) return;

    const completionToken = Symbol('agent-completion');
    completionLockRef.current = { key, lifecycleEpoch, token: completionToken };
    if (markConnected) {
      const current = resultRef.current;
      if (current?.lifecycleEpoch === lifecycleEpoch
        && current.prepared.agentId === selection.agentId) {
        const connectedState: ResultState = {
          ...current,
          prepared: { ...current.prepared, connection: { kind: 'connected' } },
        };
        resultRef.current = connectedState;
        instructionRef.current = null;
        checkLockRef.current = null;
        setResultState(connectedState);
      }
    }

    const busyToken = beginBusy();
    setErrorKey(null);
    let completed = false;
    try {
      await callbacksRef.current.onPrepared(selection);
      if (isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)
        && completionLockRef.current?.token === completionToken) {
        completedSelectionRef.current = { key, lifecycleEpoch };
        completed = true;
        if (selection.connection === 'pending') {
          instructionGenerationRef.current += 1;
          instructionRef.current = null;
          checkLockRef.current = null;
          resultRef.current = null;
          setResultState(null);
        }
        callbacksRef.current.onClose();
      }
    } catch (error) {
      if (isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)
        && completionLockRef.current?.token === completionToken) {
        if (apiResponseStatus(error) === 403) {
          await loseAuthorization();
        } else {
          setErrorKey(refreshErrorKey);
        }
      }
    } finally {
      if (completionLockRef.current?.token === completionToken) {
        completionLockRef.current = null;
      }
      if (!completed || isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)) {
        endBusy(busyToken);
      }
    }
  }, [beginBusy, endBusy, loseAuthorization]);

  const setWaitingResult = useCallback((
    prepared: PreparedAgent,
    installation: AgentInstallation,
    lifecycleEpoch: number,
    installationGeneration: number,
  ) => {
    const nextPrepared: PreparedAgent = {
      ...prepared,
      connection: { kind: 'waiting', installation },
    };
    const nextState = { prepared: nextPrepared, lifecycleEpoch, installationGeneration };
    resultRef.current = nextState;
    instructionRef.current = {
      agentId: prepared.agentId,
      agentName: prepared.agentName,
      expiresAt: installation.expiresAt,
      installationGeneration,
      installationId: installation.installationId,
      instructions: installation.instructions,
      lifecycleEpoch,
      spaceId,
    };
    setNow(Date.now());
    setCopied(false);
    setErrorKey(null);
    setResultState(nextState);
  }, [spaceId]);

  const acceptPrepared = useCallback(async (prepared: PreparedAgent) => {
    const lifecycleEpoch = stableLifecycleRef.current.epoch;
    if (!isCurrentLifecycle(stableLifecycleRef, lifecycleEpoch)) return;
    const installationGeneration = instructionGenerationRef.current + 1;
    instructionGenerationRef.current = installationGeneration;
    instructionRef.current = null;
    checkLockRef.current = null;
    setCopied(false);
    setErrorKey(null);

    if (prepared.connection.kind === 'instruction_failed' && prepared.connection.status === 403) {
      await loseAuthorization();
      return;
    }

    const nextState = { prepared, lifecycleEpoch, installationGeneration };
    resultRef.current = nextState;
    setResultState(nextState);
    if (prepared.connection.kind === 'waiting') {
      setWaitingResult(
        prepared,
        prepared.connection.installation,
        lifecycleEpoch,
        installationGeneration,
      );
    } else if (prepared.connection.kind === 'connected') {
      await completeSelection({
        agentId: prepared.agentId,
        agentName: prepared.agentName,
        connection: 'connected',
      }, lifecycleEpoch, true);
    }
  }, [completeSelection, loseAuthorization, setWaitingResult]);

  const reset = useCallback(() => {
    instructionGenerationRef.current += 1;
    instructionRef.current = null;
    checkLockRef.current = null;
    completionLockRef.current = null;
    completedSelectionRef.current = null;
    resultRef.current = null;
    setResultState(null);
    setCopied(false);
    setErrorKey(null);
  }, []);

  const retryInstruction = useCallback(async () => {
    const current = resultRef.current;
    if (!current || !isCurrentLifecycle(stableLifecycleRef, current.lifecycleEpoch)) return;
    const requestGeneration = instructionGenerationRef.current + 1;
    instructionGenerationRef.current = requestGeneration;
    instructionRef.current = null;
    checkLockRef.current = null;
    setCopied(false);
    setErrorKey(null);
    const busyToken = beginBusy();
    try {
      const installation = await agentPreparationApi.createInstallation(
        current.prepared.agentId,
        spaceId,
        current.prepared.role,
      );
      if (!isCurrentLifecycle(stableLifecycleRef, current.lifecycleEpoch)
        || instructionGenerationRef.current !== requestGeneration) return;
      setWaitingResult(
        current.prepared,
        installation,
        current.lifecycleEpoch,
        requestGeneration,
      );
    } catch (error) {
      if (!isCurrentLifecycle(stableLifecycleRef, current.lifecycleEpoch)
        || instructionGenerationRef.current !== requestGeneration) return;
      if (apiResponseStatus(error) === 403) {
        await loseAuthorization();
        return;
      }
      const failedState: ResultState = {
        ...current,
        installationGeneration: requestGeneration,
        prepared: { ...current.prepared, connection: { kind: 'instruction_failed' } },
      };
      resultRef.current = failedState;
      setResultState(failedState);
    } finally {
      endBusy(busyToken);
    }
  }, [beginBusy, endBusy, loseAuthorization, setWaitingResult, spaceId]);

  const runCheck = useCallback(async (snapshot: InstructionSnapshot, manual: boolean) => {
    const checkedAt = Date.now();
    if (!instructionIsCurrentAndUnexpired(snapshot, checkedAt)) {
      if (instructionIsCurrent(snapshot)) setNow(checkedAt);
      return;
    }
    if (checkLockRef.current?.generation === snapshot.installationGeneration) return;
    const checkToken = Symbol('connection-check');
    checkLockRef.current = { generation: snapshot.installationGeneration, token: checkToken };
    const busyToken = manual ? beginBusy() : null;
    if (manual) setErrorKey(null);
    try {
      const detail = await agentPreparationApi.getAgent(snapshot.agentId);
      const settledAt = Date.now();
      if (!instructionIsCurrentAndUnexpired(snapshot, settledAt)) {
        if (instructionIsCurrent(snapshot)) setNow(settledAt);
        return;
      }
      setErrorKey((current) => current === checkingErrorKey ? null : current);
      if (hasActiveSpaceCredential(detail, snapshot.spaceId)) {
        await completeSelection({
          agentId: snapshot.agentId,
          agentName: snapshot.agentName,
          connection: 'connected',
        }, snapshot.lifecycleEpoch, true);
      }
    } catch (error) {
      const settledAt = Date.now();
      if (!instructionIsCurrent(snapshot)) return;
      if (apiResponseStatus(error) === 403) {
        await loseAuthorization();
        return;
      }
      if (!instructionIsCurrentAndUnexpired(snapshot, settledAt)) {
        setNow(settledAt);
        return;
      }
      setErrorKey(checkingErrorKey);
    } finally {
      if (checkLockRef.current?.token === checkToken) checkLockRef.current = null;
      if (busyToken) endBusy(busyToken);
    }
  }, [
    beginBusy,
    completeSelection,
    endBusy,
    instructionIsCurrent,
    instructionIsCurrentAndUnexpired,
    loseAuthorization,
  ]);

  const checkNow = useCallback(async () => {
    const snapshot = instructionRef.current;
    if (snapshot) await runCheck(snapshot, true);
  }, [runCheck]);

  const copyInstruction = useCallback(async () => {
    const snapshot = instructionRef.current;
    if (!snapshot || !instructionIsCurrent(snapshot)) return;
    const copiedAt = Date.now();
    const expiresAt = Date.parse(snapshot.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= copiedAt) {
      if (instructionIsCurrent(snapshot)) setNow(copiedAt);
      return;
    }
    try {
      await navigator.clipboard.writeText(snapshot.instructions);
      const settledAt = Date.now();
      if (!instructionIsCurrentAndUnexpired(snapshot, settledAt)) {
        if (instructionIsCurrent(snapshot)) setNow(settledAt);
        return;
      }
      setCopied(true);
      setErrorKey(null);
    } catch {
      const settledAt = Date.now();
      if (!instructionIsCurrentAndUnexpired(snapshot, settledAt)) {
        if (instructionIsCurrent(snapshot)) setNow(settledAt);
        return;
      }
      setCopied(false);
      setErrorKey('collaboration.agentPreparation.copyFailed');
    }
  }, [instructionIsCurrent, instructionIsCurrentAndUnexpired]);

  const connectLater = useCallback(async () => {
    const current = resultRef.current;
    if (!current || !isCurrentLifecycle(stableLifecycleRef, current.lifecycleEpoch)) return;
    await completeSelection({
      agentId: current.prepared.agentId,
      agentName: current.prepared.agentName,
      connection: 'pending',
    }, current.lifecycleEpoch, false);
  }, [completeSelection]);

  const retryCompletion = useCallback(async () => {
    const current = resultRef.current;
    if (!current || current.prepared.connection.kind !== 'connected') return;
    await completeSelection({
      agentId: current.prepared.agentId,
      agentName: current.prepared.agentName,
      connection: 'connected',
    }, current.lifecycleEpoch, true);
  }, [completeSelection]);

  useEffect(() => {
    instructionGenerationRef.current += 1;
    instructionRef.current = null;
    checkLockRef.current = null;
    completionLockRef.current = null;
    completedSelectionRef.current = null;
    busyTokensRef.current = new Set();
    resultRef.current = null;
    setResultState(null);
    setBusy(false);
    setErrorKey(null);
    setAuthorizationLost(false);
    setCopied(false);

    return () => {
      instructionGenerationRef.current += 1;
      instructionRef.current = null;
      checkLockRef.current = null;
      completionLockRef.current = null;
      completedSelectionRef.current = null;
      busyTokensRef.current = new Set();
      resultRef.current = null;
    };
  }, [spaceId, targetId]);

  const result = resultState?.prepared ?? null;
  const waiting = result?.connection.kind === 'waiting' ? result.connection.installation : null;
  const waitingInstallationId = waiting?.installationId ?? '';
  const waitingExpiresAt = waiting?.expiresAt ?? '';
  const expiryTimestamp = waitingExpiresAt ? Date.parse(waitingExpiresAt) : Number.NaN;
  const remainingSeconds = Number.isFinite(expiryTimestamp)
    ? Math.max(0, Math.ceil((expiryTimestamp - now) / 1_000))
    : 0;
  const expired = waiting !== null && remainingSeconds === 0;

  useEffect(() => {
    if (!waitingInstallationId || expired) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [expired, waitingExpiresAt, waitingInstallationId]);

  const pollAgentId = waiting ? result?.agentId ?? '' : '';
  const pollAgentName = waiting ? result?.agentName ?? '' : '';
  const pollGeneration = resultState?.installationGeneration ?? 0;
  const pollLifecycleEpoch = resultState?.lifecycleEpoch ?? 0;

  useEffect(() => {
    if (!pollAgentId || !waitingInstallationId || expired || authorizationLost) return;
    const snapshot: InstructionSnapshot = {
      agentId: pollAgentId,
      agentName: pollAgentName,
      expiresAt: waitingExpiresAt,
      installationGeneration: pollGeneration,
      installationId: waitingInstallationId,
      instructions: waiting?.instructions ?? '',
      lifecycleEpoch: pollLifecycleEpoch,
      spaceId,
    };
    const interval = window.setInterval(() => void runCheck(snapshot, false), 2_000);
    return () => window.clearInterval(interval);
  }, [
    authorizationLost,
    expired,
    pollAgentId,
    pollAgentName,
    pollGeneration,
    pollLifecycleEpoch,
    runCheck,
    spaceId,
    waiting?.instructions,
    waitingExpiresAt,
    waitingInstallationId,
  ]);

  const remaining = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;

  return {
    acceptPrepared,
    authorizationLost,
    busy,
    checkNow,
    connectLater,
    copied,
    copyInstruction,
    errorKey,
    expired,
    loseAuthorization,
    remaining,
    reset,
    result,
    retryCompletion,
    retryInstruction,
  };
};
