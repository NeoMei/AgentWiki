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
  onGetContinuation?: () => void;
  continuationLoading?: boolean;
}> = ({ run, role, userId, t, onAction, onGetContinuation, continuationLoading = false }) => {
  const Icon = ICONS[run.status] ?? AlertTriangle;
  const manager = role === 'owner' || role === 'admin';
  const starter = run.startedById === userId;
  const canOperate = !!role && (manager || starter);
  const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
  return (
    <aside data-testid="dashboard-section-summary" tabIndex={0} className="aw-collab-summary min-h-0 min-w-0 lg:self-start">
      <div aria-label={`${t(`collaboration.status.${run.status}`)} ${t('common.status').toLowerCase()}`} className="aw-collab-status aw-collab-summary-status" data-status={run.status}>
        <Icon data-testid="status-icon" size={15} className="shrink-0" aria-hidden="true" />
        <span>{t(`collaboration.status.${run.status}`)}</span>
      </div>
      <dl className="aw-collab-summary-facts"><div><dt>{t('collaboration.dashboard.updated')}</dt><dd>{new Date(run.updatedAt).toLocaleString()}</dd></div><div><dt>{t('collaboration.dashboard.version')}</dt><dd>{run.version}</dd></div>{run.pauseReason ? <div><dt>{t('collaboration.dashboard.pauseReason')}</dt><dd>{run.pauseReason}</dd></div> : null}</dl>
      <div className="aw-collab-summary-actions">
        {canOperate && ['running', 'waiting_review'].includes(run.status) && onGetContinuation ? <button type="button" disabled={continuationLoading} onClick={onGetContinuation} className="aw-collab-button">{t(continuationLoading ? 'collaboration.dashboard.gettingContinuation' : 'collaboration.dashboard.getContinuation')}</button> : null}
        {!terminal ? <>
          {canOperate && ['running', 'waiting_review'].includes(run.status) ? <button type="button" onClick={() => onAction('pause')} className="aw-collab-button">{t('collaboration.dashboard.pause')}</button> : null}
          {canOperate && run.status === 'paused' ? <button type="button" onClick={() => onAction('resume')} className="aw-collab-button">{t('collaboration.dashboard.resume')}</button> : null}
          {manager ? <button type="button" onClick={() => onAction('fail')} className="aw-collab-button aw-collab-button-ghost aw-collab-button-danger">{t('collaboration.dashboard.fail')}</button> : null}
          {manager ? <button type="button" onClick={() => onAction('cancel')} className="aw-collab-button aw-collab-button-ghost aw-collab-button-danger">{t('collaboration.dashboard.cancel')}</button> : null}
        </> : null}
      </div>
    </aside>
  );
};
