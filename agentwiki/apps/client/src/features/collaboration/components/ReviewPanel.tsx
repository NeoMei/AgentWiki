import React from 'react';
import { Link } from 'react-router-dom';
import type { CollaborationArtifact, CollaborationPageReviewComparison, CollaborationReview, CollaborationRun } from '../types';

export type ReviewDetail =
  | { reviewId: string; kind: 'loading' }
  | { reviewId: string; kind: 'error'; message: string }
  | { reviewId: string; kind: 'comparison'; comparison: CollaborationPageReviewComparison };

export const ReviewPanel: React.FC<{
  run: CollaborationRun;
  spaceId: string;
  t: (key: string, params?: Record<string, string | number>) => string;
  artifacts: Record<string, CollaborationArtifact>;
  artifactErrors: Record<string, boolean>;
  detail: ReviewDetail | null;
  resolvingConflict: boolean;
  onLoadDetail: (review: CollaborationReview) => void;
  onRetryArtifact: (review: CollaborationReview) => void;
  onHistory: () => void;
  onDecision: (kind: 'approve' | 'reject_for_revision' | 'terminate', review: CollaborationReview) => void;
  onResolveConflict: (kind: 'regenerate' | 'adopt_current', review: CollaborationReview, comparison: CollaborationPageReviewComparison) => void;
}> = ({ run, spaceId, t, artifacts, artifactErrors, detail, resolvingConflict, onLoadDetail, onRetryArtifact, onHistory, onDecision, onResolveConflict }) => (
  <section data-testid="dashboard-section-reviews" className="order-3 min-w-0 rounded-xl border bg-white p-4 lg:col-start-3 lg:row-start-1">
    <h2 className="font-semibold">{t('collaboration.dashboard.reviews')}</h2>
    <div className="mt-3 space-y-3">{(run.reviews ?? []).length ? (run.reviews ?? []).map((review) => {
      const pageReview = Boolean(review.pagePublication || run.tasks?.some((task) => task.id === review.sourceTaskId && task.targetPageId));
      const selected = pageReview && detail?.reviewId === review.id ? detail : null;
      const comparison = selected?.kind === 'comparison' ? selected.comparison : null;
      const artifact = pageReview ? null : artifacts[review.id];
      const artifactError = !pageReview && artifactErrors[review.id];
      const canDecide = review.status === 'pending' && (pageReview ? comparison?.canDecide === true : review.canDecide === true && Boolean(artifact));
      const recoverConflict = Boolean(pageReview && comparison?.mode === 'candidate' && comparison.conflict && comparison.canDecide && run.pauseReason === 'page_version_conflict');
      return <article key={review.id} className="rounded-lg border p-3">
        <p className="text-sm font-medium">{t(`collaboration.reviewStatus.${review.status}`)}</p>
        {review.approvalCriteria?.length ? <div className="mt-3"><h3 className="text-xs font-medium text-gray-700">{t('collaboration.dashboard.approvalCriteria')}</h3><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-600">{review.approvalCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div> : null}
        {pageReview && !selected ? <button type="button" onClick={() => onLoadDetail(review)} className="mt-3 min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.loadPageComparison')}</button> : null}
        {selected?.kind === 'loading' ? <p role="status" className="mt-3 text-xs text-gray-500">{t('common.loading')}</p> : null}
        {selected?.kind === 'error' ? <div role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{selected.message}<button type="button" onClick={() => onLoadDetail(review)} className="ml-2 underline">{t('common.retry')}</button></div> : null}
        {artifact ? <ArtifactDetail artifact={artifact} t={t} /> : null}
        {!pageReview && review.status === 'pending' && !artifact ? <div className="mt-3 rounded-lg bg-gray-50 p-3">{artifactError
          ? <div role="alert" className="text-xs text-red-700">{t('collaboration.dashboard.reviewArtifactFailed')}<button type="button" onClick={() => onRetryArtifact(review)} className="ml-2 underline">{t('common.retry')}</button></div>
          : <p className="text-xs text-gray-500">{t('collaboration.dashboard.loadingReviewArtifact')}</p>}</div> : null}
        {comparison ? <PageComparison comparison={comparison} spaceId={spaceId} t={t} /> : null}
        {review.reason ? <p className="mt-2 break-words text-xs text-gray-500">{review.reason}</p> : null}
        {recoverConflict && comparison ? <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">{t('collaboration.dashboard.conflictRecoveryHelp')}</p><div className="flex flex-col gap-2 sm:flex-row"><button type="button" disabled={resolvingConflict} onClick={() => onResolveConflict('regenerate', review, comparison)} className="min-h-10 rounded-lg border border-amber-300 bg-white px-3 text-sm disabled:opacity-50">{t('collaboration.dashboard.regenerateFromCurrent')}</button><button type="button" disabled={resolvingConflict} onClick={() => onResolveConflict('adopt_current', review, comparison)} className="min-h-10 rounded-lg bg-amber-700 px-3 text-sm text-white disabled:opacity-50">{t('collaboration.dashboard.adoptCurrent')}</button></div></div>
          : canDecide ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onDecision('approve', review)} className="min-h-9 rounded-lg bg-green-600 px-3 text-sm text-white">{t('collaboration.dashboard.approve')}</button><button type="button" onClick={() => onDecision('reject_for_revision', review)} className="min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.reject')}</button>{review.allowTerminate ? <button type="button" onClick={() => onDecision('terminate', review)} className="min-h-9 rounded-lg border border-red-200 px-3 text-sm text-red-700">{t('collaboration.dashboard.terminate')}</button> : null}</div>
            : comparison || artifact ? <p className="mt-3 text-xs text-gray-500">{t('collaboration.dashboard.readOnlyReview')}</p> : null}
      </article>;
    }) : <p className="text-sm text-gray-500">{t('collaboration.dashboard.noReviews')}</p>}</div>
    <button type="button" onClick={onHistory} className="mt-4 min-h-9 rounded-lg border px-3 text-sm">{t('collaboration.dashboard.viewAllReviews')}</button>
  </section>
);

const ArtifactDetail: React.FC<{ artifact: CollaborationArtifact; t: (key: string) => string }> = ({ artifact, t }) => <div className="mt-3 rounded-lg bg-gray-50 p-3"><h3 className="text-xs font-medium text-gray-700">{t('collaboration.dashboard.reviewArtifact')}</h3><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700">{artifactText(artifact.payload)}</pre>{artifact.evidence ? <><h4 className="mt-3 text-xs font-medium text-gray-700">{t('collaboration.dashboard.evidence')}</h4><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-600">{artifactText(artifact.evidence)}</pre></> : null}</div>;

