import React, { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace, MarkdownWorkspaceHandle } from '../../components/MarkdownWorkspace';
import { Save, ArrowLeft, History, Users, Bot, Ellipsis } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { ModeToggleButton } from '../../components/ModeToggleButton';
import { SavePageAsTemplateDialog } from '../page-templates/SavePageAsTemplateDialog';
import { listPageTemplates } from '../page-templates/pageTemplateApi';
import { truncateValidatorLength } from '../page-templates/validatorLength';
import { AgentAssistPanel } from './AgentAssistPanel';
import 'highlight.js/styles/github.css';

interface Page {
  id: string;
  title: string;
  content: string;
  format: string;
  spaceId: string;
  updatedAt: string;
  capabilities?: { canEdit?: boolean };
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

const PAGE_TITLE_LIMIT = 200;

const pageRevision = (page: Page) => JSON.stringify([
  page.updatedAt,
  page.title,
  page.content,
  page.format,
]);

export const PageEditor: React.FC<{ workspaceRef?: React.MutableRefObject<MarkdownWorkspaceHandle | null> }> = ({ workspaceRef } = {}) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, t } = useLanguage();
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
  const mountedRef = useRef(true);
  const dismissedRemoteRevisionRef = useRef<string | null>(null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moreActionsRef = useRef<HTMLDivElement>(null);
  const moreActionsButtonRef = useRef<HTMLButtonElement>(null);
  const moreActionsMenuRef = useRef<HTMLDivElement>(null);
  const saveAsTemplateItemRef = useRef<HTMLButtonElement>(null);

  const [page, setPage] = useState<Page | null>(null);
  const [spacePages, setSpacePages] = useState<Array<{ id: string; title?: string; slug?: string }>>([]);
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

  const templateCapabilityIdentity = page
    ? `${page.id}\u0000${page.spaceId}\u0000${page.format}\u0000${language}`
    : null;
  const canManageTemplates = templateCapabilityIdentity !== null
    && templateCapability?.identity === templateCapabilityIdentity
    && templateCapability.canManage;
  const templateCreationBlocked = isDirty || saving || remoteUpdate !== null;

  activePageIdRef.current = id;

  const updateDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  const adoptRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage)) => {
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
  }, [updateDirty]);

  const adoptRemoteDraft = useCallback((nextContent: string, revision: string) => {
    setTemplateDialogSnapshot(null);
    setContent(nextContent);
    contentRef.current = nextContent;
    editRevisionRef.current += 1;
    acceptedSocketRevisionRef.current = revision;
    dismissedRemoteRevisionRef.current = null;
    setRemoteUpdate(null);
    updateDirty(true);
  }, [updateDirty]);

  const offerRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage), forcePrompt = false) => {
    if (nextPage.id !== activePageIdRef.current) return;
    if (revision.startsWith('socket:') && revision === acceptedSocketRevisionRef.current) return;
    const baseline = pageRef.current;
    if (baseline && revision === (baselineRevisionRef.current || pageRevision(baseline))) return;
    if (isDirtyRef.current) {
      if (forcePrompt || dismissedRemoteRevisionRef.current !== revision) {
        setRemoteUpdate({ page: nextPage, revision });
      }
      return;
    }
    if (revision.startsWith('socket:')) {
      adoptRemoteDraft(nextPage.content || '', revision);
    } else {
      adoptRemotePage(nextPage, revision);
    }
  }, [adoptRemoteDraft, adoptRemotePage]);

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
        window.alert(tRef.current('common.forbidden'));
        navigate(`/pages/${requestedId}`, { replace: true });
        return;
      }
      setError(null);
      offerRemotePage(res.data, pageRevision(res.data), forcePrompt);
    } catch (err: any) {
      if (controller.signal.aborted || !mountedRef.current || activePageIdRef.current !== requestedId) return;
      if (showLoading) setError(err.response?.data?.message || tRef.current('editor.loadFailed'));
    } finally {
      requestControllersRef.current.delete(controller);
      if (showLoading && mountedRef.current && sequence === loadSequenceRef.current && activePageIdRef.current === requestedId) {
        setLoading(false);
      }
    }
  }, [id, navigate, offerRemotePage]);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!page?.spaceId) return;
    api.get(`/pages?spaceId=${page.spaceId}&take=200`)
      .then((res) => setSpacePages(res.data?.data || res.data?.items || []))
      .catch(() => setSpacePages([]));
  }, [page?.spaceId]);

  useEffect(() => {
    setMoreActionsOpen(false);
    setMoreActionsPosition(null);
    setTemplateDialogSnapshot(null);
    setTemplateCapability(null);
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
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handleModeShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        setMode((currentMode) => currentMode === 'edit' ? 'preview' : 'edit');
      }
    };
    window.addEventListener('keydown', handleModeShortcut);
    return () => window.removeEventListener('keydown', handleModeShortcut);
  }, []);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Guard SPA navigation when there are unsaved changes.
  const guardNavigate = useCallback((target: string) => {
    if (isDirty && !window.confirm(t('editor.unsavedWarning'))) return;
    // Use a full navigation so React Router unmounts and state resets cleanly.
    window.location.assign(target);
  }, [isDirty, t]);

  // Load page data and reset state when navigating to another page.
  useEffect(() => {
    loadSequenceRef.current += 1;
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
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
    updateDirty(false);
    if (!id) {
      setLoading(false);
      return;
    }
    void loadPage(true);
  }, [id, loadPage, updateDirty]);

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
    const submittedEditRevision = editRevisionRef.current;
    const submittedTitle = title;
    const submittedContent = content;
    setSaving(true);
    setSaveStatus(null);
    try {
      const response = await api.patch(`/pages/${requestedId}`, {
        title: submittedTitle,
        content: submittedContent,
        expectedUpdatedAt: baseline.updatedAt,
      });
      if (!mountedRef.current || activePageIdRef.current !== requestedId) return;
      const savedPage: Page = {
        ...baseline,
        ...response.data,
        title: submittedTitle,
        content: submittedContent,
      };
      pageRef.current = savedPage;
      baselineRevisionRef.current = pageRevision(savedPage);
      setPage(savedPage);
      setSaveStatus({ kind: 'success', text: t('editor.saved') });
      if (editRevisionRef.current === submittedEditRevision) updateDirty(false);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      if (!mountedRef.current || activePageIdRef.current !== requestedId) return;
      setSaveStatus({ kind: 'error', text: t('editor.saveFailed', { message: err.response?.data?.message || t('common.notAvailable') }) });
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => setSaveStatus(null), 5000);
      if (err.response?.status === 409) {
        dismissedRemoteRevisionRef.current = null;
        void loadPage(false, true);
      }
    } finally {
      if (mountedRef.current && activePageIdRef.current === requestedId) setSaving(false);
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
      <button onClick={() => guardNavigate(page?.spaceId ? `/spaces/${page.spaceId}` : '/')} className="text-blue-600 hover:underline">{t('common.back')}</button>
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => guardNavigate(page.spaceId ? `/spaces/${page.spaceId}` : '/')}
            className="p-2 hover:bg-gray-100 rounded"
            title={t('editor.backToSpace')}
          >
            <ArrowLeft size={20} />
          </button>
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            className="text-2xl font-bold border-none focus:outline-none bg-transparent min-w-0"
          />
          {isDirty && (
            <span className="text-xs text-orange-500 ml-2">● {t('editor.unsaved')}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button onClick={() => guardNavigate(`/pages/${id}/versions`)} aria-label={t('editor.versions')} title={t('editor.versions')} data-testid="history-button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <History size={18} />
          </button>
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
          <IconButton
            label={saving ? t('common.saving') : t('common.save')}
            onClick={handleSave}
            disabled={saving || !isDirty || !!remoteUpdate}
            primary
            testId="save-button"
          >
            <Save size={18} />
          </IconButton>
          <ModeToggleButton mode={mode} onToggle={() => setMode(mode === 'edit' ? 'preview' : 'edit')} />
          <IconButton
            label={t('editor.assist')}
            onClick={() => setAssistOpen((open) => !open)}
            active={assistOpen}
            testId="assist-toggle"
          >
            <Bot size={18} />
          </IconButton>
        </div>
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
          <MarkdownWorkspace ref={workspaceRef} value={content} mode={mode} onChange={handleContentChange} pages={spacePages} />
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
            setSaveStatus({ kind: 'success', text: t('pageTemplate.created') });
          }}
        />
      ) : null}
    </div>
  );
};
