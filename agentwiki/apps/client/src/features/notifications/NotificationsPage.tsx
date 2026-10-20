import React, { useCallback, useEffect, useState } from 'react';
import { CheckCheck, ExternalLink, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { notificationsApi, type UserNotification } from './notificationsApi';

const formatDate = (value: string, language: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export const NotificationsPage: React.FC = () => {
  const { token, user } = useAuth();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const zh = language === 'zh-CN';
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextLimit = limit, background = false) => {
    if (!token || !user?.id) return;
    if (background) setRefreshing(true); else setLoading(true);
    try {
      setError(null);
      const result = await notificationsApi.list({ unreadOnly, limit: nextLimit });
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
    } catch {
      setError(zh ? '通知加载失败，请重试。' : 'Failed to load notifications. Retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [limit, token, user?.id, unreadOnly, zh]);

  useEffect(() => { void load(); }, [load]);

  const openNotification = async (notification: UserNotification) => {
    if (!notification.readAt) {
      try { await notificationsApi.markRead(notification.id); } catch { /* navigation still works */ }
      setNotifications((items) => items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    navigate(notification.href);
  };

  const markAll = async () => {
    try {
      await notificationsApi.markAllRead();
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
    } catch {
      setError(zh ? '标记已读失败，请重试。' : 'Failed to mark notifications as read. Retry.');
    }
  };

  const title = zh ? '消息通知' : 'Notifications';
  return <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-gray-900">{title}</h1><p className="mt-1 text-sm text-gray-500">{zh ? `未读 ${unreadCount} 条` : `${unreadCount} unread`}</p></div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void markAll()} disabled={!unreadCount} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"><CheckCheck size={16} /> {zh ? '全部已读' : 'Mark all read'}</button>
        <button type="button" aria-label={zh ? '刷新通知' : 'Refresh notifications'} onClick={() => void load(limit, true)} className="rounded-lg border p-2 text-gray-600 hover:bg-gray-50"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
      </div>
    </div>
    <div className="mt-6 flex items-center gap-2 border-b pb-3 text-sm">
      <button type="button" onClick={() => { setUnreadOnly(false); setLimit(30); }} aria-pressed={!unreadOnly} className={`rounded-full px-3 py-1.5 ${!unreadOnly ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>{zh ? '全部' : 'All'}</button>
      <button type="button" onClick={() => { setUnreadOnly(true); setLimit(30); }} aria-pressed={unreadOnly} className={`rounded-full px-3 py-1.5 ${unreadOnly ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>{zh ? '未读' : 'Unread'}</button>
    </div>
    {error ? <div role="alert" className="mt-5 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"><span>{error}</span><button type="button" onClick={() => void load()} className="underline">{zh ? '重试' : 'Retry'}</button></div> : null}
    {loading ? <p role="status" className="py-16 text-center text-sm text-gray-500">{zh ? '加载中…' : 'Loading…'}</p> : null}
    {!loading && !notifications.length ? <p className="py-16 text-center text-sm text-gray-500">{zh ? '暂无通知' : 'No notifications'}</p> : null}
    {!loading && notifications.length ? <div className="mt-4 divide-y rounded-xl border bg-white">
      {notifications.map((notification) => <button type="button" key={notification.id} onClick={() => void openNotification(notification)} className={`block w-full px-4 py-4 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-gray-50 ${notification.readAt ? '' : 'bg-blue-50/50'}`}>
        <div className="flex items-start gap-3"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.readAt ? 'bg-gray-200' : 'bg-blue-600'}`} /><span className="min-w-0 flex-1"><span className="block font-medium text-gray-900">{notification.title}</span><span className="mt-1 block text-sm text-gray-600">{notification.body}</span><span className="mt-2 block text-xs text-gray-400">{formatDate(notification.createdAt, language)}</span></span><ExternalLink size={16} className="mt-1 shrink-0 text-gray-400" /></div>
      </button>)}
    </div> : null}
    {!loading && notifications.length >= limit ? <button type="button" onClick={() => { const next = limit + 30; setLimit(next); void load(next); }} className="mx-auto mt-5 block rounded-lg border px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">{zh ? '加载更多' : 'Load more'}</button> : null}
  </main>;
};
