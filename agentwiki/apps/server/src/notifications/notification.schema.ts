import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const queryBoolean = z.preprocess(value => {
  if (value === undefined || value === '') return false;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return value;
}, z.boolean());

const queryLimit = z.preprocess(value => {
  if (value === undefined || value === '') return 20;
  return value;
}, z.coerce.number().int().min(1).max(100));

export const NOTIFICATION_LIST_QUERY = z.object({
  unreadOnly: queryBoolean,
  limit: queryLimit,
}).strict();

export type NotificationListQuery = z.infer<typeof NOTIFICATION_LIST_QUERY>;

export function parseNotificationListQuery(raw: unknown): NotificationListQuery {
  const parsed = NOTIFICATION_LIST_QUERY.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'NOTIFICATION_QUERY_INVALID',
      message: 'Invalid notification query',
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

export const PAGE_NOTE_NOTIFICATION_TYPE = 'page_note_mention' as const;
export type PageNoteNotificationType = typeof PAGE_NOTE_NOTIFICATION_TYPE;

export interface CreatePageNoteNotificationsInput {
  noteId: string;
  pageId: string;
  spaceId: string;
  authorUserId: string;
  recipientUserIds: string[];
  pageTitle: string;
  body: string;
  quote: string;
}

export interface NotificationListItem {
  id: string;
  type: PageNoteNotificationType | string;
  title: string;
  body: string;
  pageId: string;
  pageNoteId: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationListResult {
  unreadCount: number;
  notifications: NotificationListItem[];
}
