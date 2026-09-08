import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import api from '../../api/client';
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
  rememberWorkspacePosition,
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
  const reportPageIdentity = usePageWorkspaceIdentity();
  const workspace = useOptionalSpaceWorkspace();
  const tRef = useRef(t);
  tRef.current = t;
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskSaveError, setTaskSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [relatedPages, setRelatedPages] = useState<any[]>([]);
  const [pendingTaskIndexes, setPendingTaskIndexes] = useState<ReadonlySet<number>>(new Set());
  const mountedRef = useRef(false);
  const activePageIdRef = useRef<string | undefined>(id);
  const routeGenerationRef = useRef(0);
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
    const generation = routeGenerationRef.current + 1;
    routeGenerationRef.current = generation;
    deleteOperationRef.current += 1;
    deleteControllerRef.current?.abort();
    deleteControllerRef.current = null;
    deleteInFlightRef.current = false;
    activePageIdRef.current = id;
    pendingTaskOperationsRef.current = [];
    saveChainRef.current = Promise.resolve();
    lastCommittedPageRef.current = null;
    pageRef.current = null;
    lastScrolledHashRef.current = null;
    setPage(null);
    setLoading(true);
    setError(null);
    setTaskSaveError(null);
    setDeleting(false);
    setPendingTaskIndexes(new Set());
    setRelatedPages([]);
    if (id) reportPageIdentity(id, null);
    if (!id) {
      setLoading(false);
      return;
    }

    const requestedId = id;
    api.get(`/pages/${requestedId}`)
      .then((response) => {
        if (!routeIsActive(requestedId, generation)) return;
        lastCommittedPageRef.current = response.data;
        pageRef.current = response.data;
        setPage(response.data);
        reportPageIdentity(requestedId, response.data?.spaceId || null, response.data?.folderId ?? null);
      })
      .catch((loadError: any) => {
        if (!routeIsActive(requestedId, generation)) return;
        reportPageIdentity(requestedId, null);
        setError(loadError.response?.data?.message || tRef.current('editor.loadFailed'));
      })
      .finally(() => {
        if (routeIsActive(requestedId, generation)) setLoading(false);
      });
  }, [id, reportPageIdentity]);

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
      ) setError(err.response?.data?.message || t('page.deleteFailed'));
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
      {page?.spaceId ? (
        <Link to={`/spaces/${page.spaceId}`} className="text-blue-600 hover:underline">{t('editor.backToSpace')}</Link>
      ) : (
        <Link to="/" className="text-blue-600 hover:underline">{t('search.back')}</Link>
      )}
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <div data-reading-toolbar className="sticky top-16 z-20 -mx-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
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
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
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
          <ArticleContentsPopover articleRootRef={markdownRootRef} pageKey={page.id} />
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

      <article className="mx-auto min-h-[300px] min-w-0 max-w-[860px] bg-white px-1 py-5 sm:px-5 lg:px-8">
        <header className="mb-8 border-b border-gray-200 pb-5">
          <h1 title={page.title} className="break-words text-3xl font-semibold leading-tight text-gray-950">{page.title}</h1>
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
        <div ref={markdownRootRef} className="prose prose-sm max-w-none break-words
          [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-6
          [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-5
          [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-4
          [&_p]:mb-3 [&_p]:leading-7
          [&_ul]:ml-6 [&_ul]:list-disc [&_ul]:mb-3
          [&_ol]:ml-6 [&_ol]:list-decimal [&_ol]:mb-3
          [&_li]:mb-1
          [&_a]:text-blue-600 [&_a]:hover:underline
          [&_strong]:font-bold
          [&_em]:italic
          [&_blockquote]:border-l-4 [&_blockquote]:border-gray-300 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_blockquote]:italic [&_blockquote]:my-4
          [&_img]:max-w-full [&_img]:h-auto
          [&_pre]:max-w-full [&_pre]:bg-gray-50 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:mb-4
          [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono
          [&_pre_code]:bg-transparent [&_pre_code]:p-0
          [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:mb-4
          [&_th]:border [&_th]:border-gray-300 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-gray-50 [&_th]:font-semibold [&_th]:text-left
          [&_td]:border [&_td]:border-gray-300 [&_td]:px-3 [&_td]:py-2
          [&_hr]:border-gray-300 [&_hr]:my-6
          [&_del]:line-through
          [&_input[type=checkbox]]:mr-2
        ">
          {page.content ? (
            <Markdown
              mode="page"
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
