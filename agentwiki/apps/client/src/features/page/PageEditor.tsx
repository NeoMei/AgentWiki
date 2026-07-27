import React, { useCallback, useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace, MarkdownWorkspaceHandle } from '../../components/MarkdownWorkspace';
import { Save, ArrowLeft, History, Users } from 'lucide-react';
import { IconButton } from '../../components/IconButton';
import { ModeToggleButton } from '../../components/ModeToggleButton';
import 'highlight.js/styles/github.css';

interface Page {
  id: string;
  title: string;
  content: string;
  format: string;
  spaceId: string;
  updatedAt: string;
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

const pageRevision = (page: Page) => JSON.stringify([
  page.updatedAt,
  page.title,
  page.content,
  page.format,
]);

export const PageEditor: React.FC<{ workspaceRef?: React.MutableRefObject<MarkdownWorkspaceHandle | null> }> = ({ workspaceRef } = {}) => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const socketRef = useRef<Socket | null>(null);
  const contentRef = useRef<string>('');
  const tRef = useRef(t);
  const pageRef = useRef<Page | null>(null);
  const baselineRevisionRef = useRef<string | null>(null);
  const isDirtyRef = useRef(false);
  const editRevisionRef = useRef(0);
  const activePageIdRef = useRef(id);
  const loadSequenceRef = useRef(0);
  const mountedRef = useRef(true);
  const dismissedRemoteRevisionRef = useRef<string | null>(null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [remoteUpdate, setRemoteUpdate] = useState<RemotePageUpdate | null>(null);

  activePageIdRef.current = id;

  const updateDirty = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty;
    setIsDirty(dirty);
  }, []);

  const adoptRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage)) => {
    pageRef.current = nextPage;
    baselineRevisionRef.current = revision;
    setPage(nextPage);
    setTitle(nextPage.title);
    setContent(nextPage.content || '');
    contentRef.current = nextPage.content || '';
    dismissedRemoteRevisionRef.current = null;
    setRemoteUpdate(null);
    updateDirty(false);
  }, [updateDirty]);

  const offerRemotePage = useCallback((nextPage: Page, revision = pageRevision(nextPage), forcePrompt = false) => {
    if (nextPage.id !== activePageIdRef.current) return;
    const baseline = pageRef.current;
    if (baseline && revision === (baselineRevisionRef.current || pageRevision(baseline))) return;
    if (isDirtyRef.current) {
      if (forcePrompt || dismissedRemoteRevisionRef.current !== revision) {
        setRemoteUpdate({ page: nextPage, revision });
      }
      return;
    }
    adoptRemotePage(nextPage, revision);
  }, [adoptRemotePage]);

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
  }, [id, offerRemotePage]);

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

  // Load page data and reset state when navigating to another page.
  useEffect(() => {
    loadSequenceRef.current += 1;
    requestControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    pageRef.current = null;
    baselineRevisionRef.current = null;
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

  const handleContentChange = (newContent: string) => {
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
  };

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    editRevisionRef.current += 1;
    updateDirty(true);
  };

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
    editRevisionRef.current += 1;
    adoptRemotePage(remoteUpdate.page, remoteUpdate.revision);
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
      <Link to={page?.spaceId ? `/spaces/${page.spaceId}` : '/'} className="text-blue-600 hover:underline">{t('common.back')}</Link>
    </div>
  );
  if (!page) return <div className="text-center py-8 text-gray-500">{t('editor.notFound')}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Link
            to={page.spaceId ? `/spaces/${page.spaceId}` : '/'}
            className="p-2 hover:bg-gray-100 rounded"
            title={t('editor.backToSpace')}
          >
            <ArrowLeft size={20} />
          </Link>
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
          <Link to={`/pages/${id}/versions`} aria-label={t('editor.versions')} title={t('editor.versions')} data-testid="history-button" className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <History size={18} />
          </Link>
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
        </div>
      </div>

      {saveStatus && (
        <div className={`mb-2 p-2 rounded-md text-sm text-center ${saveStatus.kind === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {saveStatus.text}
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

      <MarkdownWorkspace ref={workspaceRef} value={content} mode={mode} onChange={handleContentChange} pages={spacePages} />
    </div>
  );
};
