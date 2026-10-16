import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollaborationInputValuesSchema } from '@neomei/agentwiki-sync-protocol';
import { ArrowLeft, CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { Toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { runStartText } from './runStartText';
import { collaborationApi } from './api';
import { AgentPreparationDialog, type PreparedAgentSelection } from './components/AgentPreparationDialog';
import { RoleBindingEditor } from './components/RoleBindingEditor';
import type {
  AgentInstruction,
  CollaborationRun,
  RoleBinding,
  SpaceMemberSummary,
  TemplateDetail,
} from './types';
import { buildAgentJoinInstructions } from './agentJoinInstructions';
import { runSystemTemplateText, systemTemplateText } from './systemTemplateText';
import './run-start-wizard.css';

export { buildAgentJoinInstructions } from './agentJoinInstructions';

type Step = 1 | 2 | 3;
type RetryAction = 'input' | 'mapping' | 'start' | null;
type Translate = (key: string, params?: Record<string, string | number>) => string;
const PENDING_CONNECTION_REFRESH_MS = 3_000;

interface PreparationTarget {
  id: string;
  name: string;
  token: number;
}

interface PreparedConnection {
  agentId: string;
  agentName: string;
  connection: 'connected' | 'pending';
}

type PreparedConnectionsByAgent = Record<string, PreparedConnection>;

interface MappingState {
  bindings: RoleBinding[];
  preparedConnections: PreparedConnectionsByAgent;
}

interface PreparedMappingTarget {
  roleSlotId: string;
  roleSlotName: string;
  agentId: string;
  agentName: string;
  connection: PreparedConnection['connection'];
}

function hasRepeatedAgentBindings(bindings: RoleBinding[]): boolean {
  const counts = new Map<string, number>();
  for (const binding of bindings) counts.set(binding.agentId, (counts.get(binding.agentId) ?? 0) + 1);
  return [...counts.values()].some((count) => count > 1);
}

function sameBindings(left: RoleBinding[], right: RoleBinding[]): boolean {
  if (left.length !== right.length) return false;
  const rightBySlot = new Map(right.map((binding) => [binding.roleSlotId, binding.agentId]));
  return left.every((binding) => rightBySlot.get(binding.roleSlotId) === binding.agentId);
}

export const RunStartWizard: React.FC = () => {
  const { id = '', templateId = '' } = useParams<{ id: string; templateId: string }>();
  const { t: sharedT, language } = useLanguage();
  const t = useCallback((key: string, params?: Record<string, string | number>) =>
    runStartText(language, key, params) ?? sharedT(key, params), [language, sharedT]);
  const { user } = useAuth();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [members, setMembers] = useState<SpaceMemberSummary[]>([]);
  const [agents, setAgents] = useState<SpaceMemberSummary[]>([]);
  const [run, setRun] = useState<CollaborationRun | null>(null);
  const [started, setStarted] = useState<CollaborationRun | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [runName, setRunName] = useState('');
  const [runNameError, setRunNameError] = useState(false);
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [newRunSequence, setNewRunSequence] = useState(0);
  const runNameRef = useRef<HTMLInputElement>(null);
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [mappingState, setMappingState] = useState<MappingState>(() => emptyMappingState());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [selfReviewAcknowledged, setSelfReviewAcknowledged] = useState(false);
  const [preparationTarget, setPreparationTarget] = useState<PreparationTarget | null>(null);
  const [preparationAuthorizationInvalidated, setPreparationAuthorizationInvalidated] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const idempotencyKey = useMemo(() => `start-${safeUuid()}`, [id, templateId, user?.id, newRunSequence]);
  const initializeRequest = useRef(0);
  const restoreLegacyPointer = useRef(true);
  const mutationEpoch = useRef(0);
  const memberRefreshRequest = useRef(0);
  const authoritativeMemberRefresh = useRef<{ epoch: number; request: number | null }>({
    epoch: 0,
    request: null,
  });
  const agentsRef = useRef(agents);
  const preparationSequence = useRef(0);
  const preparationTargetRef = useRef<PreparationTarget | null>(null);
  const routeIdentityRef = useRef({ id, templateId });
  const mappingStateRef = useRef(mappingState);
  const stepRef = useRef(step);
  const mappingFocusFallbackRef = useRef<HTMLHeadingElement>(null);
  preparationTargetRef.current = preparationTarget;
  routeIdentityRef.current = { id, templateId };
  mappingStateRef.current = mappingState;
  stepRef.current = step;
  agentsRef.current = agents;
  const legacyStorageKey = `agentwiki.collaboration.draft.${id}.${templateId}`;
  const storageKey = `${legacyStorageKey}.${user?.id ?? 'anonymous'}`;
  const { bindings, preparedConnections } = mappingState;
  const pendingConnectionKey = useMemo(() => {
    const boundAgentIds = new Set(bindings.map((binding) => binding.agentId));
    return Object.values(preparedConnections)
      .filter((connection) => connection.connection === 'pending' && boundAgentIds.has(connection.agentId))
      .map((connection) => connection.agentId)
      .sort()
      .join('|');
  }, [bindings, preparedConnections]);

  const myRole = members.find((member) => member.type === 'human' && member.userId === user?.id)?.role;
  const canPrepareAgents = myRole === 'owner' || myRole === 'admin';
  const preparationActionsAvailable = canPrepareAgents && !preparationAuthorizationInvalidated;

  useEffect(() => {
    initializeRequest.current += 1;
    restoreLegacyPointer.current = true;
    mutationEpoch.current += 1;
    authoritativeMemberRefresh.current = { epoch: mutationEpoch.current, request: null };
    memberRefreshRequest.current += 1;
    setTemplate(null);
    setMembers([]);
    setAgents([]);
    agentsRef.current = [];
    setRun(null);
    setStarted(null);
    setStep(1);
    setRunName('');
    setRunNameError(false);
    setInputErrors({});
    setRestoreFailed(false);
    setInputValues({});
    setMappingState(emptyMappingState());
    setLoading(true);
    setSubmitting(false);
    setRetryAction(null);
    setSelfReviewAcknowledged(false);
    setPreparationTarget(null);
    setPreparationAuthorizationInvalidated(false);
    setToast(null);
  }, [id, templateId, user?.id]);

  const validatedInputs = () => {
    if (!template || restoreFailed) return null;
    const missingName = !runName.trim();
    const errors: Record<string, string> = Object.create(null);
    const normalized: Record<string, string | number | boolean> = {};
    for (const input of template.definition.inputs) {
      // An untouched required checkbox represents false, not missing input.
      const value = inputValues[input.key] ?? (input.type === 'boolean' && input.required ? false : undefined);
      if (input.required && (value === undefined || (typeof value === 'string' && !value.trim()))) {
        errors[input.key] = 'collaboration.wizard.inputRequired';
      } else if (value !== undefined && value !== '') {
        normalized[input.key] = value;
      }
    }
    setRunNameError(missingName);
    setInputErrors(errors);
    if (missingName || Object.keys(errors).length > 0) {
      setToast(null);
      if (missingName) runNameRef.current?.focus();
      else {
        const firstInvalidInput = template.definition.inputs.find((input) => errors[input.key]);
        if (firstInvalidInput) inputRefs.current[firstInvalidInput.key]?.focus();
      }
      return null;
    }
    const parsed = CollaborationInputValuesSchema.safeParse(normalized);
    if (!parsed.success) {
      setToast({ kind: 'error', message: t('collaboration.wizard.invalidInputs') });
      return null;
    }
    return parsed.data;
  };

  const beginNewRun = () => {
    initializeRequest.current += 1;
    mutationEpoch.current += 1;
    memberRefreshRequest.current += 1;
    authoritativeMemberRefresh.current = { epoch: mutationEpoch.current, request: null };
    localStorage.removeItem(storageKey);
    // An unadopted legacy pointer may belong to another account. Preserve it,
    // but do not restore it into this explicitly fresh wizard on reinitialization.
    restoreLegacyPointer.current = false;
    // Detach the local pointer only. The server draft and its audit history remain intact.
    setRun(null);
    setStarted(null);
    setStep(1);
    setRunName('');
    setRunNameError(false);
    setInputErrors({});
    setRestoreFailed(false);
    setInputValues({});
    setMappingState(emptyMappingState());
    setRetryAction(null);
    setSelfReviewAcknowledged(false);
    setPreparationTarget(null);
    setToast(null);
    setNewRunSequence((current) => current + 1);
    window.requestAnimationFrame(() => runNameRef.current?.focus());
  };

  const validatedBindings = () => {
    if (!template) return null;
    const currentBindings = mappingStateRef.current.bindings;
    if (template.definition.roleSlots.some((slot) => slot.required && !currentBindings.some((binding) => binding.roleSlotId === slot.id))) {
      setToast({ kind: 'error', message: t('collaboration.wizard.requiredBindings') });
      return null;
    }
    return currentBindings.map(({ roleSlotId, agentId }) => ({ roleSlotId, agentId }));
  };

  const initialize = useCallback(async () => {
    if (!id || !templateId) return;
    const request = ++initializeRequest.current;
    setLoading(true);
    setToast(null);
    // Keep a failed restore blocked until the full retry succeeds.
    try {
      const [nextTemplate, nextMembers] = await Promise.all([
        collaborationApi.getTemplate(id, templateId),
        collaborationApi.listMembers(id),
      ]);
      if (initializeRequest.current !== request) return;
      const executable = nextMembers.filter(isExecutableAgent);
      setTemplate(nextTemplate);
      setMembers(nextMembers);
      setAgents(executable);
      agentsRef.current = executable;
      const scopedRunId = localStorage.getItem(storageKey);
      const storedRunId = scopedRunId ?? (restoreLegacyPointer.current ? localStorage.getItem(legacyStorageKey) : null);
      if (storedRunId) {
        try {
          const existing = await loadEditableRun(id, storedRunId);
          if (initializeRequest.current !== request) return;
          setRestoreFailed(false);
          // Legacy pointers were shared across accounts. Only adopt the original starter's run.
          if ((!scopedRunId && existing.startedById && existing.startedById !== user?.id)
            || (existing.templateId && existing.templateId !== templateId)) return;
          localStorage.setItem(storageKey, existing.id);
          if (!scopedRunId && localStorage.getItem(legacyStorageKey) === storedRunId) localStorage.removeItem(legacyStorageKey);
          const restoredMapping = reconcileConnectionFacts(
            convergeAuthoritativeMapping(
              { bindings: existing.roleBindings, preparedConnections: {} },
              new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : [])),
            ),
            executable,
          );
          const editable = ['draft', 'ready'].includes(existing.status);
          const restoredRun = editable ? { ...existing, roleBindings: restoredMapping.bindings } : existing;
          const removedBinding = restoredMapping.bindings.length !== existing.roleBindings.length;
          setRun(restoredRun);
          setRunName(existing.name);
          setInputValues(existing.inputs ?? {});
          setMappingState(restoredMapping);
          if (!editable) setStarted(existing);
          else if (removedBinding) {
            setStep(2);
            setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
          } else if (existing.status === 'ready') setStep(3);
          else setStep(2);
        } catch {
          if (initializeRequest.current !== request) return;
          // A network/authorization failure must not erase a recoverable draft pointer.
          setRestoreFailed(true);
        }
      } else {
        setRestoreFailed(false);
      }
    } catch {
      if (initializeRequest.current !== request) return;
      setToast({ kind: 'error', message: t('collaboration.wizard.loadFailed') });
    } finally {
      if (initializeRequest.current === request) setLoading(false);
    }
  }, [id, legacyStorageKey, storageKey, t, templateId, user?.id]);

  useEffect(() => { void initialize(); }, [initialize]);

  const loadAuthoritativeMembers = async (spaceId: string) => {
    const request = ++memberRefreshRequest.current;
    const epoch = mutationEpoch.current;
    authoritativeMemberRefresh.current = { epoch, request };
    try {
      return { members: await collaborationApi.listMembers(spaceId), request };
    } finally {
      if (authoritativeMemberRefresh.current.epoch === epoch
        && authoritativeMemberRefresh.current.request === request) {
        authoritativeMemberRefresh.current.request = null;
      }
    }
  };

  useEffect(() => {
    if (!id || loading || !pendingConnectionKey || started) return;
    const epoch = mutationEpoch.current;
    const route = { id, templateId };
    let disposed = false;
    let timer: number | undefined;

    const refresh = async () => {
      if (authoritativeMemberRefresh.current.epoch === epoch
        && authoritativeMemberRefresh.current.request !== null) {
        if (!disposed) timer = window.setTimeout(refresh, PENDING_CONNECTION_REFRESH_MS);
        return;
      }
      const refreshRequest = ++memberRefreshRequest.current;
      try {
        const nextMembers = await collaborationApi.listMembers(route.id);
        const currentRoute = routeIdentityRef.current;
        if (disposed
          || mutationEpoch.current !== epoch
          || currentRoute.id !== route.id
          || currentRoute.templateId !== route.templateId) return;
        if (memberRefreshRequest.current === refreshRequest) {
          const executable = nextMembers.filter(isExecutableAgent);
          const executableIds = new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : []));
          const currentMapping = mappingStateRef.current;
          const converged = reconcileConnectionFacts(
            convergeAuthoritativeMapping(currentMapping, executableIds),
            executable,
          );
          const removedBinding = converged.bindings.length !== currentMapping.bindings.length;
          setMembers(nextMembers);
          setAgents(executable);
          agentsRef.current = executable;
          setMappingState(converged);
          if (removedBinding && stepRef.current === 3) {
            setRun((current) => current ? { ...current, roleBindings: converged.bindings } : current);
            setSelfReviewAcknowledged(false);
            setStep(2);
            setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
          }
        }
      } catch {
        // A transient refresh failure keeps the last visible warning and retries.
      }
      if (!disposed) timer = window.setTimeout(refresh, PENDING_CONNECTION_REFRESH_MS);
    };

    timer = window.setTimeout(refresh, PENDING_CONNECTION_REFRESH_MS);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, loading, pendingConnectionKey, started, t, templateId]);

  const isCurrentPreparation = (
    targetToken: number,
    epoch: number,
    route: { id: string; templateId: string },
  ) => {
    const currentRoute = routeIdentityRef.current;
    return mutationEpoch.current === epoch
      && currentRoute.id === route.id
      && currentRoute.templateId === route.templateId
      && preparationTargetRef.current?.token === targetToken;
  };

  const openPreparation = (roleSlotId: string) => {
    if (!preparationActionsAvailable || !template) return;
    const slot = template.definition.roleSlots.find((candidate) => candidate.id === roleSlotId);
    if (!slot) return;
    setPreparationTarget({ id: slot.id, name: slot.name, token: ++preparationSequence.current });
  };

  const closePreparation = (targetToken: number) => {
    setPreparationTarget((current) => current?.token === targetToken ? null : current);
  };

  const handleBindingsChange = (nextBindings: RoleBinding[]) => {
    setMappingState((current) => reconcileConnectionFacts(
      replaceBindings(current, nextBindings),
      agentsRef.current,
    ));
    setSelfReviewAcknowledged(false);
  };

  const handlePrepared = async (
    targetToken: number,
    route: { id: string; templateId: string },
    prepared: PreparedAgentSelection,
  ) => {
    const epoch = mutationEpoch.current;
    const target = preparationTargetRef.current;
    if (!target || target.token !== targetToken || !isCurrentPreparation(targetToken, epoch, route)) return;

    let nextMembers: SpaceMemberSummary[];
    let memberRequest: number;
    try {
      const refreshed = await loadAuthoritativeMembers(route.id);
      nextMembers = refreshed.members;
      memberRequest = refreshed.request;
    } catch (error) {
      if (!isCurrentPreparation(targetToken, epoch, route)) return;
      throw error;
    }
    if (!isCurrentPreparation(targetToken, epoch, route)
      || memberRefreshRequest.current !== memberRequest) return;

    const executable = nextMembers.filter(isExecutableAgent);
    const executableIds = new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : []));
    const authoritativeAgent = executable.find((member) => member.agentId === prepared.agentId);
    setMembers(nextMembers);
    setAgents(executable);
    agentsRef.current = executable;
    if (!authoritativeAgent) {
      setMappingState((current) => reconcileConnectionFacts(
        convergeAuthoritativeMapping(current, executableIds),
        executable,
      ));
      throw new Error(t('collaboration.agentPreparation.refreshFailed'));
    }

    setMappingState((current) => reconcileConnectionFacts(
      convergeAuthoritativeMapping(current, executableIds, {
        roleSlotId: target.id,
        roleSlotName: target.name,
        agentId: prepared.agentId,
        agentName: authoritativeAgent.agent?.name ?? prepared.agentName,
        connection: prepared.connection,
      }),
      executable,
    ));
    setSelfReviewAcknowledged(false);
    setPreparationTarget((current) => current?.token === targetToken ? null : current);
  };

  const handlePreparationAuthorizationLost = async (
    targetToken: number,
    route: { id: string; templateId: string },
  ) => {
    const epoch = mutationEpoch.current;
    if (!isCurrentPreparation(targetToken, epoch, route)) return;
    setPreparationAuthorizationInvalidated(true);
    setPreparationTarget((current) => current?.token === targetToken ? null : current);
    try {
      const refreshed = await loadAuthoritativeMembers(route.id);
      const nextMembers = refreshed.members;
      const currentRoute = routeIdentityRef.current;
      if (mutationEpoch.current !== epoch
        || currentRoute.id !== route.id
        || currentRoute.templateId !== route.templateId
        || preparationSequence.current !== targetToken
        || memberRefreshRequest.current !== refreshed.request) return;
      setMembers(nextMembers);
      const executable = nextMembers.filter(isExecutableAgent);
      setAgents(executable);
      agentsRef.current = executable;
      setMappingState((current) => reconcileConnectionFacts(
        convergeAuthoritativeMapping(
          current,
          new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : [])),
        ),
        executable,
      ));
    } catch {
      // The preparation entry remains fail-closed for this wizard epoch.
    }
  };

  const completeInputs = async (currentRun: CollaborationRun | null = run) => {
    const inputs = validatedInputs();
    if (!inputs) return;
    const epoch = mutationEpoch.current;
    setSubmitting(true);
    try {
      const draft = currentRun && ['draft', 'ready'].includes(currentRun.status)
        ? await collaborationApi.updateRunDraft(id, currentRun.id, { expectedVersion: currentRun.version, name: runName.trim(), inputs })
        : await collaborationApi.createRunDraft(id, { templateId, name: runName.trim(), inputs, roleBindings: [] });
      if (mutationEpoch.current !== epoch) return;
      setRun(draft);
      localStorage.setItem(storageKey, draft.id);
      setRetryAction(null);
      setStep(2);
    } catch (error) {
      await handleMutationError(error, 'input', epoch);
    } finally {
      if (mutationEpoch.current === epoch) setSubmitting(false);
    }
  };

  const completeMapping = async (currentRun: CollaborationRun | null = run) => {
    if (!template || !currentRun) return;
    const roleBindings = validatedBindings();
    if (!roleBindings) return;
    const epoch = mutationEpoch.current;
    setSubmitting(true);
    try {
      const updated = await collaborationApi.updateRunDraft(id, currentRun.id, { expectedVersion: currentRun.version, roleBindings });
      if (mutationEpoch.current !== epoch) return;
      const currentBindings = mappingStateRef.current.bindings;
      if (!sameBindings(roleBindings, currentBindings)) {
        setRun({ ...updated, roleBindings: currentBindings });
        setRetryAction(null);
        setSelfReviewAcknowledged(false);
        setStep(2);
        setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
        return;
      }
      const ready = await collaborationApi.validateRunDraft(id, currentRun.id, updated.version);
      if (mutationEpoch.current !== epoch) return;
      const executableIds = new Set(agentsRef.current.flatMap((member) => member.agentId ? [member.agentId] : []));
      const converged = reconcileConnectionFacts(
        convergeAuthoritativeMapping(
          replaceBindings(mappingStateRef.current, ready.roleBindings),
          executableIds,
        ),
        agentsRef.current,
      );
      const currentReady = { ...ready, roleBindings: converged.bindings };
      setRun(currentReady);
      setMappingState(converged);
      setRetryAction(null);
      if (converged.bindings.length !== ready.roleBindings.length) {
        setSelfReviewAcknowledged(false);
        setStep(2);
        setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
        return;
      }
      setStep(3);
    } catch (error) {
      await handleMutationError(error, 'mapping', epoch);
    } finally {
      if (mutationEpoch.current === epoch) setSubmitting(false);
    }
  };

  const start = async (currentRun: CollaborationRun | null = run) => {
    if (!currentRun) return;
    const executableIds = new Set(agentsRef.current.flatMap((member) => member.agentId ? [member.agentId] : []));
    const converged = reconcileConnectionFacts(
      convergeAuthoritativeMapping(
        replaceBindings(mappingStateRef.current, currentRun.roleBindings),
        executableIds,
      ),
      agentsRef.current,
    );
    if (converged.bindings.length !== currentRun.roleBindings.length) {
      setRun({ ...currentRun, roleBindings: converged.bindings });
      setMappingState(converged);
      setSelfReviewAcknowledged(false);
      setStep(2);
      setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
      return;
    }
    if (hasRepeatedAgentBindings(currentRun.roleBindings) && !selfReviewAcknowledged) {
      setRun(currentRun);
      setMappingState((current) => reconcileConnectionFacts(
        replaceBindings(current, currentRun.roleBindings),
        agentsRef.current,
      ));
      setStep(3);
      setToast({ kind: 'error', message: t('collaboration.wizard.selfReviewConfirm') });
      return;
    }
    const epoch = mutationEpoch.current;
    setSubmitting(true);
    try {
      const result = await collaborationApi.startRun(id, currentRun.id, { expectedVersion: currentRun.version, idempotencyKey });
      if (mutationEpoch.current !== epoch) return;
      const enrichedBindings = result.roleBindings.map((binding) => ({
        ...binding,
        roleSlotName: binding.roleSlotName || template?.definition.roleSlots.find((slot) => slot.id === binding.roleSlotId)?.name || binding.roleSlotId,
      }));
      setStarted({ ...result, roleBindings: enrichedBindings });
      setRetryAction(null);
      localStorage.removeItem(storageKey);
    } catch (error) {
      await handleMutationError(error, 'start', epoch);
    } finally {
      if (mutationEpoch.current === epoch) setSubmitting(false);
    }
  };

  const handleMutationError = async (error: unknown, action: Exclude<RetryAction, null>, epoch = mutationEpoch.current) => {
    if (mutationEpoch.current !== epoch) return;
    const code = (error as { response?: { data?: { code?: string } } }).response?.data?.code;
    if (code === 'COLLABORATION_RUN_VERSION_CONFLICT') {
      setRetryAction(action);
      setToast({ kind: 'error', message: t('collaboration.wizard.conflict') });
    } else if (code === 'COLLABORATION_AGENT_INACTIVE' || code === 'COLLABORATION_AGENT_CANNOT_EXECUTE') {
      try {
        const refreshed = await loadAuthoritativeMembers(id);
        const members = refreshed.members;
        if (mutationEpoch.current !== epoch
          || memberRefreshRequest.current !== refreshed.request) return;
        const executable = members.filter(isExecutableAgent);
        const executableIds = new Set(executable.flatMap((member) => member.agentId ? [member.agentId] : []));
        setMembers(members);
        setAgents(executable);
        agentsRef.current = executable;
        setMappingState((current) => reconcileConnectionFacts(
          convergeAuthoritativeMapping(current, executableIds),
          executable,
        ));
      } catch {
        setMembers([]);
        setAgents([]);
        agentsRef.current = [];
        setMappingState(emptyMappingState());
      }
      setStep(2);
      setRetryAction(null);
      setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
    } else {
      setToast({ kind: 'error', message: t('collaboration.wizard.actionFailed') });
    }
  };

  const retry = async () => {
    const action = retryAction;
    if (!action || !run) return;
    const epoch = mutationEpoch.current;
    setSubmitting(true);
    try {
      const latest = await loadEditableRun(id, run.id);
      if (mutationEpoch.current !== epoch) return;
      setRun(latest);
      setRetryAction(null);
      if (!['draft', 'ready'].includes(latest.status)) {
        setStarted(latest);
        localStorage.removeItem(storageKey);
        return;
      }
      if (action === 'input') await completeInputs(latest);
      else if (action === 'mapping') await completeMapping(latest);
      else if (latest.status === 'draft') {
        const inputs = validatedInputs();
        const roleBindings = validatedBindings();
        if (!inputs || !roleBindings) return;
        const updated = await collaborationApi.updateRunDraft(id, latest.id, {
          expectedVersion: latest.version,
          name: runName.trim(),
          inputs,
          roleBindings,
        });
        if (mutationEpoch.current !== epoch) return;
        const currentBindings = mappingStateRef.current.bindings;
        if (!sameBindings(roleBindings, currentBindings)) {
          setRun({ ...updated, roleBindings: currentBindings });
          setRetryAction(null);
          setSelfReviewAcknowledged(false);
          setStep(2);
          setToast({ kind: 'error', message: t('collaboration.wizard.agentChanged') });
          return;
        }
        const ready = await collaborationApi.validateRunDraft(id, latest.id, updated.version);
        if (mutationEpoch.current !== epoch) return;
        setRun(ready);
        await start(ready);
      } else {
        setMappingState((current) => reconcileConnectionFacts(
          replaceBindings(current, latest.roleBindings),
          agentsRef.current,
        ));
        await start(latest);
      }
    } catch (error) {
      await handleMutationError(error, action, epoch);
    } finally {
      if (mutationEpoch.current === epoch) setSubmitting(false);
    }
  };

  const instructions = useMemo(() => started ? buildAgentJoinInstructions(started) : [], [started]);
  const hasSelfReview = instructions.some((instruction) => instruction.roleSlots.length > 1);
  const hasPotentialSelfReview = useMemo(
    () => hasRepeatedAgentBindings(run?.roleBindings ?? bindings),
    [bindings, run?.roleBindings],
  );
  const firstRequiredUnmappedSlot = template?.definition.roleSlots.find((slot) =>
    slot.required && !bindings.some((binding) => binding.roleSlotId === slot.id));

  if (loading) return <div data-testid="run-wizard-loading" className="aw-run-start aw-run-start-empty">{t('common.loading')}</div>;
  if (!template) return <div role="alert" className="aw-run-start aw-run-start-empty"><p>{t('collaboration.wizard.loadFailed')}</p><button type="button" onClick={() => void initialize()} className="aw-run-start-button"><RefreshCw size={15} />{t('common.retry')}</button></div>;

  return (
    <div className="aw-run-start">
      <header className="aw-run-start-header">
        <Link to={`/spaces/${id}/collaboration`} className="aw-run-start-back"><ArrowLeft size={14} />{t('collaboration.title')}</Link>
        <h1>{t('collaboration.wizard.title')}</h1>
        <p>{template.name}</p>
      </header>
      <ol aria-label={t('collaboration.wizard.progress')} className="aw-run-start-progress">
        {[1, 2, 3].map((value) => (
          <li key={value} aria-current={!started && step === value ? 'step' : undefined} data-complete={value < step || !!started}>
            <span className="aw-run-start-step-number" aria-hidden="true">{value < step || started ? <CheckCircle2 size={15} /> : value}</span>
            <span>{t(`collaboration.wizard.step${value}Short`)}</span>
          </li>
        ))}
      </ol>

      <div className={`aw-run-start-layout${started ? ' aw-run-start-layout-started' : ''}`}>
        <div className="aw-run-start-main">
          {restoreFailed ? <div role="alert" className="aw-run-start-notice">
            <p>{t('collaboration.wizard.restoreFailed')}</p>
            <button type="button" className="aw-run-start-button" onClick={() => void initialize()}>{t('collaboration.wizard.retrySavedRun')}</button>
          </div> : null}
          {run || started || restoreFailed ? <div className="aw-run-start-notice">
            <p>{t('collaboration.wizard.newRunHelp')}</p>
            <button type="button" disabled={submitting} onClick={beginNewRun} className="aw-run-start-button">{t('collaboration.wizard.newRun')}</button>
          </div> : null}
          <fieldset disabled={submitting || restoreFailed} className="aw-run-start-fields">
            {!started && step === 1 ? <InputStep template={template} runName={runName} runNameRef={runNameRef} runNameError={runNameError} onRunName={(name) => { setRunName(name); setRunNameError(false); }} values={inputValues} inputErrors={inputErrors} inputRefs={inputRefs} onValues={(values, key) => {
              setInputValues(values);
              setInputErrors((current) => { const next = { ...current }; delete next[key]; return next; });
            }} t={t} /> : null}
            {!started && step === 2 ? (
              <section>
                <h2 ref={mappingFocusFallbackRef} tabIndex={-1} className="aw-run-start-section-title">{t('collaboration.wizard.step2')}</h2>
                <p className="aw-run-start-help">{t('collaboration.wizard.step2Help')}</p>
                <div className="aw-run-start-roles">
                  <RoleBindingEditor
                    roleSlots={template.definition.roleSlots}
                    agents={agents}
                    bindings={bindings}
                    onChange={handleBindingsChange}
                    onPrepare={preparationActionsAvailable ? openPreparation : undefined}
                    chooseLabel={t('collaboration.wizard.chooseAgent')}
                    prepareLabel={t('collaboration.agentPreparation.action')}
                    prepareActionLabel={(role) => t('collaboration.agentPreparation.actionFor', { role })}
                  />
                </div>
                <PendingConnectionWarnings
                  bindings={bindings}
                  preparedConnections={preparedConnections}
                  t={t}
                />
                {preparationAuthorizationInvalidated ? (
                  <div role="alert" className="aw-run-start-notice">
                    {t('collaboration.agentPreparation.ownerRequired')}
                  </div>
                ) : null}
                {!agents.length && !preparationAuthorizationInvalidated ? (
                  <div role="alert" className="aw-run-start-notice">
                    <p>{preparationActionsAvailable
                      ? t('collaboration.wizard.noAgents')
                      : t('collaboration.agentPreparation.ownerRequired')}</p>
                    {preparationActionsAvailable && firstRequiredUnmappedSlot ? (
                      <button
                        type="button"
                        onClick={() => openPreparation(firstRequiredUnmappedSlot.id)}
                        className="aw-run-start-button"
                      >
                        {t('collaboration.agentPreparation.first')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}
            {!started && step === 3 && run ? <ReviewStep template={template} run={run} bindings={run.roleBindings} agents={agents} preparedConnections={preparedConnections} t={t} hasPotentialSelfReview={hasPotentialSelfReview} acknowledged={selfReviewAcknowledged} onAcknowledged={setSelfReviewAcknowledged} /> : null}
          </fieldset>
          {started ? <StartedStep started={started} instructions={instructions} hasSelfReview={hasSelfReview} onCopy={(text) => void copyInstruction(text, setToast, t)} t={t} spaceId={id} /> : null}

          {!started ? (
            <div className="aw-run-start-actions">
              <button type="button" disabled={submitting || step === 1} onClick={() => setStep((current) => current === 3 ? 2 : 1)} className="aw-run-start-button">{t('common.back')}</button>
              <div className="aw-run-start-next-actions">
                {retryAction ? <button type="button" onClick={() => void retry()} disabled={submitting} className="aw-run-start-button aw-run-start-button-warning">{t('collaboration.wizard.retryConflict')}</button> : null}
                <button type="button" disabled={submitting || restoreFailed} onClick={() => step === 1 ? void completeInputs() : step === 2 ? void completeMapping() : void start()} className="aw-run-start-button aw-run-start-button-primary">{submitting ? t('collaboration.wizard.working') : step === 3 ? t('collaboration.start') : t('common.next')}</button>
              </div>
            </div>
          ) : null}
        </div>
        {!started ? (
          <TemplateFlowSummary
            definition={run?.templateSnapshot ?? template.definition}
            description={run?.templateSnapshot ? '' : localizedFlowDescription(template, t)}
            display={(value) => run?.templateSnapshot
              ? runSystemTemplateText(run, null, value, t)
              : systemTemplateText(template, value, t)}
            t={t}
          />
        ) : null}
      </div>
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
      {preparationTarget ? (
        <AgentPreparationDialog
          key={`${id}:${templateId}:${preparationTarget.token}`}
          spaceId={id}
          target={{ id: preparationTarget.id, name: preparationTarget.name }}
          onClose={() => closePreparation(preparationTarget.token)}
          fallbackFocusRef={mappingFocusFallbackRef}
          onPrepared={(prepared) => handlePrepared(
            preparationTarget.token,
            { id, templateId },
            prepared,
          )}
          onAuthorizationLost={() => handlePreparationAuthorizationLost(
            preparationTarget.token,
            { id, templateId },
          )}
        />
      ) : null}
    </div>
  );
};

const InputStep: React.FC<{ template: TemplateDetail; runName: string; runNameRef: React.RefObject<HTMLInputElement>; runNameError: boolean; onRunName: (name: string) => void; values: Record<string, string | number | boolean>; onValues: (values: Record<string, string | number | boolean>, key: string) => void; inputErrors: Record<string, string>; inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>; t: Translate }> = ({ template, runName, runNameRef, runNameError, onRunName, values, onValues, inputErrors, inputRefs, t }) => (
  <section>
    <h2 className="aw-run-start-section-title">{t('collaboration.wizard.step1')}</h2>
    <p className="aw-run-start-help">{t('collaboration.wizard.step1Help')}</p>
    <div className="aw-run-start-inputs">
      <label className="aw-run-start-field">
        <span>{t('collaboration.wizard.runName')}<span className="aw-run-start-required">*</span></span>
        <input ref={runNameRef} required aria-label={t('collaboration.wizard.runName')} aria-invalid={runNameError || undefined} aria-describedby={runNameError ? 'run-name-error' : undefined} value={runName} onChange={(event) => onRunName(event.target.value)} className="aw-run-start-input" />
        {runNameError ? <span id="run-name-error" role="alert" className="text-sm text-red-600">{t('collaboration.wizard.runNameRequired')}</span> : null}
      </label>
      {template.definition.inputs.map((input) => <InputControl key={input.key} input={input} value={values[input.key]} error={inputErrors[input.key] ? t(inputErrors[input.key]) : undefined} controlRef={(element) => { inputRefs.current[input.key] = element; }} onChange={(value) => onValues({ ...values, [input.key]: value }, input.key)} />)}
    </div>
  </section>
);

const InputControl: React.FC<{
  input: TemplateDetail['definition']['inputs'][number];
  value: string | number | boolean | undefined;
  error?: string;
  controlRef: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onChange: (value: string | number | boolean) => void;
}> = ({ input, value, error, controlRef, onChange }) => {
  const errorId = `run-input-${input.key}-error`;
  const accessibility = {
    'aria-label': input.label,
    'aria-invalid': error ? true as const : undefined,
    'aria-describedby': error ? errorId : undefined,
    'aria-required': input.required || undefined,
  };
  return (
    <div className="aw-run-start-field">
      <label className={`aw-run-start-field${input.type === 'boolean' ? ' aw-run-start-field-checkbox' : ''}`}>
        <span>{input.label}{input.required ? <span className="aw-run-start-required">*</span> : null}</span>
        {input.type === 'long_text' ? (
          <textarea {...accessibility} ref={controlRef} required={input.required} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className="aw-run-start-input aw-run-start-textarea" />
        ) : input.type === 'boolean' ? (
          <input {...accessibility} ref={controlRef} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        ) : (
          <input {...accessibility} ref={controlRef} required={input.required} type={input.type === 'number' ? 'number' : input.type === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(input.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} className="aw-run-start-input" />
        )}
      </label>
      {error ? <span id={errorId} role="alert" className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
};

function localizedFlowDescription(template: TemplateDetail, t: Translate): string {
  if (!template.system || template.spaceId !== null) return template.description;
  const key = `collaboration.template.${template.slug}.description`;
  const localized = t(key);
  return localized === key ? template.description : localized;
}

const TemplateFlowSummary: React.FC<{ definition: TemplateDetail['definition']; description: string; display: (value: string) => string; t: Translate }> = ({ definition, description, display, t }) => (
  <aside className="aw-run-start-summary" aria-labelledby="run-start-flow-title">
    <div className="aw-run-start-summary-heading">
      <h2 id="run-start-flow-title">{t('collaboration.editor.section.flow')}</h2>
      <span>{definition.nodes.length}</span>
    </div>
    {description ? <p className="aw-run-start-help">{description}</p> : null}
    <ul className="aw-run-start-flow">
      {definition.nodes.map((node) => (
        <li key={node.id}>
          <h3>{display(node.name)}</h3>
          <p>
            {node.kind === 'agent_task' ? t('collaboration.editor.agentTask') : t('collaboration.editor.humanReview')}
            {node.kind === 'agent_task' ? <span> · {display(definition.roleSlots.find((slot) => slot.id === node.roleSlotId)?.name ?? '')}</span> : null}
          </p>
        </li>
      ))}
    </ul>
  </aside>
);

const ReviewStep: React.FC<{
  template: TemplateDetail;
  run: CollaborationRun;
  bindings: RoleBinding[];
  agents: SpaceMemberSummary[];
  preparedConnections: PreparedConnectionsByAgent;
  t: Translate;
  hasPotentialSelfReview: boolean;
  acknowledged: boolean;
  onAcknowledged: (value: boolean) => void;
}> = ({ template, run, bindings, agents, preparedConnections, t, hasPotentialSelfReview, acknowledged, onAcknowledged }) => (
  <section>
    <h2 className="aw-run-start-section-title">{t('collaboration.wizard.step3')}</h2>
    <p className="aw-run-start-help">{t('collaboration.wizard.step3Help')}</p>
    {hasPotentialSelfReview ? <label className="aw-run-start-notice aw-run-start-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} /><span>{t('collaboration.wizard.selfReviewConfirm')}</span></label> : null}
    <PendingConnectionWarnings bindings={bindings} preparedConnections={preparedConnections} t={t} />
    <dl className="aw-run-start-review">
      <div><dt>{t('collaboration.wizard.runName')}</dt><dd>{run.name}</dd></div>
      <div><dt>{t('collaboration.templates')}</dt><dd>{template.name}</dd></div>
      {bindings.map((binding) => <div key={binding.roleSlotId}><dt>{template.definition.roleSlots.find((slot) => slot.id === binding.roleSlotId)?.name}</dt><dd>{agents.find((agent) => agent.agentId === binding.agentId)?.agent?.name}</dd></div>)}
    </dl>
  </section>
);

const PendingConnectionWarnings: React.FC<{
  bindings: RoleBinding[];
  preparedConnections: PreparedConnectionsByAgent;
  t: Translate;
}> = ({ bindings, preparedConnections, t }) => {
  const boundAgentIds = new Set(bindings.map((binding) => binding.agentId));
  const pending = Object.values(preparedConnections).filter((connection) =>
    connection.connection === 'pending' && boundAgentIds.has(connection.agentId));
  return (
    <div role="status" aria-live="polite">
      {pending.length ? <ul className="aw-run-start-pending">
      {pending.map((connection) => (
        <li key={connection.agentId} className="aw-run-start-notice">
          {t('collaboration.agentPreparation.pending', { agent: connection.agentName })}
        </li>
      ))}
      </ul> : null}
    </div>
  );
};

const StartedStep: React.FC<{ started: CollaborationRun; instructions: AgentInstruction[]; hasSelfReview: boolean; onCopy: (text: string) => void; t: Translate; spaceId: string }> = ({ started, instructions, hasSelfReview, onCopy, t, spaceId }) => (
  <section>
    <div className="aw-run-start-success">
      <CheckCircle2 size={20} />
      <div><h2 className="aw-run-start-section-title">{t('collaboration.wizard.started')}</h2><p className="aw-run-start-help">{started.name}</p><p className="aw-run-start-help">{t('collaboration.wizard.currentStatus', { status: t(`collaboration.status.${started.status}`) })}</p></div>
    </div>
    {hasSelfReview ? <p className="aw-run-start-notice">{t('collaboration.wizard.selfReview')}</p> : null}
    <div className="aw-run-start-instructions">
      {instructions.map((instruction) => (
        <article key={instruction.agentId}>
          <h3>{instruction.roleSlots.join(', ')}</h3>
          <p>{instruction.text}</p>
          <button type="button" onClick={() => onCopy(instruction.text)} className="aw-run-start-button"><Copy size={15} />{t('collaboration.wizard.copyInstruction')}</button>
        </article>
      ))}
    </div>
    <div className="aw-run-start-actions"><Link to={`/spaces/${spaceId}/collaboration/runs/${started.id}`} className="aw-run-start-button aw-run-start-button-primary">{t('collaboration.wizard.openRun')}</Link></div>
  </section>
);

function isExecutableAgent(member: SpaceMemberSummary): boolean {
  return member.type === 'agent' && !!member.agentId && !!member.agent
    && member.agent.status === 'active' && !member.agent.revokedAt
    && (member.role === 'editor' || member.role === 'publisher');
}

function emptyMappingState(): MappingState {
  return { bindings: [], preparedConnections: {} };
}

function replaceBindings(current: MappingState, bindings: RoleBinding[]): MappingState {
  return {
    bindings,
    preparedConnections: prunePreparedConnections(current.preparedConnections, bindings),
  };
}

function convergeAuthoritativeMapping(
  current: MappingState,
  executableAgentIds: ReadonlySet<string>,
  preparedTarget?: PreparedMappingTarget,
): MappingState {
  const bindings = current.bindings.filter((binding) =>
    executableAgentIds.has(binding.agentId)
      && (!preparedTarget || binding.roleSlotId !== preparedTarget.roleSlotId));
  if (preparedTarget) {
    bindings.push({
      roleSlotId: preparedTarget.roleSlotId,
      roleSlotName: preparedTarget.roleSlotName,
      agentId: preparedTarget.agentId,
    });
  }

  const preparedConnections = { ...current.preparedConnections };
  if (preparedTarget) {
    preparedConnections[preparedTarget.agentId] = {
      agentId: preparedTarget.agentId,
      agentName: preparedTarget.agentName,
      connection: preparedTarget.connection,
    };
  }

  return {
    bindings,
    preparedConnections: prunePreparedConnections(preparedConnections, bindings, executableAgentIds),
  };
}

function prunePreparedConnections(
  current: PreparedConnectionsByAgent,
  bindings: RoleBinding[],
  executableAgentIds?: ReadonlySet<string>,
): PreparedConnectionsByAgent {
  const boundAgentIds = new Set(bindings.map((binding) => binding.agentId));
  return Object.fromEntries(Object.entries(current).filter(([agentId, connection]) =>
    agentId === connection.agentId
      && boundAgentIds.has(connection.agentId)
      && (!executableAgentIds || executableAgentIds.has(connection.agentId))));
}

function reconcileConnectionFacts(
  current: MappingState,
  executableAgents: SpaceMemberSummary[],
): MappingState {
  const membersByAgentId = new Map(executableAgents.flatMap((member) =>
    member.agentId ? [[member.agentId, member] as const] : []));
  const preparedConnections = { ...current.preparedConnections };

  for (const binding of current.bindings) {
    const member = membersByAgentId.get(binding.agentId);
    const connected = member?.agent?.connected;
    if (connected === true) {
      delete preparedConnections[binding.agentId];
    } else if (connected === false && member?.agent) {
      preparedConnections[binding.agentId] = {
        agentId: binding.agentId,
        agentName: member.agent.name,
        connection: 'pending',
      };
    }
  }

  return {
    bindings: current.bindings,
    preparedConnections: prunePreparedConnections(preparedConnections, current.bindings),
  };
}

async function loadEditableRun(spaceId: string, runId: string): Promise<CollaborationRun> {
  const summary = await collaborationApi.getRun(spaceId, runId);
  if (['draft', 'ready'].includes(summary.status) && !summary.inputs) {
    const details = await collaborationApi.getRunDraftDetails(spaceId, runId);
    // The bounded draft projection omits immutable identity fields. Preserve them
    // from the human summary while using the newer draft version/content.
    return {
      ...summary,
      ...details,
      startedById: summary.startedById,
      templateId: summary.templateId,
      spaceId: summary.spaceId,
    };
  }
  return summary;
}

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function copyInstruction(text: string, setToast: (toast: { kind: 'success' | 'error'; message: string }) => void, t: Translate) {
  try {
    await navigator.clipboard.writeText(text);
    setToast({ kind: 'success', message: t('collaboration.wizard.copied') });
  } catch {
    setToast({ kind: 'error', message: t('collaboration.wizard.copyFailed') });
  }
}