const PageComparison: React.FC<{ comparison: CollaborationPageReviewComparison; spaceId: string; t: (key: string, params?: Record<string, string | number>) => string }> = ({ comparison, spaceId, t }) => <div className="mt-3 min-w-0 rounded-lg border bg-gray-50 p-3">
  <Link to={`/pages/${comparison.target.pageId}`} className="break-words text-sm font-medium text-blue-700 underline">{comparison.target.title} · {comparison.target.pageId}</Link>
  {comparison.mode === 'candidate' ? <><dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"><VersionFact label={t('collaboration.dashboard.baselineVersion')} value={comparison.baseline.pageVersionId} hash={comparison.baseline.contentHash} t={t} /><VersionFact label={t('collaboration.dashboard.currentVersion')} value={comparison.current.pageVersionId} hash={comparison.current.contentHash} t={t} /></dl><div className="mt-3 grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-3"><MarkdownSnapshot title={t('collaboration.dashboard.baseline')} value={comparison.baseline.available ? comparison.baseline.markdown : null} unavailable={t('collaboration.dashboard.baselineUnavailable')} /><MarkdownSnapshot title={t('collaboration.dashboard.proposed')} value={comparison.candidate.markdown} /><MarkdownSnapshot title={t('collaboration.dashboard.current')} value={comparison.current.markdown} /></div><Link to={`/review?spaceId=${encodeURIComponent(spaceId)}&changeSet=${encodeURIComponent(comparison.candidate.changeSetId)}`} className="mt-3 inline-flex min-h-9 items-center break-all text-xs font-medium text-blue-700 underline">{t('collaboration.dashboard.linkedChangeSet')}: {comparison.candidate.changeSetId}</Link>{comparison.conflict ? <p role="status" className="mt-2 rounded-lg bg-amber-100 p-2 text-xs text-amber-900">{t('collaboration.dashboard.pageConflict')}</p> : null}</>
    : <><p className="mt-3 text-xs text-gray-600">{t('collaboration.dashboard.adoptedCurrentSource')}</p><dl className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"><VersionFact label={t('collaboration.dashboard.adoptedVersion')} value={comparison.adoptedCurrent.pageVersionId} hash={comparison.adoptedCurrent.contentHash} t={t} /><VersionFact label={t('collaboration.dashboard.currentVersion')} value={comparison.current.pageVersionId} hash={comparison.current.contentHash} t={t} /></dl><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><MarkdownSnapshot title={t('collaboration.dashboard.adopted')} value={comparison.adoptedCurrent.markdown} /><MarkdownSnapshot title={t('collaboration.dashboard.current')} value={comparison.current.markdown} /></div></>}
</div>;

const VersionFact: React.FC<{ label: string; value: string | null; hash: string | null; t: (key: string) => string }> = ({ label, value, hash, t }) => <div className="min-w-0 rounded-lg border bg-white p-2"><dt className="font-medium text-gray-700">{label}</dt><dd className="mt-1 break-all text-gray-600">{value ?? t('collaboration.dashboard.noVersion')}</dd><dd className="mt-1 break-all font-mono text-[11px] text-gray-500">{hash ?? t('collaboration.dashboard.noHash')}</dd></div>;
const MarkdownSnapshot: React.FC<{ title: string; value: string | null; unavailable?: string }> = ({ title, value, unavailable }) => <section className="min-w-0 rounded-lg border bg-white p-2"><h4 className="text-xs font-medium text-gray-700">{title}</h4>{value === null ? <p className="mt-2 text-xs text-gray-500">{unavailable}</p> : <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700">{value}</pre>}</section>;
function artifactText(value: unknown): string { if (typeof value === 'string') return value; if (value && typeof value === 'object' && typeof (value as { markdown?: unknown }).markdown === 'string') return (value as { markdown: string }).markdown; return JSON.stringify(value, null, 2); }
