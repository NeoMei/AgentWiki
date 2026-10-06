import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { captureReadingSelection } from '../agent-session/readingSelection';
import type { AssistTarget } from './assistTargets';
const AgentReadingSidebar = React.lazy(() => import('../agent-session/AgentReadingSidebar').then((module) => ({ default: module.AgentReadingSidebar })));
import { apiErrorMessage } from '../../api/error-message';
import { getContentTreeRevision } from '../../api/content-tree';
import { ArrowLeft, ChevronRight, Clock, Folder, User, PenLine, FileText } from 'lucide-react';
import 'highlight.js/styles/github.css';
import { useLanguage } from '../../context/LanguageContext';
import { Markdown } from '../../components/Markdown';
import type { MarkdownTaskRef, MarkdownTaskToggle } from '../../components/markdown/markdownTypes';
import { rebaseMarkdownTask, toggleMarkdownTask } from '../../components/markdown/tasks';
import { useOptionalSpaceWorkspace, usePageWorkspaceIdentity } from '../space-workspace/SpaceWorkspaceContext';
import { ArticleContentsPopover } from '../space-workspace/ArticleContentsPopover';
import { PageInfoPanel } from '../space-workspace/PageInfoPanel';
import {
  captureReadingPosition,
  readWorkspacePosition,
  createWorkspacePositionRecorder,
  renderedHeadingText,
  spaceFolderHref,
  type WorkspacePosition,
} from '../space-workspace/workspaceNavigation';

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
  folderId?: string | null;
  provenance?: any;
  evidence?: any[];
  lastChange?: { id: string; title: string; status: string } | null;
  lastModifiedByUser?: { id: string; name?: string; email?: string } | null;
  lastModifiedByAgent?: { id: string; name: string } | null;
  lastModifiedAt?: string;
  capabilities?: { canEdit?: boolean };
}

interface PendingTaskOperation {
  id: number;
  pageId: string;
  generation: number;
  task: MarkdownTaskRef;
  nextChecked: boolean;
  requiresRebase: boolean;
}

