import React from 'react';
import type { CollaborationArtifact, CollaborationReview, CollaborationRun } from '../types';

export const ReviewPanel: React.FC<{
  run: CollaborationRun;
  t: (key: string) => string;
  artifacts: Record<string, CollaborationArtifact>;
  artifactErrors: Record<string, boolean>;
  onRetryArtifact: (review: CollaborationReview) => void;
  onHistory: () => void;
  onDecision: (kind: 'approve' | 'reject_for_revision' | 'terminate', review: CollaborationReview) => void;
}> = ({ run, t, artifacts, artifactErrors, onRetryArtifact, onHistory, onDecision }) => (
  <section data-testid="dashboard-section-reviews" className="order-3 min-w-0 rounded-xl border bg-white p-4 lg:col-start-3 lg:row-start-1">
    <h2 className="font-semibold">{t('collaboration.dashboard.reviews')}</h2>
    <div className="mt-3 space-y-3">{(run.reviews ?? []).length ? (run.reviews ?? []).map((review) => {
      const allowed = review.status === 'pending' && review.canDecide === true;
      const artifact = artifacts[review.id];
      const artifactError = artifactErrors[review.id];
      return <article key={review.id} className="rounded-lg border p-3"><p className="text-sm font-medium">{t(`collaboration.reviewStatus.${review.status}`)}</p>{review.approvalCriteria?.length ? <div className="mt-3"><h3 className="text-xs font-medium text-gray-700">{t('collaboration.dashboard.approvalCriteria')}</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-600">{review.approvalCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div> : null}{review.status === 'pending' ? <div className="mt-3 rounded-lg bg-gray-50 p-3">{artifact ? <><h3 className="text-xs font-medium text-gray-700">{t('collaboration.dashboard.reviewArtifact')}</h3><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700">{artifactText(artifact.payload)}</pre>{artifact.evidence ? <><h4 className="mt-3 text-xs font-medium text-gray-700">{t('collaboration.dashboard.evidence')}</h4><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-600">{artifactText(artifact.evidence)}</pre></> : null}</> : artifactError ? <div role="alert" className="text-xs text-red-700">{t('collaboration.dashboard.reviewArtifactFailed')}<button type="button" onClick={() => onRetryArtifact(review)} className="ml-2 underline">{t('common.retry')}</button></div> : <p className="text-xs text-gray-500">{t('collaboration.dashboard.loadingReviewArtifact')}</p>}</div> : null}{review.reason ? <p className="mt-1 break-words text-xs text-gray-500">{review.reason}</p> : null}{allowed ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!artifact} onClick={() => onDecision('approve', review)} className="min-h-9 rounded-lg bg-green-600 px-3 text-sm text-white disabled:opacity-50">{t('collaboration.dashboard.approve')}</button><button type="button" disabled={!artifact} onClick={() => onDecision('reject_for_revision', review)} className="min-h-9 rounded-lg border px-3 text-sm disabled:opacity-50">{t('collaboration.dashboard.reject')}</button>{review.allowTerminate ? <button type="button" disabled={!artifact} onClick={() => onDecision('terminate', review)} className="min-h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700 disabled:opacity-50">{t('collaboration.dashboard.terminate')}</button> : null}</div> : null}</article>;
    }) : <p className="text-sm text-gray-500">{t('collaboration.dashboard.noReviews')}</p>}</div><button type="button" onClick={onHistory} className="mt-4 min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.viewAllReviews')}</button>
  </section>
);

function artifactText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { markdown?: unknown }).markdown === 'string') {
    return (value as { markdown: string }).markdown;
  }
  return JSON.stringify(value, null, 2);
}
