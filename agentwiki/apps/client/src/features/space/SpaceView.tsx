import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { Plus, RotateCcw, X } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { NewPageDialog, type NewPageCreationTarget } from '../page-templates/NewPageDialog';
import { PageAgentBindingDialog, type BindingDialogScope } from '../page-templates/PageAgentBindingDialog';
import { SaveFolderAsTemplateDialog } from '../page-templates/SaveFolderAsTemplateDialog';
import { listCompositeTemplates } from '../page-templates/compositeTemplateApi';
import {
  createFolder,
  deleteFolder,
  getContentTreeRevision,
  moveTreeNode,
  renameFolder,
  restoreFolder,
} from '../content-tree/contentTreeApi';
import { ContentBreadcrumbs } from '../content-tree/ContentBreadcrumbs';
import { crumbsForFolder } from '../content-tree/contentTreeState';
import { ContentTree } from '../content-tree/ContentTree';
import type { ContentMoveRequest } from '../content-tree/ContentTree';
import { FolderDialog } from '../content-tree/FolderDialog';
import { FolderDeleteDialog } from '../content-tree/FolderDeleteDialog';
import type {
  ContentTreePageNode,
  ContentTreeFolderNode,
  DeleteImpactResponse,
} from '../content-tree/contentTreeTypes';
import { useOptionalSpaceWorkspace } from '../space-workspace/SpaceWorkspaceContext';
import { useSpaceDirectory } from '../space-workspace/useSpaceDirectory';
import { SpaceDirectory } from '../space-workspace/SpaceDirectory';

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
  returnFocusTo?: HTMLElement | null;
}

interface RestoreInfo {
  folderId: string;
  folderName: string;
  deletionBatchId: string;
  folderUpdatedAt: string;
}

export interface SpaceViewProps {
  spaceId?: string | null;
  workspaceContent?: React.ReactNode;
}

