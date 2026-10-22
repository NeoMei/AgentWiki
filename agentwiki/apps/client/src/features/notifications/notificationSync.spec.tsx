import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import api from '../../api/client';
import { NotificationBell } from './NotificationBell';
import { NotificationsPage } from './NotificationsPage';
import { notificationsApi } from './notificationsApi';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: { id: 'u1', mustChangePassword: false } }),
}));
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const http = vi.mocked(api);
const item = { id: 'n1', type: 'page_note_mention', title: 'Review requested', body: 'Check page',
  pageId: 'p1', pageNoteId: 'note1', href: '/pages/p1', createdAt: '2026-10-22T00:00:00Z', readAt: null };
let read: boolean;
const renderBoth = () => render(<LanguageProvider><MemoryRouter initialEntries={['/notifications']}><NotificationBell /><NotificationsPage /></MemoryRouter></LanguageProvider>);

describe('notification read synchronization', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    read = false;
    http.get.mockImplementation(async (_url, config) => ({ data: {
      unreadCount: read ? 0 : 1,
      notifications: read && (config?.params as { unreadOnly?: boolean } | undefined)?.unreadOnly ? [] : [{ ...item, readAt: read ? '2026-10-23T00:00:00Z' : null }],
    } }));
    http.patch.mockImplementation(async () => { read = true; return { data: {} }; });
    http.post.mockImplementation(async () => { read = true; return { data: {} }; });
  });

  it('clears the bell and refreshes its open dropdown immediately after mark all on the page', async () => {
    renderBoth();
    await screen.findByLabelText('1 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByLabelText('Unread')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument());
    expect(screen.getByText('0 unread')).toBeVisible();
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument();
    expect(screen.getAllByText('Review requested')).toHaveLength(2);
  });

  it('synchronizes single reads and removes read rows from the unread filter', async () => {
    renderBoth();
    await screen.findByLabelText('1 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await act(async () => { await notificationsApi.markRead('n1'); });
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument());
    expect(within(screen.getByRole('main')).queryByText('Review requested')).not.toBeInTheDocument();
    expect(screen.getByText('0 unread')).toBeVisible();
  });

  it('refreshes both views when another tab reports a successful read', async () => {
    renderBoth();
    await screen.findByLabelText('1 unread');
    read = true;
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'agentwiki.notifications.changed.v1', newValue: 'read-1' })));
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument());
    expect(screen.getByText('0 unread')).toBeVisible();
  });

  it('does not claim a failed read succeeded', async () => {
    http.post.mockRejectedValue(new Error('offline'));
    renderBoth();
    await screen.findByLabelText('1 unread');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to mark');
    expect(screen.getByLabelText('1 unread')).toBeVisible();
    expect(screen.getByText('1 unread')).toBeVisible();
  });

  it('ignores older in-flight counts after a successful read refresh', async () => {
    renderBoth();
    await screen.findByLabelText('1 unread');
    let finishBell!: (value: unknown) => void;
    let finishPage!: (value: unknown) => void;
    http.get.mockImplementationOnce(() => new Promise((resolve) => { finishBell = resolve; }));
    http.get.mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve; }));
    act(() => window.dispatchEvent(new Event('focus')));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh notifications' }));
    await act(async () => { await notificationsApi.markAllRead(); });
    await waitFor(() => expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument());
    await act(async () => {
      const stale = { data: { unreadCount: 1, notifications: [item] } };
      finishBell(stale);
      finishPage(stale);
    });
    expect(screen.queryByLabelText('1 unread')).not.toBeInTheDocument();
    expect(screen.getByText('0 unread')).toBeVisible();
  });
});
