import { bugOperationsMessages, bugOperationsText } from '../../i18n/bug-operations-messages';
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

export const IngestRunDetails: React.FC<{ run: any; spaceId?: string; showRunLink?: boolean }> = ({ run, spaceId, showRunLink = true }) => {
  const { t, language } = useLanguage();
  const op = (key: string) => bugOperationsText(language, key);
  const failure = run.result?.failure;
  const code = typeof failure?.code === 'string' && /^[A-Z_]{1,80}$/.test(failure.code) ? failure.code : undefined;
  const stage = typeof failure?.stage === 'string' && ['fetching', 'extracting', 'compiling', 'indexing', 'publishing'].includes(failure.stage) ? failure.stage : undefined;
  const knownRemoteCode = code && bugOperationsMessages.en[`operations.failure.${code}`];
  const httpStatus = Number.isInteger(run.result?.sourceMetadata?.statusCode) ? run.result.sourceMetadata.statusCode : undefined;
  const httpReason = code === 'REMOTE_REQUEST_FAILED' && httpStatus
    ? [401, 403].includes(httpStatus) ? 'httpDenied' : httpStatus === 404 ? 'httpMissing' : httpStatus === 429 ? 'httpLimited' : httpStatus >= 500 ? 'httpServer' : undefined
    : undefined;
  const advice = code === 'REMOTE_URL_REJECTED' ? 'url' : code === 'REMOTE_REQUEST_FAILED' ? 'request'
    : code === 'REMOTE_BODY_TOO_LARGE' ? 'size' : code === 'REMOTE_ENCODING_INVALID' ? 'encoding'
      : code?.startsWith('REMOTE_REDIRECT') ? 'redirect' : ['REMOTE_CONTENT_TYPE_UNSUPPORTED', 'REMOTE_SOURCE_EMPTY'].includes(code || '') ? 'text' : 'unknown';
  // Allowlist structured fields: never render historical raw errors, headers or payloads.
  const diagnostic = {
    ...(code ? { code } : {}), ...(stage ? { stage } : {}),
    ...(run.id ? { runId: run.id } : {}),
    ...(Number.isInteger(run.result?.sourceMetadata?.statusCode) ? { httpStatus: run.result.sourceMetadata.statusCode } : {}),
    ...(safeDiagnosticUrl(run.result?.sourceMetadata?.finalUrl) ? { finalUrl: safeDiagnosticUrl(run.result.sourceMetadata.finalUrl) } : {}),
  };
  const counters = ['chunks', 'pages', 'changeItems', 'entities', 'relations'];
  const terminal = ['completed', 'failed', 'partial', 'cancelled'].includes(run.status);
  return <div className="space-y-2 text-xs text-gray-600">
    <p><span>{runtimeLabel(run.status, t)}</span>{run.stage && run.stage !== run.status && !terminal ? <> · {runtimeLabel(run.stage, t)}</> : null} · {t('run.attempt')} {run.attempts ?? 0}/{run.maxAttempts ?? 3} · {new Date(run.createdAt).toLocaleString(language)}{run.updatedAt ? <> · {t('run.lastUpdated')} {new Date(run.updatedAt).toLocaleString(language)}</> : null}</p>
    {run.error || failure || run.status === 'failed' ? <div className="space-y-2 rounded-lg border border-red-100 bg-red-50 p-3">
      <p className="font-medium">{op('operations.failureStage')}: {stage ? op(`operations.stage.${stage}`) : op('operations.stageUnknown')}</p>
      <p className="text-red-700">{httpReason ? `${op(`operations.failure.${httpReason}`)}（HTTP ${httpStatus}）` : GIT_FAILURE_CODES.has(code || '') ? t(`run.failure.${code}`) : op(knownRemoteCode ? `operations.failure.${code}` : 'operations.failure.unknown')}</p>
      <p>{op('operations.nextStep')}: {op(`operations.advice.${advice}`)}</p>
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
