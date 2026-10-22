import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ExternalLink } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { notificationsApi, type NotificationList, type UserNotification } from './notificationsApi';
import { subscribeNotificationsChanged } from './notificationEvents';

const POLL_INTERVAL = 5_000;

const formatNotificationDate = (value: string, language: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

export const NotificationBell: React.FC = () => {
  const { token, user } = useAuth();
  const { language } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationList>({ unreadCount: 0, notifications: [] });
  const [loading, setLoading] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sequenceRef = useRef(0);

  const canPoll = Boolean(token && user?.id && !user.mustChangePassword);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!canPoll) return;
    const sequence = ++sequenceRef.current;
    setLoading(true);
    try {
      const next = await notificationsApi.list({ limit: 8 }, signal);
      if (!signal?.aborted && sequence === sequenceRef.current) setState(next);
    } catch {
      // Keep the last successful notification state on transient failures.
    } finally {
      if (!signal?.aborted && sequence === sequenceRef.current) setLoading(false);
    }
  }, [canPoll, token, user?.id]);

  useEffect(() => {
    if (!canPoll) {
      ++sequenceRef.current;
      setState({ unreadCount: 0, notifications: [] });
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => { void load(); };
    const unsubscribe = subscribeNotificationsChanged(refresh);
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(refresh, POLL_INTERVAL);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      ++sequenceRef.current;
      controller.abort();
      window.clearInterval(timer);
      unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [canPoll, load, location.pathname]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openNotification = async (notification: UserNotification) => {
    setMarkingId(notification.id);
    try {
      if (!notification.readAt) await notificationsApi.markRead(notification.id);
    } catch {
      // Navigation remains useful when marking read is unavailable.
    } finally {
      setMarkingId(null);
      setOpen(false);
      navigate(notification.href);
    }
  };

  const label = language === 'zh-CN' ? '消息通知' : 'Notifications';
  const allLabel = language === 'zh-CN' ? '查看全部通知' : 'View all notifications';
  const emptyLabel = language === 'zh-CN' ? '暂无通知' : 'No notifications';
  const loadingLabel = language === 'zh-CN' ? '加载中…' : 'Loading…';

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`relative rounded-lg p-2 transition ${open || location.pathname.startsWith('/notifications') ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'}`}
      >
        <Bell size={20} aria-hidden="true" />
        {state.unreadCount > 0 ? <span aria-label={`${state.unreadCount} unread`} className="absolute -right-0.5 -top-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">{state.unreadCount > 99 ? '99+' : state.unreadCount}</span> : null}
      </button>
      {open ? <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border bg-white p-2 shadow-lg z-50">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{label}</p>
          {loading ? <span role="status" className="text-xs text-gray-400">{loadingLabel}</span> : null}
        </div>
        {state.notifications.length ? <div className="max-h-80 overflow-y-auto py-1">
          {state.notifications.map((notification) => <button
            type="button"
            key={notification.id}
            disabled={markingId === notification.id}
            onClick={() => void openNotification(notification)}
            className={`block w-full rounded-lg px-3 py-2 text-left transition hover:bg-gray-50 disabled:opacity-60 ${notification.readAt ? '' : 'bg-blue-50/60'}`}
          >
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-gray-800">{notification.title}</span>
                <span className="mt-0.5 block line-clamp-2 text-xs text-gray-600">{notification.body}</span>
                <span className="mt-1 block text-[11px] text-gray-400">{formatNotificationDate(notification.createdAt, language)}</span>
              </span>
              {!notification.readAt ? <span aria-label={language === 'zh-CN' ? '未读' : 'Unread'} className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" /> : null}
            </span>
          </button>)}
        </div> : <p className="px-3 py-6 text-center text-sm text-gray-500">{loading ? loadingLabel : emptyLabel}</p>}
        <Link to="/notifications" onClick={() => setOpen(false)} className="flex items-center justify-center gap-1 border-t px-3 py-2 text-sm text-blue-600 hover:text-blue-700">
          <ExternalLink size={14} aria-hidden="true" /> {allLabel}
        </Link>
      </div> : null}
    </div>
  );
};
