import { Injectable, Optional } from '@nestjs/common';
import { PageNote, Prisma } from '@prisma/client';
import { AuthorizationService, Principal, SpaceRole } from '../core/authorization/authorization.service';
import { BusinessException } from '../core/filters/business-error';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import type { PageNoteRecipientSummary } from '../notifications/notification.schema';
import { NOTE_CREATE, NOTE_DELETE, NOTE_ID, NOTE_ROUTE, NOTE_UPDATE, parseNoteInput, parseNoteDiscoveryQuery } from './page-note.schema';
import { decodeNoteDiscoveryCursor, encodeNoteDiscoveryCursor, noteDiscoveryScope } from './page-note-discovery.cursor';

const READ_ROLES: SpaceRole[] = ['owner', 'admin', 'editor', 'viewer'];
const identity = (principal: Principal) => principal.agentId
  ? { authorType: 'agent', authorId: principal.agentId }
  : { authorType: 'user', authorId: principal.userId };
interface DiscoveryRow extends PageNote {
  pageTitle: string;
  folderPath: string | null;
  spaceName: string;
  canWrite: boolean;
}

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
      include: { recipients: { orderBy: { createdAt: 'asc' }, include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    return { notes: rows.map(note => this.project(note, principal, canCreate)), canCreate };
  }

  async discover(principal: Principal, raw: unknown) {
    const query = parseNoteDiscoveryQuery(raw);
    const scope = noteDiscoveryScope(principal, query);
    const cursor = decodeNoteDiscoveryCursor(query.cursor, scope);
    // The authorization, total, result page and recipient projection share one
    // database snapshot. A later request always rechecks current live access.
    return this.prisma.$transaction(async db => {
      const user = await db.user.findFirst({
        where: { id: principal.userId, type: 'human', deletedAt: null, lockedAt: null },
        select: { platformRole: true },
      });
      if (!user) throw new BusinessException('SPACE_ACCESS_DENIED');
      const liveUser = Prisma.sql`EXISTS (SELECT 1 FROM "User" u WHERE u."id" = ${principal.userId}
        AND u."type" = 'human' AND u."deletedAt" IS NULL AND u."lockedAt" IS NULL)`;
      const membership = Prisma.sql`EXISTS (SELECT 1 FROM "SpaceMember" m
        WHERE m."spaceId" = s."id" AND m."userId" = ${principal.userId}
        AND m."role" IN ('owner', 'admin', 'editor', 'viewer'))`;
      let access: Prisma.Sql;
      let canWrite: Prisma.Sql;
      if (principal.agentId) {
        const credential = principal.credentialId && await db.agentCredential.findFirst({ where: {
          id: principal.credentialId, agentId: principal.agentId, revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          agent: { ownerId: principal.userId, status: 'active', revokedAt: null },
        }, select: { id: true } });
        if (!credential) throw new BusinessException('SPACE_ACCESS_DENIED');
        const liveAgent = Prisma.sql`EXISTS (SELECT 1 FROM "Agent" a JOIN "AgentCredential" c ON c."agentId" = a."id"
          WHERE a."id" = ${principal.agentId} AND a."ownerId" = ${principal.userId} AND a."status" = 'active'
          AND a."revokedAt" IS NULL AND c."id" = ${principal.credentialId} AND c."revokedAt" IS NULL
          AND (c."expiresAt" IS NULL OR c."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))`;
        access = Prisma.sql`${liveAgent} AND EXISTS (SELECT 1 FROM "AgentGrant" g
          WHERE g."spaceId" = s."id" AND g."agentId" = ${principal.agentId}
          AND g."role"::text IN ('reader', 'editor', 'publisher'))`;
        canWrite = Prisma.sql`EXISTS (SELECT 1 FROM "AgentGrant" g WHERE g."spaceId" = s."id"
          AND g."agentId" = ${principal.agentId} AND g."role"::text IN ('editor', 'publisher'))`;
      } else {
        await this.authorization.assertLiveHumanCredential(db, principal, ['pages:read']);
        const credentialRead = principal.credentialId ? Prisma.sql`EXISTS (SELECT 1 FROM "ApiKeyCredential" c
          WHERE c."id" = ${principal.credentialId} AND c."userId" = ${principal.userId} AND c."revokedAt" IS NULL
          AND (c."expiresAt" IS NULL OR c."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          AND c."scopes" && ARRAY['*', 'pages:read']::text[])` : Prisma.sql`TRUE`;
        const credentialWrite = principal.credentialId ? Prisma.sql`EXISTS (SELECT 1 FROM "ApiKeyCredential" c
          WHERE c."id" = ${principal.credentialId} AND c."userId" = ${principal.userId} AND c."revokedAt" IS NULL
          AND (c."expiresAt" IS NULL OR c."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          AND c."scopes" && ARRAY['*', 'pages:write']::text[])` : Prisma.sql`TRUE`;
        access = Prisma.sql`${credentialRead} AND (${membership} OR ${user.platformRole === 'super_admin'})`;
        canWrite = Prisma.sql`${membership} AND ${credentialWrite}`;
      }
      const predicates: Prisma.Sql[] = [Prisma.sql`n."deletedAt" IS NULL AND p."deletedAt" IS NULL AND s."deletedAt" IS NULL`, liveUser, access];
      if (query.spaceId) predicates.push(Prisma.sql`n."spaceId" = ${query.spaceId}`);
      if (query.author === 'me') {
        const author = identity(principal);
        predicates.push(Prisma.sql`n."authorType" = ${author.authorType} AND n."authorId" = ${author.authorId}`);
      } else if (query.author === 'mentioned') {
        // Mentions target humans, never the human owner of an Agent principal.
        predicates.push(principal.agentId ? Prisma.sql`FALSE` : Prisma.sql`EXISTS (SELECT 1 FROM "PageNoteRecipient" r
          WHERE r."noteId" = n."id" AND r."userId" = ${principal.userId})`);
      }
      if (query.status !== 'all') predicates.push(query.status === 'resolved' ? Prisma.sql`n."status" = 'resolved'` : Prisma.sql`n."status" <> 'resolved'`);
      if (query.query) predicates.push(Prisma.sql`(strpos(lower(n."body"), lower(${query.query})) > 0
        OR strpos(lower(COALESCE(n."target"->>'quote', '')), lower(${query.query})) > 0
        OR strpos(lower(p."title"), lower(${query.query})) > 0)`);
      const where = Prisma.join(predicates.map(predicate => Prisma.sql`(${predicate})`), ' AND ');
      const from = Prisma.sql`FROM "PageNote" n JOIN "Page" p ON p."id" = n."pageId" AND p."spaceId" = n."spaceId"
        JOIN "Space" s ON s."id" = p."spaceId"
        LEFT JOIN "Folder" f ON f."id" = p."folderId" AND f."spaceId" = p."spaceId" AND f."deletedAt" IS NULL`;
      // Prisma DateTime columns are timestamp without time zone. Bind the UTC
      // text explicitly, avoiding session-TimeZone casts from timestamptz.
      const after = cursor ? Prisma.sql`(n."updatedAt" < ${cursor.updatedAt.toISOString()}::timestamp
        OR (n."updatedAt" = ${cursor.updatedAt.toISOString()}::timestamp AND n."id" < ${cursor.id}))` : Prisma.sql`TRUE`;
      // A count can stay constant while one readable Space is revoked and
      // another gains notes. Let clients invalidate accumulated pages on access
      // changes without disclosing the underlying Space ids.
      const [accessState] = await db.$queryRaw<Array<{ revision: string }>>(Prisma.sql`
        SELECT md5(COALESCE(jsonb_agg(s."id" ORDER BY s."id")::text, '[]')) AS revision FROM "Space" s
        WHERE s."deletedAt" IS NULL AND ${liveUser} AND (${access})
          AND ${query.spaceId ? Prisma.sql`s."id" = ${query.spaceId}` : Prisma.sql`TRUE`}`);
      const [count] = await db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT COUNT(*) AS total ${from} WHERE ${where}`);
      const rows = await db.$queryRaw<DiscoveryRow[]>(Prisma.sql`SELECT n.*, p."title" AS "pageTitle", f."path" AS "folderPath",
        s."name" AS "spaceName", (${canWrite}) AS "canWrite" ${from} WHERE ${where} AND ${after}
        ORDER BY n."updatedAt" DESC, n."id" DESC LIMIT ${query.limit + 1}`);
      const page = rows.slice(0, query.limit);
      const recipients = page.length ? await db.pageNoteRecipient.findMany({
        where: { noteId: { in: page.map(note => note.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: { id: true, name: true, email: true } } },
      }) : [];
      return {
        notes: page.map(note => ({
          ...this.project({ ...note, recipients: recipients.filter(recipient => recipient.noteId === note.id) }, principal, note.canWrite),
          page: { id: note.pageId, title: note.pageTitle, folderPath: note.folderPath?.split('/').slice(1) ?? [] },
          space: { id: note.spaceId, name: note.spaceName },
        })),
        total: Number(count.total),
        nextCursor: rows.length > query.limit ? encodeNoteDiscoveryCursor(page[page.length - 1], scope) : null,
        accessRevision: accessState.revision,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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
      let recipients: PageNoteRecipientSummary[] = [];
      if (this.notifications && input.recipientUserIds?.length) {
        const page = await db.page.findUnique({ where: { id: pageId }, select: { title: true } });
        recipients = await this.notifications.createPageNoteNotifications(db, {
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
      return this.project(note, principal, true, recipients);
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

  private project(note: PageNote & { recipients?: Array<{ userId: string; user: { id: string; name: string | null; email: string } }> }, principal: Principal, canWrite: boolean, createdRecipients?: PageNoteRecipientSummary[]) {
    const author = identity(principal);
    return {
      id: note.id, spaceId: note.spaceId, pageId: note.pageId, body: note.body, target: note.target,
      status: note.status, ...(note.taskId ? { taskId: note.taskId } : {}),
      author: { type: note.authorType, id: note.authorId, name: note.authorName },
      createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString(),
      canEdit: canWrite && note.authorType === author.authorType && note.authorId === author.authorId,
      recipients: createdRecipients ?? note.recipients?.map(recipient => ({
        userId: recipient.user.id,
        name: recipient.user.name?.trim() || recipient.user.email,
        email: recipient.user.email,
      })) ?? [],
      ...(note.authorType === author.authorType && note.authorId === author.authorId ? { clientNoteId: note.clientNoteId } : {}),
    };
  }
}
