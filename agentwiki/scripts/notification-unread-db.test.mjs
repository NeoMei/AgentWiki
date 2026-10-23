import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { withCollaborationTestDatabase } from './collaboration-test-database.mjs';

const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { PrismaClient } = requireFromServer('@prisma/client');
const { AuthorizationService } = requireFromServer('./dist/core/authorization/authorization.service.js');
const { NotificationService } = requireFromServer('./dist/notifications/notification.service.js');
const { parseNotificationListQuery } = requireFromServer('./dist/notifications/notification.schema.js');

const baseDatabaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
if (!baseDatabaseUrl) throw new Error('COLLABORATION_TEST_DATABASE_URL is required');

// Use real Prisma filters and persisted readAt values. A mocked count can hide
// an API response that counts already-read history as unread notifications.
test('notification unread count and read transitions in real PostgreSQL', {
  timeout: 180_000,
}, async (t) => {
  await withCollaborationTestDatabase(baseDatabaseUrl, async ({ databaseUrl, schemaName }) => {
    assert.match(schemaName, /^collaboration_test_[a-z0-9_]+$/u);
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const service = new NotificationService(prisma, new AuthorizationService(prisma));
    const all = parseNotificationListQuery({});
    const unread = parseNotificationListQuery({ unreadOnly: 'true' });
    try {
      await t.test('keeps already-read history while reporting zero unread, including a fresh client', async () => {
        const fixture = await createFixture(prisma);
        const readAt = new Date('2026-10-22T03:24:51.712Z');
        const row = await createNotification(prisma, fixture, { readAt });

        assert.deepEqual(await service.markAllRead(fixture.principal), { updated: 0 });
        const result = await service.list(fixture.principal, all);
        assert.equal(result.unreadCount, 0);
        assert.deepEqual(result.notifications.map(item => [item.id, item.readAt]), [[row.id, readAt.toISOString()]]);
        assert.deepEqual(await service.list(fixture.principal, unread), { unreadCount: 0, notifications: [] });

        const freshPrisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
        try {
          const freshService = new NotificationService(freshPrisma, new AuthorizationService(freshPrisma));
          assert.equal((await freshService.list(fixture.principal, all)).unreadCount, 0);
        } finally {
          await freshPrisma.$disconnect();
        }
      });

      await t.test('counts all unread notifications independently of list mode and pagination', async () => {
        const fixture = await createFixture(prisma);
        const unreadRows = [];
        for (let index = 0; index < all.limit + 3; index++) {
          unreadRows.push(await createNotification(prisma, fixture));
        }
        // A newer read item remains visible in All and must not raise the badge.
        const read = await createNotification(prisma, fixture, { readAt: new Date() });
        const defaultResult = await service.list(fixture.principal, all);
        assert.equal(defaultResult.notifications.length, all.limit);
        assert.equal(defaultResult.unreadCount, unreadRows.length);
        assert.equal(defaultResult.notifications[0].id, read.id);
        for (const query of [{ ...all, limit: 1 }, { ...unread, limit: 1 }]) {
          const result = await service.list(fixture.principal, query);
          assert.equal(result.notifications.length, 1);
          assert.equal(result.unreadCount, unreadRows.length);
          if (query.unreadOnly) assert.equal(result.notifications[0].readAt, null);
        }
      });

      await t.test('persists single/all read transitions and makes repeated operations idempotent', async () => {
        const fixture = await createFixture(prisma);
        const first = await createNotification(prisma, fixture);
        const second = await createNotification(prisma, fixture);
        assert.equal((await service.list(fixture.principal, all)).unreadCount, 2);
        assert.deepEqual(await service.markRead(fixture.principal, first.id), { updated: 1 });
        const firstReadAt = (await prisma.userNotification.findUniqueOrThrow({ where: { id: first.id } })).readAt;
        assert.ok(firstReadAt instanceof Date);
        assert.deepEqual(await service.markRead(fixture.principal, first.id), { updated: 0 });
        assert.equal((await service.list(fixture.principal, all)).unreadCount, 1);
        assert.deepEqual((await service.list(fixture.principal, unread)).notifications.map(item => item.id), [second.id]);
        assert.deepEqual(await service.markAllRead(fixture.principal), { updated: 1 });
        assert.deepEqual(await service.markAllRead(fixture.principal), { updated: 0 });
        assert.deepEqual(await service.markRead(fixture.principal, second.id), { updated: 0 });
        const result = await service.list(fixture.principal, all);
        assert.equal(result.unreadCount, 0);
        assert.equal(result.notifications.length, 2);
        assert.ok(result.notifications.every(item => item.readAt !== null));
        assert.equal((await prisma.userNotification.findUniqueOrThrow({ where: { id: first.id } })).readAt.toISOString(), firstReadAt.toISOString());
        assert.deepEqual(await service.list(fixture.principal, unread), { unreadCount: 0, notifications: [] });
      });

      await t.test('excludes other recipients, deleted pages/spaces, and revoked Space memberships', async () => {
        const fixture = await createFixture(prisma);
        const other = await prisma.user.create({ data: { email: `${randomUUID()}@notification.test` } });
        await prisma.spaceMember.create({ data: { userId: other.id, spaceId: fixture.space.id, role: 'viewer' } });
        const visibleUnread = await createNotification(prisma, fixture);
        const visibleRead = await createNotification(prisma, fixture, { readAt: new Date() });
        const otherRow = await createNotification(prisma, fixture, { recipientUserId: other.id });
        const deletedPage = await createPage(prisma, fixture, { deletedAt: new Date() });
        await createNotification(prisma, { ...fixture, page: deletedPage });
        const deletedSpace = await createSpace(prisma, fixture.principal.userId, { deletedAt: new Date() });
        const pageInDeletedSpace = await createPage(prisma, { ...fixture, space: deletedSpace });
        await createNotification(prisma, { ...fixture, space: deletedSpace, page: pageInDeletedSpace });
        const revokedSpace = await createSpace(prisma, fixture.principal.userId);
        const pageInRevokedSpace = await createPage(prisma, { ...fixture, space: revokedSpace });
        await createNotification(prisma, { ...fixture, space: revokedSpace, page: pageInRevokedSpace });
        await prisma.spaceMember.delete({ where: { userId_spaceId: { userId: fixture.principal.userId, spaceId: revokedSpace.id } } });

        const result = await service.list(fixture.principal, all);
        assert.equal(result.unreadCount, 1);
        assert.deepEqual(new Set(result.notifications.map(item => item.id)), new Set([visibleUnread.id, visibleRead.id]));
        assert.deepEqual((await service.list(fixture.principal, unread)).notifications.map(item => item.id), [visibleUnread.id]);
        assert.deepEqual(await service.markRead(fixture.principal, otherRow.id), { updated: 0 });
        assert.equal((await prisma.userNotification.findUniqueOrThrow({ where: { id: otherRow.id } })).readAt, null);
        await service.markAllRead(fixture.principal);
        assert.equal((await service.list(fixture.principal, all)).unreadCount, 0);
        assert.equal((await service.list({ userId: other.id }, all)).unreadCount, 1);
        assert.equal((await prisma.userNotification.findUniqueOrThrow({ where: { id: otherRow.id } })).readAt, null);
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});

async function createFixture(prisma) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@notification.test`, name: 'Notification Reader' } });
  const principal = { userId: user.id };
  const space = await createSpace(prisma, user.id);
  const fixture = { principal, space };
  return { ...fixture, page: await createPage(prisma, fixture) };
}

async function createSpace(prisma, userId, data = {}) {
  return prisma.space.create({ data: {
    name: 'Notification test Space', slug: randomUUID(),
    members: { create: { userId, role: 'owner' } },
    ...data,
  } });
}

async function createPage(prisma, fixture, data = {}) {
  const slug = randomUUID();
  return prisma.page.create({ data: {
    title: 'Notification test Page', slug, spaceId: fixture.space.id,
    authorId: fixture.principal.userId, syncPath: `${slug}.md`, syncPathKey: `${slug}.md`,
    ...data,
  } });
}

let notificationSequence = 0;
async function createNotification(prisma, fixture, data = {}) {
  const note = await prisma.pageNote.create({ data: {
    pageId: fixture.page.id, spaceId: fixture.space.id,
    authorType: 'user', authorId: fixture.principal.userId, authorName: 'Notification Reader',
    clientNoteId: randomUUID(), body: 'Notification regression fixture', target: {},
  } });
  return prisma.userNotification.create({ data: {
    recipientUserId: fixture.principal.userId, actorUserId: fixture.principal.userId,
    spaceId: fixture.space.id, pageId: fixture.page.id, pageNoteId: note.id,
    type: 'page_note_mention', title: fixture.page.title,
    body: note.body, payload: {},
    createdAt: new Date(Date.UTC(2026, 9, 22) + notificationSequence++ * 1000),
    ...data,
  } });
}
