import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { notificationsApi } from './notificationsApi';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const apiMock = vi.mocked(api);

describe('notificationsApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists notifications and preserves deep-link hrefs', async () => {
    apiMock.get.mockResolvedValue({ data: {
      unreadCount: 2,
      notifications: [{ id: 'n1', type: 'page_note_mention', title: 'A note', body: 'Read this', pageId: 'p/1', pageNoteId: 'note-1', href: '', createdAt: '2026-10-21T00:00:00Z', readAt: null }],
    } });
    await expect(notificationsApi.list({ unreadOnly: false, limit: 20 })).resolves.toMatchObject({
      unreadCount: 2,
      notifications: [{ href: '/pages/p%2F1?note=note-1' }],
    });
    expect(apiMock.get).toHaveBeenCalledWith('/notifications', expect.objectContaining({ params: { unreadOnly: false, limit: 20 } }));
  });

  it('scopes read mutations through the notification endpoints', async () => {
    apiMock.patch.mockResolvedValue({});
    apiMock.post.mockResolvedValue({});
    await notificationsApi.markRead('notification/1');
    await notificationsApi.markAllRead();
    expect(apiMock.patch).toHaveBeenCalledWith('/notifications/notification%2F1/read');
    expect(apiMock.post).toHaveBeenCalledWith('/notifications/read-all');
  });
});
