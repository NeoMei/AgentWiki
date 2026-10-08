import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { runtimeLabel } from '../../i18n/runtime-label';
import { reviewStatusLabel } from '../review/ChangeSetStatusBadge';

const GIT_FAILURE_CODES = new Set(['GIT_UNAVAILABLE', 'GIT_TIMEOUT', 'GIT_ACCESS_FAILED', 'GIT_FETCH_FAILED', 'GIT_CHECKOUT_FAILED', 'GIT_SOURCE_EMPTY']);
const safeDiagnosticUrl = (value: unknown) => {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return ''; }
};

export const IngestRunDetails: React.FC<{ run: any; spaceId?: string }> = ({ run, spaceId }) => {
  const { t, language } = useLanguage();
  const counters = ['chunks', 'pages', 'changeItems', 'entities', 'relations'];
  return <div className="space-y-2 text-xs text-gray-600">
    <p><span>{runtimeLabel(run.status, t)}</span>{run.stage && run.stage !== run.status ? <> · {runtimeLabel(run.stage, t)}</> : null} · {t('run.attempt')} {run.attempts ?? 0}/{run.maxAttempts ?? 3} · {new Date(run.createdAt).toLocaleString(language)}</p>
    {run.error || run.result?.failure ? <p className="text-red-600">{t(GIT_FAILURE_CODES.has(run.result?.failure?.code) ? `run.failure.${run.result.failure.code}` : 'run.failedSummary')}{run.result?.failure?.stage ? <> · {runtimeLabel(run.result.failure.stage, t)}</> : null}</p> : null}
    {counters.some((key) => typeof run.result?.[key] === 'number') ? <p>{counters.filter((key) => typeof run.result?.[key] === 'number').map((key) => `${t(`run.counter.${key}`)}: ${run.result[key]}`).join(' · ')}</p> : null}
    {run.result?.sourceMetadata ? <div className="rounded-lg bg-gray-50 p-2 space-y-1">
      <p className="break-all"><strong>{t('run.finalUrl')}:</strong> {safeDiagnosticUrl(run.result.sourceMetadata.finalUrl) || t('common.notAvailable')}</p>
      <p><strong>{t('run.contentType')}:</strong> {run.result.sourceMetadata.contentType || t('common.notAvailable')}</p>
      <p>{t('run.redirectCount', { count: run.result.sourceMetadata.redirectCount || 0 })}</p>
    </div> : null}
    {run.artifacts?.length ? <div><p className="font-medium">{t('run.artifacts')} ({run.artifacts.length})</p>{run.artifacts.map((artifact: any) => <details key={artifact.id} className="mt-1 rounded-lg border p-2"><summary className="cursor-pointer">{['chunk', 'compiled_page', 'index'].includes(artifact.type) ? t(`run.artifact.${artifact.type}`) : t('run.artifact.other')}{artifact.metadata?.title ? ` · ${artifact.metadata.title}` : ''}</summary>{artifact.content ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{artifact.content}</pre> : null}</details>)}</div> : null}
    <div className="flex flex-wrap gap-3">
      {run.changeSet ? <Link to={'/review?changeSet=' + encodeURIComponent(run.changeSet.id)} className="inline-flex min-h-8 items-center text-blue-700 underline">{t('nav.review')} · {reviewStatusLabel(run.changeSet.status, language, t('common.notAvailable'))}</Link> : null}
      {spaceId && run.id ? <Link to={`/spaces/${spaceId}/sources?view=runs&run=${encodeURIComponent(run.id)}`} className="inline-flex min-h-8 items-center text-blue-700 underline">{t('run.details')}</Link> : null}
    </div>
  </div>;
};
