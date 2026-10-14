import { PageNoteService } from './page-note.service';
import { BusinessException } from '../core/filters/business-error';
import { Principal } from '../core/authorization/authorization.service';

export const human: Principal = { userId: 'user-1' };
export const agent: Principal = { userId: 'user-1', agentId: 'agent-1', credentialId: 'credential-1' };
export const target = { kind: 'selection', from: 3, to: 8, quote: 'hello', prefix: 'abc', suffix: 'def', baseUpdatedAt: '2026-01-01T00:00:00.000Z' };
export const input = { clientNoteId: 'local-1', body: 'A shared annotation', target };

export function setupNotes() {
  const rows: any[] = [];
  let counter = 0;
  const denied = () => new BusinessException('SPACE_ACCESS_DENIED');
  const access = { human: true, agent: true, member: true, role: 'editor', page: true, spaceId: 'space-1', credential: true };
  const authorization: any = {
    assertPageAccess: jest.fn(async (_p, pageId) => {
      if (!access.human || !access.agent) throw denied();
      if (!access.page || pageId !== 'page-1') throw new BusinessException('RESOURCE_NOT_FOUND');
      return { id: pageId, spaceId: access.spaceId };
    }),
    assertSpaceAccess: jest.fn(async p => p.agentId ? { role: access.role } : access.member ? { id: 'membership', role: 'viewer' } : { role: 'viewer' }),
    assertLiveAgentAccess: jest.fn(async () => { if (!access.agent) throw denied(); }),
    assertLiveAgentWriteAccess: jest.fn(async () => { if (!access.agent || access.role === 'reader') throw denied(); }),
    lockLiveAgentWriteAccessAcrossSpaceBoundary: jest.fn(async (_db, _principal, _spaceId, _scopes, lock) => {
      if (!access.agent || access.role === 'reader') throw denied();
      await lock();
      if (!access.agent || access.role === 'reader') throw denied();
    }),
    assertLiveHumanCredential: jest.fn(async () => { if (!access.credential) throw denied(); }),
    lockLiveHumanPrincipal: jest.fn(async () => { if (!access.human) throw denied(); }),
    lockLiveHumanPersonalCredential: jest.fn(async () => { if (!access.credential) throw denied(); }),
    assertLiveHumanSpaceAccess: jest.fn(async () => { if (!access.member || !access.human) throw denied(); }),
  };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value);
  const db: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async sql => String(sql.strings).includes('FROM "Page"') ? access.page ? [{ id: 'page-1' }] : [] : [{ id: 'lock' }]),
    user: { findUnique: jest.fn(async () => ({ name: 'Alice' })) },
    agent: { findUnique: jest.fn(async () => ({ name: 'Codex' })) },
    apiKeyCredential: { findUnique: jest.fn(async () => ({ scopes: ['*'] })) },
    pageNote: {
      findMany: jest.fn(async ({ where }) => rows.filter(row => matches(row, where))),
      findUnique: jest.fn(async ({ where }) => rows.find(row => matches(row, where.pageId_authorType_authorId_clientNoteId)) ?? null),
      findFirst: jest.fn(async ({ where }) => rows.find(row => matches(row, where)) ?? null),
      create: jest.fn(async ({ data }) => {
        const note = { ...data, id: `note-${++counter}`, createdAt: new Date('2026-10-14T00:00:00.000Z'), updatedAt: new Date('2026-10-14T00:00:00.000Z'), deletedAt: null };
        rows.push(note); return note;
      }),
      update: jest.fn(async ({ where, data }) => { const row = rows.find(row => row.id === where.id); Object.assign(row, data); return row; }),
    },
  };
  db.$transaction = jest.fn(async run => run(db));
  const service = new PageNoteService(db, authorization);
  return { service, authorization, db, rows, access };
}
