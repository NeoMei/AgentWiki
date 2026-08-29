import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Plus, RotateCcw, X } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { NewPageDialog } from '../page-templates/NewPageDialog';
import {
  createFolder,
  deleteFolder,
  getContentTreeRevision,
  listTreeChildren,
  moveTreeNode,
  renameFolder,
  restoreFolder,
} from '../content-tree/contentTreeApi';
import { ContentBreadcrumbs } from '../content-tree/ContentBreadcrumbs';
import { ContentTree } from '../content-tree/ContentTree';
import type { ContentMoveRequest } from '../content-tree/ContentTree';
import { crumbsForFolder, createFolderIndex, registerFolders } from '../content-tree/contentTreeState';
import type { FolderIndex } from '../content-tree/contentTreeState';
import { FolderDialog } from '../content-tree/FolderDialog';
import { FolderDeleteDialog } from '../content-tree/FolderDeleteDialog';
import type {
  ContentTreeNode,
  ContentTreePageNode,
  ContentTreeFolderNode,
  DeleteImpactResponse,
} from '../content-tree/contentTreeTypes';

interface SpaceMemberSummary {
  userId: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
}

interface Space {
  id: string;
  name: string;
  description?: string;
  members: SpaceMemberSummary[];
}

interface PendingFolderDialog {
  mode: 'create' | 'rename';
  parent: Pick<ContentTreeFolderNode, 'id' | 'name'> | null;
  target?: ContentTreeFolderNode;
}

interface RestoreInfo {
  folderId: string;
  folderName: string;
  deletionBatchId: string;
  folderUpdatedAt: string;
}

