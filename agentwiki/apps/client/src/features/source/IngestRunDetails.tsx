import { bugOperationsText } from '../../i18n/bug-operations-messages';
import React from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';
import { runtimeLabel } from '../../i18n/runtime-label';
import { reviewStatusLabel } from '../review/ChangeSetStatusBadge';
import { ingestRunFailure } from './ingestRunFailure';

const safeDiagnosticUrl = (value: unknown) => {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch { return ''; }
};

export const IngestRunDetails: React.FC<{ run: any; spaceId?: string; showRunLink?: boolean }> = ({ run, spaceId, showRunLink = true }) => {
  const { t, language } = useLanguage();
  const op = (key: string) => bugOperationsText(language, key);
  const failure = ingestRunFailure(run, language, t);
  // Allowlist structured fields: never render historical raw errors, headers or payloads.
  const diagnostic = {
    ...(failure?.code ? { code: failure.code } : {}), ...(failure?.stage ? { stage: failure.stage } : {}),
    ...(run.id ? { runId: run.id } : {}),
    ...(Number.isInteger(run.result?.sourceMetadata?.statusCode) ? { httpStatus: run.result.sourceMetadata.statusCode } : {}),
    ...(safeDiagnosticUrl(run.result?.sourceMetadata?.finalUrl) ? { finalUrl: safeDiagnosticUrl(run.result.sourceMetadata.finalUrl) } : {}),
  };
  const counters = ['chunks', 'pages', 'changeItems', 'entities', 'relations'];
  const terminal = ['completed', 'failed', 'partial', 'cancelled'].includes(run.status);
  return <div className="space-y-2 text-xs text-gray-600">
    <p><span>{runtimeLabel(run.status, t)}</span>{run.stage && run.stage !== run.status && !terminal ? <> · {runtimeLabel(run.stage, t)}</> : null} · {t('run.attempt')} {run.attempts ?? 0}/{run.maxAttempts ?? 3} · {new Date(run.createdAt).toLocaleString(language)}{run.updatedAt ? <> · {t('run.lastUpdated')} {new Date(run.updatedAt).toLocaleString(language)}</> : null}</p>
    {failure ? <div className="space-y-2 rounded-lg border border-red-100 bg-red-50 p-3">
      <p className="font-medium">{op('operations.failureStage')}: {failure.stageLabel}</p>
      <p className="text-red-700">{failure.reason}</p>
      <p>{op('operations.nextStep')}: {failure.advice}</p>
      {Object.keys(diagnostic).length ? <details><summary className="cursor-pointer">{op('operations.technical')}</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(diagnostic, null, 2)}</pre></details> : null}
    </div> : null}
    {counters.some((key) => typeof run.result?.[key] === 'number') ? <p>{counters.filter((key) => typeof run.result?.[key] === 'number').map((key) => `${t(`run.counter.${key}`)}: ${run.result[key]}`).join(' · ')}</p> : null}
    {run.result?.sourceMetadata ? <div className="rounded-lg bg-gray-50 p-2 space-y-1">
      <p className="break-all"><strong>{t('run.finalUrl')}:</strong> {safeDiagnosticUrl(run.result.sourceMetadata.finalUrl) || t('common.notAvailable')}</p>
      <p><strong>{t('run.contentType')}:</strong> {run.result.sourceMetadata.contentType || t('common.notAvailable')}</p>
      <p>{t('run.redirectCount', { count: run.result.sourceMetadata.redirectCount || 0 })}</p>
    </div> : null}
    {run.artifacts?.length ? <div><p className="font-medium">{t('run.artifacts')} ({run.artifacts.length})</p>{run.artifacts.map((artifact: any) => <details key={artifact.id} className="mt-1 rounded-lg border p-2"><summary className="cursor-pointer">{['chunk', 'compiled_page', 'index'].includes(artifact.type) ? t(`run.artifact.${artifact.type}`) : t('run.artifact.other')}{artifact.metadata?.title ? ` · ${artifact.metadata.title}` : ''}</summary>{artifact.content ? <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{artifact.content}</pre> : null}</details>)}</div> : null}
    <div className="flex flex-wrap gap-3">
      {run.changeSet ? <Link to={'/review?changeSet=' + encodeURIComponent(run.changeSet.id)} className="inline-flex min-h-8 items-center text-blue-700 underline">{t('nav.review')} · {reviewStatusLabel(run.changeSet.status, language, t('common.notAvailable'))}</Link> : null}
      {showRunLink && spaceId && run.id ? <Link to={`/spaces/${spaceId}/sources?view=runs&run=${encodeURIComponent(run.id)}`} className="inline-flex min-h-8 items-center text-blue-700 underline">{t('run.details')}</Link> : null}
    </div>
  </div>;
};
