import { Injectable, Optional } from '@nestjs/common';
import { PageNote, Prisma } from '@prisma/client';
import { AuthorizationService, Principal, SpaceRole } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { NOTE_CREATE, NOTE_DELETE, NOTE_ID, NOTE_ROUTE, NOTE_UPDATE, parseNoteInput } from './page-note.schema';

const READ_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const identity = (principal: Principal) => principal.agentId
  ? { authorType: 'agent', authorId: principal.agentId }
  : { authorType: 'user', authorId: principal.userId };

@Injectable()
export class PageNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async list(principal: Principal, spaceId: string, pageId: string) {
    await this.assertRead(principal, spaceId, pageId);
    const access = await this.authorization.assertSpaceAccess(principal, spaceId, READ_ROLES, 'pages:read');
    let canCreate = principal.agentId ? ['editor', 'publisher'].includes(access.role) : 'id' in access;
    if (canCreate && !principal.agentId && principal.credentialId) {
      const credential = await this.prisma.apiKeyCredential.findUnique({ where: { id: principal.credentialId }, select: { scopes: true } });
      canCreate = Boolean(credential?.scopes.some(scope => scope === '*' || scope === 'pages:write'));
    }
    const rows = await this.prisma.pageNote.findMany({
      where: { spaceId, pageId, deletedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { notes: rows.map(note => this.project(note, principal, canCreate)), canCreate };
  }

  async create(principal: Principal, spaceId: string, pageId: string, raw: unknown) {
    const input = parseNoteInput(NOTE_CREATE, raw);
    await this.assertRead(principal, spaceId, pageId);
    return this.prisma.$transaction(async db => {
      await this.lockWrite(db, principal, spaceId, pageId);
      const author = identity(principal);
      const existing = await db.pageNote.findUnique({
        where: { pageId_authorType_authorId_clientNoteId: { pageId, ...author, clientNoteId: input.clientNoteId } },
      });
      // A retry never resurrects or overwrites a subsequently edited/deleted note.
      if (existing) {
        if (existing.deletedAt) throw new BusinessException('RESOURCE_CONFLICT', 'This note was deleted; use a new clientNoteId for a new note');
        return this.project(existing, principal, true);
      }
      const account = principal.agentId
        ? await db.agent.findUnique({ where: { id: principal.agentId }, select: { name: true } })
        : await db.user.findUnique({ where: { id: principal.userId }, select: { name: true } });
      if (!account) throw new BusinessException('SPACE_ACCESS_DENIED');
      const note = await db.pageNote.create({ data: {
        spaceId, pageId, ...author, authorName: account.name?.trim() || (principal.agentId ? 'Agent' : '成员'),
        clientNoteId: input.clientNoteId, body: input.body, target: input.target as Prisma.InputJsonValue,
        status: input.status ?? 'pending', taskId: !input.status || input.status === 'pending' ? null : input.taskId ?? null,
      } });
      if (this.notifications && input.recipientUserIds?.length) {
        const page = await db.page.findUnique({ where: { id: pageId }, select: { title: true } });
        await this.notifications.createPageNoteNotifications(db, {
          noteId: note.id,
          pageId,
          spaceId,
          authorUserId: principal.userId,
          recipientUserIds: input.recipientUserIds,
          pageTitle: page?.title ?? '',
          body: note.body,
          quote: input.target.quote,
        });
      }
      return this.project(note, principal, true);
    });
  }

  async update(principal: Principal, spaceId: string, pageId: string, noteId: string, raw: unknown) {
    const input = parseNoteInput(NOTE_UPDATE, raw);
    parseNoteInput(NOTE_ID, noteId);
    await this.assertRead(principal, spaceId, pageId);
    return this.prisma.$transaction(async db => {
      await this.lockWrite(db, principal, spaceId, pageId);
      const note = await this.ownNote(db, principal, spaceId, pageId, noteId, input.expectedUpdatedAt);
      // Advance even within the same millisecond so the optimistic token never repeats.
      const updatedAt = new Date(Math.max(Date.now(), note.updatedAt.getTime() + 1));
      const changed = await db.pageNote.update({ where: { id: note.id }, data: {
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.target === undefined ? {} : { target: input.target as Prisma.InputJsonValue }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...((input.status ?? note.status) === 'pending' ? { taskId: null } : input.taskId === undefined ? {} : { taskId: input.taskId }),
        updatedAt,
      } });
      return this.project(changed, principal, true);
    });
  }

  async remove(principal: Principal, spaceId: string, pageId: string, noteId: string, raw: unknown) {
    const input = parseNoteInput(NOTE_DELETE, raw);
    parseNoteInput(NOTE_ID, noteId);
    await this.assertRead(principal, spaceId, pageId);
    return this.prisma.$transaction(async db => {
      await this.lockWrite(db, principal, spaceId, pageId);
      const note = await this.ownNote(db, principal, spaceId, pageId, noteId, input.expectedUpdatedAt);
      await db.pageNote.update({ where: { id: note.id }, data: { deletedAt: new Date(), updatedAt: new Date(Math.max(Date.now(), note.updatedAt.getTime() + 1)) } });
      return { deleted: true as const };
    });
  }

  private async assertRead(principal: Principal, spaceId: string, pageId: string) {
    parseNoteInput(NOTE_ROUTE, { spaceId, pageId });
    const page = await this.authorization.assertPageAccess(principal, pageId, READ_ROLES, 'pages:read');
    if (page.spaceId !== spaceId) throw new BusinessException('SPACE_ACCESS_DENIED', 'Page does not belong to this Space');
    if (principal.agentId) await this.authorization.assertLiveAgentAccess(principal, spaceId, ['pages:read']);
    else await this.authorization.assertLiveHumanCredential(this.prisma, principal, ['pages:read']);
  }

  private async lockWrite(db: Prisma.TransactionClient, principal: Principal, spaceId: string, pageId: string) {
    // Page writers take this advisory lock before locking Page and advancing
    // Space revisions. Join that order before holding Space rows, otherwise a
    // note write and a Page rename can wait on each other's Space/Page locks.
    const lockSpaceBoundary = () => db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${spaceId}))`);
    if (principal.agentId) {
      // Reader grants remain read-only; annotations do not grant permission to publish Page content.
      await this.authorization.lockLiveAgentWriteAccessAcrossSpaceBoundary(db, principal, spaceId, ['pages:write'], lockSpaceBoundary);
    } else {
      await this.authorization.lockLiveHumanPrincipal(db, principal);
      await this.authorization.lockLiveHumanPersonalCredential(db, principal);
      await this.authorization.assertLiveHumanCredential(db, principal, ['pages:write']);
      await lockSpaceBoundary();
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "Space" WHERE "id" = ${spaceId} FOR SHARE`);
      await db.$queryRaw(Prisma.sql`SELECT "id" FROM "SpaceMember" WHERE "spaceId" = ${spaceId} AND "userId" = ${principal.userId} FOR SHARE`);
      await this.authorization.assertLiveHumanSpaceAccess(db, principal, spaceId, READ_ROLES, { requireSpaceMembership: true });
    }
    const pages = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Page" WHERE "id" = ${pageId} AND "spaceId" = ${spaceId} AND "deletedAt" IS NULL FOR UPDATE
    `);
    if (pages.length !== 1) throw new BusinessException('RESOURCE_NOT_FOUND', 'Page not found');
  }

  private async ownNote(db: Prisma.TransactionClient, principal: Principal, spaceId: string, pageId: string, noteId: string, expectedUpdatedAt: string) {
    const note = await db.pageNote.findFirst({ where: { id: noteId, spaceId, pageId, deletedAt: null } });
    if (!note) throw new BusinessException('RESOURCE_NOT_FOUND', 'Page note not found');
    const author = identity(principal);
    if (note.authorType !== author.authorType || note.authorId !== author.authorId) {
      throw new BusinessException('SPACE_ACCESS_DENIED', 'Only the note author can change this note');
    }
    if (note.updatedAt.getTime() !== Date.parse(expectedUpdatedAt)) {
      throw new BusinessException('RESOURCE_CONFLICT', 'The note changed; reload before editing');
    }
    return note;
  }

  private project(note: PageNote, principal: Principal, canWrite: boolean) {
    const author = identity(principal);
    return {
      id: note.id, spaceId: note.spaceId, pageId: note.pageId, body: note.body, target: note.target,
      status: note.status, ...(note.taskId ? { taskId: note.taskId } : {}),
      author: { type: note.authorType, id: note.authorId, name: note.authorName },
      createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(),
      canEdit: canWrite && note.authorType === author.authorType && note.authorId === author.authorId,
      ...(note.authorType === author.authorType && note.authorId === author.authorId ? { clientNoteId: note.clientNoteId } : {}),
    };
  }
}