export const SpaceView: React.FC<SpaceViewProps> = ({ spaceId: providedSpaceId, workspaceContent }) => {
  const { id: routeId } = useParams<{ id: string }>();
  const id = providedSpaceId !== undefined ? (providedSpaceId ?? undefined) : routeId;
  const navigate = useNavigate();
  const { language, t } = useLanguage();
  const { user } = useAuth();
  const createPageOpenerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
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

  const workspace = useOptionalSpaceWorkspace();
  const [localCurrentFolderId, setLocalCurrentFolderId] = useState<string | null>(null);
  const [localExpandedFolderIds, setLocalExpandedFolderIds] = useState<ReadonlySet<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<PendingFolderDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentTreeFolderNode | null>(null);
  const [deleteReturnFocus, setDeleteReturnFocus] = useState<HTMLElement | null>(null);
  const [deleteFallbackFocus, setDeleteFallbackFocus] = useState<HTMLElement | null>(null);
  const [restoreInfo, setRestoreInfo] = useState<RestoreInfo | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [bindingScope, setBindingScope] = useState<BindingDialogScope | null>(null);
  const [bindingReturnFocus, setBindingReturnFocus] = useState<HTMLElement | null>(null);
  const [templateFolder, setTemplateFolder] = useState<ContentTreeFolderNode | null>(null);
  const [templateReturnFocus, setTemplateReturnFocus] = useState<HTMLElement | null>(null);
  const [compositeCapability, setCompositeCapability] = useState<{
    identity: string;
    canCreate: boolean;
  } | null>(null);

  const currentFolderId = workspace?.mode === 'directory' ? workspace.selectedFolderId : localCurrentFolderId;
  const setCurrentFolderId = useCallback((folderId: string | null) => {
    if (workspace) workspace.selectFolder(folderId);
    else setLocalCurrentFolderId(folderId);
  }, [workspace]);
  const setLocalFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    setLocalExpandedFolderIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(folderId); else next.delete(folderId);
      return next;
    });
  }, []);
  const expandedFolderIds = workspace?.expandedFolderIds ?? localExpandedFolderIds;
  const setFolderExpanded = workspace?.setFolderExpanded ?? setLocalFolderExpanded;
  const targetFolderId = workspace?.selectedPageFolderId ?? currentFolderId;
  const directory = useSpaceDirectory({
    spaceId: space?.id === id && id ? id : null,
    targetFolderId,
    expandedFolderIds,
    setFolderExpanded,
    rootLabel: space?.name ?? '',
  });
  const currentLevel = directory.levels.get(currentFolderId);
  const nodes = currentLevel?.nodes ?? [];
  const pageCount = nodes.filter((node) => node.kind === 'page').length;
  const treeRevision = directory.treeRevision;
  const folderIndex = directory.folderIndex;
  const crumbs = directory.crumbs;
  const openFolderDelete = (folder: ContentTreeFolderNode) => {
    const parentId = folderIndex.get(folder.id)?.parentId ?? null;
    const parentTarget = parentId
      ? [...document.querySelectorAll<HTMLElement>('[data-testid^="content-node-"]')]
        .find((element) => element.dataset.testid === `content-node-${parentId}`) ?? null
      : null;
    const rootTarget = document.querySelector<HTMLElement>('[data-testid="space-root-focus"]')
      ?? folderOpenerRef.current;
    setDeleteReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDeleteFallbackFocus(parentTarget ?? rootTarget);
    setDeleteTarget(folder);
  };
  useEffect(() => {
    workspace?.reportDirectoryCrumbs(crumbs);
  }, [crumbs, workspace?.reportDirectoryCrumbs]);

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
      setLocalCurrentFolderId(null);
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
      if (err.response?.status === 401 || err.response?.status === 403) setSpace(null);
      setError(err.response?.data?.message || t('page.loadSpaceFailed'));
    } finally {
      if (requestSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [id, t]);

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
      setBindingScope(null);
      setBindingReturnFocus(null);
      setTemplateFolder(null);
      setTemplateReturnFocus(null);
    }
    void fetchSpace(routeChanged);
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [fetchSpace, id]);

  useEffect(() => {
    setCompositeCapability(null);
    setBindingScope(null);
    setBindingReturnFocus(null);
    setTemplateFolder(null);
    setTemplateReturnFocus(null);
    if (!id) return;
    const requestIdentity = `${id}\u0000${language}`;
    let active = true;
    void listCompositeTemplates(id, { locale: language, take: 1 })
      .then((catalog) => {
        if (active) {
          setCompositeCapability({
            identity: requestIdentity,
            canCreate: catalog.capabilities.canCreate,
          });
        }
      })
      .catch(() => {
        if (active) setCompositeCapability({ identity: requestIdentity, canCreate: false });
      });
    return () => {
      active = false;
    };
  }, [id, language]);

  const requireTreeRevision = (): string | null => {
    if (treeRevision) return treeRevision;
    setActionError(t('folder.revisionMissing'));
    return null;
  };

  const reloadTree = () => {
    if (id) void directory.reloadLevel(currentFolderId);
  };

  const handleCreateFolder = async (name: string) => {
    if (!id || !folderDialog) return;
    const revision = requireTreeRevision();
    if (!revision) throw new Error('missing revision');
    const parent = folderDialog.parent;
    const result = await createFolder(id, name, parent?.id ?? null, revision);
    directory.acceptTreeRevision(result.treeRevision);
    if (parent && parent.id !== currentFolderId) {
      await directory.reloadLevel(parent.id);
    } else {
      reloadTree();
    }
  };

  const handleRenameFolder = async (name: string) => {
    if (!id || !folderDialog?.target) return;
    const revision = requireTreeRevision();
    if (!revision) throw new Error('missing revision');
    const result = await renameFolder(id, folderDialog.target.id, name, revision, folderDialog.target.updatedAt);
    directory.acceptTreeRevision(result.treeRevision);
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
    directory.acceptTreeRevision(result.treeRevision);
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
      directory.acceptTreeRevision(result.treeRevision);
      reloadTree();
    } catch (err: any) {
      setActionError(err.response?.data?.message || t('folder.restoreFailed'));
    } finally {
      setRestoring(false);
    }
  };

  const handleContentMove = async (request: ContentMoveRequest) => {
    if (!id || !treeRevision) return;
    const dragNode = [...directory.levels.values()]
      .flatMap((level) => level.nodes)
      .find((node) => node.id === request.id);
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
      directory.acceptTreeRevision(result.treeRevision);
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
      await directory.reloadLevel(page.folderId);
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

  if (requestSpaceId !== id || loading || !id) return workspaceContent ? (
    <div>
      <div className="mb-6" />
      <div key="workspace-layout" className="flex flex-col lg:flex-row">
        <aside className="hidden w-[260px] shrink-0 border-r border-gray-200 lg:block" />
        <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">{workspaceContent}</main>
      </div>
    </div>
  ) : <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error && workspaceContent) return (
    <div>
      <div key="workspace-layout" className="flex flex-col lg:flex-row">
        <aside className="w-full border-b border-gray-200 p-4 lg:min-h-[calc(100vh-4rem)] lg:w-[260px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <p className="mb-3 text-sm text-red-600">{error}</p>
          <button type="button" onClick={() => { void fetchSpace(false); }} className="text-sm font-medium text-blue-700 underline">
            {t('common.retry')}
          </button>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">{workspaceContent}</main>
      </div>
    </div>
  );
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
  const canManageTemplates = (
    user?.platformRole === 'super_admin'
      || currentRole === 'owner'
      || currentRole === 'admin'
  );
  const compositeCreationEnabled = compositeCapability?.identity === `${id}\u0000${language}`
    && compositeCapability.canCreate;

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
      {!workspace ? <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
          <Link to="/" className="shrink-0 hover:text-blue-600">{t('nav.spaces')}</Link>
          <span>/</span>
          <span title={space.name} className="min-w-0 truncate text-gray-600 font-medium">{space.name}</span>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0 w-full lg:w-auto">
            <h1 title={space.name} className="text-2xl font-bold truncate">{space.name}</h1>
            {space.description && <p className="text-gray-500 mt-1">{space.description}</p>}
          </div>
        </div>
      </div> : null}

      {!workspace ? <SpaceNav spaceId={id} /> : null}
      {workspace ? <div className="flex flex-col border-b border-gray-200 lg:flex-row lg:items-stretch">
        <div className="flex min-h-12 w-full items-center border-b border-gray-100 px-4 lg:w-[260px] lg:shrink-0 lg:border-b-0 lg:border-r">
          <h1 tabIndex={-1} data-testid="space-root-focus" title={space.name} className="truncate text-base font-semibold text-gray-900">{space.name}</h1>
        </div>
        <div className="min-w-0 flex-1 px-3"><SpaceNav spaceId={id} activeSection={workspace.activeSection} embedded /></div>
      </div> : null}

      <div key="workspace-layout" className="flex flex-col lg:flex-row">
        {workspace && !workspace.directoryCollapsed ? <SpaceDirectory
          spaceName={space.name}
          levels={directory.levels}
          expandedFolderIds={expandedFolderIds}
          selectedFolderId={workspace.selectedFolderId}
          selectedPageId={workspace.selectedPageId}
          loading={!directory.levels.has(null) && directory.locating}
          error={directory.error}
          canEdit={canEdit}
          directoryScrollTop={workspace.directoryScrollTop}
          onDirectoryScrollTopChange={workspace.setDirectoryScrollTop}
          pageDeleteDisabled={archivingPageId !== null}
          onToggleFolder={(folderId) => { void directory.toggleFolder(folderId); }}
          onRetry={directory.retry}
          onCreatePage={() => setShowCreate(true)}
          onCreateFolder={() => setFolderDialog({
            mode: 'create',
            parent: targetFolderId
              ? { id: targetFolderId, name: folderIndex.get(targetFolderId)?.name ?? '' }
              : null,
            returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
          })}
          onSelectFolder={(folderId) => setCurrentFolderId(folderId)}
          onOpenPage={(page) => navigate('/pages/' + page.id)}
          onEditPage={(page) => navigate('/pages/' + page.id + '/edit')}
          onDeletePage={(page) => { void handleDeletePage(page); }}
          onCreateSubfolder={(parent) => setFolderDialog({ mode: 'create', parent, returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null })}
          onRenameFolder={(folder) => setFolderDialog({ mode: 'rename', parent: null, target: folder, returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null })}
          onDeleteFolder={openFolderDelete}
          onMove={(request) => { void handleContentMove(request); }}
        /> : null}
        <main className="min-w-0 flex-1 px-4 py-4 lg:px-6">
        {workspaceContent ?? <>
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
                returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
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
          loading={!currentLevel && directory.locating}
          error={directory.error}
          canEdit={canEdit}
          levelParentFolderId={currentFolderId}
          selectedFolderId={workspace?.selectedFolderId}
          currentPageId={workspace?.selectedPageId ?? undefined}
          expandedFolderIds={expandedFolderIds}
          childLevels={new Map([...directory.levels.entries()].flatMap(([parent, value]) => parent ? [[parent, value.nodes] as const] : []))}
          onToggleFolder={(folderId) => { void directory.toggleFolder(folderId); }}
          pageDeleteDisabled={archivingPageId !== null}
          emptyText={t('page.empty')}
          onOpenFolder={(folderId) => setCurrentFolderId(folderId)}
          onOpenPage={(page) => navigate('/pages/' + page.id)}
          onEditPage={(page) => navigate('/pages/' + page.id + '/edit')}
          onDeletePage={(page) => { void handleDeletePage(page); }}
          onCreateSubfolder={(parent) => setFolderDialog({ mode: 'create', parent, returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null })}
          onRenameFolder={(folder) => setFolderDialog({ mode: 'rename', parent: null, target: folder, returnFocusTo: document.activeElement instanceof HTMLElement ? document.activeElement : null })}
          onDeleteFolder={openFolderDelete}
          onConfigurePageAgent={compositeCreationEnabled ? (page) => {
            setBindingReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
            setBindingScope({ kind: 'page', pageId: page.id, title: page.title });
          } : undefined}
          onConfigureFolderAgents={compositeCreationEnabled ? (folder) => {
            setBindingReturnFocus(document.activeElement instanceof HTMLElement ? document.activeElement : null);
            setBindingScope({ kind: 'folder', folderId: folder.id, name: folder.name });
          } : undefined}
          onSaveFolderAsTemplate={canManageTemplates && compositeCreationEnabled ? (folder, trigger) => {
            setTemplateFolder(folder);
            setTemplateReturnFocus(trigger);
          } : undefined}
          onMove={(request) => { void handleContentMove(request); }}
        />
      </div>
      </>}
        </main>
      </div>

      {showCreate && canEdit && id ? (
        <NewPageDialog
          spaceId={id}
          folderId={targetFolderId}
          targetLocation={directory.crumbs.map((crumb) => crumb.name).filter(Boolean).join(' / ')}
          returnFocusTo={createPageOpenerRef.current}
          onClose={() => setShowCreate(false)}
          onCreated={(target) => {
            setShowCreate(false);
            if (typeof target === 'string') {
              reloadTree();
              navigate('/pages/' + target + '/edit');
              return;
            }
            const created = target as NewPageCreationTarget;
            if (created.rootFolderId) {
              setCurrentFolderId(created.rootFolderId);
            } else if (created.firstPageId) {
              reloadTree();
              navigate('/pages/' + created.firstPageId + '/edit');
            } else {
              reloadTree();
            }
          }}
        />
      ) : null}

      {bindingScope && canEdit && compositeCreationEnabled && id ? <PageAgentBindingDialog
        spaceId={id}
        scope={bindingScope}
        returnFocusTo={bindingReturnFocus}
        onClose={() => { setBindingScope(null); setBindingReturnFocus(null); }}
        onSaved={reloadTree}
      /> : null}

      {templateFolder && canManageTemplates && compositeCreationEnabled && id ? <SaveFolderAsTemplateDialog
        spaceId={id}
        folderId={templateFolder.id}
        folderName={templateFolder.name}
        returnFocusTo={templateReturnFocus}
        onClose={() => { setTemplateFolder(null); setTemplateReturnFocus(null); }}
        onSaved={() => { setTemplateFolder(null); setTemplateReturnFocus(null); }}
      /> : null}

      {folderDialog && canEdit && id ? (
        <FolderDialog
          mode={folderDialog.mode}
          initialName={folderDialog.target?.name ?? ''}
          targetLocation={folderDialog.mode === 'rename' && folderDialog.target
            ? crumbsForFolder(folderIndex, folderDialog.target.id, space.name).map((crumb) => crumb.name).join(' / ')
            : crumbsForFolder(folderIndex, folderDialog.parent?.id ?? null, space.name).map((crumb) => crumb.name).join(' / ')}
          returnFocusTo={folderDialog.returnFocusTo ?? folderOpenerRef.current}
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
          targetLocation={crumbsForFolder(folderIndex, deleteTarget.id, space.name).map((crumb) => crumb.name).join(' / ')}
          returnFocusTo={deleteReturnFocus}
          fallbackFocusTo={deleteFallbackFocus}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteReturnFocus(null);
            setDeleteFallbackFocus(null);
          }}
          onConfirm={handleDeleteFolderConfirm}
        />
      ) : null}
    </div>
  );
};
