import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { ArrowLeft, History, RotateCcw, Clock, User } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

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

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        const [pageRes, versionsRes] = await Promise.all([
          api.get(`/pages/${id}`),
          api.get(`/pages/${id}/versions`),
        ]);
        setPage(pageRes.data);
        setVersions(versionsRes.data || []);
      } catch (err: any) {
        setError(err.response?.data?.message || t('version.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  const handleRestore = async (versionId: string) => {
    if (!id || !window.confirm(t('version.restoreConfirm'))) return;
    setRestoring(versionId);
    try {
      await api.post(`/pages/${id}/versions/${versionId}/restore`);
      alert(t('version.restored'));
      navigate(`/pages/${id}/edit`);
    } catch (err: any) {
      alert(t('version.restoreFailed', { message: err.response?.data?.message || t('page.unknown') }));
    } finally {
      setRestoring(null);
    }
  };

  const getAuthorName = (version: PageVersion): string => {
    if (version.author) {
      return version.author.name || version.author.email || t('page.unknown');
    }
    return t('page.unknown');
  };

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
              <button
                onClick={() => handleRestore(version.id)}
                disabled={restoring === version.id}
                className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm flex-shrink-0"
              >
                <RotateCcw size={16} />
                {restoring === version.id ? t('version.restoring') : t('version.restore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
