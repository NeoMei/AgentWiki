import React from 'react';
import type { CollaborationReview, CollaborationRun, HumanSpaceRole } from '../types';

const ROLE_LEVEL: Record<HumanSpaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const ReviewPanel: React.FC<{
  run: CollaborationRun;
  role?: HumanSpaceRole;
  userId?: string;
  t: (key: string) => string;
  onDecision: (kind: 'approve' | 'reject_for_revision' | 'terminate', review: CollaborationReview) => void;
}> = ({ run, role, userId, t, onDecision }) => (
  <section data-testid="dashboard-section-reviews" className="order-3 min-w-0 rounded-xl border bg-white p-4 lg:col-start-3 lg:row-start-1">
    <h2 className="font-semibold">{t('collaboration.dashboard.reviews')}</h2>
    <div className="mt-3 space-y-3">{(run.reviews ?? []).length ? (run.reviews ?? []).map((review) => {
      const allowed = review.status === 'pending' && !!role && ROLE_LEVEL[role] >= ROLE_LEVEL[review.minimumRole]
        && (!review.reviewerUserIds.length || (!!userId && review.reviewerUserIds.includes(userId)));
      return <article key={review.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{t(`collaboration.reviewStatus.${review.status}`)}</p>{review.reason ? <p className="mt-1 break-words text-xs text-gray-500">{review.reason}</p> : null}{allowed ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onDecision('approve', review)} className="min-h-9 rounded-lg bg-green-600 px-3 text-sm text-white">{t('collaboration.dashboard.approve')}</button><button type="button" onClick={() => onDecision('reject_for_revision', review)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.reject')}</button>{review.allowTerminate ? <button type="button" onClick={() => onDecision('terminate', review)} className="min-h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.terminate')}</button> : null}</div> : null}</article>;
    }) : <p className="text-sm text-gray-500">{t('collaboration.dashboard.noReviews')}</p>}</div>
  </section>
);
