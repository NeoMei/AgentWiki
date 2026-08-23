import React from 'react';
import { AlertTriangle, Ban, CheckCircle2, CircleDot, Clock3, Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import type { CollaborationRun, HumanSpaceRole } from '../types';

const ICONS = {
  completed: CheckCircle2, failed: XCircle, cancelled: Ban, paused: Pause,
  waiting_review: Clock3, running: Play, ready: CircleDot, draft: CircleDot, retry_wait: RotateCcw,
} as const;

export const RunSummary: React.FC<{
  run: CollaborationRun;
  role?: HumanSpaceRole;
  userId?: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  onAction: (kind: 'pause' | 'resume' | 'fail' | 'cancel') => void;
}> = ({ run, role, userId, t, onAction }) => {
  const Icon = ICONS[run.status] ?? AlertTriangle;
  const manager = role === 'owner' || role === 'admin';
  const starter = run.startedById === userId;
  const canOperate = manager || starter;
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
  return (
    <aside data-testid="dashboard-section-summary" className="order-1 min-w-0 rounded-xl border bg-white p-4 lg:col-start-1 lg:row-start-1">
      <div aria-label={`${t(`collaboration.status.${run.status}`)} ${t('common.status').toLowerCase()}`} className="flex items-center gap-2">
        <Icon data-testid="status-icon" size={18} className="shrink-0" aria-hidden="true" />
        <span className="font-semibold">{t(`collaboration.status.${run.status}`)}</span>
      </div>
      <h2 className="mt-4 break-words text-lg font-semibold">{run.name}</h2>
      <dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-gray-500">{t('collaboration.dashboard.updated')}</dt><dd>{new Date(run.updatedAt).toLocaleString()}</dd></div><div><dt className="text-xs text-gray-500">{t('collaboration.dashboard.version')}</dt><dd>{run.version}</dd></div>{run.pauseReason ? <div><dt className="text-xs text-gray-500">{t('collaboration.dashboard.pauseReason')}</dt><dd className="break-words">{run.pauseReason}</dd></div> : null}</dl>
      {!terminal ? <div className="mt-5 grid gap-2">
        {canOperate && ['running', 'waiting_review'].includes(run.status) ? <button type="button" onClick={() => onAction('pause')} className="min-h-10 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.pause')}</button> : null}
        {canOperate && run.status === 'paused' ? <button type="button" onClick={() => onAction('resume')} className="min-h-10 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.resume')}</button> : null}
        {manager ? <button type="button" onClick={() => onAction('fail')} className="min-h-10 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.fail')}</button> : null}
        {manager ? <button type="button" onClick={() => onAction('cancel')} className="min-h-10 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.cancel')}</button> : null}
      </div> : null}
    </aside>
  );
};

