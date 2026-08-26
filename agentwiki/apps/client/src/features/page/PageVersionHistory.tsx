import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { ArrowLeft, History, RotateCcw, Clock, User, Eye, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Markdown } from '../../components/Markdown';
import { apiErrorMessage } from '../../api/error-message';

interface PageVersion {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  authorId?: string;
  author?: { name?: string; email?: string } | null;
}

interface Page {
  id: string;
  title: string;
  spaceId: string;
  capabilities?: { canEdit?: boolean };
}

export const PageVersionHistory: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const routeRef = useRef({ id, generation: 0 });
  const restoringRef = useRef<string | null>(null);
  if (routeRef.current.id !== id) {
    routeRef.current = { id, generation: routeRef.current.generation + 1 };
  }

  useEffect(() => {
    if (!id) return;
    let active = true;
    setPage(null);
    setVersions([]);
    setPreviewVersionId(null);
    setError(null);
    restoringRef.current = null;
    setRestoring(null);
    setLoading(true);
    const fetchData = async () => {
      try {
        const [pageRes, versionsRes] = await Promise.all([
          api.get(`/pages/${id}`),
          api.get(`/pages/${id}/versions`),
        ]);
        if (!active) return;
        setPage(pageRes.data);
        setVersions(versionsRes.data || []);
      } catch (err: unknown) {
        if (active) setError(apiErrorMessage(err, t, 'version.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();
    return () => {
      active = false;
    };
  }, [id]);

  const handleRestore = async (versionId: string) => {
    if (!id || restoringRef.current !== null || !window.confirm(t('version.restoreConfirm'))) return;
    const requestedId = id;
    const requestedRoute = routeRef.current;
    restoringRef.current = versionId;
    setRestoring(versionId);
    try {
      await api.post(`/pages/${requestedId}/versions/${versionId}/restore`);
      if (routeRef.current !== requestedRoute) return;
      alert(t('version.restored'));
      navigate(`/pages/${requestedId}/edit`);
    } catch (err: unknown) {
      if (routeRef.current !== requestedRoute) return;
      alert(apiErrorMessage(err, t, 'version.restoreFailedGeneric'));
    } finally {
      if (routeRef.current === requestedRoute && restoringRef.current === versionId) {
        restoringRef.current = null;
        setRestoring(null);
      }
    }
  };

  const getAuthorName = (version: PageVersion): string => {
    if (version.author) {
      return version.author.name || version.author.email || t('page.unknown');
    }
    return t('page.unknown');
  };
  const previewVersion = versions.find((version) => version.id === previewVersionId);
  const previewIndex = previewVersion ? versions.findIndex((version) => version.id === previewVersion.id) : -1;
  const previewNumber = previewIndex >= 0 ? versions.length - previewIndex : 0;

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <Link to={page?.spaceId ? `/spaces/${page.spaceId}` : '/'} className="text-blue-600 hover:underline">{t('common.back')}</Link>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/pages/${id}/edit`} className="p-2 hover:bg-gray-100 rounded">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <History size={14} />
            <span>{t('version.title')}</span>
          </div>
          <h1 className="text-2xl font-bold">{t('version.heading', { title: page?.title || t('space.pages') })}</h1>
        </div>
      </div>

      {versions.length === 0 ? (
        <div className="text-center py-12">
          <History size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('version.empty')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version, idx) => (
            <div
              key={version.id}
              className="flex items-center justify-between p-4 bg-white rounded-lg shadow-sm border border-gray-100"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="text-lg font-bold text-gray-400">v{versions.length - idx}</span>
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium truncate">{version.title}</h3>
                  <div className="flex items-center gap-3 text-sm text-gray-400 mt-1">
                    <span className="flex items-center gap-1">
                      <User size={12} />
                      {getAuthorName(version)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(version.createdAt).toLocaleString(language)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <button
                  type="button"
                  aria-label={t('version.preview', { version: versions.length - idx })}
                  onClick={() => setPreviewVersionId(version.id)}
                  className="flex items-center gap-1 rounded-md border px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"
                >
                  <Eye size={16} /> {t('common.preview')}
                </button>
                {page?.capabilities?.canEdit === true ? (
                  <button
                    onClick={() => handleRestore(version.id)}
                    disabled={restoring !== null}
                    className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm flex-shrink-0"
                  >
                    <RotateCcw size={16} />
                    {restoring === version.id ? t('version.restoring') : t('version.restore')}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {previewVersion ? (
        <div role="dialog" aria-modal="true" aria-label={t('version.previewTitle', { version: previewNumber })} className="fixed inset-0 z-50 overflow-auto bg-black/30 p-4">
          <div className="mx-auto max-h-[90vh] max-w-3xl overflow-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b pb-4">
              <div><h2 className="text-xl font-semibold">{t('version.previewTitle', { version: previewNumber })}</h2><p className="mt-1 text-sm text-gray-500">{previewVersion.title}</p></div>
              <button type="button" aria-label={t('version.closePreview')} onClick={() => setPreviewVersionId(null)} className="rounded p-1 hover:bg-gray-100"><X size={20} /></button>
            </div>
            <div className="mt-4"><Markdown mode="version" canEdit={false}>{previewVersion.content || ''}</Markdown></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