export const SpaceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const createPageOpenerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const treeSequenceRef = useRef(0);
  const fetchedRouteIdRef = useRef<string | undefined>(undefined);
  const activeRouteIdRef = useRef<string | undefined>(id);
  const mountedRef = useRef(false);
  const archiveOperationRef = useRef(0);
  const archiveControllerRef = useRef<AbortController | null>(null);
  const archiveInFlightRef = useRef<string | null>(null);
  const folderOpenerRef = useRef<HTMLButtonElement | null>(null);

  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [requestSpaceId, setRequestSpaceId] = useState<string | undefined>(undefined);
  const [archivingPageId, setArchivingPageId] = useState<string | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<ContentTreeNode[]>([]);
  const [pageCount, setPageCount] = useState(0);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeRevision, setTreeRevision] = useState<string | null>(null);
  const [folderIndex, setFolderIndex] = useState<FolderIndex>(() => createFolderIndex());
  const [folderDialog, setFolderDialog] = useState<PendingFolderDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentTreeFolderNode | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<RestoreInfo | null>(null);
  const [restoring, setRestoring] = useState(false);

  activeRouteIdRef.current = id;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      archiveOperationRef.current += 1;
      archiveControllerRef.current?.abort();
      archiveControllerRef.current = null;
      archiveInFlightRef.current = null;
    };
  }, []);

  const fetchSpace = useCallback(async (resetForRoute: boolean) => {
    const requestSequence = ++requestSequenceRef.current;
    setRequestSpaceId(id);
    if (resetForRoute) {
      setLoading(true);
      setError(null);
      setActionError(null);
      setSpace(null);
      setCurrentFolderId(null);
      setRestoreInfo(null);
    }
    if (!id) {
      if (requestSequenceRef.current === requestSequence) setLoading(false);
      return;
    }
    try {
      const spaceRes = await api.get('/spaces/' + id);
      if (requestSequenceRef.current !== requestSequence) return;
      setSpace(spaceRes.data);
    } catch (err: any) {
      if (requestSequenceRef.current !== requestSequence) return;
      setError(err.response?.data?.message || t('page.loadSpaceFailed'));
    } finally {
      if (requestSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [id, t]);

  const loadTreeLevel = useCallback(async (spaceId: string, folderId: string | null) => {
    const sequence = ++treeSequenceRef.current;
    setTreeLoading(true);
    setTreeError(null);
    try {
      const level = await listTreeChildren(spaceId, folderId);
      if (treeSequenceRef.current !== sequence) return;
      setNodes(level.data);
      setTreeRevision(level.treeRevision);
      setPageCount(level.data.filter((node) => node.kind === 'page').length);
      setFolderIndex((prev) => {
        const next = new Map(prev);
        registerFolders(next, level.data, folderId);
        return next;
      });
    } catch (err: any) {
      if (treeSequenceRef.current !== sequence) return;
      setTreeError(err.response?.data?.message || t('page.loadSpaceFailed'));
    } finally {
      if (treeSequenceRef.current === sequence) setTreeLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const routeChanged = fetchedRouteIdRef.current !== id;
    fetchedRouteIdRef.current = id;
    if (routeChanged) {
      archiveOperationRef.current += 1;
      archiveControllerRef.current?.abort();
      archiveControllerRef.current = null;
      archiveInFlightRef.current = null;
      setArchivingPageId(null);
      setShowCreate(false);
      setFolderDialog(null);
      setDeleteTarget(null);
    }
    void fetchSpace(routeChanged);
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [fetchSpace, id]);

  useEffect(() => {
    if (!id || requestSpaceId !== id) return;
    void loadTreeLevel(id, currentFolderId);
  }, [id, currentFolderId, requestSpaceId, loadTreeLevel]);

  const requireTreeRevision = (): string | null => {
    if (treeRevision) return treeRevision;
    setActionError(t('folder.revisionMissing'));
    return null;
  };

  const reloadTree = () => {
    if (id) void loadTreeLevel(id, currentFolderId);
  };

  const handleCreateFolder = async (name: string) => {
    if (!id || !folderDialog) return;
    const revision = requireTreeRevision();
    if (!revision) throw new Error('missing revision');
    const parent = folderDialog.parent;
    const result = await createFolder(id, name, parent?.id ?? null, revision);
    setTreeRevision(result.treeRevision);
    if (parent && parent.id !== currentFolderId) {
      setFolderIndex((prev) => {
        const next = new Map(prev);
        next.set(result.folder.id, {
          id: result.folder.id,
          parentId: parent.id,
          name: result.folder.name,
        });
        return next;
      });
    } else {
      reloadTree();
    }
  };

  const handleRenameFolder = async (name: string) => {
    if (!id || !folderDialog?.target) return;
    const revision = requireTreeRevision();
    if (!revision) throw new Error('missing revision');
    const result = await renameFolder(id, folderDialog.target.id, name, revision, folderDialog.target.updatedAt);
    setTreeRevision(result.treeRevision);
    reloadTree();
  };

  const handleDeleteFolderConfirm = async (impact: DeleteImpactResponse) => {
    if (!id || !deleteTarget) return;
    const result = await deleteFolder(id, deleteTarget.id, {
      expectedTreeRevision: impact.treeRevision,
      expectedUpdatedAt: impact.rootUpdatedAt,
      expectedImpactHash: impact.impactHash,
    });
    setRestoreInfo({
      folderId: deleteTarget.id,
      folderName: deleteTarget.name,
      deletionBatchId: result.batch.id,
      folderUpdatedAt: impact.rootUpdatedAt,
    });
    setTreeRevision(result.treeRevision);
    reloadTree();
  };

  const handleRestore = async () => {
    if (!id || !restoreInfo || restoring) return;
    setRestoring(true);
    setActionError(null);
    try {
      const result = await restoreFolder(id, restoreInfo.folderId, {
        deletionBatchId: restoreInfo.deletionBatchId,
        expectedUpdatedAt: restoreInfo.folderUpdatedAt,
        expectedTreeRevision: treeRevision ?? (await getContentTreeRevision(id)),
        mode: 'original',
      });
      setRestoreInfo(null);
      setTreeRevision(result.treeRevision);
      reloadTree();
    } catch (err: any) {
      setActionError(err.response?.data?.message || t('folder.restoreFailed'));
    } finally {
      setRestoring(false);
    }
  };

  const handleContentMove = async (request: ContentMoveRequest) => {
    if (!id || !treeRevision) return;
    const dragNode = nodes.find((node) => node.id === request.id);
    if (!dragNode) return;
    setActionError(null);
    try {
      const result = await moveTreeNode(id, {
        kind: request.kind,
        id: request.id,
        targetParentFolderId: request.targetFolderId,
        ...(request.beforeId ? { beforeId: request.beforeId } : {}),
        expectedTreeRevision: treeRevision,
        expectedUpdatedAt: dragNode.updatedAt,
      });
      setTreeRevision(result.treeRevision);
    } catch (err: any) {
      setActionError(err.response?.data?.message || t('folder.moveFailed'));
    } finally {
      reloadTree();
    }
  };

  const handleDeletePage = async (page: ContentTreePageNode) => {
    if (archiveInFlightRef.current !== null) return;
    if (!window.confirm(t('page.deleteConfirm', { title: page.title }))) return;
    if (!id) {
      setActionError(t('page.deleteFailed'));
      return;
    }
    const requestedSpaceId = id;
    const requestedPageId = page.id;
    const operation = ++archiveOperationRef.current;
    archiveInFlightRef.current = page.id;
    archiveControllerRef.current?.abort();
    const controller = new AbortController();
    archiveControllerRef.current = controller;
    setArchivingPageId(page.id);
    try {
      const expectedTreeRevision = await getContentTreeRevision(requestedSpaceId, controller.signal);
      if (
        !mountedRef.current
        || controller.signal.aborted
        || archiveOperationRef.current !== operation
        || archiveInFlightRef.current !== requestedPageId
        || activeRouteIdRef.current !== requestedSpaceId
        || fetchedRouteIdRef.current !== requestedSpaceId
        || id !== requestedSpaceId
      ) return;
      await api.delete('/pages/' + requestedPageId, {
        data: { expectedUpdatedAt: page.updatedAt, expectedTreeRevision },
      });
      if (
        !mountedRef.current
        || archiveOperationRef.current !== operation
        || archiveInFlightRef.current !== requestedPageId
        || activeRouteIdRef.current !== requestedSpaceId
        || fetchedRouteIdRef.current !== requestedSpaceId
      ) return;
      setNodes((prev) => prev.filter((node) => node.id !== requestedPageId));
      setPageCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      if (
        mountedRef.current
        && !controller.signal.aborted
        && archiveOperationRef.current === operation
        && archiveInFlightRef.current === requestedPageId
        && activeRouteIdRef.current === requestedSpaceId
        && fetchedRouteIdRef.current === requestedSpaceId
      ) setActionError(err.response?.data?.message || t('page.deleteFailed'));
    } finally {
      if (archiveControllerRef.current === controller) archiveControllerRef.current = null;
      if (archiveOperationRef.current === operation) archiveInFlightRef.current = null;
      if (
        mountedRef.current
        && archiveOperationRef.current === operation
        && activeRouteIdRef.current === requestedSpaceId
        && fetchedRouteIdRef.current === requestedSpaceId
      ) setArchivingPageId(null);
    }
  };

  if (requestSpaceId !== id || loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <Link to="/" className="text-blue-600 hover:underline">{t('search.back')}</Link>
    </div>
  );
  if (!space || space.id !== id) return <div className="text-center py-8 text-gray-500">{t('page.spaceNotFound')}</div>;

  const currentRole = space.members.find((member) => member.userId === user?.id)?.role;
  const canEdit = (
    user?.platformRole === 'super_admin'
      || currentRole === 'owner'
      || currentRole === 'admin'
      || currentRole === 'editor'
  );
  const crumbs = crumbsForFolder(folderIndex, currentFolderId, space.name);

  return (
    <div>
      {actionError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-md text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-2 text-red-400 hover:text-red-600">
            <X size={16} />
          </button>
        </div>
      )}
      {restoreInfo && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-md text-sm flex items-center justify-between" data-testid="folder-restored-banner">
          <span>{t('folder.deletedBanner', { name: restoreInfo.folderName })}</span>
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoring}
            data-testid="folder-restore-button"
            className="ml-3 inline-flex items-center gap-1 rounded border border-green-300 px-2 py-1 font-medium text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw size={13} />
            {t('folder.restore')}
          </button>
        </div>
      )}
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

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <ContentBreadcrumbs
          crumbs={crumbs}
          onSelect={(folderId) => setCurrentFolderId(folderId)}
        />
        <div className="flex items-center gap-2">
          {canEdit ? (
            <button
              ref={folderOpenerRef}
              type="button"
              onClick={() => setFolderDialog({
                mode: 'create',
                parent: currentFolderId
                  ? { id: currentFolderId, name: folderIndex.get(currentFolderId)?.name ?? '' }
                  : null,
              })}
              data-testid="new-folder-button"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('folder.createTitle')}
            </button>
          ) : null}
          {canEdit ? (
            <button
              ref={createPageOpenerRef}
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"
            >
              <Plus size={18} />
              {t('page.new')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
          <span data-testid="folder-page-count">{t('space.pages')} ({pageCount})</span>
        </div>
        <ContentTree
          nodes={nodes}
          loading={treeLoading}
          error={treeError}
          canEdit={canEdit}
          pageDeleteDisabled={archivingPageId !== null}
          emptyText={t('page.empty')}
          onOpenFolder={(folderId) => setCurrentFolderId(folderId)}
          onOpenPage={(page) => navigate('/pages/' + page.id)}
          onEditPage={(page) => navigate('/pages/' + page.id + '/edit')}
          onDeletePage={(page) => { void handleDeletePage(page); }}
          onCreateSubfolder={(parent) => setFolderDialog({ mode: 'create', parent })}
          onRenameFolder={(folder) => setFolderDialog({ mode: 'rename', parent: null, target: folder })}
          onDeleteFolder={(folder) => setDeleteTarget(folder)}
          onMove={(request) => { void handleContentMove(request); }}
        />
      </div>

      {showCreate && canEdit && id ? (
        <NewPageDialog
          spaceId={id}
          folderId={currentFolderId}
          returnFocusTo={createPageOpenerRef.current}
          onClose={() => setShowCreate(false)}
          onCreated={(pageId) => {
            setShowCreate(false);
            reloadTree();
            navigate('/pages/' + pageId + '/edit');
          }}
        />
      ) : null}

      {folderDialog && canEdit && id ? (
        <FolderDialog
          mode={folderDialog.mode}
          initialName={folderDialog.target?.name ?? ''}
          returnFocusTo={folderOpenerRef.current}
          onClose={() => setFolderDialog(null)}
          onSubmit={async (name) => {
            if (folderDialog.mode === 'create') await handleCreateFolder(name);
            else await handleRenameFolder(name);
          }}
        />
      ) : null}

      {deleteTarget && canEdit && id ? (
        <FolderDeleteDialog
          spaceId={id}
          folderId={deleteTarget.id}
          folderName={deleteTarget.name}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDeleteFolderConfirm}
        />
      ) : null}
    </div>
  );
};
