import type { PageSourceStatus } from '@agentwiki/shared';
import { SourceStatusNotice } from './SourceStatusNotice';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { captureReadingSelection } from '../agent-session/readingSelection';
import type { AssistTarget } from './assistTargets';
import { usePersonalNotes } from './usePersonalNotes';
import { SelectionNoteComposer } from './SelectionNoteComposer';
import { locateReadingNote, resolvePersonalNoteHighlights } from './personalNoteHighlights';
const AgentReadingSidebar = React.lazy(() => import('../agent-session/AgentReadingSidebar').then((module) => ({ default: module.AgentReadingSidebar })));
import { apiErrorMessage } from '../../api/error-message';
import { getContentTreeRevision } from '../../api/content-tree';
import { ArrowLeft, ChevronRight, Clock, Folder, User, PenLine, FileText } from 'lucide-react';
import 'highlight.js/styles/github.css';
import { useLanguage } from '../../context/LanguageContext';
import { Markdown } from '../../components/Markdown';
import { outlineFor } from '../../components/markdown-tools/outline';
import type { MarkdownTaskRef, MarkdownTaskToggle } from '../../components/markdown/markdownTypes';
import { rebaseMarkdownTask, toggleMarkdownTask } from '../../components/markdown/tasks';
import { useOptionalSpaceWorkspace, usePageWorkspaceIdentity } from '../space-workspace/SpaceWorkspaceContext';
import { ArticleContentsPopover } from '../space-workspace/ArticleContentsPopover';
import { PageInfoContent } from '../space-workspace/PageInfoPanel';
import { DocumentPanelToolbar, type DocumentPanelTab } from '../space-workspace/DocumentPanelToolbar';
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
  sourceStatus?: PageSourceStatus;
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
  const [localPanel, setLocalPanel] = useState<{ scope: string; open: boolean; tab: DocumentPanelTab }>({ scope: '', open: false, tab: 'contents' });
  const [agentMountedScope, setAgentMountedScope] = useState<string | null>(null);
  const [notesContainer, setNotesContainer] = useState<HTMLDivElement | null>(null);
  const [agentContainer, setAgentContainer] = useState<HTMLDivElement | null>(null);
  const [agentFocusRequest, setAgentFocusRequest] = useState<{ identity: string; request: string } | null>(null);
  const [readingTarget, setReadingTarget] = useState<AssistTarget | null>(null);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [activeNote, setActiveNote] = useState<{ identity: string; id: string } | null>(null);
  const notesEnabled = !!user?.id && !!page && page.id === id && !loading && !error;
  const personalNotes = usePersonalNotes({ scope: notesEnabled && page ? { userId: user.id, spaceId: page.spaceId, pageId: page.id } : null, canEdit: page?.capabilities?.canEdit === true, enabled: notesEnabled, stageForSession: true, source: page?.content ?? '', updatedAt: page?.updatedAt, language });
  const noteHighlights = useMemo(() => resolvePersonalNoteHighlights(page?.content ?? '', personalNotes.notes), [page?.content, personalNotes.notes]);
  const activeNoteId = activeNote?.identity === personalNotes.identityKey ? activeNote.id : null;
  const [panelGeometry, setPanelGeometry] = useState({ top: 130, width: window.innerWidth });
  const readingToolbarRef = useRef<HTMLDivElement>(null);
  const notesPanelRef = useRef<HTMLElement>(null);
  const panelScope = `${user?.id ?? 'guest'}\u0000${page?.spaceId ?? ''}`;
  const panelIdentity = `${panelScope}\u0000${id ?? ''}`;
  const panelMatches = !!workspace && workspace.spaceId === page?.spaceId && workspace.userId === user?.id;
  const localPanelMatches = localPanel.scope === panelScope;
  const panelOpen = panelGeometry.width >= 1024 && panelMatches
    ? workspace.collaborationOpen === true : localPanelMatches && localPanel.open;
  const panelTab: DocumentPanelTab = panelMatches
    ? workspace.collaborationTab ?? 'contents' : localPanelMatches ? localPanel.tab : 'contents';
  const notesOpen = panelTab === 'notes';
  const agentMounted = agentMountedScope === panelScope || panelOpen && (notesOpen || panelTab === 'assist');
  useEffect(() => {
    if (panelOpen && (notesOpen || panelTab === 'assist')) setAgentMountedScope(panelScope);
  }, [panelOpen, notesOpen, panelTab, panelScope]);
  const openPanel = (tab: DocumentPanelTab, focusComposer = false) => {
    if ((tab === 'notes' || tab === 'assist') && !user?.id) return;
    if (tab === 'notes' || tab === 'assist') setAgentMountedScope(panelScope);
    setLocalPanel({ scope: panelScope, open: true, tab });
    setAgentFocusRequest(tab === 'assist' && focusComposer ? { identity: panelIdentity, request: crypto.randomUUID() } : null);
    if (panelMatches) workspace.setPanelPreferences({ collaborationTab: tab, ...(panelGeometry.width >= 1024 ? { collaborationOpen: true } : {}) });
  };
  const closePanel = () => {
    setAgentFocusRequest(null);
    setLocalPanel({ scope: panelScope, open: false, tab: panelTab });
    if (panelMatches && panelGeometry.width >= 1024) workspace.setPanelPreferences({ collaborationOpen: false });
    notesPanelRef.current?.querySelector<HTMLButtonElement>(`[data-panel-tab="${panelTab}"]`)?.focus();
  };
  const activateNote = (noteId: string) => {
    if (!noteHighlights.some((note) => note.id === noteId)) return;
    setActiveNote({ identity: personalNotes.identityKey, id: noteId });
    openPanel('notes');
  };
  const locateNote = (noteId: string) => {
    if (!noteHighlights.some((note) => note.id === noteId)) return false;
    setActiveNote({ identity: personalNotes.identityKey, id: noteId });
    return locateReadingNote(markdownRootRef.current, noteId);
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
        event.preventDefault(); openPanel('assist', true);
      }
      if (event.key === 'Escape' && panelOpen) closePanel();
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [id, page?.id, page?.spaceId, loading, error, panelOpen, panelTab, panelMatches, panelGeometry.width, panelScope]);
  useEffect(() => {
    if (!panelOpen || panelGeometry.width >= 1024) return;
    const frame = requestAnimationFrame(() => {
      const panel = notesPanelRef.current;
      if (!panel) return;
      const toolbarBottom = readingToolbarRef.current?.getBoundingClientRect().bottom ?? 0;
      panel.style.scrollMarginTop = `${Math.max(16, Math.ceil(toolbarBottom + 12))}px`;
      panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (notesPanelRef.current) notesPanelRef.current.style.scrollMarginTop = '';
    };
  }, [panelOpen, panelTab, panelGeometry.width]);
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

    const changed = content !== (committed.content || '');
    const canInvalidateReview = committed.sourceStatus?.status === 'current' || committed.sourceStatus?.status === 'needs_review';
    const optimisticPage = {
      ...committed, content,
      sourceStatus: changed && canInvalidateReview
        ? { ...committed.sourceStatus!, status: 'needs_review' as const, reason: 'page_changed' as const }
        : committed.sourceStatus,
    };
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

  // Keep the original Markdown and source offsets intact when its opening
  // heading already supplies the page title.
  const titleInContent = useMemo(() => {
    if (!page) return false;
    const first = outlineFor(page.content || '')[0];
    return first?.level === 1 && first.label.trim() === page.title.trim()
      && !page.content.slice(0, first.from).trim();
  }, [page]);

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
        </div>
      </div>

      <aside ref={notesPanelRef} data-document-side-panel className={`document-side-panel${panelOpen ? ' is-open' : ''}`} style={{ top: panelGeometry.top, width: Math.min(400, panelGeometry.width - 32) }}>
        <DocumentPanelToolbar panelIdPrefix="reading-document" activeTab={panelTab} open={panelOpen} onSelect={openPanel} onClose={closePanel} disabledTabs={!user?.id ? ['assist', 'notes'] : undefined} />
        <div hidden={!panelOpen} className="document-side-panel-body">
          <section hidden={panelTab !== 'contents'} role="tabpanel" id="reading-document-panel-contents" aria-labelledby="reading-document-tab-contents" data-panel-content="contents" className="document-panel-scroll">
            <ArticleContentsPopover embedded articleRootRef={markdownRootRef} pageKey={page.id} spaceId={page.spaceId} source={page.content || ''} />
          </section>
          <section hidden={panelTab !== 'info'} role="tabpanel" id="reading-document-panel-info" aria-labelledby="reading-document-tab-info" data-panel-content="info" className="document-panel-scroll">
            {panelOpen && panelTab === 'info' ? <PageInfoContent
              key={page.id}
              spaceId={page.spaceId}
              provenance={page.provenance}
              evidence={page.evidence}
              sourceStatus={page.sourceStatus}
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
            /> : null}
          </section>
          <div ref={setNotesContainer} role="tabpanel" id="reading-document-panel-notes" aria-labelledby="reading-document-tab-notes" hidden={panelTab !== 'notes'} className="min-h-0 flex-1 overflow-auto" />
          <div ref={setAgentContainer} role="tabpanel" id="reading-document-panel-assist" aria-labelledby="reading-document-tab-assist" hidden={panelTab !== 'assist'} className="agent-session-host min-h-0 flex-1 flex-col" />
          <React.Suspense fallback={null}>
            {agentMounted ? <AgentReadingSidebar key={`${user?.id}:${page.spaceId}:${page.id}`} notesContainer={notesContainer} agentContainer={agentContainer} page={page} notes={personalNotes} activeNoteId={activeNoteId} onLocateNote={locateNote} onClearActiveNote={() => setActiveNote(null)} visible={panelOpen && (notesOpen || panelTab === 'assist')} notesOpen={notesOpen} focusRequest={panelOpen && panelTab === 'assist' && agentFocusRequest?.identity === panelIdentity ? agentFocusRequest.request : undefined} target={readingTarget} selectionUnavailable={selectionUnavailable} onTarget={setReadingTarget} onOpenAgent={() => openPanel('assist')} /> : null}
          </React.Suspense>
        </div>
      </aside>

      <SourceStatusNotice status={page.sourceStatus} />
      <article className="document-canvas min-h-[300px] bg-white" style={{ '--document-panel-width': `${panelOpen && panelGeometry.width >= 1024 ? 420 : 0}px` } as React.CSSProperties}>
        <header className={titleInContent ? "document-content-title-meta" : "document-header document-reading-header"}>
          {!titleInContent ? <h1 title={page.title} className="document-title">{page.title}</h1> : null}
          <div className={`${titleInContent ? "" : "mt-3"} flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500`}>
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
              noteHighlights={noteHighlights}
              activeNoteId={activeNoteId}
              onNoteActivate={activateNote}
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

      {notesEnabled ? <SelectionNoteComposer key={personalNotes.identityKey} rootRef={markdownRootRef}
        identity={personalNotes.identityKey} source={page.content} updatedAt={page.updatedAt} language={language}
        storageUnavailable={personalNotes.storageUnavailable} disabled={!personalNotes.loaded || !personalNotes.canCreate || personalNotes.syncing || !!personalNotes.assistRequest} onAdd={(target, body) => personalNotes.add(target, body, { requirePersistence: true })} captureTarget={() => {
          const selection = window.getSelection(), root = markdownRootRef.current?.querySelector<HTMLElement>('[data-markdown-selection-root]');
          return root && selection?.rangeCount && !selection.isCollapsed
            ? captureReadingSelection(root, selection.getRangeAt(0), page.content, page.updatedAt, root.dataset.markdownSelectionVersion ?? '') : null;
        }} /> : null}
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
