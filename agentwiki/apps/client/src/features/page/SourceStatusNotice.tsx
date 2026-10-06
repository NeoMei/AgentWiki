import { sourceStatusText } from '../../i18n/source-status-messages';
import type { PageSourceStatus } from '@agentwiki/shared';
import { useLanguage } from '../../context/LanguageContext';

export function SourceStatusNotice({ status, details = false, candidate = false }: { status?: PageSourceStatus; details?: boolean; candidate?: boolean }) {
  const { t, language } = useLanguage();
  const sourceText = (key: string) => sourceStatusText(language, key);
  if (!status || status.status === 'untracked') return null;
  if (!details && !candidate && status.status === 'current') return null;
  return <div role="note" className="my-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-gray-700 break-words">
    <p>{sourceText(candidate && status.status === 'current' ? 'sourceStatus.candidateCurrent' : `sourceStatus.${status.status}`)}</p>
    {status.reason === 'page_changed' ? <p className="mt-1">{sourceText('sourceStatus.pageChanged')}</p> : null}
    {details && status.sourceId ? <dl className="mt-2 space-y-1 text-xs">
      <div><dt className="inline font-medium">Source ID: </dt><dd className="inline break-all">{status.sourceId}</dd></div>
      <div><dt className="inline font-medium">{sourceText(candidate ? 'sourceStatus.pinned' : 'sourceStatus.reviewed')}: </dt><dd className="inline">{status.reviewedSourceVersion ?? t('page.unknown')} · {sourceText('sourceStatus.generation')} {status.reviewedSourceGeneration ?? t('page.unknown')}</dd></div>
      {status.reviewedSourceVersionId ? <div className="break-all">SourceVersion ID: {status.reviewedSourceVersionId}</div> : null}
      <div><dt className="inline font-medium">{sourceText('sourceStatus.accepted')}: </dt><dd className="inline">{status.currentSourceVersion ?? t('page.unknown')} · {sourceText('sourceStatus.generation')} {status.currentSourceGeneration ?? t('page.unknown')}</dd></div>
      {status.currentSourceVersionId ? <div className="break-all">SourceVersion ID: {status.currentSourceVersionId}</div> : null}
    </dl> : null}
  </div>;
}
