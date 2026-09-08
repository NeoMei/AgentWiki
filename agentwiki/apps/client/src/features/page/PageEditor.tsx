import React, { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { getContentTreeRevision } from '../../api/content-tree';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace, MarkdownWorkspaceHandle } from '../../components/MarkdownWorkspace';
import { Save, ArrowLeft, History, Users, Bot, Ellipsis, ImagePlus, BookOpen, PenLine, ChevronRight, Folder } from 'lucide-react';
import { SavePageAsTemplateDialog } from '../page-templates/SavePageAsTemplateDialog';
import { PageAgentBindingDialog } from '../page-templates/PageAgentBindingDialog';
import { listPageTemplates } from '../page-templates/pageTemplateApi';
import { truncateValidatorLength } from '../page-templates/validatorLength';
import { listCompositeTemplates } from '../page-templates/compositeTemplateApi';
import { AgentAssistPanel } from './AgentAssistPanel';
import { AttachmentPickerDialog } from '../attachments/AttachmentPickerDialog';
import { uploadAttachment } from '../attachments/attachmentApi';
import { formatAttachmentReference } from '../attachments/attachmentReference';
import 'highlight.js/styles/github.css';
import { useOptionalSpaceWorkspace, usePageWorkspaceIdentity } from '../space-workspace/SpaceWorkspaceContext';
import {
  readWorkspacePosition,
  nearestMarkdownSourceBlock,
  rememberWorkspacePosition,
  spaceFolderHref,
  useDirtyNavigationGuard,
  useGuardedNavigate,
  type WorkspacePosition,
} from '../space-workspace/workspaceNavigation';

interface Page {
  id: string;
  title: string;
  content: string;
  format: string;
  spaceId: string;
  folderId?: string | null;
  updatedAt: string;
  capabilities?: { canEdit?: boolean; canManageAttachments?: boolean };
}

interface ActiveUser {
  userId: string;
  userName: string;
  color: string;
}

interface RemotePageUpdate {
  page: Page;
  revision: string;
}

interface TemplateDialogSnapshot {
  spaceId: string;
  pageId: string;
  pageTitle: string;
  pageUpdatedAt: string;
}

type SaveStatusSource = 'save' | 'template' | 'attachment';

interface AttachmentRuntimeContext {
  pageId: string | null;
  spaceId: string | null;
  revision: string | null;
  mode: MarkdownMode;
  saving: boolean;
  remoteConflict: boolean;
  authorized: boolean;
}

const PAGE_TITLE_LIMIT = 200;

const pageRevision = (page: Page) => JSON.stringify([
  page.updatedAt,
  page.title,
  page.content,
  page.format,
]);

class StaleAttachmentUploadError extends Error {
  constructor() {
    super('Attachment upload became stale');
    this.name = 'StaleAttachmentUploadError';
  }
}

