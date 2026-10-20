import { Prisma } from '@prisma/client';
import { NotificationService } from './notification.service';
import { Principal } from '../core/authorization/authorization.service';

const principal: Principal = { userId: 'u1' };

function setup() {
  const prisma: any = {
    userNotification: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'notification-1', type: 'page_note_mention', title: 'Page', body: 'A note',
        pageId: 'p1', pageNoteId: 'n1', createdAt: new Date('2026-10-21T00:00:00.000Z'), readAt: null,
      }]),
      count: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const authorization: any = { assertLiveHumanCredential: jest.fn().mockResolvedValue(undefined) };
  const service = new NotificationService(prisma, authorization);
  return { prisma, authorization, service };
}

describe('NotificationService', () => {
  it('lists only visible notifications for the current recipient', async () => {
    const { service, prisma } = setup();
    const result = await service.list(principal, { unreadOnly: false, limit: 20 });
    expect(result).toMatchObject({ unreadCount: 1, notifications: [{ pageId: 'p1', pageNoteId: 'n1', href: '/pages/p1?note=n1' }] });
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        recipientUserId: 'u1',
        page: expect.objectContaining({
          deletedAt: null,
          space: expect.objectContaining({ members: { some: { userId: 'u1' } } }),
        }),
      }),
    }));
  });

  it('marks only the current user notification as read and is idempotent', async () => {
    const { service, prisma } = setup();
    await service.markRead(principal, 'notification-1');
    expect(prisma.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'notification-1', recipientUserId: 'u1', readAt: null },
    }));
  });

  it('creates one notification per new recipient and skips the author', async () => {
    const tx: any = {
      spaceMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u2' }]),
      },
      pageNoteRecipient: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      userNotification: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const { service } = setup();
    await service.createPageNoteNotifications(tx as Prisma.TransactionClient, {
      noteId: 'n1', pageId: 'p1', spaceId: 's1', authorUserId: 'u1', recipientUserIds: ['u1', 'u2', 'u2'],
      pageTitle: 'Page', body: 'A note', quote: 'quoted',
    });
    expect(tx.pageNoteRecipient.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ noteId: 'n1', userId: 'u2' }], skipDuplicates: true,
    }));
    expect(tx.userNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ recipientUserId: 'u2', pageNoteId: 'n1', type: 'page_note_mention' })], skipDuplicates: true,
    }));
  });

  it('rejects recipients outside the current Space or non-human accounts', async () => {
    const tx: any = {
      spaceMember: { findMany: jest.fn().mockResolvedValue([]) },
      pageNoteRecipient: { createMany: jest.fn() },
      userNotification: { createMany: jest.fn() },
    };
    const { service } = setup();
    await expect(service.createPageNoteNotifications(tx as Prisma.TransactionClient, {
      noteId: 'n1', pageId: 'p1', spaceId: 's1', authorUserId: 'u1', recipientUserIds: ['agent-1'],
      pageTitle: 'Page', body: 'A note', quote: 'quoted',
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PAGE_NOTE_RECIPIENT_INVALID' }) });
    expect(tx.pageNoteRecipient.createMany).not.toHaveBeenCalled();
  });
});
