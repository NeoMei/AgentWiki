import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Plus, Folder, X, Trash2, Network } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingSpace, setDeletingSpace] = useState<string | null>(null);
  const [newSpace, setNewSpace] = useState({ name: '', description: '' });

  const fetchSpaces = async () => {
    try {
      const res = await api.get('/spaces');
      setSpaces(res.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || t('dashboard.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpaces();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpace.name.trim()) return;
    setCreating(true);
    try {
      await api.post('/spaces', {
        name: newSpace.name,
        description: newSpace.description || undefined,
      });
      setNewSpace({ name: '', description: '' });
      setShowCreate(false);
      await fetchSpaces();
    } catch (err: any) {
      setError(err.response?.data?.message || t('dashboard.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSpace = async (spaceId: string, spaceName: string) => {
    if (!window.confirm(t('dashboard.deleteConfirm', { name: spaceName }))) return;
    setDeletingSpace(spaceId);
    try {
      await api.delete(`/spaces/${spaceId}`);
      setSpaces(prev => prev.filter(s => s.id !== spaceId));
    } catch (err: any) {
      setError(err.response?.data?.message || t('dashboard.deleteFailed'));
    } finally {
      setDeletingSpace(null);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('dashboard.welcome', { name: user?.name || user?.email || '' })}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition"
        >
          <Plus size={20} />
          {t('dashboard.newSpace')}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-md text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}

      {spaces.length === 0 ? (
        <div className="text-center py-16">
          <Folder size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 mb-4">{t('dashboard.empty')}</p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={18} />
            {t('dashboard.createSpace')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {spaces.map((space) => (
            <div
              key={space.id}
              className="group relative block p-6 bg-white rounded-lg shadow hover:shadow-md transition border border-gray-100"
            >
              <Link to={`/spaces/${space.id}`} className="block">
                <div className="flex items-center gap-3 mb-2">
                  <Folder className="text-blue-600" size={24} />
                  <h3 className="text-lg font-semibold">{space.name}</h3>
                </div>
                <p className="text-gray-500 text-sm line-clamp-2">{space.description || t('common.noDescription')}</p>
              </Link>
              <div className="mt-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                <Link
                  to={`/spaces/${space.id}/graph`}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title={t('dashboard.viewGraph')}
                >
                  <Network size={14} />
                  {t('space.graph')}
                </Link>
                <button
                  onClick={() => handleDeleteSpace(space.id, space.name)}
                  disabled={deletingSpace === space.id}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  title={t('dashboard.deleteSpace')}
                >
                  <Trash2 size={14} />
                  {deletingSpace === space.id ? t('common.deleting') : t('common.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{t('dashboard.createTitle')}</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.name')} *</label>
                <input
                  type="text"
                  value={newSpace.name}
                  onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder={t('dashboard.namePlaceholder')}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">{t('common.description')}</label>
                <textarea
                  value={newSpace.description}
                  onChange={(e) => setNewSpace({ ...newSpace, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder={t('dashboard.descriptionPlaceholder')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating || !newSpace.name.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
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
