import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { apiErrorMessage } from '../../api/error-message';
import type { SpaceListResponse, SpaceSummary } from '../../api/space-types';
import { ModalDialog } from '../../components/ModalDialog';
import { useAuth } from '../../context/AuthContext';
import { Plus, Folder, X, Trash2, Network } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

const PAGE_SIZE = 20;
const OPTIMISTIC_SPACE_TTL_MS = 5 * 60_000;

interface OptimisticSpace {
  space: SpaceSummary;
  mutationVersion: number;
  expiresAt: number;
}

const mergeSpaces = (current: SpaceSummary[], incoming: SpaceSummary[]) => {
  const seen = new Set(current.map((space) => space.id));
  return [...current, ...incoming.filter((space) => !seen.has(space.id))];
};

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [serverSpaces, setServerSpaces] = useState<SpaceSummary[]>([]);
  const [optimisticSpaces, setOptimisticSpaces] = useState<OptimisticSpace[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingSpace, setDeletingSpace] = useState<string | null>(null);
  const [newSpace, setNewSpace] = useState({ name: '', description: '' });
  const mutationVersionRef = useRef(0);
  const activeListRequestRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const serverSeenIdsRef = useRef(new Set<string>());
  const createDialogOpenerRef = useRef<HTMLElement | null>(null);
  const spaces = useMemo(
    () => mergeSpaces(optimisticSpaces.map(({ space }) => space), serverSpaces),
    [optimisticSpaces, serverSpaces],
  );

  const fetchSpaces = async (reset = true) => {
    if (!reset && !nextCursorRef.current) {
      await fetchSpaces(true);
      return;
    }
    const requestId = activeListRequestRef.current + 1;
    activeListRequestRef.current = requestId;
    if (reset) setResetting(true);
    else setLoadingMore(true);
    const requestMutationVersion = mutationVersionRef.current;
    try {
      const cursor = reset ? null : nextCursorRef.current;
      const res = await api.get('/spaces', {
        params: cursor ? { take: PAGE_SIZE, cursor } : { take: PAGE_SIZE },
      });
      if (requestId !== activeListRequestRef.current) return;
      const response = res.data as SpaceListResponse;
      const incoming = response.data || [];
      if (!reset && requestMutationVersion !== mutationVersionRef.current && !response.resetRequired) {
        setLoadingMore(false);
        await fetchSpaces(true);
        return;
      }
      const authoritativeReset = reset || response.resetRequired;
      const incomingIds = new Set(incoming.map((space) => space.id));
      const now = Date.now();
      setOptimisticSpaces((current) => current.filter((entry) => {
        if (incomingIds.has(entry.space.id) || entry.expiresAt <= now) return false;
        if (authoritativeReset && entry.mutationVersion <= requestMutationVersion) return false;
        return true;
      }));
      if (authoritativeReset) {
        setServerSpaces(incoming);
        serverSeenIdsRef.current = incomingIds;
      } else {
        setServerSpaces((current) => mergeSpaces(current, incoming));
        serverSeenIdsRef.current = new Set([...serverSeenIdsRef.current, ...incomingIds]);
      }
      nextCursorRef.current = response.nextCursor;
      setHasMore(response.hasMore);
    } catch (err: unknown) {
      if (requestId !== activeListRequestRef.current) return;
      setError(apiErrorMessage(err, t, 'dashboard.loadFailed'));
    } finally {
      if (requestId === activeListRequestRef.current) {
        if (reset) {
          setLoading(false);
          setResetting(false);
          setLoadingMore(false);
        } else {
          setLoadingMore(false);
        }
      }
    }
  };

  useEffect(() => {
    void fetchSpaces(true);
  }, []);

  useEffect(() => {
    if (!optimisticSpaces.length) return;
    const expiresAt = Math.min(...optimisticSpaces.map((entry) => entry.expiresAt));
    const timeout = window.setTimeout(() => {
      const now = Date.now();
      setOptimisticSpaces((current) => {
        const active = current.filter((entry) => entry.expiresAt > now);
        return active.length === current.length ? current : active;
      });
    }, Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [optimisticSpaces]);

  const openCreateDialog = (event: React.MouseEvent<HTMLButtonElement>) => {
    createDialogOpenerRef.current = event.currentTarget;
    setCreateError(null);
    setShowCreate(true);
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateError(null);
    setShowCreate(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpace.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data: created } = await api.post('/spaces', {
        name: newSpace.name.trim(),
        description: newSpace.description.trim() || undefined,
      });
      const mutationVersion = mutationVersionRef.current + 1;
      mutationVersionRef.current = mutationVersion;
      if (!serverSeenIdsRef.current.has(created.id)) {
        setOptimisticSpaces((current) => [{
          space: created,
          mutationVersion,
          expiresAt: Date.now() + OPTIMISTIC_SPACE_TTL_MS,
        }, ...current.filter((entry) => entry.space.id !== created.id)]);
      }
      setNewSpace({ name: '', description: '' });
      setShowCreate(false);
    } catch (err: unknown) {
      setCreateError(apiErrorMessage(err, t, 'dashboard.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSpace = async (spaceId: string, spaceName: string) => {
    if (!window.confirm(t('dashboard.deleteConfirm', { name: spaceName }))) return;
    setDeletingSpace(spaceId);
    try {
      await api.delete(`/spaces/${spaceId}`);
      mutationVersionRef.current += 1;
      setOptimisticSpaces((current) => current.filter((entry) => entry.space.id !== spaceId));
      setServerSpaces((current) => current.filter((space) => space.id !== spaceId));
      serverSeenIdsRef.current.delete(spaceId);
      nextCursorRef.current = null;
      await fetchSpaces(true);
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t, 'dashboard.deleteFailed'));
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
          onClick={openCreateDialog}
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
            onClick={openCreateDialog}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            <Plus size={18} />
            {t('dashboard.createSpace')}
          </button>
        </div>
      ) : (
        <>
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
          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={loadingMore || resetting}
                onClick={() => void fetchSpaces(false)}
                className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {loadingMore || resetting ? t('dashboard.loadingMore') : t('dashboard.loadMore')}
              </button>
            </div>
          ) : null}
        </>
      )}

      {showCreate ? (
        <ModalDialog
          labelledBy="create-space-title"
          onRequestClose={closeCreateDialog}
          closeDisabled={creating}
          returnFocusTo={createDialogOpenerRef.current}
          className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-[14px] bg-white p-6 shadow-xl"
        >
            <div className="flex items-center justify-between mb-4">
              <h2 id="create-space-title" className="text-xl font-bold">{t('dashboard.createTitle')}</h2>
              <button
                type="button"
                onClick={closeCreateDialog}
                disabled={creating}
                aria-label={t('common.close')}
                className="rounded-lg p-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              {createError ? <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">{createError}</div> : null}
              <div>
                <label htmlFor="create-space-name" className="block text-sm font-medium mb-1">{t('common.name')} *</label>
                <input
                  id="create-space-name"
                  data-modal-autofocus
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
                <label htmlFor="create-space-description" className="block text-sm font-medium mb-1">{t('common.description')}</label>
                <textarea
                  id="create-space-description"
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
                  onClick={closeCreateDialog}
                  disabled={creating}
                  className="rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
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
        </ModalDialog>
      ) : null}
    </div>
  );
};
