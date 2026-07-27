import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { FileText, Plus, X } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { PageTree, PageTreeNode } from '../../components/PageTree';

interface Page {
  id: string;
  title: string;
  slug: string;
  updatedAt: string;
  parentId?: string | null;
}

const flattenTree = (nodes: PageTreeNode[]): Page[] => {
  const out: Page[] = [];
  const walk = (list: PageTreeNode[], parentId: string | null) => {
    for (const node of list) {
      out.push({ id: node.id, title: node.title, slug: '', updatedAt: node.updatedAt || '', parentId });
      if (node.children?.length) walk(node.children, node.id);
    }
  };
  walk(nodes, null);
  return out;
};

const removeFromTree = (nodes: PageTreeNode[], id: string): PageTreeNode[] =>
  nodes
    .filter((node) => node.id !== id)
    .map((node) => (node.children?.length ? { ...node, children: removeFromTree(node.children, id) } : node));

interface Space {
  id: string;
  name: string;
  description?: string;
}

export const SpaceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const [space, setSpace] = useState<Space | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageTree, setPageTree] = useState<PageTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageParent, setNewPageParent] = useState('');

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const [spaceRes, pagesRes] = await Promise.all([
        api.get(`/spaces/${id}`),
        api.get(`/pages/hierarchy/${id}`),
      ]);
      setSpace(spaceRes.data);
      const tree: PageTreeNode[] = Array.isArray(pagesRes.data) ? pagesRes.data : pagesRes.data.data || [];
      setPageTree(tree);
      setPages(flattenTree(tree));
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
    try {
      await api.delete(`/pages/${pageId}`);
      setPages((prev) => prev.filter((p) => p.id !== pageId));
      setPageTree((prev) => removeFromTree(prev, pageId));
    } catch (err: any) {
      setError(err.response?.data?.message || t('page.deleteFailed'));
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <PageTree
            nodes={pageTree}
            emptyText={t('page.empty')}
            onEdit={(node) => navigate(`/pages/${node.id}/edit`)}
            onDelete={(node) => handleDeletePage(node.id, node.title)}
            editLabel={t('page.edit')}
            deleteLabel={t('page.delete')}
          />
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
