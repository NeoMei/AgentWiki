import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { FileText, Plus, X, Trash2, Edit } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';

interface Page {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
}

interface Space {
  id: string;
  name: string;
  description?: string;
}

export const SpaceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const [space, setSpace] = useState<Space | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageParent, setNewPageParent] = useState('');
  const [deletingPage, setDeletingPage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [spaceRes, pagesRes] = await Promise.all([
        api.get(`/spaces/${id}`),
        api.get(`/pages?spaceId=${id}`),
      ]);
      setSpace(spaceRes.data);
      setPages(pagesRes.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('page.loadSpaceFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreatePage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPageTitle.trim() || !id) return;
    setCreating(true);
    try {
      const res = await api.post('/pages', { title: newPageTitle, spaceId: id, parentId: newPageParent || undefined });
      setNewPageTitle('');
      setNewPageParent('');
      setShowCreate(false);
      navigate(`/pages/${res.data.id}/edit`);
    } catch (err: any) {
      setError(err.response?.data?.message || t('page.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePage = async (pageId: string, pageTitle: string) => {
    if (!window.confirm(t('page.deleteConfirm', { title: pageTitle }))) return;
    setDeletingPage(pageId);
    try {
      await api.delete(`/pages/${pageId}`);
      setPages(prev => prev.filter(p => p.id !== pageId));
    } catch (err: any) {
      setError(err.response?.data?.message || t('page.deleteFailed'));
    } finally {
      setDeletingPage(null);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <Link to="/" className="text-blue-600 hover:underline">{t('search.back')}</Link>
    </div>
  );
  if (!space) return <div className="text-center py-8 text-gray-500">{t('page.spaceNotFound')}</div>;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
          <Link to="/" className="hover:text-blue-600">{t('nav.spaces')}</Link>
          <span>/</span>
          <span className="text-gray-600 font-medium">{space.name}</span>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0 w-full lg:w-auto">
            <h1 className="text-2xl font-bold truncate">{space.name}</h1>
            {space.description && <p className="text-gray-500 mt-1">{space.description}</p>}
          </div>
        </div>
      </div>

      <SpaceNav spaceId={id} />

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{t('space.pages')} ({pages.length})</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          <Plus size={18} />
          {t('page.new')}
        </button>
      </div>

      {pages.length === 0 ? (
        <div className="text-center py-12">
          <FileText size={36} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t('page.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pages.map((page) => (
            <div
              key={page.id}
              className="group flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm hover:shadow-md transition border border-gray-100"
            >
              <Link to={`/pages/${page.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <FileText size={20} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate group-hover:text-blue-600 transition">{page.title}</h3>
                  <p className="text-sm text-gray-400">{t('page.updated', { date: new Date(page.updatedAt).toLocaleDateString(language) })}</p>
                </div>
              </Link>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <Link
                  to={`/pages/${page.id}/edit`}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title={t('page.edit')}
                >
                  <Edit size={16} />
                </Link>
                <button
                  onClick={() => handleDeletePage(page.id, page.title)}
                  disabled={deletingPage === page.id}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  title={t('page.delete')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{t('page.createTitle')}</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePage} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.title')} *</label>
                <input
                  type="text"
                  value={newPageTitle}
                  onChange={e => setNewPageTitle(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('page.titlePlaceholder')}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('page.parent')}</label>
                <select
                  value={newPageParent}
                  onChange={e => setNewPageParent(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('page.noParent')}</option>
                  {pages.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={creating || !newPageTitle.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                  {creating ? t('common.creating') : t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};