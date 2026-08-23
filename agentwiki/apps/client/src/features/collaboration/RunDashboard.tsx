import React, { useEffect, useMemo, useState } from 'react';
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
import type { AgentInstruction, CollaborationReview, CollaborationRun, CollaborationTask, HumanSpaceRole, SpaceMemberSummary } from './types';
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
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [agentId, setAgentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [resumeInstructions, setResumeInstructions] = useState<AgentInstruction[]>([]);

  useEffect(() => {
    if (!id) return;
    void collaborationApi.listMembers(id).then(setMembers).catch(() => setMembers([]));
  }, [id]);

  const run = state.kind === 'ready' ? state.value : state.kind === 'error' ? state.previous : undefined;
  const humanRole = members.find((member) => member.type === 'human' && member.userId === user?.id)?.role as HumanSpaceRole | undefined;
  const executableAgents = useMemo(() => members.filter((member) => member.type === 'agent' && member.agent?.status === 'active' && !member.agent.revokedAt && ['editor', 'publisher'].includes(member.role)), [members]);

  useEffect(() => {
    if (state.kind === 'ready' && !state.updating && state.value.status !== 'running') setResumeInstructions([]);
  }, [state]);

  const showResumeInstructions = resumeInstructions.length > 0
    && !(state.kind === 'ready' && !state.updating && state.value.status !== 'running');

  const openAction = (action: PendingAction) => {
    setPending(action);
    setReason('');
    setAgentId(action.type === 'task' && action.kind === 'reassign' ? executableAgents[0]?.agentId ?? '' : '');
  };

  const submitAction = async () => {
    if (!pending || !run || !reason.trim()) return;
    setSubmitting(true);
    const input = { reason: reason.trim(), idempotencyKey: `${pending.type}-${pending.kind}-${safeUuid()}` };
    try {
      let result: CollaborationRun;
      if (pending.type === 'run') {
        if (pending.kind === 'pause') result = await collaborationApi.pauseRun(id, run.id, input);
        else if (pending.kind === 'resume') result = await collaborationApi.resumeRun(id, run.id, input);
        else if (pending.kind === 'fail') result = await collaborationApi.failRun(id, run.id, input);
        else result = await collaborationApi.cancelRun(id, run.id, input);
      } else if (pending.type === 'task') {
        if (pending.kind === 'retry') result = await collaborationApi.retryTask(id, run.id, pending.task.id, input);
        else if (pending.kind === 'skip') result = await collaborationApi.skipTask(id, run.id, pending.task.id, input);
        else {
          if (!agentId) return;
          result = await collaborationApi.reassignTask(id, run.id, pending.task.id, { ...input, agentId });
        }
      } else {
        result = await collaborationApi.decideReview(id, run.id, pending.review.id, {
          kind: pending.kind,
          reason: reason.trim(),
          idempotencyKey: input.idempotencyKey,
        });
      }
      const shouldResume = pending.type === 'review'
        || (pending.type === 'run' && pending.kind === 'resume')
        || (pending.type === 'task' && ['retry', 'reassign', 'skip'].includes(pending.kind));
      if (shouldResume && result.status === 'running') {
        setResumeInstructions(buildAgentJoinInstructions(result));
      } else setResumeInstructions([]);
      setPending(null);
      setToast({ kind: 'success', message: t('collaboration.dashboard.actionSuccess') });
      await refresh();
    } catch {
      setToast({ kind: 'error', message: t('collaboration.dashboard.actionFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === 'loading') return <div data-testid="collaboration-run-loading" className="py-14 text-center text-sm text-gray-500">{t('common.loading')}</div>;
  if (!run) return <div data-testid="collaboration-run-error" className="rounded-xl border border-red-200 bg-red-50 py-12 text-center"><p className="text-sm text-red-700">{t('collaboration.dashboard.loadFailed')}</p><button type="button" onClick={() => void refresh()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm"><RefreshCw size={15} />{t('common.retry')}</button></div>;

  return (
    <div className="mx-auto max-w-7xl min-w-0 overflow-x-clip">
      <SpaceNav spaceId={id} />
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><Link to={`/spaces/${id}/collaboration`} className="inline-flex items-center gap-1 text-sm text-gray-500"><ArrowLeft size={15} />{t('collaboration.title')}</Link><h1 className="mt-2 break-words text-2xl font-semibold">{t('collaboration.dashboard.title')}</h1></div>
        {state.kind === 'ready' && state.updating ? <span role="status" className="text-sm text-gray-500">{t('collaboration.dashboard.updating')}</span> : <button type="button" aria-label={t('common.refresh')} onClick={() => void refresh()} className="rounded-lg border p-2"><RefreshCw size={16} /></button>}
      </div>
      {state.kind === 'error' ? <div role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t('collaboration.dashboard.stale')}</div> : null}
      {showResumeInstructions ? <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-blue-900">{t('collaboration.dashboard.resumeInstructions')}</h2><p className="mt-1 text-sm text-blue-800">{t('collaboration.dashboard.resumeInstructionsHelp')}</p></div><button type="button" onClick={() => setResumeInstructions([])} className="text-sm text-blue-800">{t('common.close')}</button></div><div className="mt-3 space-y-2">{resumeInstructions.map((instruction) => <div key={instruction.agentId} className="flex min-w-0 flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center"><p className="min-w-0 flex-1 break-words text-sm">{instruction.text}</p><button type="button" onClick={() => void copyResumeInstruction(instruction.text, setToast, t)} className="min-h-9 shrink-0 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.copyResume')}</button></div>)}</div></section> : null}

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.8fr)_minmax(17rem,1fr)]">
        <RunSummary run={run} role={humanRole} userId={user?.id} t={t} onAction={(kind) => openAction({ type: 'run', kind })} />
        <TaskPanel run={run} role={humanRole} userId={user?.id} t={t} onAction={(kind, task) => openAction({ type: 'task', kind, task })} />
        <ReviewPanel run={run} role={humanRole} userId={user?.id} t={t} onDecision={(kind, review) => openAction({ type: 'review', kind, review })} />
        <ArtifactPanel run={run} t={t} />
        <AgentActivityPanel run={run} t={t} />
      </div>

      {pending ? <ActionDialog pending={pending} run={run} reason={reason} setReason={setReason} agentId={agentId} setAgentId={setAgentId} agents={executableAgents} submitting={submitting} onClose={() => setPending(null)} onConfirm={() => void submitAction()} t={t} /> : null}
      {toast ? <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} /> : null}
    </div>
  );
};

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
