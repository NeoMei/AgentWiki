import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CollaborationInputValuesSchema } from '@neomei/agentwiki-sync-protocol';
import { ArrowLeft, CheckCircle2, Copy, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { SpaceNav } from '../../components/SpaceNav';
import { Toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { AgentPreparationDialog, type PreparedAgentSelection } from './components/AgentPreparationDialog';
import { RoleBindingEditor } from './components/RoleBindingEditor';
import type {
  AgentInstruction,
  CollaborationRun,
  RoleBinding,
  RunJoinInstruction,
  SpaceMemberSummary,
  TemplateDetail,
} from './types';

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

export function buildAgentJoinInstructions(run: { id: string; roleBindings: RoleBinding[]; joinInstructions?: RunJoinInstruction[] }): AgentInstruction[] {
  if (run.joinInstructions !== undefined) {
    return run.joinInstructions.map((instruction) => {
      const roleSlots = instruction.roleSlotIds.map((roleSlotId) =>
        run.roleBindings.find((binding) => binding.roleSlotId === roleSlotId)?.roleSlotName || roleSlotId);
      return toAgentInstruction(run.id, instruction.agentId, roleSlots);
    });
  }
  const byAgent = new Map<string, string[]>();
  for (const binding of run.roleBindings) {
    const name = binding.roleSlotName || binding.roleSlotId;
    byAgent.set(binding.agentId, [...(byAgent.get(binding.agentId) ?? []), name]);
  }
  return [...byAgent.entries()].map(([agentId, roleSlots]) => toAgentInstruction(run.id, agentId, roleSlots));
}

function toAgentInstruction(runId: string, agentId: string, roleSlots: string[]): AgentInstruction {
  const roleSummary = roleSlots.length ? ` Roles: ${roleSlots.join(', ')}.` : '';
  return {
    agentId,
    roleSlots,
    text: `Run ${runId}.${roleSummary} Use the existing AgentWiki MCP connection. Call wiki_collaboration_join_run with runId ${runId}, then call wiki_collaboration_next_action and follow each action until waiting_human, paused, completed, failed, or cancelled. Never invent or request a new connection secret.`,
  };
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
  const { t } = useLanguage();
  const { user } = useAuth();
  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [members, setMembers] = useState<SpaceMemberSummary[]>([]);
  const [agents, setAgents] = useState<SpaceMemberSummary[]>([]);
  const [run, setRun] = useState<CollaborationRun | null>(null);
  const [started, setStarted] = useState<CollaborationRun | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [runName, setRunName] = useState('');
  const [inputValues, setInputValues] = useState<Record<string, string | number | boolean>>({});
  const [mappingState, setMappingState] = useState<MappingState>(() => emptyMappingState());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [retryAction, setRetryAction] = useState<RetryAction>(null);
  const [selfReviewAcknowledged, setSelfReviewAcknowledged] = useState(false);
  const [preparationTarget, setPreparationTarget] = useState<PreparationTarget | null>(null);
  const [preparationAuthorizationInvalidated, setPreparationAuthorizationInvalidated] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const idempotencyKey = useMemo(() => `start-${safeUuid()}`, [id, templateId]);
  const initializeRequest = useRef(0);
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
  const storageKey = `agentwiki.collaboration.draft.${id}.${templateId}`;
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
  const canPrepareAgents = user?.platformRole === 'super_admin' || myRole === 'owner' || myRole === 'admin';
  const preparationActionsAvailable = canPrepareAgents && !preparationAuthorizationInvalidated;

  useEffect(() => {
    initializeRequest.current += 1;
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
    setInputValues({});
    setMappingState(emptyMappingState());
    setLoading(true);
    setSubmitting(false);
    setRetryAction(null);
    setSelfReviewAcknowledged(false);
    setPreparationTarget(null);
    setPreparationAuthorizationInvalidated(false);
    setToast(null);
  }, [id, templateId]);

  const validatedInputs = () => {
    if (!template || !runName.trim()) return null;
    const normalized: Record<string, string | number | boolean> = {};
    for (const input of template.definition.inputs) {
      const value = inputValues[input.key];
      if (input.required && (value === undefined || value === '')) {
        setToast({ kind: 'error', message: t('collaboration.wizard.requiredInputs') });
        return null;
      }
      if (value !== undefined && value !== '') normalized[input.key] = value;
    }
    const parsed = CollaborationInputValuesSchema.safeParse(normalized);
    if (!parsed.success) {
      setToast({ kind: 'error', message: t('collaboration.wizard.invalidInputs') });
      return null;
    }
    return parsed.data;
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
      const storedRunId = localStorage.getItem(storageKey);
      if (storedRunId) {
        try {
          const existing = await loadEditableRun(id, storedRunId);
          if (initializeRequest.current !== request) return;
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
          localStorage.removeItem(storageKey);
        }
      }
    } catch {
      if (initializeRequest.current !== request) return;
      setToast({ kind: 'error', message: t('collaboration.wizard.loadFailed') });
    } finally {
      if (initializeRequest.current === request) setLoading(false);
    }
  }, [id, storageKey, t, templateId]);

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

  if (loading) return <div data-testid="run-wizard-loading" className="py-14 text-center text-sm text-gray-500">{t('common.loading')}</div>;
  if (!template) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 py-12 text-center"><p className="text-sm text-red-700">{t('collaboration.wizard.loadFailed')}</p><button type="button" onClick={() => void initialize()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={15} />{t('common.retry')}</button></div>;

  return (
    <div className="mx-auto max-w-4xl min-w-0">
      <SpaceNav spaceId={id} />
      <Link to={`/spaces/${id}/collaboration`} className="inline-flex items-center gap-1 text-sm text-gray-500"><ArrowLeft size={15} />{t('collaboration.title')}</Link>
      <div className="mt-3"><h1 className="text-2xl font-semibold">{t('collaboration.wizard.title')}</h1><p className="mt-1 text-sm text-gray-600">{template.name}</p></div>
      <ol aria-label={t('collaboration.wizard.progress')} className="mt-6 grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
        {[1, 2, 3].map((value) => <li key={value} className={`rounded-lg border px-2 py-2 ${step === value ? 'border-blue-500 bg-blue-50 font-medium text-blue-700' : value < step || started ? 'border-green-200 bg-green-50 text-green-700' : 'text-gray-500'}`}>{value}. {t(`collaboration.wizard.step${value}Short`)}</li>)}
      </ol>

      <div className="mt-6">
        <fieldset disabled={submitting} className="disabled:opacity-70">
        {!started && step === 1 ? <InputStep template={template} runName={runName} onRunName={setRunName} values={inputValues} onValues={setInputValues} t={t} /> : null}
        {!started && step === 2 ? (
          <section>
            <h2 ref={mappingFocusFallbackRef} tabIndex={-1} className="text-xl font-semibold">{t('collaboration.wizard.step2')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step2Help')}</p>
            <div className="mt-5">
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
              <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {t('collaboration.agentPreparation.ownerRequired')}
              </div>
            ) : null}
            {!agents.length && !preparationAuthorizationInvalidated ? (
              <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p>{preparationActionsAvailable
                  ? t('collaboration.wizard.noAgents')
                  : t('collaboration.agentPreparation.ownerRequired')}</p>
                {preparationActionsAvailable && firstRequiredUnmappedSlot ? (
                  <button
                    type="button"
                    onClick={() => openPreparation(firstRequiredUnmappedSlot.id)}
                    className="mt-3 min-h-10 w-full rounded-lg border border-amber-300 bg-white px-4 text-sm font-medium sm:w-auto"
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
      </div>

      {!started ? <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5"><button type="button" disabled={submitting || step === 1} onClick={() => setStep((current) => current === 3 ? 2 : 1)} className="min-h-10 rounded-lg border px-4 text-sm disabled:opacity-40">{t('common.back')}</button><div className="flex items-center gap-2">{retryAction ? <button type="button" onClick={() => void retry()} disabled={submitting} className="min-h-10 rounded-lg border border-amber-300 px-4 text-sm text-amber-800">{t('collaboration.wizard.retryConflict')}</button> : null}<button type="button" disabled={submitting} onClick={() => step === 1 ? void completeInputs() : step === 2 ? void completeMapping() : void start()} className="min-h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white disabled:opacity-50">{submitting ? t('collaboration.wizard.working') : step === 3 ? t('collaboration.start') : t('common.next')}</button></div></div> : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
      {preparationTarget ? (
        <AgentPreparationDialog
          key={`${id}:${templateId}:${preparationTarget.token}`}
          spaceId={id}
          target={{ id: preparationTarget.id, name: preparationTarget.name }}
          onClose={() => closePreparation(preparationTarget.token)}
          fallbackFocusTo={mappingFocusFallbackRef.current}
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

const InputStep: React.FC<{ template: TemplateDetail; runName: string; onRunName: (name: string) => void; values: Record<string, string | number | boolean>; onValues: (values: Record<string, string | number | boolean>) => void; t: Translate }> = ({ template, runName, onRunName, values, onValues, t }) => <section><h2 className="text-xl font-semibold">{t('collaboration.wizard.step1')}</h2><p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step1Help')}</p><div className="mt-5 space-y-4 rounded-xl border bg-white p-5"><label className="block text-sm font-medium">{t('collaboration.wizard.runName')}<input aria-label={t('collaboration.wizard.runName')} value={runName} onChange={(event) => onRunName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>{template.definition.inputs.map((input) => <InputControl key={input.key} input={input} value={values[input.key]} onChange={(value) => onValues({ ...values, [input.key]: value })} />)}</div></section>;

const InputControl: React.FC<{ input: TemplateDetail['definition']['inputs'][number]; value: string | number | boolean | undefined; onChange: (value: string | number | boolean) => void }> = ({ input, value, onChange }) => <label className="block text-sm font-medium">{input.label}{input.required ? <span className="ml-1 text-red-600">*</span> : null}{input.type === 'long_text' ? <textarea aria-label={input.label} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-28 w-full rounded-lg border p-3" /> : input.type === 'boolean' ? <input aria-label={input.label} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} className="ml-3" /> : <input aria-label={input.label} type={input.type === 'number' ? 'number' : input.type === 'url' ? 'url' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(input.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" />}</label>;

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
    <h2 className="text-xl font-semibold">{t('collaboration.wizard.step3')}</h2>
    <p className="mt-1 text-sm text-gray-600">{t('collaboration.wizard.step3Help')}</p>
    {hasPotentialSelfReview ? <label className="mt-4 block rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><input type="checkbox" checked={acknowledged} onChange={(event) => onAcknowledged(event.target.checked)} /> <span className="ml-1">{t('collaboration.wizard.selfReviewConfirm')}</span></label> : null}
    <PendingConnectionWarnings bindings={bindings} preparedConnections={preparedConnections} t={t} />
    <dl className="mt-5 divide-y rounded-xl border bg-white">
      <div className="p-4"><dt className="text-xs text-gray-500">{t('collaboration.wizard.runName')}</dt><dd className="mt-1 font-medium">{run.name}</dd></div>
      <div className="p-4"><dt className="text-xs text-gray-500">{t('collaboration.templates')}</dt><dd className="mt-1 font-medium">{template.name}</dd></div>
      {bindings.map((binding) => <div key={binding.roleSlotId} className="p-4"><dt className="text-xs text-gray-500">{template.definition.roleSlots.find((slot) => slot.id === binding.roleSlotId)?.name}</dt><dd className="mt-1 font-medium">{agents.find((agent) => agent.agentId === binding.agentId)?.agent?.name}</dd></div>)}
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
    <div role="status" aria-live="polite" className={pending.length ? 'mt-4' : undefined}>
      {pending.length ? <ul className="space-y-2">
      {pending.map((connection) => (
        <li key={connection.agentId} className="break-words rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t('collaboration.agentPreparation.pending', { agent: connection.agentName })}
        </li>
      ))}
      </ul> : null}
    </div>
  );
};

const StartedStep: React.FC<{ started: CollaborationRun; instructions: AgentInstruction[]; hasSelfReview: boolean; onCopy: (text: string) => void; t: Translate; spaceId: string }> = ({ started, instructions, hasSelfReview, onCopy, t, spaceId }) => <section><div className="flex items-center gap-3"><CheckCircle2 className="text-green-600" /><div><h2 className="text-xl font-semibold">{t('collaboration.wizard.started')}</h2><p className="text-sm text-gray-600">{started.name}</p></div></div>{hasSelfReview ? <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('collaboration.wizard.selfReview')}</p> : null}<div className="mt-5 space-y-4">{instructions.map((instruction) => <article key={instruction.agentId} className="rounded-xl border bg-white p-4"><h3 className="font-medium">{instruction.roleSlots.join(', ')}</h3><p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm text-gray-700">{instruction.text}</p><button type="button" onClick={() => onCopy(instruction.text)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><Copy size={15} />{t('collaboration.wizard.copyInstruction')}</button></article>)}</div><Link to={`/spaces/${spaceId}/collaboration/runs/${started.id}`} className="mt-6 inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-4 text-sm font-medium text-white">{t('collaboration.wizard.openRun')}</Link></section>;

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
    return collaborationApi.getRunDraftDetails(spaceId, runId);
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
