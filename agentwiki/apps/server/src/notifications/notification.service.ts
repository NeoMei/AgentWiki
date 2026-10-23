import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { PrismaService } from '../database/prisma.service';
import {
  CreatePageNoteNotificationsInput,
  NotificationListItem,
  NotificationListQuery,
  NotificationListResult,
  PAGE_NOTE_NOTIFICATION_TYPE,
  PageNoteRecipientSummary,
} from './notification.schema';

const MAX_SNAPSHOT_LENGTH = 1000;

const clip = (value: string, length = MAX_SNAPSHOT_LENGTH) => value.slice(0, length);

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async list(principal: Principal, query: NotificationListQuery): Promise<NotificationListResult> {
    await this.assertHuman(principal);
    const where = this.visibleWhere(principal, query.unreadOnly);
    const [rows, unreadCount] = await Promise.all([
      this.prisma.userNotification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          pageId: true,
          pageNoteId: true,
          createdAt: true,
          readAt: true,
        },
      }),
      this.prisma.userNotification.count({ where: this.visibleWhere(principal, true) }),
    ]);
    return {
      unreadCount,
      notifications: rows.map(row => this.project(row)),
    };
  }

  async markRead(principal: Principal, notificationId: string): Promise<{ updated: number }> {
    await this.assertHuman(principal);
    const result = await this.prisma.userNotification.updateMany({
      where: { id: notificationId, recipientUserId: principal.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async markAllRead(principal: Principal): Promise<{ updated: number }> {
    await this.assertHuman(principal);
    const result = await this.prisma.userNotification.updateMany({
      where: { recipientUserId: principal.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async createPageNoteNotifications(
    tx: Prisma.TransactionClient,
    input: CreatePageNoteNotificationsInput,
  ): Promise<PageNoteRecipientSummary[]> {
    // An explicit self mention is meaningful: it creates a normal inbox item
    // and keeps the note's @ recipients visible to every reader.
    const recipientUserIds = [...new Set(input.recipientUserIds)];
    if (recipientUserIds.length === 0) return [];

    const members = await tx.spaceMember.findMany({
      where: {
        spaceId: input.spaceId,
        userId: { in: recipientUserIds },
        user: { type: 'human', deletedAt: null },
      },
      select: { userId: true, user: { select: { id: true, name: true, email: true } } },
    });
    const verifiedIds = new Set(members.map(member => member.userId));
    if (recipientUserIds.some(userId => !verifiedIds.has(userId))) {
      throw new BadRequestException({
        code: 'PAGE_NOTE_RECIPIENT_INVALID',
        message: 'One or more page note recipients are not human members of this Space',
      });
    }

    const body = clip(input.body);
    const quote = clip(input.quote);
    await tx.pageNoteRecipient.createMany({
      data: recipientUserIds.map(userId => ({ noteId: input.noteId, userId })),
      skipDuplicates: true,
    });
    await tx.userNotification.createMany({
      data: recipientUserIds.map(recipientUserId => ({
        recipientUserId,
        actorUserId: input.authorUserId,
        spaceId: input.spaceId,
        pageId: input.pageId,
        pageNoteId: input.noteId,
        type: PAGE_NOTE_NOTIFICATION_TYPE,
        title: input.pageTitle,
        body,
        payload: { pageTitle: input.pageTitle, body, quote } as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    const requestedIds = new Set(recipientUserIds);
    return members.filter(member => requestedIds.has(member.userId)).map(member => ({
      userId: member.user.id,
      name: member.user.name?.trim() || member.user.email,
      email: member.user.email,
    }));
  }

  private visibleWhere(principal: Principal, unreadOnly: boolean): Prisma.UserNotificationWhereInput {
    return {
      recipientUserId: principal.userId,
      ...(unreadOnly ? { readAt: null } : {}),
      page: {
        deletedAt: null,
        space: {
          deletedAt: null,
          members: { some: { userId: principal.userId } },
        },
      },
    };
  }

  private project(row: {
    id: string;
    type: string;
    title: string;
    body: string;
    pageId: string;
    pageNoteId: string;
    createdAt: Date;
    readAt: Date | null;
  }): NotificationListItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      pageId: row.pageId,
      pageNoteId: row.pageNoteId,
      href: `/pages/${encodeURIComponent(row.pageId)}?note=${encodeURIComponent(row.pageNoteId)}`,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  }

  private async assertHuman(principal: Principal): Promise<void> {
    if (!principal?.userId || principal.agentId) throw new ForbiddenException('This operation requires a human account');
    await this.authorization.assertLiveHumanCredential(this.prisma, principal, ['pages:read']);
  }
}
