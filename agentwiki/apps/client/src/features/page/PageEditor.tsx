import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { MarkdownMode, MarkdownWorkspace } from '../../components/MarkdownWorkspace';
import { Save, ArrowLeft, History, Users } from 'lucide-react';
import 'highlight.js/styles/github.css';

interface Page {
  id: string;
  title: string;
  content: string;
  format: string;
  spaceId: string;
}

interface ActiveUser {
  userId: string;
  userName: string;
  color: string;
}

export const PageEditor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const socketRef = useRef<Socket | null>(null);
  const contentRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

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

  // Load page data
  useEffect(() => {
    if (!id) return;
    const fetchPage = async () => {
      try {
        const res = await api.get(`/pages/${id}`);
        setPage(res.data);
        setTitle(res.data.title);
        setContent(res.data.content || '');
        contentRef.current = res.data.content || '';
      } catch (err: any) {
        setError(err.response?.data?.message || t('editor.loadFailed'));
      } finally {
        setLoading(false);
      }
    };
    fetchPage();
  }, [id]);

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

    socket.on('contentUpdated', (data: { content: string; userId: string }) => {
      if (data.userId !== socket.id && data.content !== contentRef.current) {
        setContent(data.content);
        contentRef.current = data.content;
      }
    });

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      socket.emit('leavePage', { pageId: id });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [id, user?.id, page?.id]);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    contentRef.current = newContent;
    setIsDirty(true);

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
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      await api.patch(`/pages/${id}`, { title, content });
      setSaveStatus({ kind: 'success', text: t('editor.saved') });
      setIsDirty(false);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err: any) {
      setSaveStatus({ kind: 'error', text: t('editor.saveFailed', { message: err.response?.data?.message || t('common.notAvailable') }) });
      setTimeout(() => setSaveStatus(null), 5000);
    } finally {
      setSaving(false);
    }
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
          <Link to={`/pages/${id}/versions`} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-md hover:bg-gray-200">
            <History size={18} />
            {t('editor.versions')}
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={18} />
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>

      {saveStatus && (
        <div className={`mb-2 p-2 rounded-md text-sm text-center ${saveStatus.kind === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {saveStatus.text}
        </div>
      )}

      <MarkdownWorkspace value={content} mode={mode} onChange={handleContentChange} onModeChange={setMode} />
    </div>
  );
};