export const PagePreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const reportPageIdentity = usePageWorkspaceIdentity();
  const workspace = useOptionalSpaceWorkspace();
  const tRef = useRef(t);
  tRef.current = t;
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadRequest, setLoadRequest] = useState(0);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [outlineOccupiedWidth, setOutlineOccupiedWidth] = useState(0);
  const [localPanel, setLocalPanel] = useState({ open: false, notes: false });
  const [agentMounted, setAgentMounted] = useState(false);
  const [readingTarget, setReadingTarget] = useState<AssistTarget | null>(null);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [panelGeometry, setPanelGeometry] = useState({ top: 130, width: window.innerWidth });
  const readingToolbarRef = useRef<HTMLDivElement>(null);
  const panelMatches = workspace?.spaceId === page?.spaceId && workspace?.userId === user?.id;
  const agentOpen = panelGeometry.width >= 1024 && panelMatches ? workspace?.collaborationOpen === true : localPanel.open;
  const notesOpen = panelMatches ? workspace?.collaborationTab === 'notes' : localPanel.notes;
  const openAgent = (notes = false) => {
    setAgentMounted(true); setLocalPanel({ open: true, notes });
    if (!notes) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-agent-composer]')?.focus());
    if (panelMatches) workspace?.setPanelPreferences({ collaborationTab: notes ? 'notes' : 'assist', ...(panelGeometry.width >= 1024 ? { collaborationOpen: true } : {}) });
  };
  const closeAgent = () => {
    setLocalPanel((state) => ({ ...state, open: false }));
    if (panelMatches && panelGeometry.width >= 1024) workspace?.setPanelPreferences({ collaborationOpen: false });
    readingToolbarRef.current?.querySelector<HTMLButtonElement>('[data-agent-toggle]')?.focus();
  };
  useEffect(() => { setReadingTarget(null); setSelectionUnavailable(false); }, [id, page?.updatedAt, user?.id]);
  useEffect(() => {
    const position = () => setPanelGeometry({ top: Math.ceil(readingToolbarRef.current?.getBoundingClientRect().bottom ?? 118) + 12, width: window.innerWidth });
    position(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position);
    if (readingToolbarRef.current) observer?.observe(readingToolbarRef.current);
    document.addEventListener('scroll', position, true); window.addEventListener('resize', position);
    return () => { observer?.disconnect(); document.removeEventListener('scroll', position, true); window.removeEventListener('resize', position); };
  }, [page?.id, loading]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'l' && page?.id === id && !loading && !error) {
        event.preventDefault(); openAgent(); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-agent-composer]')?.focus());
      }
      if (event.key === 'Escape' && agentOpen) closeAgent();
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [id, page?.id, page?.spaceId, loading, error, agentOpen, panelMatches, panelGeometry.width]);
  const [relatedPages, setRelatedPages] = useState<any[]>([]);
  const [pendingTaskIndexes, setPendingTaskIndexes] = useState<ReadonlySet<number>>(new Set());
  const mountedRef = useRef(false);
  const activePageIdRef = useRef<string | undefined>(id);
  const loadedRouteIdRef = useRef<string | undefined>(undefined);
  const routeGenerationRef = useRef(0);
  const pageLoadSequenceRef = useRef(0);
  const pageRef = useRef<Page | null>(null);
  const markdownRootRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledHashRef = useRef<string | null>(null);
  const restoredEntryRef = useRef<string | null>(null);
  const lastCommittedPageRef = useRef<Page | null>(null);
  const pendingTaskOperationsRef = useRef<PendingTaskOperation[]>([]);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const nextTaskOperationIdRef = useRef(0);
  const deleteOperationRef = useRef(0);
  const deleteControllerRef = useRef<AbortController | null>(null);
  const deleteInFlightRef = useRef(false);

  activePageIdRef.current = id;

  const routeIsActive = (pageId: string, generation: number) => (
    mountedRef.current
    && activePageIdRef.current === pageId
    && routeGenerationRef.current === generation
  );

  const removePendingOperation = (operationId: number) => {
    pendingTaskOperationsRef.current = pendingTaskOperationsRef.current.filter(
      (operation) => operation.id !== operationId,
    );
  };

  const replayPendingOperations = (pageId: string, generation: number) => {
    const committed = lastCommittedPageRef.current;
    if (!committed || !routeIsActive(pageId, generation)) return;

    let content = committed.content || '';
    const indexes = new Set<number>();
    for (const operation of pendingTaskOperationsRef.current) {
      if (operation.pageId !== pageId || operation.generation !== generation) continue;

      let task = operation.requiresRebase ? rebaseMarkdownTask(content, operation.task) : operation.task;
      let toggled = task ? toggleMarkdownTask(content, task, operation.nextChecked) : null;
      if (!toggled && !operation.requiresRebase) {
        task = rebaseMarkdownTask(content, operation.task);
        toggled = task ? toggleMarkdownTask(content, task, operation.nextChecked) : null;
      }
      if (!task || toggled === null) continue;

      operation.task = task;
      operation.requiresRebase = false;
      indexes.add(task.index);
      content = toggled;
    }

    const optimisticPage = { ...committed, content };
    pageRef.current = optimisticPage;
    setPage(optimisticPage);
    setPendingTaskIndexes(indexes);
  };

  const showTaskSaveFailure = (pageId: string, generation: number) => {
    if (routeIsActive(pageId, generation)) setTaskSaveError(tRef.current('page.taskSaveFailed'));
  };

  const adoptSavedTask = (
    pageId: string,
    generation: number,
    operation: PendingTaskOperation,
    baseline: Page,
    content: string,
    responseData: Partial<Page>,
  ) => {
    if (!routeIsActive(pageId, generation)) return;
    lastCommittedPageRef.current = {
      ...baseline,
      ...responseData,
      content,
      capabilities: responseData.capabilities ?? baseline.capabilities,
    };
    removePendingOperation(operation.id);
    replayPendingOperations(pageId, generation);
  };

  const processTaskOperation = async (operation: PendingTaskOperation) => {
    const pageId = operation.pageId;
    const generation = operation.generation;
    if (!routeIsActive(pageId, generation)) return;
    const baseline = lastCommittedPageRef.current;
    if (!baseline) return;

    let task = operation.requiresRebase
      ? rebaseMarkdownTask(baseline.content || '', operation.task)
      : operation.task;
    let content = task
      ? toggleMarkdownTask(baseline.content || '', task, operation.nextChecked)
      : null;
    if (content === null && !operation.requiresRebase) {
      task = rebaseMarkdownTask(baseline.content || '', operation.task);
      content = task
        ? toggleMarkdownTask(baseline.content || '', task, operation.nextChecked)
        : null;
    }
    if (!task || content === null) {
      removePendingOperation(operation.id);
      replayPendingOperations(pageId, generation);
      showTaskSaveFailure(pageId, generation);
      return;
    }

    try {
      const response = await api.patch(`/pages/${pageId}`, {
        content,
        expectedUpdatedAt: baseline.updatedAt,
      });
      adoptSavedTask(pageId, generation, operation, baseline, content, response.data || {});
      return;
    } catch (error: any) {
      if (!routeIsActive(pageId, generation)) return;
      if (error.response?.status !== 409) {
        removePendingOperation(operation.id);
        replayPendingOperations(pageId, generation);
        showTaskSaveFailure(pageId, generation);
        return;
      }
    }

    try {
      const latestResponse = await api.get(`/pages/${pageId}`);
      if (!routeIsActive(pageId, generation)) return;
      const latest: Page = { ...baseline, ...latestResponse.data };
      lastCommittedPageRef.current = latest;
      for (const pending of pendingTaskOperationsRef.current) {
        if (
          pending.pageId === pageId
          && pending.generation === generation
          && pending.id !== operation.id
        ) pending.requiresRebase = true;
      }

      const rebasedTask = rebaseMarkdownTask(latest.content || '', operation.task);
      if (rebasedTask?.checked === operation.nextChecked) {
        removePendingOperation(operation.id);
        replayPendingOperations(pageId, generation);
        return;
      }
      const rebasedContent = rebasedTask
        ? toggleMarkdownTask(latest.content || '', rebasedTask, operation.nextChecked)
        : null;
      if (!rebasedTask || rebasedContent === null) {
        removePendingOperation(operation.id);
        replayPendingOperations(pageId, generation);
        showTaskSaveFailure(pageId, generation);
        return;
      }

      try {
        const retryResponse = await api.patch(`/pages/${pageId}`, {
          content: rebasedContent,
          expectedUpdatedAt: latest.updatedAt,
        });
        adoptSavedTask(pageId, generation, operation, latest, rebasedContent, retryResponse.data || {});
      } catch {
        if (!routeIsActive(pageId, generation)) return;
        removePendingOperation(operation.id);
        replayPendingOperations(pageId, generation);
        showTaskSaveFailure(pageId, generation);
      }
    } catch {
      if (!routeIsActive(pageId, generation)) return;
      removePendingOperation(operation.id);
      replayPendingOperations(pageId, generation);
      showTaskSaveFailure(pageId, generation);
    }
  };

  const handleTaskToggle = (toggle: MarkdownTaskToggle) => {
    if (!id) return;
    const generation = routeGenerationRef.current;
    if (!routeIsActive(id, generation)) return;
    const current = pageRef.current;
    if (!current || current.capabilities?.canEdit !== true) return;
    const optimisticContent = toggleMarkdownTask(current.content || '', toggle.task, toggle.nextChecked);
    if (optimisticContent === null) return;

    const operation: PendingTaskOperation = {
      id: nextTaskOperationIdRef.current++,
      pageId: id,
      generation,
      task: toggle.task,
      nextChecked: toggle.nextChecked,
      requiresRebase: false,
    };
    pendingTaskOperationsRef.current = [...pendingTaskOperationsRef.current, operation];
    setTaskSaveError(null);
    replayPendingOperations(id, generation);
    saveChainRef.current = saveChainRef.current
      .then(() => processTaskOperation(operation))
      .catch(() => {
        if (!routeIsActive(operation.pageId, operation.generation)) return;
        removePendingOperation(operation.id);
        replayPendingOperations(operation.pageId, operation.generation);
        showTaskSaveFailure(operation.pageId, operation.generation);
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      deleteOperationRef.current += 1;
      deleteControllerRef.current?.abort();
      deleteControllerRef.current = null;
      deleteInFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    const routeChanged = loadedRouteIdRef.current !== id;
    loadedRouteIdRef.current = id;
    const generation = routeChanged ? routeGenerationRef.current + 1 : routeGenerationRef.current;
    if (routeChanged) routeGenerationRef.current = generation;
    const loadSequence = pageLoadSequenceRef.current + 1;
    pageLoadSequenceRef.current = loadSequence;
    activePageIdRef.current = id;
    if (routeChanged) {
      deleteOperationRef.current += 1;
      deleteControllerRef.current?.abort();
      deleteControllerRef.current = null;
      deleteInFlightRef.current = false;
      pendingTaskOperationsRef.current = [];
      saveChainRef.current = Promise.resolve();
      lastCommittedPageRef.current = null;
      pageRef.current = null;
      lastScrolledHashRef.current = null;
      setPage(null);
      setTaskSaveError(null);
      setDeleting(false);
      setPendingTaskIndexes(new Set());
      setRelatedPages([]);
      if (id) reportPageIdentity(id, null);
    }
    setLoading(true);
    setError(null);
    if (!id) {
      setLoading(false);
      return;
    }

    const requestedId = id;
    api.get(`/pages/${requestedId}`)
      .then((response) => {
        if (!routeIsActive(requestedId, generation) || pageLoadSequenceRef.current !== loadSequence) return;
        lastCommittedPageRef.current = response.data;
        pageRef.current = response.data;
        const hasPendingTasks = pendingTaskOperationsRef.current.some(
          (operation) => operation.pageId === requestedId && operation.generation === generation,
        );
        if (hasPendingTasks) {
          for (const operation of pendingTaskOperationsRef.current) {
            if (operation.pageId === requestedId && operation.generation === generation) operation.requiresRebase = true;
          }
          replayPendingOperations(requestedId, generation);
        } else {
          setPage(response.data);
        }
        setError(null);
        reportPageIdentity(requestedId, response.data?.spaceId || null, response.data?.folderId ?? null);
      })
      .catch((loadError: any) => {
        if (!routeIsActive(requestedId, generation) || pageLoadSequenceRef.current !== loadSequence) return;
        const status = loadError.response?.status;
        if (status === 401 || status === 403) reportPageIdentity(requestedId, null);
        setError(apiErrorMessage(loadError, tRef.current, 'editor.loadFailed'));
      })
      .finally(() => {
        if (routeIsActive(requestedId, generation) && pageLoadSequenceRef.current === loadSequence) setLoading(false);
      });
  }, [id, loadRequest, reportPageIdentity, workspace?.pageRefreshRequest]);

  useEffect(() => {
    setRelatedPages([]);
    if (!id) return;
    const requestedId = id;
    const generation = routeGenerationRef.current;
    api.get(`/knowledge/related/${requestedId}`)
      .then((res) => {
        if (routeIsActive(requestedId, generation)) setRelatedPages(res.data || []);
      })
      .catch(() => {
        if (routeIsActive(requestedId, generation)) setRelatedPages([]);
      });
  }, [id]);

  useEffect(() => {
    if (loading || !id || !page || page.id !== id) return;
    const pageId = id;
    const spaceId = page.spaceId;
    const generation = routeGenerationRef.current;

    const observer = new MutationObserver(() => {
      if (scrollToCurrentHash()) observer.disconnect();
    });

    const currentHashTarget = (): string | null => {
      const encodedTarget = window.location.hash.slice(1);
      if (!encodedTarget) return null;
      try {
        return decodeURIComponent(encodedTarget) || null;
      } catch {
        return null;
      }
    };

    function scrollToCurrentHash(): boolean {
      const currentPage = pageRef.current;
      if (
        !mountedRef.current
        || activePageIdRef.current !== pageId
        || routeGenerationRef.current !== generation
        || currentPage?.id !== pageId
        || currentPage.spaceId !== spaceId
      ) return false;

      const targetId = currentHashTarget();
      if (!targetId) return false;

      const target = document.getElementById(targetId);
      const markdownRoot = markdownRootRef.current;
      if (!target || !markdownRoot?.contains(target)) return false;

      const scrollIdentity = `${generation}:${window.location.hash}`;
      if (lastScrolledHashRef.current === scrollIdentity) return true;
      target.scrollIntoView();
      lastScrolledHashRef.current = scrollIdentity;
      return true;
    }

    const armHashScroll = () => {
      observer.disconnect();
      if (!currentHashTarget()) return;
      if (scrollToCurrentHash()) return;
      const markdownRoot = markdownRootRef.current;
      if (markdownRoot) observer.observe(markdownRoot, { childList: true, subtree: true });
    };

    armHashScroll();
    window.addEventListener('hashchange', armHashScroll);
    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', armHashScroll);
    };
  }, [id, loading, page?.content, page?.id, page?.spaceId]);

  useLayoutEffect(() => {
    if (
      loading
      || !page
      || page.id !== id
      || !markdownRootRef.current
      || restoredEntryRef.current === location.key
    ) return;
    const requestedFromState = (location.state as { workspacePosition?: WorkspacePosition } | null)?.workspacePosition;
    const requested = (requestedFromState?.pageId === page.id ? requestedFromState : null)
      ?? (navigationType === 'POP' ? readWorkspacePosition(location.key, page.id) : null);
    restoredEntryRef.current = location.key;
    if (!requested) {
      if (navigationType !== 'POP' && window.scrollY > 0) {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      }
      return;
    }
    // The hash-scrolling effect owns hash targets. `window.location.hash` also
    // covers memory-router tests and embedded hosts whose router location can
    // lag the browser history update for one render.
    if (location.hash || window.location.hash) return;
    const sourceBlock = requested.sourceOffset === null ? null : [
      ...markdownRootRef.current.querySelectorAll<HTMLElement>('[data-markdown-source-start]'),
    ].reduce<HTMLElement | null>((nearest, candidate) => (
      Number(candidate.dataset.markdownSourceStart) <= requested.sourceOffset! ? candidate : nearest
    ), null);
    const headingById = requested.headingId ? document.getElementById(requested.headingId) : null;
    const heading = headingById ?? (requested.headingText
      ? [...markdownRootRef.current.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')]
        .find((candidate) => renderedHeadingText(candidate) === requested.headingText) ?? null
      : null);
    const target = sourceBlock ?? heading;
    if (target && markdownRootRef.current.contains(target)) {
      target.scrollIntoView({ block: 'start' });
      const toolbarBottom = document.querySelector<HTMLElement>('[data-reading-toolbar]')
        ?.getBoundingClientRect().bottom ?? 0;
      const hiddenByToolbar = toolbarBottom - target.getBoundingClientRect().top + 12;
      if (hiddenByToolbar > 0) window.scrollBy({ top: -hiddenByToolbar, left: 0, behavior: 'instant' });
    } else if (requested.scrollTop > 0) window.scrollTo({ top: requested.scrollTop, left: 0, behavior: 'instant' });
  }, [loading, location.key, location.state, navigationType, page]);

  useEffect(() => {
    if (loading || !page || page.id !== id) return;
    const pageId = page.id;
    const rememberWorkspacePosition = createWorkspacePositionRecorder();
    const rememberCurrentPosition = () => {
      const root = markdownRootRef.current;
      if (!root) return;
      const toolbarBottom = document.querySelector<HTMLElement>('[data-reading-toolbar]')
        ?.getBoundingClientRect().bottom ?? 88;
      rememberWorkspacePosition(location.key, captureReadingPosition(root, toolbarBottom, pageId));
    };
    window.addEventListener('scroll', rememberCurrentPosition, { passive: true });
    return () => {
      rememberCurrentPosition();
      window.removeEventListener('scroll', rememberCurrentPosition);
    };
  }, [id, loading, location.key, page?.content, page?.id]);

  const handleDelete = async () => {
    if (
      !page
      || deleteInFlightRef.current
      || page.capabilities?.canEdit !== true
      || !window.confirm(t('page.deleteConfirm', { title: page.title }))
    ) return;
    const requestedPageId = page.id;
    const requestedSpaceId = page.spaceId;
    const requestedUpdatedAt = page.updatedAt;
    const requestedGeneration = routeGenerationRef.current;
    const operation = ++deleteOperationRef.current;
    deleteInFlightRef.current = true;
    deleteControllerRef.current?.abort();
    const controller = new AbortController();
    deleteControllerRef.current = controller;
    setDeleting(true);
    try {
      const expectedTreeRevision = await getContentTreeRevision(requestedSpaceId, controller.signal);
      const currentPage = pageRef.current;
      if (
        !routeIsActive(requestedPageId, requestedGeneration)
        || controller.signal.aborted
        || deleteOperationRef.current !== operation
        || currentPage?.id !== requestedPageId
        || currentPage.spaceId !== requestedSpaceId
        || currentPage.updatedAt !== requestedUpdatedAt
      ) return;
      await api.delete(`/pages/${requestedPageId}`, {
        data: { expectedUpdatedAt: requestedUpdatedAt, expectedTreeRevision },
      });
      if (
        routeIsActive(requestedPageId, requestedGeneration)
        && deleteOperationRef.current === operation
      ) navigate(`/spaces/${requestedSpaceId}`);
    } catch (err: any) {
      if (
        routeIsActive(requestedPageId, requestedGeneration)
        && !controller.signal.aborted
        && deleteOperationRef.current === operation
      ) setError(apiErrorMessage(err, t, 'page.deleteFailed'));
    } finally {
      if (deleteControllerRef.current === controller) deleteControllerRef.current = null;
      if (deleteOperationRef.current === operation) deleteInFlightRef.current = false;
      if (routeIsActive(requestedPageId, requestedGeneration) && deleteOperationRef.current === operation) {
        setDeleting(false);
      }
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <button type="button" onClick={() => setLoadRequest((current) => current + 1)} className="mr-3 text-blue-600 hover:underline">
        {t('common.retry')}
      </button>
      {page?.spaceId ? (
        <Link to={`/spaces/${page.spaceId}`} className="text-blue-600 hover:underline">{t('editor.backToSpace')}</Link>
      ) : (
        <Link to="/" className="text-blue-600 hover:underline">{t('search.back')}</Link>
      )}
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div className="document-page">
      <div ref={readingToolbarRef} data-reading-toolbar className="document-toolbar sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white">
        {workspace?.directoryCrumbs.length ? (
          <nav aria-label="breadcrumb" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-gray-500">
            {workspace.directoryCrumbs.map((crumb, index) => (
              <React.Fragment key={crumb.id ?? 'root'}>
                {index > 0 ? <ChevronRight size={14} className="shrink-0 text-gray-300" aria-hidden="true" /> : null}
                <Link
                  to={spaceFolderHref(page.spaceId, crumb.id)}
                  title={crumb.name}
                  className="flex min-w-0 items-center gap-1 rounded px-1.5 py-1 hover:bg-gray-100 hover:text-blue-700"
                >
                  <Folder size={14} className="shrink-0 text-gray-400" aria-hidden="true" />
                  <span className="max-w-40 truncate">{crumb.name}</span>
                </Link>
              </React.Fragment>
            ))}
          </nav>
        ) : page.spaceId ? (
          <Link to={`/spaces/${page.spaceId}`} className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-blue-700" title={t('editor.backToSpace')}>
            <ArrowLeft size={18} aria-hidden="true" />
            {t('editor.backToSpace')}
          </Link>
        ) : <span />}
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          <button type="button" data-agent-toggle aria-pressed={agentOpen && !notesOpen} onClick={() => agentOpen && !notesOpen ? closeAgent() : openAgent()} className="min-h-9 rounded-lg px-3 text-sm hover:bg-gray-100">Agent</button>
          <button type="button" aria-pressed={agentOpen && notesOpen} disabled={!user?.id} onClick={() => openAgent(true)} className="min-h-9 rounded-lg px-3 text-sm hover:bg-gray-100 disabled:opacity-40">{language === 'zh-CN' ? '个人笔记' : 'Personal notes'}</button>
          {page.capabilities?.canEdit === true ? (
            <button
              type="button"
              onClick={() => {
                const root = markdownRootRef.current;
                const toolbarBottom = document.querySelector<HTMLElement>('[data-reading-toolbar]')
                  ?.getBoundingClientRect().bottom ?? 88;
                navigate(`/pages/${id}/edit`, {
                  state: { workspacePosition: root ? captureReadingPosition(root, toolbarBottom, page.id) : null },
                });
              }}
              aria-label={t('common.edit')}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <PenLine size={17} aria-hidden="true" />
              {t('common.edit')}
            </button>
          ) : null}
          <ArticleContentsPopover articleRootRef={markdownRootRef} pageKey={page.id} spaceId={page.spaceId} source={page.content || ''} onOccupiedWidthChange={setOutlineOccupiedWidth} suppressed={agentOpen} />
          <PageInfoPanel
            key={page.id}
            spaceId={page.spaceId}
            provenance={page.provenance}
            evidence={page.evidence}
            lastChange={page.lastChange}
            lastModifiedByUser={page.lastModifiedByUser}
            lastModifiedByAgent={page.lastModifiedByAgent}
            lastModifiedAt={page.lastModifiedAt}
            canEdit={page.capabilities?.canEdit === true}
            deleting={deleting}
            onDelete={handleDelete}
            onOpenHistory={() => {
              const toolbarBottom = document.querySelector<HTMLElement>('[data-reading-toolbar]')
                ?.getBoundingClientRect().bottom ?? 88;
              const workspacePosition = markdownRootRef.current
                ? captureReadingPosition(markdownRootRef.current, toolbarBottom, page.id)
                : null;
              navigate(`/pages/${page.id}/versions`, {
                state: { pageHistorySource: { pageId: page.id, mode: 'read', workspacePosition } },
              });
            }}
          />
        </div>
      </div>

      <article className="document-canvas min-h-[300px] bg-white" style={{ '--document-panel-width': `${agentOpen && panelGeometry.width >= 1600 ? 420 : outlineOccupiedWidth}px` } as React.CSSProperties}>
        <header className="document-header">
          <h1 title={page.title} className="document-title">{page.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            {page.author ? (
              <span className="flex items-center gap-1">
                <User size={14} aria-hidden="true" />
                {page.author.name || page.author.email || t('page.unknown')}
              </span>
            ) : null}
            <span className="flex items-center gap-1">
              <Clock size={14} aria-hidden="true" />
              {new Date(page.updatedAt).toLocaleDateString(language)}
            </span>
          </div>
        </header>
        {taskSaveError ? <p role="alert" className="mb-4 text-sm text-red-600">{taskSaveError}</p> : null}
        <div ref={markdownRootRef} className="document-body" onMouseUp={() => {
          const selection = window.getSelection(), root = markdownRootRef.current?.querySelector<HTMLElement>('[data-markdown-selection-root]');
          if (!root || !selection?.rangeCount || selection.isCollapsed) return;
          const target = captureReadingSelection(root, selection.getRangeAt(0), page.content, page.updatedAt, root.dataset.markdownSelectionVersion ?? '');
          setReadingTarget(target); setSelectionUnavailable(!target);
        }} onKeyUp={() => {
          const selection = window.getSelection(), root = markdownRootRef.current?.querySelector<HTMLElement>('[data-markdown-selection-root]');
          if (!root || !selection?.rangeCount || selection.isCollapsed) return;
          const target = captureReadingSelection(root, selection.getRangeAt(0), page.content, page.updatedAt, root.dataset.markdownSelectionVersion ?? '');
          setReadingTarget(target); setSelectionUnavailable(!target);
        }}>
          {page.content ? (
            <Markdown
              mode="page"
              selectionSourceVersion={page.updatedAt}
              className="document-body"
              canEdit={page.capabilities?.canEdit === true}
              pendingTaskIndexes={pendingTaskIndexes}
              onTaskToggle={handleTaskToggle}
              pageId={page.id}
              spaceId={page.spaceId}
            >
              {page.content}
            </Markdown>
          ) : (
            <p className="text-gray-400">{t('page.emptyContent')}</p>
          )}
        </div>
      </article>

      {agentMounted || agentOpen ? <div hidden={!agentOpen} className="document-assist-layer" style={{ top: panelGeometry.top, width: Math.min(400, panelGeometry.width - 32) }}>
        <div className="document-panel-scroll document-agent-scroll">
          <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white p-3 text-sm"><button type="button" onClick={() => openAgent()} aria-pressed={!notesOpen} className={`rounded-lg px-2 py-1 ${!notesOpen ? 'bg-gray-100 font-medium' : 'text-gray-500'}`}>Agent</button><button type="button" onClick={() => openAgent(true)} aria-pressed={notesOpen} className={`rounded-lg px-2 py-1 ${notesOpen ? 'bg-gray-100 font-medium' : 'text-gray-500'}`}>{language === 'zh-CN' ? '个人笔记' : 'Personal notes'}</button><button type="button" className="ml-auto min-h-8 px-2" aria-label={language === 'zh-CN' ? '关闭协作面板' : 'Close collaboration panel'} onClick={closeAgent}>×</button></div>
          <React.Suspense fallback={<p>Agent…</p>}><AgentReadingSidebar key={`${user?.id}:${page.spaceId}:${page.id}`} page={page} notesOpen={notesOpen} target={readingTarget} selectionUnavailable={selectionUnavailable} onTarget={setReadingTarget} onOpenAgent={() => openAgent()} /></React.Suspense>
        </div>
      </div> : null}
      {relatedPages.length > 0 && (
        <div className="mx-auto mt-6 max-w-[860px] px-1 sm:px-5 lg:px-8">
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
