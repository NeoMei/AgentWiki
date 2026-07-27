import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { ArrowLeft, Clock, User, Trash2, FileText, Database } from 'lucide-react';
import 'highlight.js/styles/github.css';
import { useLanguage } from '../../context/LanguageContext';
import { Markdown } from '../../components/Markdown';
import { ModeToggleButton } from '../../components/ModeToggleButton';

interface Page {
  id: string;
  title: string;
  content: string;
  format: string;
  authorId?: string;
  author?: { name?: string; email?: string };
  createdAt: string;
  updatedAt: string;
  spaceId: string;
  provenance?: any;
  evidence?: any[];
  lastChange?: { id: string; title: string; status: string } | null;
  lastModifiedByUser?: { id: string; name?: string; email?: string } | null;
  lastModifiedByAgent?: { id: string; name: string } | null;
  lastModifiedAt?: string;
}

export const PagePreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [page, setPage] = useState<Page | null>(null);
  const [spacePages, setSpacePages] = useState<Array<{ id: string; title?: string; slug?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [relatedPages, setRelatedPages] = useState<any[]>([]);

  const fetchPage = async () => {
    if (!id) return;
    try {
      const res = await api.get(`/pages/${id}`);
      setPage(res.data);
    } catch (err: any) {
      setError(err.response?.data?.message || t('editor.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPage();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    api.get(`/knowledge/related/${id}`)
      .then(res => setRelatedPages(res.data || []))
      .catch(() => setRelatedPages([]));
  }, [id]);

  useEffect(() => {
    if (!page?.spaceId) return;
    api.get(`/pages?spaceId=${page.spaceId}&take=200`)
      .then((res) => setSpacePages(res.data?.data || res.data?.items || []))
      .catch(() => setSpacePages([]));
  }, [page?.spaceId]);

  const handleDelete = async () => {
    if (!page || !window.confirm(t('page.deleteConfirm', { title: page.title }))) return;
    setDeleting(true);
    try {
      await api.delete(`/pages/${page.id}`);
      navigate(`/spaces/${page.spaceId}`);
    } catch (err: any) {
      setError(err.response?.data?.message || t('page.deleteFailed'));
      setDeleting(false);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      {page?.spaceId ? (
        <Link to={`/spaces/${page.spaceId}`} className="text-blue-600 hover:underline">{t('editor.backToSpace')}</Link>
      ) : (
        <Link to="/" className="text-blue-600 hover:underline">{t('search.back')}</Link>
      )}
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {page.spaceId && (
            <Link to={`/spaces/${page.spaceId}`} className="p-2 hover:bg-gray-100 rounded" title={t('editor.backToSpace')}>
              <ArrowLeft size={20} />
            </Link>
          )}
          <div>
            <h1 className="text-3xl font-bold">{page.title}</h1>
            <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
              {page.author && (
                <span className="flex items-center gap-1">
                  <User size={14} />
                  {page.author.name || page.author.email || t('page.unknown')}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock size={14} />
                {new Date(page.updatedAt).toLocaleDateString(language)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
      <div className="relative bg-white rounded-lg shadow-sm border p-8 min-h-[300px]">
        <div className="absolute right-4 top-4 flex items-center gap-1">
          <ModeToggleButton mode="preview" onToggle={() => navigate(`/pages/${id}/edit`)} />
          <button
            onClick={handleDelete}
            disabled={deleting}
            aria-label={t('page.delete')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            title={t('page.delete')}
          >
            <Trash2 size={18} />
          </button>
        </div>
        <div className="prose prose-sm max-w-none
          [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6
          [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-5
          [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4
          [&_p]:mb-3 [&_p]:leading-7
          [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:mb-3
          [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:mb-3
          [&_li]:mb-1
          [&_a]:text-blue-600 [&_a]:hover:underline
          [&_strong]:font-bold
          [&_em]:italic
          [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-4
          [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
          [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
          [&_pre_code]:bg-transparent [&_pre_code]:p-0
          [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4
          [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
          [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
          [&_hr]:border-gray-300 [&_hr]:my-6
          [&_del]:line-through
          [&_input[type=checkbox]]:mr-2
        ">
          {page.content ? (
            <Markdown pages={spacePages}>{page.content}</Markdown>
          ) : (
            <p className="text-gray-400">{t('page.emptyContent')}</p>
          )}
        </div>
      </div>

      <aside className="border rounded-[14px] bg-white p-4 lg:sticky lg:top-20" aria-label={t('page.sourceChanges')}>
        <h2 className="font-medium flex items-center gap-2"><Database size={16} /> {t('page.sourceChanges')}</h2>
        {page.provenance ? (
          <div className="space-y-4 text-sm mt-4">
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.createdBy')}</span><p className="mt-1">{page.provenance.createdByAgent?.name ? `Agent · ${page.provenance.createdByAgent.name}` : t('page.human')}</p></div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.source')}</span><p className="mt-1 break-words">{page.provenance.run?.source?.name || t('page.unknown')} · {page.provenance.run?.source?.type || t('page.unknown')}</p>{page.provenance.run?.source?.uri ? <p className="text-xs text-gray-500 break-all mt-1">{page.provenance.run.source.uri}</p> : null}</div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.extractionRun')}</span><p className="mt-1"><Link className="text-blue-600 hover:underline" to={`/spaces/${page.spaceId}/runs`}>{page.provenance.run?.id || t('page.unknown')}</Link> · {page.provenance.run?.stage || page.provenance.run?.status}</p></div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.candidateChange')}</span><p className="mt-1">{page.provenance.title} · {page.provenance.status}</p></div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.approval')}</span><p className="mt-1">{page.provenance.approvals?.[0]?.reviewer?.name || page.provenance.approvals?.[0]?.reviewer?.email || (page.provenance.status === 'published' ? t('page.autoPublished') : t('page.notApproved'))}</p>{page.provenance.publishedAt ? <p className="text-xs text-gray-500 mt-1">{t('page.published', { date: new Date(page.provenance.publishedAt).toLocaleString(language) })}</p> : null}</div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.latestChange')}</span><p className="mt-1">{page.lastModifiedByAgent?.name ? `Agent · ${page.lastModifiedByAgent.name}` : page.lastModifiedByUser?.name || page.lastModifiedByUser?.email || t('page.human')}</p>{page.lastChange ? <p className="text-xs mt-1"><Link className="text-blue-600 hover:underline" to={`/review?changeSet=${page.lastChange.id}`}>{page.lastChange.title}</Link> · {page.lastChange.status}</p> : <p className="text-xs text-gray-500 mt-1">{t('page.directEdit')}</p>}{page.lastModifiedAt ? <p className="text-xs text-gray-500 mt-1">{t('page.changed', { date: new Date(page.lastModifiedAt).toLocaleString(language) })}</p> : null}</div>
            <div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.evidence', { count: page.evidence?.length || 0 })}</span>
              {page.evidence?.length ? page.evidence.map((item) => {
                const metadata = item.sourceVersion?.metadata || {};
                const files = item.sourceVersion?.files || [];
                return <blockquote key={item.id} className="mt-2 border-l-2 pl-3 text-xs text-gray-600">
                  <p>{item.quote || t('page.noExcerpt')}</p>
                  <p className="mt-1 text-gray-400">{t('page.confidenceVersion', { confidence: Math.round((item.confidence ?? 1) * 100), version: item.sourceVersion?.version })}</p>
                  {item.location ? <p className="mt-1 text-gray-400 break-all">{t('page.location')}: {JSON.stringify(item.location)}</p> : null}
                  {metadata.commit ? <p className="mt-1 text-gray-400 break-all">Commit: {metadata.commit}</p> : null}
                  {files.length ? <p className="mt-1 text-gray-400">{t('page.files')}: {files.slice(0, 3).map((file: any) => file.path).join(', ')}{files.length > 3 ? ` +${files.length - 3}` : ''}</p> : null}
                </blockquote>;
              }) : <p className="mt-1 text-gray-500">{t('page.noEvidence')}</p>}
            </div>
          </div>
        ) : <div className="text-sm mt-3 space-y-3"><p className="text-gray-500">{t('page.humanCreated')}</p><div><span className="text-xs uppercase tracking-wide text-gray-400">{t('page.latestChange')}</span><p className="mt-1">{page.lastModifiedByUser?.name || page.lastModifiedByUser?.email || t('page.human')}</p>{page.lastModifiedAt ? <p className="text-xs text-gray-500 mt-1">{t('page.changed', { date: new Date(page.lastModifiedAt).toLocaleString(language) })}</p> : null}</div></div>}
      </aside>
      </div>

      {relatedPages.length > 0 && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold mb-3">{t('page.related')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {relatedPages.map((rp, idx) => (
              <Link
                key={idx}
                to={`/pages/${rp.page?.id}`}
                className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-100 hover:shadow-md transition"
              >
                <FileText size={18} className="text-gray-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-blue-600 hover:underline truncate">
                    {rp.page?.title || t('page.unknown')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {rp.direction === 'outgoing' ? '→' : '←'} {rp.relation}
                    {rp.strength != null && rp.strength < 1 ? ` (${t('page.strength', { value: rp.strength.toFixed(1) })})` : ''}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
