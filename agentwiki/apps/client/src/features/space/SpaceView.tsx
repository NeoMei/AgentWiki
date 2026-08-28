import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import { FileText, Plus, X } from 'lucide-react';
import { SpaceNav } from '../../components/SpaceNav';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { PageTree, PageTreeNode } from '../../components/PageTree';
import { NewPageDialog } from '../page-templates/NewPageDialog';

// Compute the new parent/sortOrder for every page after a drag move.
export const applyMove = (
  nodes: PageTreeNode[],
  dragId: string,
  targetId: string,
  position: 'into' | 'before' | 'after',
): Array<{ id: string; parentId: string | null; sortOrder: number }> => {
  // Deep clone so we never mutate React state directly.
  const clone = JSON.parse(JSON.stringify(nodes)) as PageTreeNode[];
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string | null, PageTreeNode[]>();
  const register = (list: PageTreeNode[], parent: string | null) => {
    childrenOf.set(parent, list);
    for (const node of list) {
      parentOf.set(node.id, parent);
      if (node.children?.length) register(node.children, node.id);
    }
  };
  register(clone, null);

  const findNode = (list: PageTreeNode[], id: string): PageTreeNode | null => {
    for (const node of list) {
      if (node.id === id) return node;
      const found = node.children ? findNode(node.children, id) : null;
      if (found) return found;
    }
    return null;
  };
  const dragNode = findNode(clone, dragId);
  if (!dragNode) return [];

  // detach drag node from its siblings
  for (const list of childrenOf.values()) {
    const index = list.findIndex((node) => node.id === dragId);
    if (index >= 0) list.splice(index, 1);
  }

  const newParent = position === 'into' ? targetId : parentOf.get(targetId) ?? null;
  // prevent dropping into its own subtree
  let cursor: string | null = newParent;
  while (cursor) {
    if (cursor === dragId) return [];
    cursor = parentOf.get(cursor) ?? null;
  }
  dragNode.children = dragNode.children || [];
  const siblings = childrenOf.get(newParent) || [];
  childrenOf.set(newParent, siblings);
  if (position === 'into') siblings.push(dragNode);
  else {
    const index = siblings.findIndex((node) => node.id === targetId);
    siblings.splice(position === 'before' ? index : index + 1, 0, dragNode);
  }
  parentOf.set(dragId, newParent);
  // keep each node's own children array in sync with the rebuilt map so the
  // emit walk below sees the moved node under its new parent
  if (position === 'into') {
    const target = findNode(clone, targetId);
    if (target) target.children = siblings;
  }

  // flatten in order, assigning sequential sortOrder per sibling group
  const items: Array<{ id: string; parentId: string | null; sortOrder: number }> = [];
  const emit = (list: PageTreeNode[], parent: string | null) => {
    list.forEach((node, index) => {
      items.push({ id: node.id, parentId: parent, sortOrder: index });
      const childList = childrenOf.get(node.id) || node.children || [];
      if (childList.length) emit(childList, node.id);
    });
  };
  emit(childrenOf.get(null) || [], null);
  return items;
};

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

export const SpaceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user } = useAuth();
  const createPageOpenerRef = useRef<HTMLButtonElement | null>(null);
  const requestSequenceRef = useRef(0);
  const fetchedRouteIdRef = useRef<string | undefined>(undefined);

  const [space, setSpace] = useState<Space | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageTree, setPageTree] = useState<PageTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [requestSpaceId, setRequestSpaceId] = useState<string | undefined>(undefined);

  const fetchData = useCallback(async (resetForRoute = false) => {
    const requestSequence = ++requestSequenceRef.current;
    setRequestSpaceId(id);
    if (resetForRoute) {
      setLoading(true);
      setError(null);
      setActionError(null);
      setSpace(null);
      setPages([]);
      setPageTree([]);
    }
    if (!id) {
      if (requestSequenceRef.current === requestSequence) setLoading(false);
      return;
    }
    try {
      const [spaceRes, pagesRes] = await Promise.all([
        api.get(`/spaces/${id}`),
        api.get(`/pages/hierarchy/${id}`),
      ]);
      if (requestSequenceRef.current !== requestSequence) return;
      setSpace(spaceRes.data);
      const tree: PageTreeNode[] = Array.isArray(pagesRes.data) ? pagesRes.data : pagesRes.data.data || [];
      setPageTree(tree);
      setPages(flattenTree(tree));
    } catch (err: any) {
      if (requestSequenceRef.current !== requestSequence) return;
      setError(err.response?.data?.message || t('page.loadSpaceFailed'));
    } finally {
      if (requestSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    const routeChanged = fetchedRouteIdRef.current !== id;
    fetchedRouteIdRef.current = id;
    if (routeChanged) setShowCreate(false);
    void fetchData(routeChanged);
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [fetchData, id]);

  const handleDeletePage = async (pageId: string, pageTitle: string, expectedUpdatedAt?: string) => {
    if (!window.confirm(t('page.deleteConfirm', { title: pageTitle }))) return;
    if (!id || !expectedUpdatedAt) {
      setActionError(t('page.deleteFailed'));
      return;
    }
    try {
      const expectedTreeRevision = await getContentTreeRevision(id);
      await api.delete(`/pages/${pageId}`, {
        data: { expectedUpdatedAt, expectedTreeRevision },
      });
      setPages((prev) => prev.filter((p) => p.id !== pageId));
      setPageTree((prev) => removeFromTree(prev, pageId));
    } catch (err: any) {
      setActionError(err.response?.data?.message || t('page.deleteFailed'));
    }
  };

  const handleMove = async (dragId: string, targetId: string | null, position: 'into' | 'before' | 'after') => {
    if (!id || !targetId) return;
    const items = applyMove(pageTree, dragId, targetId, position);
    if (!items.length) return;
    try {
      const res = await api.patch(`/pages/reorder/${id}`, { items });
      const tree: PageTreeNode[] = Array.isArray(res.data) ? res.data : res.data.data || [];
      setPageTree(tree);
      setPages(flattenTree(tree));
    } catch (err: any) {
      setActionError(err.response?.data?.message || t('page.loadSpaceFailed'));
      // Rollback: refetch from server to restore correct state
      void fetchData();
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
  const canCreatePages = space.id === id && (
    user?.platformRole === 'super_admin'
      || currentRole === 'owner'
      || currentRole === 'admin'
      || currentRole === 'editor'
  );

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
        {canCreatePages ? (
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
            onDelete={(node) => handleDeletePage(node.id, node.title, node.updatedAt)}
            editLabel={t('page.edit')}
            deleteLabel={t('page.delete')}
            onMove={handleMove}
          />
        </div>
      )}

      {showCreate && canCreatePages && id ? (
        <NewPageDialog
          spaceId={id}
          parentOptions={pages.map(({ id: pageId, title }) => ({ id: pageId, title }))}
          returnFocusTo={createPageOpenerRef.current}
          onClose={() => setShowCreate(false)}
          onCreated={(pageId) => {
            setShowCreate(false);
            navigate(`/pages/${pageId}/edit`);
          }}
        />
      ) : null}
    </div>
  );
};