export const PageEditor: React.FC<{ workspaceRef?: React.MutableRefObject<MarkdownWorkspaceHandle | null> }> = ({ workspaceRef } = {}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const reportPageIdentity = usePageWorkspaceIdentity();
  const workspace = useOptionalSpaceWorkspace();
  const socketRef = useRef<Socket | null>(null);
  const contentRef = useRef<string>('');
  const tRef = useRef(t);
  const pageRef = useRef<Page | null>(null);
  const baselineRevisionRef = useRef<string | null>(null);
  const acceptedSocketRevisionRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const activePageIdRef = useRef(id);
  const loadSequenceRef = useRef(0);
  const routeGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const dismissedRemoteRevisionRef = useRef<string | null>(null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const saveOperationRef = useRef(0);
  const saveControllerRef = useRef<AbortController | null>(null);
  const attachmentControllersRef = useRef(new Set<AbortController>());
  const attachmentGenerationRef = useRef(0);
  const attachmentContextRef = useRef<AttachmentRuntimeContext>({
    pageId: null,
    spaceId: null,
    revision: null,
    mode: 'edit',
    saving: false,
    remoteConflict: false,
    authorized: false,
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusSourceRef = useRef<SaveStatusSource | null>(null);
  const statusGenerationRef = useRef(0);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
  const moreActionsMenuRef = useRef<HTMLDivElement>(null);
  const saveAsTemplateItemRef = useRef<HTMLButtonElement>(null);
  const attachmentButtonRef = useRef<HTMLButtonElement>(null);
  const bindingButtonRef = useRef<HTMLButtonElement>(null);
  const internalWorkspaceRef = useRef<MarkdownWorkspaceHandle | null>(null);
  const pendingWorkspacePositionRef = useRef<ReturnType<MarkdownWorkspaceHandle['capturePosition']> | null>(null);
  const editorPreviewOriginRef = useRef<ReturnType<MarkdownWorkspaceHandle['capturePosition']> | null>(null);
  const restoredEntryRef = useRef<string | null>(null);

  const [page, setPage] = useState<Page | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [saveStatus, setSaveStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [mode, setMode] = useState<MarkdownMode>('edit');
  const [assistOpen, setAssistOpen] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState<RemotePageUpdate | null>(null);
  const [templateCapability, setTemplateCapability] = useState<{ identity: string; canManage: boolean } | null>(null);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [moreActionsPosition, setMoreActionsPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const [templateDialogSnapshot, setTemplateDialogSnapshot] = useState<TemplateDialogSnapshot | null>(null);
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [compositeCapability, setCompositeCapability] = useState<{
    identity: string;
    canCreate: boolean;
  } | null>(null);

  const templateCapabilityIdentity = page
    ? `${page.id}\u0000${page.spaceId}\u0000${page.format}\u0000${language}`
    : null;
  const canManageTemplates = templateCapabilityIdentity !== null
    && templateCapability?.identity === templateCapabilityIdentity
    && templateCapability.canManage;
  const compositeCreationEnabled = templateCapabilityIdentity !== null
    && compositeCapability?.identity === templateCapabilityIdentity
    && compositeCapability.canCreate;
  const templateCreationBlocked = isDirty || saving || remoteUpdate !== null;
  const attachmentEnabled = page?.capabilities?.canManageAttachments === true
    && page.id === id
    && page.format === 'markdown'
    && mode === 'edit'
    && !remoteUpdate
    && !saving;
  const saveButtonText = saving
    ? t('common.saving')
    : !isDirty && saveStatus?.kind === 'success' && statusSourceRef.current === 'save'
      ? t('common.saved')
      : t('common.save');

  useDirtyNavigationGuard(isDirty, t('editor.unsavedWarning'));

  useLayoutEffect(() => {
    attachmentContextRef.current = {
      pageId: page?.id ?? null,
      spaceId: page?.spaceId ?? null,
      revision: acceptedSocketRevisionRef.current
        ?? baselineRevisionRef.current
        ?? (page ? pageRevision(page) : null),
      mode,
      saving,
      remoteConflict: remoteUpdate !== null,
      authorized: attachmentEnabled,
    };
  }, [attachmentEnabled, mode, page, remoteUpdate, saving]);

  activePageIdRef.current = id;

  const updateDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  const abortAttachmentUploads = useCallback(() => {
    attachmentGenerationRef.current += 1;
    attachmentControllersRef.current.forEach((controller) => controller.abort());
    attachmentControllersRef.current.clear();
  }, []);

  const clearStatus = useCallback(() => {
    statusGenerationRef.current += 1;
    statusSourceRef.current = null;
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    setSaveStatus(null);
  }, []);

  const clearAttachmentStatus = useCallback(() => {
    if (statusSourceRef.current !== 'attachment') return;
    clearStatus();
  }, [clearStatus]);

  const showStatus = useCallback((
    next: { kind: 'success' | 'error'; text: string },
    source: SaveStatusSource,
    duration?: number,
  ) => {
    const generation = ++statusGenerationRef.current;
    statusSourceRef.current = source;
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = null;
    setSaveStatus(next);
    if (duration === undefined) return;
    statusTimerRef.current = setTimeout(() => {
      if (!mountedRef.current || statusGenerationRef.current !== generation) return;
      statusSourceRef.current = null;
      statusTimerRef.current = null;
      setSaveStatus(null);
    }, duration);
  }, []);

  const bindWorkspaceRef = useCallback((handle: MarkdownWorkspaceHandle | null) => {
    internalWorkspaceRef.current = handle;
    if (workspaceRef) workspaceRef.current = handle;
  }, [workspaceRef]);

  const adoptRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage)) => {
    const previousPage = pageRef.current;
    abortAttachmentUploads();
    if (previousPage && (previousPage.id !== nextPage.id || previousPage.spaceId !== nextPage.spaceId)) {
      clearAttachmentStatus();
    }
    pageRef.current = nextPage;
    baselineRevisionRef.current = revision;
    acceptedSocketRevisionRef.current = null;
    setPage(nextPage);
    setTitle(nextPage.title);
    setContent(nextPage.content || '');
    contentRef.current = nextPage.content || '';
    dismissedRemoteRevisionRef.current = null;
    setRemoteUpdate(null);
    updateDirty(false);
    reportPageIdentity(nextPage.id, nextPage.spaceId || null, nextPage.folderId ?? null);
  }, [abortAttachmentUploads, clearAttachmentStatus, reportPageIdentity, updateDirty]);

  const adoptRemoteDraft = useCallback((nextContent: string, revision: string) => {
    abortAttachmentUploads();
    setTemplateDialogSnapshot(null);
    setBindingDialogOpen(false);
    setContent(nextContent);
    contentRef.current = nextContent;
    editRevisionRef.current += 1;
    acceptedSocketRevisionRef.current = revision;
    dismissedRemoteRevisionRef.current = null;
    setRemoteUpdate(null);
    updateDirty(true);
  }, [abortAttachmentUploads, updateDirty]);

  const offerRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage), forcePrompt = false) => {
    if (nextPage.id !== activePageIdRef.current) return;
    if (revision.startsWith('socket:') && revision === acceptedSocketRevisionRef.current) return;
    const baseline = pageRef.current;
    if (baseline && revision === (baselineRevisionRef.current || pageRevision(baseline))) return;
    if (isDirtyRef.current) {
      if (forcePrompt || dismissedRemoteRevisionRef.current !== revision) {
        abortAttachmentUploads();
        setRemoteUpdate({ page: nextPage, revision });
      }
      return;
    }
    if (revision.startsWith('socket:')) {
      adoptRemoteDraft(nextPage.content || '', revision);
    } else {
      adoptRemotePage(nextPage, revision);
    }
  }, [abortAttachmentUploads, adoptRemoteDraft, adoptRemotePage]);

  const loadPage = useCallback(async (showLoading = false, forcePrompt = false) => {
    if (!id) return;
    const requestedId = id;
    const sequence = ++loadSequenceRef.current;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    if (showLoading) setLoading(true);
    try {
      const res = await api.get(`/pages/${requestedId}`, { signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted || sequence !== loadSequenceRef.current || activePageIdRef.current !== requestedId) return;
      if (res.data.capabilities?.canEdit === false) {
        reportPageIdentity(requestedId, null);
        window.alert(tRef.current('common.forbidden'));
        navigate(`/pages/${requestedId}`, { replace: true });
        return;
      }
      setError(null);
      offerRemotePage(res.data, pageRevision(res.data), forcePrompt);
      const acceptedPage = pageRef.current;
      if (acceptedPage?.id === requestedId) {
        reportPageIdentity(requestedId, acceptedPage.spaceId || null, acceptedPage.folderId ?? null);
      }
    } catch (err: any) {
      if (controller.signal.aborted || !mountedRef.current || activePageIdRef.current !== requestedId) return;
      if (showLoading || err.response?.status === 401 || err.response?.status === 403) {
        reportPageIdentity(requestedId, null);
      }
      if (showLoading) setError(err.response?.data?.message || tRef.current('editor.loadFailed'));
    } finally {
      requestControllersRef.current.delete(controller);
      if (showLoading && mountedRef.current && sequence === loadSequenceRef.current && activePageIdRef.current === requestedId) {
        setLoading(false);
      }
    }
  }, [id, navigate, offerRemotePage, reportPageIdentity]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    setMoreActionsOpen(false);
    setMoreActionsPosition(null);
    setTemplateDialogSnapshot(null);
    setTemplateCapability(null);
    setCompositeCapability(null);
    setBindingDialogOpen(false);
    if (!page?.spaceId || !page.id || page.format !== 'markdown' || !templateCapabilityIdentity) return;

    let active = true;
    const requestIdentity = templateCapabilityIdentity;
    void listPageTemplates(page.spaceId, { locale: language, scope: 'space', take: 1 })
      .then((result) => {
        if (active) setTemplateCapability({ identity: requestIdentity, canManage: result.capabilities.canManage });
      })
      .catch(() => {
        if (active) setTemplateCapability({ identity: requestIdentity, canManage: false });
      });
    void listCompositeTemplates(page.spaceId, { locale: language, take: 1 })
      .then((result) => {
        if (active) {
          setCompositeCapability({
            identity: requestIdentity,
            canCreate: result.capabilities.canCreate,
          });
        }
      })
      .catch(() => {
        if (active) setCompositeCapability({ identity: requestIdentity, canCreate: false });
      });
    return () => {
      active = false;
    };
  }, [language, page?.format, page?.id, page?.spaceId, templateCapabilityIdentity]);

  useLayoutEffect(() => {
    if (!moreActionsOpen) {
      setMoreActionsPosition(null);
      return;
    }
    const trigger = moreActionsButtonRef.current;
    const menu = moreActionsMenuRef.current;
    if (!trigger || !menu) return;

    const viewportWidth = window.innerWidth;
    const availableWidth = Math.max(0, viewportWidth - 32);
    const measuredWidth = menu.getBoundingClientRect().width || 256;
    const width = Math.min(measuredWidth, 256, availableWidth);
    const triggerRect = trigger.getBoundingClientRect();
    const maximumLeft = Math.max(16, viewportWidth - 16 - width);
    const left = Math.min(Math.max(triggerRect.right - width, 16), maximumLeft);
    setMoreActionsPosition({ left, top: triggerRect.bottom + 8, width });
  }, [moreActionsOpen]);

  useEffect(() => {
    if (!moreActionsOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!moreActionsRef.current?.contains(event.target as Node)) setMoreActionsOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMoreActionsOpen(false);
      setMoreActionsPosition(null);
      moreActionsButtonRef.current?.focus();
    };
    const closeForViewportChange = () => {
      setMoreActionsOpen(false);
      setMoreActionsPosition(null);
      moreActionsButtonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    window.addEventListener('resize', closeForViewportChange);
    window.addEventListener('scroll', closeForViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
      window.removeEventListener('resize', closeForViewportChange);
      window.removeEventListener('scroll', closeForViewportChange, true);
    };
  }, [moreActionsOpen, templateCreationBlocked]);

  useLayoutEffect(() => {
    if (!moreActionsOpen || !moreActionsPosition || templateCreationBlocked) return;
    saveAsTemplateItemRef.current?.focus({ preventScroll: true });
  }, [moreActionsOpen, moreActionsPosition, templateCreationBlocked]);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestControllersRef.current.forEach((controller) => controller.abort());
      requestControllersRef.current.clear();
      saveOperationRef.current += 1;
      saveControllerRef.current?.abort();
      saveControllerRef.current = null;
      abortAttachmentUploads();
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, [abortAttachmentUploads]);

  useLayoutEffect(() => {
    if (attachmentEnabled) return;
    setAttachmentPickerOpen(false);
    abortAttachmentUploads();
  }, [abortAttachmentUploads, attachmentEnabled]);

  useLayoutEffect(() => {
    setAttachmentPickerOpen(false);
    abortAttachmentUploads();
  }, [abortAttachmentUploads, page?.id, page?.spaceId]);

  useLayoutEffect(() => {
    const position = pendingWorkspacePositionRef.current;
    if (!position) return;
    pendingWorkspacePositionRef.current = null;
    internalWorkspaceRef.current?.restorePosition(position);
  }, [mode]);

  const togglePreview = useCallback(() => {
    const currentPosition = internalWorkspaceRef.current?.capturePosition() ?? null;
    if (mode === 'edit') {
      editorPreviewOriginRef.current = currentPosition;
      pendingWorkspacePositionRef.current = currentPosition;
    } else {
      const editorOrigin = editorPreviewOriginRef.current;
      pendingWorkspacePositionRef.current = currentPosition && editorOrigin
        ? { ...currentPosition, cursorOffset: editorOrigin.cursorOffset }
        : currentPosition;
      editorPreviewOriginRef.current = null;
    }
    setMode((currentMode) => currentMode === 'edit' ? 'preview' : 'edit');
  }, [mode]);

  useEffect(() => {
    const handleModeShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        togglePreview();
      }
    };
    window.addEventListener('keydown', handleModeShortcut);
    return () => window.removeEventListener('keydown', handleModeShortcut);
  }, [togglePreview]);

  useLayoutEffect(() => {
    if (loading || !page || page.id !== id || restoredEntryRef.current === location.key) return;
    const requestedFromState = (location.state as { workspacePosition?: WorkspacePosition } | null)?.workspacePosition;
    const requested = (requestedFromState?.pageId === page.id ? requestedFromState : null)
      ?? (navigationType === 'POP' ? readWorkspacePosition(location.key, page.id) : null);
    restoredEntryRef.current = location.key;
    if (!requested) return;
    internalWorkspaceRef.current?.restorePosition({
      cursorOffset: requested.cursorOffset,
      headingId: requested.headingId,
      headingText: requested.headingText,
      sourceOffset: requested.sourceOffset,
      scrollTop: requested.scrollTop,
    });
  }, [loading, location.key, location.state, navigationType, page]);

  useEffect(() => () => {
    const position = internalWorkspaceRef.current?.capturePosition();
    if (!position) return;
    rememberWorkspacePosition(location.key, {
      ...position,
      pageId: pageRef.current?.id ?? '',
    });
  }, [location.key]);

  // Load page data and reset state when navigating to another page.
  useEffect(() => {
    routeGenerationRef.current += 1;
    saveOperationRef.current += 1;
    saveControllerRef.current?.abort();
    saveControllerRef.current = null;
    setSaving(false);
    loadSequenceRef.current += 1;
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    abortAttachmentUploads();
    clearAttachmentStatus();
    pageRef.current = null;
    baselineRevisionRef.current = null;
    acceptedSocketRevisionRef.current = null;
    dismissedRemoteRevisionRef.current = null;
    setPage(null);
    setTitle('');
    setContent('');
    contentRef.current = '';
    setError(null);
    setRemoteUpdate(null);
    setAttachmentPickerOpen(false);
    updateDirty(false);
    if (id) reportPageIdentity(id, null);
    if (!id) {
      setLoading(false);
      return;
    }
    void loadPage(true);
  }, [abortAttachmentUploads, clearAttachmentStatus, id, loadPage, reportPageIdentity, updateDirty]);

  // Refresh persisted state on focus and periodically without replacing dirty fields.
  useEffect(() => {
    if (!id) return;
    const refresh = () => { void loadPage(false); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, [id, loadPage]);

  // WebSocket collaboration
  useEffect(() => {
    if (!id || !user?.id || !page) return;

    const socketUrl = window.location.origin;
    const socket = io(socketUrl + '/collaboration', {
      transports: ['websocket', 'polling'],
      auth: { token: localStorage.getItem('token') },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('joinPage', {
        pageId: id,
        userId: user.id,
        userName: user.name || user.email || 'Anonymous',
      });
    });

    socket.on('currentUsers', (users: ActiveUser[]) => {
      setActiveUsers(users.filter(u => u.userId !== user.id));
    });

    socket.on('userJoined', (u: ActiveUser) => {
      if (u.userId !== user.id) {
        setActiveUsers(prev => [...prev.filter(x => x.userId !== u.userId), u]);
      }
    });

    socket.on('userLeft', (data: { userId: string }) => {
      setActiveUsers(prev => prev.filter(u => u.userId !== data.userId));
    });

    socket.on('contentUpdated', (data: { content: string; userId: string; version: number }) => {
      if (data.userId !== socket.id && data.content !== contentRef.current) {
        const baseline = pageRef.current;
        if (baseline) {
          offerRemotePage(
            { ...baseline, content: data.content },
            `socket:${data.version}:${data.content}`,
          );
        }
      }
    });

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      socket.emit('leavePage', { pageId: id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [id, user?.id, page?.id, offerRemotePage]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    contentRef.current = newContent;
    editRevisionRef.current += 1;
    updateDirty(true);

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('contentChange', {
          pageId: id,
          content: newContent,
          version: Date.now(),
        });
      }
    }, 500);
  }, [id, updateDirty]);

  const handleImageUploadError = useCallback((error: unknown) => {
    if (error instanceof StaleAttachmentUploadError || !mountedRef.current || !attachmentEnabled) return;
    showStatus({ kind: 'error', text: t('attachment.uploadFailed') }, 'attachment', 5000);
  }, [attachmentEnabled, showStatus, t]);

  const handleUploadImages = useCallback(async (files: File[]) => {
    const currentPage = pageRef.current;
    const requestedPageId = id;
    const routeGeneration = routeGenerationRef.current;
    const attachmentGeneration = attachmentGenerationRef.current;
    if (
      !attachmentEnabled
      || !requestedPageId
      || !currentPage
      || currentPage.id !== requestedPageId
      || currentPage.capabilities?.canEdit !== true
      || currentPage.format !== 'markdown'
      || files.length === 0
    ) throw new Error('Attachment upload is not available');

    const requestedSpaceId = currentPage.spaceId;
    const requestedRevision = acceptedSocketRevisionRef.current
      ?? baselineRevisionRef.current
      ?? pageRevision(currentPage);
    const controllers = files.map(() => new AbortController());
    controllers.forEach((controller) => attachmentControllersRef.current.add(controller));
    const requestIsStale = () => {
      const currentContext = attachmentContextRef.current;
      return !mountedRef.current
        || routeGenerationRef.current !== routeGeneration
        || attachmentGenerationRef.current !== attachmentGeneration
        || activePageIdRef.current !== requestedPageId
        || pageRef.current?.id !== requestedPageId
        || pageRef.current.spaceId !== requestedSpaceId
        || pageRef.current.capabilities?.canEdit !== true
        || pageRef.current.format !== 'markdown'
        || currentContext.pageId !== requestedPageId
        || currentContext.spaceId !== requestedSpaceId
        || currentContext.revision !== requestedRevision
        || currentContext.mode !== 'edit'
        || currentContext.saving
        || currentContext.remoteConflict
        || !currentContext.authorized;
    };
    try {
      const uploaded = await Promise.all(files.map((file, index) => (
        uploadAttachment(requestedSpaceId, file, { signal: controllers[index].signal })
      )));
      if (requestIsStale()) throw new StaleAttachmentUploadError();
      const canonicalPaths: string[] = [];
      for (const item of uploaded) {
        if (!item.referenceable || item.canonicalPath === null) {
          throw new Error('Invalid attachment upload result');
        }
        canonicalPaths.push(item.canonicalPath);
      }
      if (canonicalPaths.length !== files.length) throw new Error('Invalid attachment upload result');
      return canonicalPaths;
    } catch (error) {
      controllers.forEach((controller) => controller.abort());
      if (requestIsStale() && !(error instanceof StaleAttachmentUploadError)) {
        throw new StaleAttachmentUploadError();
      }
      throw error;
    } finally {
      controllers.forEach((controller) => attachmentControllersRef.current.delete(controller));
    }
  }, [attachmentEnabled, id, page?.id, page?.spaceId, page?.updatedAt]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(truncateValidatorLength(e.target.value, PAGE_TITLE_LIMIT));
    editRevisionRef.current += 1;
    updateDirty(true);
  }, [updateDirty]);

  // Stable callbacks for the assist panel so its socket connection and task
  // polling are not recreated on every editor render (which would drop the
  // live stream events).
  const applyAgentChanges = useCallback((changes: string) => {
    handleContentChange(changes);
    setMode('edit');
  }, [handleContentChange]);

  const streamAgentChanges = useCallback((partial: string) => {
    handleContentChange(partial);
    setMode('edit');
  }, [handleContentChange]);

  const handleSave = async () => {
    const baseline = pageRef.current;
    if (!id || !baseline?.updatedAt || remoteUpdate) return;
    const requestedId = id;
    const requestedSpaceId = baseline.spaceId;
    const requestedRouteGeneration = routeGenerationRef.current;
    const operation = ++saveOperationRef.current;
    const submittedEditRevision = editRevisionRef.current;
    const submittedTitle = title;
    const submittedContent = content;
    const titleChanged = submittedTitle !== baseline.title;
    abortAttachmentUploads();
    setSaving(true);
    clearStatus();
    const controller = titleChanged ? new AbortController() : null;
    saveControllerRef.current?.abort();
    saveControllerRef.current = controller;
    try {
      const expectedTreeRevision = titleChanged
        ? await getContentTreeRevision(baseline.spaceId, controller!.signal)
        : undefined;
      const currentPage = pageRef.current;
      if (
        !mountedRef.current
        || controller?.signal.aborted
        || saveOperationRef.current !== operation
        || routeGenerationRef.current !== requestedRouteGeneration
        || activePageIdRef.current !== requestedId
        || currentPage?.id !== requestedId
        || currentPage.spaceId !== requestedSpaceId
        || currentPage.updatedAt !== baseline.updatedAt
      ) return;
      const response = await api.patch(`/pages/${requestedId}`, {
        ...(titleChanged ? { title: submittedTitle, expectedTreeRevision } : {}),
        content: submittedContent,
        expectedUpdatedAt: baseline.updatedAt,
      });
      if (
        !mountedRef.current
        || saveOperationRef.current !== operation
        || routeGenerationRef.current !== requestedRouteGeneration
        || activePageIdRef.current !== requestedId
      ) return;
      const savedPage: Page = {
        ...baseline,
        ...response.data,
        title: submittedTitle,
        content: submittedContent,
      };
      pageRef.current = savedPage;
      baselineRevisionRef.current = pageRevision(savedPage);
      setPage(savedPage);
      showStatus({ kind: 'success', text: t('editor.saved') }, 'save', 3000);
      if (editRevisionRef.current === submittedEditRevision) updateDirty(false);
    } catch (err: any) {
      if (
        !mountedRef.current
        || controller?.signal.aborted
        || saveOperationRef.current !== operation
        || routeGenerationRef.current !== requestedRouteGeneration
        || activePageIdRef.current !== requestedId
      ) return;
      showStatus({
        kind: 'error',
        text: t('editor.saveFailed', { message: err.response?.data?.message || t('common.notAvailable') }),
      }, 'save', 5000);
      if (err.response?.status === 409) {
        dismissedRemoteRevisionRef.current = null;
        void loadPage(false, true);
      }
    } finally {
      if (saveControllerRef.current === controller) saveControllerRef.current = null;
      if (
        mountedRef.current
        && saveOperationRef.current === operation
        && routeGenerationRef.current === requestedRouteGeneration
        && activePageIdRef.current === requestedId
      ) setSaving(false);
    }
  };

  const acceptRemote = () => {
    if (!remoteUpdate || saving) return;
    if (remoteUpdate.revision.startsWith('socket:')) {
      adoptRemoteDraft(remoteUpdate.page.content || '', remoteUpdate.revision);
    } else {
      editRevisionRef.current += 1;
      adoptRemotePage(remoteUpdate.page, remoteUpdate.revision);
    }
  };

  const keepLocal = () => {
    if (!remoteUpdate || saving) return;
    dismissedRemoteRevisionRef.current = remoteUpdate.revision;
    setRemoteUpdate(null);
  };

  if (loading) return <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>;
  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-500 mb-2">{error}</p>
      <button onClick={() => guardedNavigate(page?.spaceId ? `/spaces/${page.spaceId}` : '/')} className="text-blue-600 hover:underline">{t('common.back')}</button>
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div className="mx-auto max-w-6xl">
      <div
        data-testid="editor-toolbar"
        className="sticky top-16 z-20 -mx-4 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 lg:-mx-6 lg:px-6"
      >
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
        ) : (
          <button
            type="button"
            onClick={() => guardedNavigate(`/spaces/${page.spaceId}`)}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-gray-600 hover:bg-gray-100 hover:text-blue-700"
            title={t('editor.backToSpace')}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            {t('editor.backToSpace')}
          </button>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end" data-testid="editor-actions">
          <button
            type="button"
            onClick={() => {
              let position = internalWorkspaceRef.current?.capturePosition();
              if (mode === 'preview') {
                const previewRoot = document.querySelector<HTMLElement>('[data-testid="md-preview"]');
                const boundary = (document.querySelector<HTMLElement>('[data-testid="editor-toolbar"]')
                  ?.getBoundingClientRect().bottom ?? 0) + 12;
                const nearestBlock = nearestMarkdownSourceBlock(
                  previewRoot?.querySelectorAll<HTMLElement>('[data-markdown-source-start]') ?? [],
                  boundary,
                );
                const sourceOffset = Number(nearestBlock?.dataset.markdownSourceStart);
                if (position && Number.isFinite(sourceOffset)) position = { ...position, sourceOffset };
              }
              guardedNavigate(`/pages/${id}`, {
                state: { workspacePosition: position ? { ...position, pageId: page.id } : null },
              });
            }}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title={t('editor.returnToReading')}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{t('editor.returnToReading')}</span>
          </button>
          {activeUsers.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 bg-green-50 rounded-md">
              <Users size={16} className="text-green-600" />
              <div className="flex -space-x-1">
                {activeUsers.map((u) => (
                  <div
                    key={u.userId}
                    title={u.userName}
                    className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-white"
                    style={{ backgroundColor: u.color }}
                  >
                    {u.userName.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => guardedNavigate(`/pages/${id}/versions`)} aria-label={t('editor.versions')} title={t('editor.versions')} data-testid="history-button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <History size={17} aria-hidden="true" />
            <span>{t('editor.versions')}</span>
          </button>
          {compositeCreationEnabled ? <button
            ref={bindingButtonRef}
            type="button"
            aria-label={t('pageTemplate.binding.action')}
            title={t('pageTemplate.binding.action')}
            onClick={() => setBindingDialogOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Users size={18} />
          </button> : null}
          {canManageTemplates && page.format === 'markdown' ? (
            <div ref={moreActionsRef} className="relative">
              <button
                ref={moreActionsButtonRef}
                type="button"
                aria-label={language === 'zh-CN' ? '更多页面操作' : 'More page actions'}
                title={language === 'zh-CN' ? '更多页面操作' : 'More page actions'}
                aria-haspopup="menu"
                aria-expanded={moreActionsOpen}
                aria-describedby={moreActionsOpen && templateCreationBlocked ? 'save-page-template-blocked-reason' : undefined}
                onClick={() => setMoreActionsOpen((open) => {
                  if (open) setMoreActionsPosition(null);
                  return !open;
                })}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  setMoreActionsOpen(true);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <Ellipsis size={18} />
              </button>
              {moreActionsOpen ? (
                <div
                  ref={moreActionsMenuRef}
                  role="menu"
                  aria-label={language === 'zh-CN' ? '更多页面操作' : 'More page actions'}
                  style={moreActionsPosition ? {
                    left: moreActionsPosition.left,
                    top: moreActionsPosition.top,
                    width: moreActionsPosition.width,
                  } : { visibility: 'hidden' }}
                  className="fixed z-20 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
                >
                  <button
                    ref={saveAsTemplateItemRef}
                    type="button"
                    role="menuitem"
                    disabled={templateCreationBlocked}
                    aria-describedby={templateCreationBlocked ? 'save-page-template-blocked-reason' : undefined}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        event.currentTarget.focus();
                      }
                    }}
                    onClick={() => {
                      const snapshot = pageRef.current;
                      if (!snapshot) return;
                      setMoreActionsOpen(false);
                      setTemplateDialogSnapshot({
                        spaceId: snapshot.spaceId,
                        pageId: snapshot.id,
                        pageTitle: snapshot.title,
                        pageUpdatedAt: snapshot.updatedAt,
                      });
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('pageTemplate.saveAs')}
                  </button>
                  {templateCreationBlocked ? (
                    <p id="save-page-template-blocked-reason" className="px-3 pb-2 pt-1 text-xs leading-5 text-gray-500">
                      {t('pageTemplate.savePageFirst')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {attachmentEnabled ? (
            <button
              ref={attachmentButtonRef}
              type="button"
              aria-label={t('attachment.title')}
              title={t('attachment.title')}
              onClick={() => setAttachmentPickerOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <ImagePlus size={18} />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={saving ? t('common.saving') : t('common.save')}
            onClick={handleSave}
            disabled={saving || !isDirty || !!remoteUpdate}
            data-testid="save-button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={17} aria-hidden="true" />
            <span>{saveButtonText}</span>
          </button>
          <button
            type="button"
            onClick={togglePreview}
            aria-label={mode === 'edit' ? t('common.preview') : t('editor.returnToEdit')}
            data-testid="mode-toggle"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {mode === 'edit' ? <BookOpen size={17} aria-hidden="true" /> : <PenLine size={17} aria-hidden="true" />}
            <span>{mode === 'edit' ? t('common.preview') : t('editor.returnToEdit')}</span>
          </button>
          <button
            type="button"
            aria-label={t('editor.assist')}
            onClick={() => setAssistOpen((open) => !open)}
            aria-pressed={assistOpen}
            data-testid="assist-toggle"
            className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${assistOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            <Bot size={17} aria-hidden="true" />
            <span>{t('editor.assist')}</span>
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[860px]">
        <div className="mb-4 flex min-w-0 items-center gap-2">
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className="min-w-0 flex-1 border-none bg-transparent text-2xl font-bold focus:outline-none"
          />
          {isDirty ? <span className="shrink-0 text-xs text-orange-500">● {t('editor.unsaved')}</span> : null}
        </div>

      {saveStatus && (
        <div
          role={saveStatus.kind === 'error' ? 'alert' : 'status'}
          aria-live={saveStatus.kind === 'error' ? 'assertive' : 'polite'}
          className={`mb-2 p-2 rounded-md text-sm text-center ${saveStatus.kind === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}
        >
          <span>{saveStatus.text}</span>
        </div>
      )}

      {remoteUpdate && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{t('editor.remoteConflict')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={acceptRemote} disabled={saving} className="rounded-lg bg-amber-700 px-3 py-2 font-medium text-white disabled:opacity-50">
              {t('editor.acceptRemote')}
            </button>
            <button type="button" onClick={keepLocal} disabled={saving} className="rounded-lg border border-amber-300 bg-white px-3 py-2 font-medium disabled:opacity-50">
              {t('editor.keepLocal')}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <MarkdownWorkspace
            ref={bindWorkspaceRef}
            value={content}
            mode={mode}
            onChange={handleContentChange}
            pageId={page.id}
            spaceId={page.spaceId}
            onUploadImages={attachmentEnabled ? handleUploadImages : undefined}
            onUploadError={attachmentEnabled ? handleImageUploadError : undefined}
          />
        </div>
        {assistOpen && page ? (
          <AgentAssistPanel
            pageId={page.id}
            pageTitle={title || page.title}
            spaceId={page.spaceId}
            snapshot={() => ({ title, content, updatedAt: page.updatedAt })}
            onApply={applyAgentChanges}
            onStreamUpdate={streamAgentChanges}
          />
        ) : null}
      </div>

      {templateDialogSnapshot && canManageTemplates && page.format === 'markdown' ? (
        <SavePageAsTemplateDialog
          spaceId={templateDialogSnapshot.spaceId}
          pageId={templateDialogSnapshot.pageId}
          pageTitle={templateDialogSnapshot.pageTitle}
          pageUpdatedAt={templateDialogSnapshot.pageUpdatedAt}
          returnFocusTo={moreActionsButtonRef.current}
          onClose={() => setTemplateDialogSnapshot(null)}
          onSaved={() => {
            setTemplateDialogSnapshot(null);
            showStatus({ kind: 'success', text: t('pageTemplate.created') }, 'template');
          }}
        />
      ) : null}

      {bindingDialogOpen && compositeCreationEnabled ? <PageAgentBindingDialog
        spaceId={page.spaceId}
        scope={{ kind: 'page', pageId: page.id, title: page.title }}
        returnFocusTo={bindingButtonRef.current}
        onClose={() => setBindingDialogOpen(false)}
        onSaved={() => showStatus({ kind: 'success', text: t('pageTemplate.binding.saved') }, 'template', 3000)}
      /> : null}

      {attachmentPickerOpen && attachmentEnabled ? (
        <AttachmentPickerDialog
          spaceId={page.spaceId}
          returnFocusTo={attachmentButtonRef.current}
          onClose={() => setAttachmentPickerOpen(false)}
          onInsert={(canonicalPath) => {
            if (!attachmentEnabled) return;
            internalWorkspaceRef.current?.insertText(formatAttachmentReference(canonicalPath));
            setAttachmentPickerOpen(false);
          }}
        />
      ) : null}
      </div>
    </div>
  );
};
