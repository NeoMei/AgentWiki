import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { NotificationBell } from './NotificationBell';
import { notificationsApi } from './notificationsApi';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ token: 'token', user: { id: 'u1', mustChangePassword: false } }),
}));
vi.mock('./notificationsApi', () => ({ notificationsApi: { list: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() } }));

const notificationApiMock = vi.mocked(notificationsApi);
const notification = { id: 'n1', type: 'page_note_mention' as const, title: 'New note', body: 'Please review this page', pageId: 'p1', pageNoteId: 'note-1', href: '/pages/p1?note=note-1', createdAt: '2026-10-21T00:00:00Z', readAt: null };
const Location = () => { const location = useLocation(); return <output data-testid="location">{location.pathname}</output>; };
const renderBell = () => render(<LanguageProvider><MemoryRouter initialEntries={['/dashboard']}><Routes><Route path="*" element={<><NotificationBell /><Location /></>} /></Routes></MemoryRouter></LanguageProvider>);

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationApiMock.list.mockResolvedValue({ unreadCount: 1, notifications: [notification] });
    notificationApiMock.markRead.mockResolvedValue();
  });

  it('polls and shows unread notifications, then marks before navigating', async () => {
    renderBell();
    await act(async () => Promise.resolve());
    expect(await screen.findByLabelText('1 unread')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: /New note/ }));
    await waitFor(() => expect(notificationApiMock.markRead).toHaveBeenCalledWith('n1'));
    expect(notificationApiMock.list).toHaveBeenCalled();
  });

  it('navigates even when marking read fails', async () => {
    notificationApiMock.markRead.mockRejectedValue(new Error('offline'));
    renderBell();
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.click(await screen.findByRole('button', { name: /New note/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/pages/p1'));
  });
});
