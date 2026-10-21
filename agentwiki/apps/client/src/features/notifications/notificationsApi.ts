import api from '../../api/client';

export interface UserNotification {
  id: string;
  type: 'page_note_mention' | string;
  title: string;
  body: string;
  pageId: string;
  pageNoteId: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationList {
  unreadCount: number;
  notifications: UserNotification[];
}

const normaliseNotification = (value: UserNotification): UserNotification => ({
  ...value,
  href: typeof value.href === 'string' && value.href
    ? value.href
    : `/pages/${encodeURIComponent(value.pageId)}?note=${encodeURIComponent(value.pageNoteId)}`,
  readAt: value.readAt ?? null,
});

export const notificationsApi = {
  async list(params?: { unreadOnly?: boolean; limit?: number }, signal?: AbortSignal): Promise<NotificationList> {
    const { data } = await api.get<Partial<NotificationList>>('/notifications', {
      params: {
        unreadOnly: params?.unreadOnly === undefined ? undefined : params.unreadOnly,
        limit: params?.limit,
      },
      signal,
    });
    const notifications = Array.isArray(data?.notifications) ? data.notifications.map(normaliseNotification) : [];
    return {
      unreadCount: Number.isFinite(Number(data?.unreadCount)) ? Math.max(0, Number(data?.unreadCount)) : 0,
      notifications,
    };
  },
  async markRead(id: string): Promise<void> {
    await api.patch(`/notifications/${encodeURIComponent(id)}/read`);
  },
  async markAllRead(): Promise<void> {
    await api.post('/notifications/read-all');
  },
};
