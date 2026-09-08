import React, { useEffect, useRef, useState } from 'react';
import { Database, Info, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../../context/LanguageContext';

interface EvidenceItem {
  id: string;
  quote?: string;
  confidence?: number;
  location?: unknown;
  sourceVersion?: { version?: string | number; metadata?: { commit?: string }; files?: Array<{ path: string }> };
}

export interface PageInfoPanelProps {
  spaceId: string;
  provenance?: any;
  evidence?: EvidenceItem[];
  lastChange?: { id: string; title: string; status: string } | null;
  lastModifiedByUser?: { id: string; name?: string; email?: string } | null;
  lastModifiedByAgent?: { id: string; name: string } | null;
  lastModifiedAt?: string;
  canEdit: boolean;
  deleting: boolean;
  onDelete: () => void;
}

export const PageInfoPanel: React.FC<PageInfoPanelProps> = ({
  spaceId,
  provenance,
  evidence = [],
  lastChange,
  lastModifiedByUser,
  lastModifiedByAgent,
  lastModifiedAt,
  canEdit,
  deleting,
  onDelete,
}) => {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <Info size={17} aria-hidden="true" />
        {t('page.information')}
      </button>
      {open ? (
        <aside
          aria-label={t('page.information')}
          className="fixed bottom-0 right-0 top-16 z-40 w-full max-w-sm overflow-y-auto border-l border-gray-200 bg-white p-5 shadow-xl"
        >
          <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900"><Database size={18} /> {t('page.sourceChanges')}</h2>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
              }}
              aria-label={t('common.close')}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {provenance ? (
            <div className="space-y-4 text-sm">
              <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.createdBy')}</span><p className="mt-1">{provenance.createdByAgent?.name ? `Agent · ${provenance.createdByAgent.name}` : t('page.human')}</p></div>
              <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.source')}</span><p className="mt-1 break-words">{provenance.run?.source?.name || t('page.unknown')} · {provenance.run?.source?.type || t('page.unknown')}</p>{provenance.run?.source?.uri ? <p className="mt-1 break-all text-xs text-gray-500">{provenance.run.source.uri}</p> : null}</div>
              <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.extractionRun')}</span><p className="mt-1"><Link className="text-blue-600 hover:underline" to={`/spaces/${spaceId}/runs`}>{provenance.run?.id || t('page.unknown')}</Link> · {provenance.run?.stage || provenance.run?.status}</p></div>
              <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.candidateChange')}</span><p className="mt-1">{provenance.title} · {provenance.status}</p></div>
              <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.approval')}</span><p className="mt-1">{provenance.approvals?.[0]?.reviewer?.name || provenance.approvals?.[0]?.reviewer?.email || (provenance.status === 'published' ? t('page.autoPublished') : t('page.notApproved'))}</p>{provenance.publishedAt ? <p className="mt-1 text-xs text-gray-500">{t('page.published', { date: new Date(provenance.publishedAt).toLocaleString(language) })}</p> : null}</div>
            </div>
          ) : <p className="text-sm text-gray-500">{t('page.humanCreated')}</p>}

          <div className="mt-5 border-t border-gray-100 pt-5 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">{t('page.latestChange')}</span>
            <p className="mt-1">{lastModifiedByAgent?.name ? `Agent · ${lastModifiedByAgent.name}` : lastModifiedByUser?.name || lastModifiedByUser?.email || t('page.human')}</p>
            {lastChange ? <p className="mt-1 text-xs"><Link className="text-blue-600 hover:underline" to={`/review?changeSet=${lastChange.id}`}>{lastChange.title}</Link> · {lastChange.status}</p> : <p className="mt-1 text-xs text-gray-500">{t('page.directEdit')}</p>}
            {lastModifiedAt ? <p className="mt-1 text-xs text-gray-500">{t('page.changed', { date: new Date(lastModifiedAt).toLocaleString(language) })}</p> : null}
          </div>

          <div className="mt-5 border-t border-gray-100 pt-5 text-sm">
            <span className="text-xs uppercase tracking-wide text-gray-400">{t('page.evidence', { count: evidence.length })}</span>
            {evidence.length ? evidence.map((item) => {
              const metadata = item.sourceVersion?.metadata || {};
              const files = item.sourceVersion?.files || [];
              return <blockquote key={item.id} className="mt-2 border-l-2 pl-3 text-xs text-gray-600">
                <p>{item.quote || t('page.noExcerpt')}</p>
                <p className="mt-1 text-gray-400">{t('page.confidenceVersion', { confidence: Math.round((item.confidence ?? 1) * 100), version: item.sourceVersion?.version ?? t('page.unknown') })}</p>
                {item.location ? <p className="mt-1 break-all text-gray-400">{t('page.location')}: {JSON.stringify(item.location)}</p> : null}
                {metadata.commit ? <p className="mt-1 break-all text-gray-400">Commit: {metadata.commit}</p> : null}
                {files.length ? <p className="mt-1 text-gray-400">{t('page.files')}: {files.slice(0, 3).map((file) => file.path).join(', ')}{files.length > 3 ? ` +${files.length - 3}` : ''}</p> : null}
              </blockquote>;
            }) : <p className="mt-1 text-gray-500">{t('page.noEvidence')}</p>}
          </div>

          {canEdit ? (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <Trash2 size={17} aria-hidden="true" />
                {t('page.delete')}
              </button>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
};
