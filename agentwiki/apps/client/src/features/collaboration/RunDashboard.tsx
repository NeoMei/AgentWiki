import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { ModalDialog } from '../../components/ModalDialog';
import { SpaceNav } from '../../components/SpaceNav';
import { Toast } from '../../components/Toast';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { collaborationApi } from './api';
import { AgentActivityPanel } from './components/AgentActivityPanel';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { RunSummary } from './components/RunSummary';
import { TaskPanel } from './components/TaskPanel';
import type { AgentInstruction, CollaborationArtifact, CollaborationHistoryKind, CollaborationReview, CollaborationRun, CollaborationTask, HumanSpaceRole, SpaceMemberSummary } from './types';
import { useCollaborationRun } from './useCollaborationRun';
import { buildAgentJoinInstructions } from './RunStartWizard';

type RunAction = 'pause' | 'resume' | 'fail' | 'cancel';
type TaskAction = 'retry' | 'reassign' | 'skip';
type ReviewAction = 'approve' | 'reject_for_revision' | 'terminate';
type PendingAction =
  | { type: 'run'; kind: RunAction }
  | { type: 'task'; kind: TaskAction; task: CollaborationTask }
  | { type: 'review'; kind: ReviewAction; review: CollaborationReview };

export const RunDashboard: React.FC = () => {
  const { id = '', runId = '' } = useParams<{ id: string; runId: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { state, refresh } = useCollaborationRun(id, runId);
  const [members, setMembers] = useState<SpaceMemberSummary[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [agentId, setAgentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [resumeInstructions, setResumeInstructions] = useState<AgentInstruction[]>([]);
  const [reviewArtifacts, setReviewArtifacts] = useState<Record<string, CollaborationArtifact>>({});
  const [reviewArtifactErrors, setReviewArtifactErrors] = useState<Record<string, boolean>>({});
  const reviewArtifactScope = useRef(`${id}:${runId}`);
  const dashboardScope = useRef(`${id}:${runId}`);
  const pendingScope = useRef<string | null>(null);
  const memberRequest = useRef(0);
  const historyRequest = useRef(0);
  const [historyKind, setHistoryKind] = useState<CollaborationHistoryKind | null>(null);
  const [historyItems, setHistoryItems] = useState<unknown[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const currentScope = `${id}:${runId}`;
  if (reviewArtifactScope.current !== currentScope) reviewArtifactScope.current = currentScope;
  if (dashboardScope.current !== currentScope) {
    dashboardScope.current = currentScope;
    memberRequest.current += 1;
    historyRequest.current += 1;
  }

  const loadMembers = React.useCallback(async () => {
    if (!id) return;
    const request = ++memberRequest.current;
    const requestedScope = `${id}:${runId}`;
    setMembersLoading(true);
    setMembersError(false);
    try {
      const nextMembers = await collaborationApi.listMembers(id);
      if (memberRequest.current !== request || dashboardScope.current !== requestedScope) return;
      setMembers(nextMembers);
    } catch {
      if (memberRequest.current !== request || dashboardScope.current !== requestedScope) return;
      setMembers([]);
      setMembersError(true);
    } finally {
      if (memberRequest.current === request && dashboardScope.current === requestedScope) setMembersLoading(false);
    }
  }, [id, runId]);

  useEffect(() => {
    setPending(null);
    pendingScope.current = null;
    setReason('');
    setAgentId('');
    setSubmitting(false);
    setToast(null);
    setResumeInstructions([]);
    setReviewArtifacts({});
    setReviewArtifactErrors({});
    setHistoryKind(null);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setHistoryError(false);
    void loadMembers();
  }, [loadMembers]);

  const run = state.kind === 'ready' ? state.value : state.kind === 'error' ? state.previous : undefined;
  const humanRole = (user?.platformRole === 'super_admin'
    ? 'owner'
    : members.find((member) => member.type === 'human' && member.userId === user?.id)?.role) as HumanSpaceRole | undefined;
  const executableAgents = useMemo(() => members.filter((member) => member.type === 'agent' && member.agent?.status === 'active' && !member.agent.revokedAt && ['editor', 'publisher'].includes(member.role)), [members]);

  const loadReviewArtifact = React.useCallback(async (review: CollaborationReview) => {
    const requestedScope = `${id}:${runId}`;
    setReviewArtifactErrors((current) => ({ ...current, [review.id]: false }));
    try {
      const artifact = await collaborationApi.getArtifact(id, runId, review.artifactId);
      if (reviewArtifactScope.current !== requestedScope) return;
      setReviewArtifacts((current) => ({ ...current, [review.id]: artifact }));
    } catch {
      if (reviewArtifactScope.current !== requestedScope) return;
      setReviewArtifactErrors((current) => ({ ...current, [review.id]: true }));
    }
  }, [id, runId]);

  useEffect(() => {
    setReviewArtifacts({});
    setReviewArtifactErrors({});
    if (!run) return;
    for (const review of (run.reviews ?? []).filter((item) => item.status === 'pending')) {
      void loadReviewArtifact(review);
    }
  }, [loadReviewArtifact, run?.id, run?.eventSequence]);

  const openHistory = async (kind: CollaborationHistoryKind) => {
    const request = ++historyRequest.current;
    setHistoryKind(kind);
    setHistoryItems([]);
    setHistoryNextCursor(null);
    setHistoryError(false);
    setHistoryLoading(true);
    try {
      const page = await collaborationApi.getRunHistory(id, runId, kind, undefined, 50);
      if (historyRequest.current !== request || dashboardScope.current !== `${id}:${runId}`) return;
      setHistoryItems(page.items);
      setHistoryNextCursor(page.nextCursor);
    } catch {
      if (historyRequest.current === request) setHistoryError(true);
    } finally {
      if (historyRequest.current === request) setHistoryLoading(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!historyKind || !historyNextCursor || historyLoading) return;
    const request = ++historyRequest.current;
    const kind = historyKind;
    const cursor = historyNextCursor;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const page = await collaborationApi.getRunHistory(id, runId, kind, cursor, 50);
      if (historyRequest.current !== request || dashboardScope.current !== `${id}:${runId}`) return;
      setHistoryItems((current) => [...current, ...page.items]);
      setHistoryNextCursor(page.nextCursor);
    } catch {
      if (historyRequest.current === request) setHistoryError(true);
    } finally {
      if (historyRequest.current === request) setHistoryLoading(false);
    }
  };

  const closeHistory = () => {
    historyRequest.current += 1;
    setHistoryKind(null);
    setHistoryNextCursor(null);
  };

  useEffect(() => {
    if (state.kind === 'ready' && !state.updating && state.value.status !== 'running') setResumeInstructions([]);
  }, [state]);

  const showResumeInstructions = resumeInstructions.length > 0
    && !(state.kind === 'ready' && !state.updating && state.value.status !== 'running');

  const openAction = (action: PendingAction) => {
    pendingScope.current = `${id}:${runId}`;
    setPending(action);
    setReason('');
    setAgentId(action.type === 'task' && action.kind === 'reassign' ? executableAgents[0]?.agentId ?? '' : '');
  };

  const submitAction = async () => {
    if (!pending || !run || !reason.trim() || pendingScope.current !== `${id}:${run.id}`) return;
    const requestedScope = `${id}:${run.id}`;
    const action = pending;
    setSubmitting(true);
    const input = { reason: reason.trim(), idempotencyKey: `${action.type}-${action.kind}-${safeUuid()}` };
    try {
      let result: CollaborationRun;
      if (action.type === 'run') {
        if (action.kind === 'pause') result = await collaborationApi.pauseRun(id, run.id, input);
        else if (action.kind === 'resume') result = await collaborationApi.resumeRun(id, run.id, input);
        else if (action.kind === 'fail') result = await collaborationApi.failRun(id, run.id, input);
        else result = await collaborationApi.cancelRun(id, run.id, input);
      } else if (action.type === 'task') {
        if (action.kind === 'retry') result = await collaborationApi.retryTask(id, run.id, action.task.id, input);
        else if (action.kind === 'skip') result = await collaborationApi.skipTask(id, run.id, action.task.id, input);
        else {
          if (!agentId) return;
          result = await collaborationApi.reassignTask(id, run.id, action.task.id, { ...input, agentId });
        }
      } else {
        result = await collaborationApi.decideReview(id, run.id, action.review.id, {
          kind: action.kind,
          reason: reason.trim(),
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (dashboardScope.current !== requestedScope) return;
      const shouldResume = action.type === 'review'
        || (action.type === 'run' && action.kind === 'resume')
        || (action.type === 'task' && ['retry', 'reassign', 'skip'].includes(action.kind));
      if (shouldResume && result.status === 'running') {
        setResumeInstructions(buildAgentJoinInstructions(result));
      } else setResumeInstructions([]);
      setPending(null);
      pendingScope.current = null;
      setToast({ kind: 'success', message: t('collaboration.dashboard.actionSuccess') });
      await refresh();
    } catch {
      if (dashboardScope.current !== requestedScope) return;
      setToast({ kind: 'error', message: t('collaboration.dashboard.actionFailed') });
    } finally {
      if (dashboardScope.current === requestedScope) setSubmitting(false);
    }
  };

  if (state.kind === 'loading') return <div data-testid="collaboration-run-loading" className="py-14 text-center text-sm text-gray-500">{t('common.loading')}</div>;
  if (!run) return <div data-testid="collaboration-run-error" className="rounded-xl border border-red-200 bg-red-50 py-12 text-center"><p className="text-sm text-red-700">{t('collaboration.dashboard.loadFailed')}</p><button type="button" onClick={() => void refresh()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={15} />{t('common.retry')}</button></div>;

  return (
    <div className="mx-auto max-w-7xl min-w-0 overflow-x-clip">
      <SpaceNav spaceId={id} />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><Link to={`/spaces/${id}/collaboration`} className="inline-flex items-center gap-1 text-sm text-gray-500"><ArrowLeft size={15} />{t('collaboration.title')}</Link><h1 className="mt-2 break-words text-2xl font-semibold">{t('collaboration.dashboard.title')}</h1></div>
        {state.kind === 'ready' && state.updating ? <span role="status" className="text-sm text-gray-500">{t('collaboration.dashboard.updating')}</span> : <button type="button" aria-label={t('common.refresh')} onClick={() => void Promise.all([refresh(), loadMembers()])} className="rounded-lg border p-2"><RefreshCw size={16} /></button>}
      </div>
      {state.kind === 'error' ? <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('collaboration.dashboard.stale')}</div> : null}
      {membersError ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t('collaboration.dashboard.membersFailed')}<button type="button" onClick={() => void loadMembers()} className="ml-2 underline">{t('common.retry')}</button></div> : null}
      {membersLoading ? <span className="sr-only" role="status">{t('common.loading')}</span> : null}
      {showResumeInstructions ? <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-blue-900">{t('collaboration.dashboard.resumeInstructions')}</h2><p className="mt-1 text-sm text-blue-800">{t('collaboration.dashboard.resumeInstructionsHelp')}</p></div><button type="button" onClick={() => setResumeInstructions([])} className="text-sm text-blue-800">{t('common.close')}</button></div><div className="mt-3 space-y-2">{resumeInstructions.map((instruction) => <div key={instruction.agentId} className="flex min-w-0 flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center"><p className="min-w-0 flex-1 break-words text-sm">{instruction.text}</p><button type="button" onClick={() => void copyResumeInstruction(instruction.text, setToast, t)} className="min-h-9 shrink-0 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.copyResume')}</button></div>)}</div></section> : null}

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.8fr)_minmax(17rem,1fr)]">
        <RunSummary run={run} role={humanRole} userId={user?.id} t={t} onAction={(kind) => openAction({ type: 'run', kind })} />
        <TaskPanel run={run} role={humanRole} userId={user?.id} t={t} onHistory={(kind) => void openHistory(kind)} onAction={(kind, task) => openAction({ type: 'task', kind, task })} />
        <ReviewPanel run={run} t={t} artifacts={reviewArtifacts} artifactErrors={reviewArtifactErrors} onHistory={() => void openHistory('reviews')} onRetryArtifact={(review) => void loadReviewArtifact(review)} onDecision={(kind, review) => openAction({ type: 'review', kind, review })} />
        <ArtifactPanel run={run} t={t} onHistory={() => void openHistory('artifacts')} />
        <AgentActivityPanel run={run} t={t} onHistory={() => void openHistory('events')} />
      </div>

      {pending && pendingScope.current === `${id}:${run.id}` ? <ActionDialog pending={pending} run={run} reason={reason} setReason={setReason} agentId={agentId} setAgentId={setAgentId} agents={executableAgents} submitting={submitting} onClose={() => { pendingScope.current = null; setPending(null); }} onConfirm={() => void submitAction()} t={t} /> : null}
      {historyKind ? <ModalDialog labelledBy="collaboration-history-title" onRequestClose={closeHistory} className="w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl"><div className="flex items-start justify-between gap-3"><div><h2 id="collaboration-history-title" className="text-lg font-semibold">{t(`collaboration.dashboard.history.${historyKind}`)}</h2><p className="mt-1 text-sm text-gray-600">{t('collaboration.dashboard.fullHistoryHelp')}</p></div><button type="button" onClick={closeHistory} className="min-h-10 rounded-lg border px-3 text-sm">{t('common.close')}</button></div>{historyError ? <div role="alert" className="mt-6 text-sm text-red-700">{t('collaboration.dashboard.historyFailed')}<button type="button" onClick={() => historyItems.length ? void loadMoreHistory() : void openHistory(historyKind)} className="ml-2 underline">{t('common.retry')}</button></div> : null}{historyItems.length ? <><ol className="mt-5 max-h-[65vh] space-y-3 overflow-auto">{historyItems.map((item, index) => <li key={historyItemKey(item, index)} className="rounded-lg border bg-gray-50 p-3"><pre className="whitespace-pre-wrap break-words text-xs text-gray-700">{JSON.stringify(item, null, 2)}</pre></li>)}</ol>{historyNextCursor ? <button type="button" disabled={historyLoading} onClick={() => void loadMoreHistory()} className="mt-4 min-h-10 rounded-lg border px-4 text-sm disabled:opacity-50">{historyLoading ? t('common.loading') : t('dashboard.loadMore')}</button> : null}</> : historyLoading ? <p role="status" className="mt-6 text-sm text-gray-500">{t('common.loading')}</p> : !historyError ? <p className="mt-6 text-sm text-gray-500">{t('collaboration.dashboard.noHistory')}</p> : null}</ModalDialog> : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
    </div>
  );
};

function historyItemKey(item: unknown, index: number): string {
  return item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
    ? (item as { id: string }).id
    : String(index);
}

const ActionDialog: React.FC<{
  pending: PendingAction;
  run: CollaborationRun;
  reason: string;
  setReason: (reason: string) => void;
  agentId: string;
  setAgentId: (agentId: string) => void;
  agents: SpaceMemberSummary[];
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}> = ({ pending, run, reason, setReason, agentId, setAgentId, agents, submitting, onClose, onConfirm, t }) => {
  const target = pending.type === 'run' ? run.name : pending.type === 'task' ? `${run.name} / ${pending.task.name}` : run.name;
  const label = t(`collaboration.dashboard.action.${pending.kind}`);
  return <ModalDialog labelledBy="collaboration-action-title" onRequestClose={onClose} closeDisabled={submitting} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 id="collaboration-action-title" className="text-lg font-semibold">{label}</h2><p className="mt-2 break-words text-sm text-gray-600">{t('collaboration.dashboard.actionTarget')}: {target}</p>{pending.type === 'review' && pending.kind === 'reject_for_revision' ? <p className="mt-2 text-sm text-gray-600">{t('collaboration.dashboard.returnTask')}: {run.tasks?.find((task) => task.id === pending.review.revisionTaskId)?.name ?? pending.review.revisionTaskId}</p> : null}{pending.type === 'task' && pending.kind === 'reassign' ? <label className="mt-4 block text-sm font-medium">{t('collaboration.dashboard.agent')}<select value={agentId} onChange={(event) => setAgentId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3">{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.agent?.name}</option>)}</select></label> : null}<label className="mt-4 block text-sm font-medium">{t('collaboration.dashboard.reason')}<textarea data-modal-autofocus aria-label={t('collaboration.dashboard.reason')} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" disabled={submitting} onClick={onClose} className="min-h-10 rounded-lg border px-4 text-sm">{t('common.cancel')}</button><button type="button" disabled={submitting || !reason.trim() || (pending.type === 'task' && pending.kind === 'reassign' && !agentId)} onClick={onConfirm} className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-50">{t('collaboration.dashboard.confirmAction')} {label.toLowerCase()}</button></div></ModalDialog>;
};

function safeUuid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function copyResumeInstruction(
  value: string,
  setToast: (toast: { kind: 'success' | 'error'; message: string }) => void,
  t: (key: string) => string,
) {
  try {
    await navigator.clipboard.writeText(value);
    setToast({ kind: 'success', message: t('collaboration.dashboard.resumeCopied') });
  } catch {
    setToast({ kind: 'error', message: t('collaboration.dashboard.resumeCopyFailed') });
  }
}
