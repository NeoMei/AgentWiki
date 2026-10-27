import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthorizationService, Principal } from '../core/authorization/authorization.service';
import { PageNoteService } from './page-note.service';

const databaseUrl = process.env.COLLABORATION_TEST_DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : undefined;
const safe = databaseUrl === process.env.DATABASE_URL && parsed
  && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  && decodeURIComponent(parsed.pathname).includes('test')
  && /^collaboration_test_[a-z0-9_]+$/.test(parsed.searchParams.get('schema') ?? '');
const dbDescribe = safe ? describe : describe.skip;

interface DiscoveryResult {
  notes: Array<{ id: string; pageId: string; spaceId: string; body: string; canEdit: boolean; clientNoteId?: string;
    page: { id: string; title: string; folderPath: string[] }; space: { id: string; name: string } }>;
  total: number;
  nextCursor: string | null;
  accessRevision: string;
}

dbDescribe('page note discovery in real PostgreSQL', () => {
  let db: PrismaClient;
  let service: PageNoteService;
  let ownerId: string;
  let otherId: string;
  let spaceId: string;
  let secondSpaceId: string;
  let hiddenSpaceId: string;
  let pageId: string;
  let secondPageId: string;
  let otherSpacePageId: string;
  let hiddenPageId: string;
  let sequence: number;
  let prefix: string;
  const time = new Date('2026-10-28T01:00:00.000Z');
  const discover = (principal: Principal = { userId: ownerId }, query: Record<string, unknown> = {}): Promise<DiscoveryResult> =>
    (service as unknown as { discover(p: Principal, q: unknown): Promise<DiscoveryResult> }).discover(principal, query);

  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    service = new PageNoteService(db as any, new AuthorizationService(db as any));
  });
  beforeEach(async () => {
    prefix = randomUUID(); sequence = 0;
    ownerId = (await db.user.create({ data: { email: `${prefix}@notes.test`, name: 'Notes reader' } })).id;
    otherId = (await db.user.create({ data: { email: `other-${prefix}@notes.test`, name: 'Other reader' } })).id;
    const makeSpace = (name: string, member: string) => db.space.create({ data: {
      name, slug: randomUUID(), members: { create: { userId: member, role: 'viewer' } },
    } });
    spaceId = (await makeSpace('First space', ownerId)).id;
    secondSpaceId = (await makeSpace('Second space', ownerId)).id;
    hiddenSpaceId = (await makeSpace('Hidden space', otherId)).id;
    const makePage = (space: string, title: string) => {
      const slug = randomUUID();
      return db.page.create({ data: { spaceId: space, title, slug, authorId: ownerId, syncPath: `${slug}.md`, syncPathKey: `${slug}.md` } });
    };
    pageId = (await makePage(spaceId, 'Rare_% specification')).id;
    secondPageId = (await makePage(spaceId, 'Second page')).id;
    otherSpacePageId = (await makePage(secondSpaceId, 'Another space page')).id;
    hiddenPageId = (await makePage(hiddenSpaceId, 'Hidden page')).id;
  });
  afterEach(async () => {
    await db.page.deleteMany({ where: { spaceId: { in: [spaceId, secondSpaceId, hiddenSpaceId] } } });
    await db.folder.deleteMany({ where: { spaceId: { in: [spaceId, secondSpaceId, hiddenSpaceId] } } });
    await db.space.deleteMany({ where: { id: { in: [spaceId, secondSpaceId, hiddenSpaceId] } } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  });
  afterAll(async () => { await db?.$disconnect(); });

  const note = (data: Record<string, unknown> = {}) => db.pageNote.create({ data: {
    id: `${prefix}-${String(++sequence).padStart(3, '0')}`, pageId, spaceId,
    authorType: 'user', authorId: ownerId, authorName: 'Notes reader', clientNoteId: randomUUID(),
    body: 'General annotation', target: { kind: 'selection', quote: 'Original Quotation' },
    createdAt: time, updatedAt: time, ...data,
  } as any });

  const inTimeZone = (zone: string) => new PageNoteService({
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      db.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('TimeZone', ${zone}, true)`);
        return run(tx);
      }, options),
  } as any, new AuthorizationService(db as any));
  const emptyResult = { notes: [], total: 0, nextCursor: null, accessRevision: expect.stringMatching(/^[a-f0-9]{32}$/) };

  it('returns cross-page sources with folder breadcrumbs and shared author permissions', async () => {
    const parent = await db.folder.create({ data: { spaceId, name: 'Guides', nameKey: 'guides', path: 'pages/Guides', pathKey: 'pages/guides', createdByUserId: ownerId, lastModifiedByUserId: ownerId } });
    const child = await db.folder.create({ data: { spaceId, parentId: parent.id, name: 'Specs', nameKey: 'specs', path: 'pages/Guides/Specs', pathKey: 'pages/guides/specs', createdByUserId: ownerId, lastModifiedByUserId: ownerId } });
    await db.page.update({ where: { id: pageId }, data: { folderId: child.id } });
    const own = await note();
    const shared = await note({ pageId: secondPageId, authorId: otherId, authorName: 'Other reader' });
    const result = await discover();
    expect(result.total).toBe(2);
    expect(result.nextCursor).toBeNull();
    expect(result.notes.map(row => row.pageId)).toEqual([secondPageId, pageId]);
    expect(result.notes[0]).toMatchObject({ id: shared.id, canEdit: false, page: { id: secondPageId, title: 'Second page', folderPath: [] }, space: { id: spaceId, name: 'First space' } });
    expect(result.notes[0]).not.toHaveProperty('clientNoteId');
    expect(result.notes[1]).toMatchObject({ id: own.id, canEdit: true, page: { folderPath: ['Guides', 'Specs'] } });
  });

  it('scopes current-space and all-space reads without exposing even self-authored inaccessible notes', async () => {
    const first = await note();
    const second = await note({ pageId: otherSpacePageId, spaceId: secondSpaceId });
    await note({ pageId: hiddenPageId, spaceId: hiddenSpaceId, body: 'Hidden self-authored note' });
    expect((await discover()).notes.map(row => row.id)).toEqual([second.id, first.id]);
    expect((await discover(undefined, { spaceId })).notes.map(row => row.id)).toEqual([first.id]);
    expect(await discover(undefined, { spaceId: hiddenSpaceId, author: 'me' })).toEqual(emptyResult);
  });

  it('searches body, original quote and page title case-insensitively with literal punctuation', async () => {
    const body = await note({ pageId: secondPageId, body: 'Literal %_\' BODY token', target: { quote: 'Unrelated' } });
    const quote = await note({ pageId: secondPageId, body: 'Elsewhere', target: { quote: 'MixedCase Quotation' } });
    const title = await note({ body: 'Elsewhere', target: { quote: 'Unrelated' } });
    for (const [query, id] of [["%_' body", body.id], ['mixedcase quotation', quote.id], ['rare_% SPEC', title.id]]) {
      const result = await discover(undefined, { query });
      expect(result.total).toBe(1); expect(result.notes.map(row => row.id)).toEqual([id]);
    }
    expect((await discover(undefined, { query: 'not present' })).total).toBe(0);
  });

  it('filters self-authored and mentioned notes without changing shared-note visibility', async () => {
    const own = await note();
    const mentioned = await note({ authorId: otherId, authorName: 'Other reader' });
    await note({ authorId: otherId, authorName: 'Other reader' });
    await db.pageNoteRecipient.create({ data: { noteId: mentioned.id, userId: ownerId } });
    expect((await discover(undefined, { author: 'me' })).notes.map(row => row.id)).toEqual([own.id]);
    expect((await discover(undefined, { author: 'mentioned' })).notes.map(row => row.id)).toEqual([mentioned.id]);
    expect((await discover()).total).toBe(3);
  });

  it('includes dispatched/review notes in open and keeps resolved notes discoverable', async () => {
    const pending = await note();
    const dispatched = await note({ status: 'dispatched' });
    const review = await note({ status: 'awaiting-review' });
    const resolved = await note({ status: 'resolved' });
    expect((await discover(undefined, { status: 'open' })).notes.map(row => row.id)).toEqual([review.id, dispatched.id, pending.id]);
    expect((await discover(undefined, { status: 'resolved' })).notes.map(row => row.id)).toEqual([resolved.id]);
    expect((await discover()).total).toBe(4);
  });

  it('paginates ties deterministically with a filter-bound cursor and an uncapped total', async () => {
    const first = await note(), second = await note({ pageId: secondPageId }), third = await note({ pageId: secondPageId });
    const page = await discover(undefined, { limit: '2' });
    expect(page.total).toBe(3); expect(page.nextCursor).not.toBeNull();
    expect(page.notes.map(row => row.id)).toEqual([third.id, second.id]);
    const next = await discover(undefined, { limit: '2', cursor: page.nextCursor });
    expect(next.total).toBe(3); expect(next.nextCursor).toBeNull();
    expect(next.notes.map(row => row.id)).toEqual([first.id]);
    await expect(discover(undefined, { cursor: page.nextCursor, author: 'me' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(discover({ userId: otherId }, { cursor: page.nextCursor })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])('keeps cursor positions independent of PostgreSQL session timezone %s', async zone => {
    const first = await note(), second = await note(), third = await note();
    const zoned = inTimeZone(zone);
    const page = await zoned.discover({ userId: ownerId }, { limit: 2 });
    expect(page.notes.map(row => row.id)).toEqual([third.id, second.id]);
    const next = await zoned.discover({ userId: ownerId }, { limit: 2, cursor: page.nextCursor });
    expect(next.total).toBe(3); expect(next.notes.map(row => row.id)).toEqual([first.id]);
    expect(next.nextCursor).toBeNull();
  });

  it.each(['UTC', 'Asia/Shanghai', 'America/Los_Angeles'])('keeps live PAT and Agent expiration independent of PostgreSQL timezone %s', async zone => {
    await note();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const pat = await db.apiKeyCredential.create({ data: { userId: ownerId, name: 'Test', prefix: prefix.slice(0, 8), keyHash: randomUUID(), scopes: ['*'], expiresAt } });
    const agent = await db.agent.create({ data: { ownerId, name: 'Expiring Agent' } });
    const credential = await db.agentCredential.create({ data: { agentId: agent.id, name: 'Test', prefix: prefix.slice(0, 8), keyHash: randomUUID(), expiresAt } });
    await db.agentGrant.create({ data: { agentId: agent.id, spaceId, role: 'reader' } });
    const zoned = inTimeZone(zone);
    expect((await zoned.discover({ userId: ownerId, credentialId: pat.id }, {})).total).toBe(1);
    expect((await zoned.discover({ userId: ownerId, agentId: agent.id, credentialId: credential.id }, {})).total).toBe(1);
  });

  it('excludes deleted notes, pages, spaces and revoked membership from results and counts', async () => {
    const visible = await note();
    await note({ deletedAt: time });
    await note({ pageId: secondPageId });
    await db.page.update({ where: { id: secondPageId }, data: { deletedAt: time } });
    await note({ spaceId: secondSpaceId, pageId: otherSpacePageId });
    await db.space.update({ where: { id: secondSpaceId }, data: { deletedAt: time } });
    await note({ spaceId: hiddenSpaceId, pageId: hiddenPageId });
    expect((await discover()).notes.map(row => row.id)).toEqual([visible.id]);
    expect((await discover()).total).toBe(1);
    await db.spaceMember.delete({ where: { userId_spaceId: { userId: ownerId, spaceId } } });
    expect(await discover(undefined, { author: 'me' })).toEqual(emptyResult);
    expect((await discover(undefined, { query: 'General', limit: 1 })).total).toBe(0);
  });

  it('changes the access revision when a revoked Space is replaced by new notes with the same total', async () => {
    const revoked = await note();
    const retained = await note({ spaceId: secondSpaceId, pageId: otherSpacePageId });
    const before = await discover(undefined, { limit: 1 });
    expect(before.total).toBe(2); expect(before.accessRevision).toMatch(/^[a-f0-9]{32}$/);
    expect((await discover(undefined, { author: 'me', query: 'annotation' })).accessRevision).toBe(before.accessRevision);
    await db.spaceMember.delete({ where: { userId_spaceId: { userId: ownerId, spaceId } } });
    const added = await note({ spaceId: secondSpaceId, pageId: otherSpacePageId });
    const after = await discover(undefined, { limit: 1, cursor: before.nextCursor });
    expect(after.total).toBe(2); expect(after.accessRevision).not.toBe(before.accessRevision);
    const refreshed = await discover();
    expect(refreshed.notes.map(row => row.id)).toEqual([added.id, retained.id]);
    expect(refreshed.notes.some(row => row.id === revoked.id)).toBe(false);
    expect(refreshed.accessRevision).toBe(after.accessRevision);
  });

  it('enforces live personal credentials and does not claim write permission for read-only PATs', async () => {
    await note();
    const credential = await db.apiKeyCredential.create({ data: { userId: ownerId, name: 'Test', prefix: prefix.slice(0, 8), keyHash: randomUUID(), scopes: ['pages:read'] } });
    const principal = { userId: ownerId, credentialId: credential.id, scopes: ['*'] };
    expect((await discover(principal)).notes[0].canEdit).toBe(false);
    await db.apiKeyCredential.update({ where: { id: credential.id }, data: { scopes: ['*'] } });
    expect((await discover(principal)).notes[0].canEdit).toBe(true);
    await db.apiKeyCredential.update({ where: { id: credential.id }, data: { scopes: ['pages:write'] } });
    await expect(discover(principal)).rejects.toThrow();
    await db.apiKeyCredential.update({ where: { id: credential.id }, data: { scopes: ['*'], expiresAt: new Date('2020-01-01') } });
    await expect(discover(principal)).rejects.toThrow();
    await db.apiKeyCredential.update({ where: { id: credential.id }, data: { expiresAt: null, revokedAt: new Date() } });
    await expect(discover(principal)).rejects.toThrow();
  });

  it('uses each live Agent grant and its own author identity instead of the owner membership or mentions', async () => {
    const agent = await db.agent.create({ data: { ownerId, name: 'Discovery Agent' } });
    const credential = await db.agentCredential.create({ data: { agentId: agent.id, name: 'Test', prefix: prefix.slice(0, 8), keyHash: randomUUID() } });
    await db.agentGrant.create({ data: { agentId: agent.id, spaceId, role: 'reader' } });
    const humanNote = await note();
    const own = await note({ authorType: 'agent', authorId: agent.id, authorName: agent.name });
    await note({ pageId: otherSpacePageId, spaceId: secondSpaceId, authorType: 'agent', authorId: agent.id });
    await db.pageNoteRecipient.create({ data: { noteId: humanNote.id, userId: ownerId } });
    const principal = { userId: ownerId, agentId: agent.id, credentialId: credential.id };
    const result = await discover(principal);
    expect(result.total).toBe(2); expect(result.notes.every(row => !row.canEdit)).toBe(true);
    expect((await discover(principal, { author: 'me' })).notes.map(row => row.id)).toEqual([own.id]);
    expect(await discover(principal, { author: 'mentioned' })).toEqual(emptyResult);
    await db.agentGrant.update({ where: { agentId_spaceId: { agentId: agent.id, spaceId } }, data: { role: 'editor' } });
    expect((await discover(principal, { author: 'me' })).notes[0].canEdit).toBe(true);
    await db.agentGrant.delete({ where: { agentId_spaceId: { agentId: agent.id, spaceId } } });
    expect(await discover(principal)).toEqual(emptyResult);
    await db.agentCredential.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
    await expect(discover(principal)).rejects.toThrow();
  });

  it('rejects locked/deleted users and revoked or incorrectly owned Agents even with old principal hints', async () => {
    await note();
    await db.user.update({ where: { id: ownerId }, data: { lockedAt: new Date() } });
    await expect(discover()).rejects.toThrow();
    await db.user.update({ where: { id: ownerId }, data: { lockedAt: null, deletedAt: new Date() } });
    await expect(discover()).rejects.toThrow();
    await db.user.update({ where: { id: ownerId }, data: { deletedAt: null } });
    const agent = await db.agent.create({ data: { ownerId, name: 'Revocable Agent' } });
    const credential = await db.agentCredential.create({ data: { agentId: agent.id, name: 'Test', prefix: prefix.slice(0, 8), keyHash: randomUUID() } });
    await db.agentGrant.create({ data: { agentId: agent.id, spaceId, role: 'publisher' } });
    const principal = { userId: ownerId, agentId: agent.id, credentialId: credential.id };
    await expect(discover({ ...principal, userId: otherId })).rejects.toThrow();
    await expect(discover({ ...principal, credentialId: undefined })).rejects.toThrow();
    await db.agentCredential.update({ where: { id: credential.id }, data: { expiresAt: new Date('2020-01-01') } });
    await expect(discover(principal)).rejects.toThrow();
    await db.agentCredential.update({ where: { id: credential.id }, data: { expiresAt: null } });
    await db.agent.update({ where: { id: agent.id }, data: { revokedAt: new Date() } });
    await expect(discover(principal)).rejects.toThrow();
  });

  it('keeps platform inspection read-only without accepting a forged super-admin hint', async () => {
    const hidden = await note({ pageId: hiddenPageId, spaceId: hiddenSpaceId });
    expect((await discover({ userId: ownerId, platformRole: 'super_admin' })).total).toBe(0);
    await db.user.update({ where: { id: ownerId }, data: { platformRole: 'super_admin' } });
    const result = await discover();
    expect(result.notes.map(row => row.id)).toEqual([hidden.id]); expect(result.notes[0].canEdit).toBe(false);
  });

  it.each([
    { limit: 0 }, { limit: 51 }, { limit: '1.5' }, { limit: '' }, { limit: ['2'] },
    { query: 'x'.repeat(201) }, { query: ['x'] }, { author: 'someone' }, { status: 'pending' },
    { cursor: 'not-a-cursor' }, { cursor: 'a'.repeat(1025) }, { spaceId: '' }, { unexpected: 'field' },
  ])('rejects malformed or unbounded query parameters before querying notes: %j', async query => {
    await expect(discover(undefined, query)).rejects.toBeInstanceOf(BadRequestException);
  });
});
