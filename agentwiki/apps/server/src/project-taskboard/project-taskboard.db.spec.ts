import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { SpaceService } from '../core/space/space.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';
import { getBusinessCode } from '../core/filters/business-error';
import { ProjectTaskboardService } from './project-taskboard.service';

const databaseUrl = process.env.TASKBOARD_TEST_DATABASE_URL;
const dbIt = databaseUrl ? it : it.skip;

function client() {
  const url = new URL(databaseUrl!);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/agentwiki_taskboard_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error('Taskboard tests require a dedicated local agentwiki_taskboard_* database');
  }
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

function service(prisma: PrismaClient) {
  return new ProjectTaskboardService(prisma as any, new AuthorizationService(prisma as any), {
    publish: async () => undefined,
  } as any);
}

async function fixture(prisma: PrismaClient) {
  const suffix = randomUUID();
  const userId = `taskboard-owner-${suffix}`;
  const collaboratorId = `taskboard-editor-${suffix}`;
  const spaceId = `taskboard-space-${suffix}`;
  await prisma.user.create({ data: { id: userId, email: `${suffix}@taskboard.test` } });
  await prisma.user.create({ data: { id: collaboratorId, email: `editor-${suffix}@taskboard.test` } });
  await prisma.space.create({ data: { id: spaceId, name: 'Taskboard integration test', slug: `taskboard-${suffix}` } });
  await prisma.spaceMember.create({ data: { userId, spaceId, role: 'owner' } });
  await prisma.spaceMember.create({ data: { userId: collaboratorId, spaceId, role: 'editor' } });
  return { principal: { userId }, collaborator: { userId: collaboratorId }, spaceId, cleanup: async () => {
    await prisma.space.delete({ where: { id: spaceId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.user.delete({ where: { id: collaboratorId } });
  } };
}

describe('taskboard PostgreSQL deletion', () => {
  dbIt('rejects a queued editor write after membership removal commits', async () => {
    const first = client(), second = client();
    const data = await fixture(first);
    let reportRemoval!: () => void, releaseRemoval!: () => void;
    const removalStarted = new Promise<void>((resolve) => { reportRemoval = resolve; });
    const removalReleased = new Promise<void>((resolve) => { releaseRemoval = resolve; });
    const heldClient = first.$extends({ query: { spaceMember: {
      async delete({ args, query }) {
        const row = await query(args);
        reportRemoval();
        await removalReleased;
        return row;
      },
    } } });
    const spaces = new SpaceService(heldClient as any, new SpaceRevisionWriterService(heldClient as any, undefined as any),
      new AuthorizationService(heldClient as any));
    let removing: Promise<unknown> | undefined, creating: Promise<unknown> | undefined;
    try {
      removing = spaces.removeMemberAs(data.spaceId, data.collaborator.userId, data.principal);
      await removalStarted;
      // The eager check still sees the committed membership; the transaction
      // must wait for the Space lock and recheck after removal commits.
      creating = service(second).createTask(data.collaborator, data.spaceId, { id: 'denied', title: 'Must not write' })
        .then(() => 'created', (error: unknown) => getBusinessCode(error));
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await first.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      releaseRemoval();
      await removing;
      expect(await creating).toBe('SPACE_ACCESS_DENIED');
      expect(await first.projectBoard.count({ where: { spaceId: data.spaceId } })).toBe(0);
      expect(await first.projectBoardTask.count()).toBe(0);
      expect(await first.projectBoardEvent.count()).toBe(0);
    } finally {
      releaseRemoval();
      await Promise.allSettled([removing, creating]);
      await data.cleanup();
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);

  dbIt('merges concurrent first imports after waiting for the same board lock', async () => {
    const first = client(), second = client();
    const data = await fixture(first);
    let reportRead!: () => void, releaseRead!: () => void;
    const readStarted = new Promise<void>((resolve) => { reportRead = resolve; });
    const readReleased = new Promise<void>((resolve) => { releaseRead = resolve; });
    let pause = true;
    const heldClient = first.$extends({ query: { projectBoard: {
      async findUnique({ args, query }) {
        const row = await query(args);
        if (pause) { pause = false; reportRead(); await readReleased; }
        return row;
      },
    } } });
    let importing: Promise<unknown> | undefined, concurrent: Promise<unknown> | undefined;
    try {
      importing = service(heldClient as unknown as PrismaClient).importPlan(data.principal, data.spaceId, {
        content: JSON.stringify({ tasks: [{ id: 'first', title: 'First', kind: 'task' }] }), sourcePath: 'first.json',
      });
      await readStarted;
      concurrent = service(second).importPlan(data.collaborator, data.spaceId, {
        content: JSON.stringify({ tasks: [{ id: 'second', title: 'Second', kind: 'task' }] }), sourcePath: 'second.json',
      }).then(() => 'imported', (error: unknown) => error);
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await first.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      releaseRead();
      await importing;
      expect(await concurrent).toBe('imported');
      const board = await first.projectBoard.findUniqueOrThrow({ where: { spaceId: data.spaceId } });
      expect(await first.projectBoardTask.findMany({ where: { boardId: board.id }, select: { id: true }, orderBy: { id: 'asc' } }))
        .toEqual([{ id: 'first' }, { id: 'second' }]);
      expect(await first.projectBoardEvent.findMany({ where: { boardId: board.id }, select: { sequence: true }, orderBy: { sequence: 'asc' } }))
        .toEqual([{ sequence: 1 }, { sequence: 2 }]);
    } finally {
      releaseRead();
      await Promise.allSettled([importing, concurrent]);
      await data.cleanup();
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);

  dbIt('serializes deletion with a concurrent child creation before either validates the tree', async () => {
    const first = client(), second = client();
    const data = await fixture(first);
    let pause = false;
    let reportRead!: () => void, releaseRead!: () => void;
    const readStarted = new Promise<void>((resolve) => { reportRead = resolve; });
    const readReleased = new Promise<void>((resolve) => { releaseRead = resolve; });
    const heldClient = first.$extends({ query: { projectBoardTask: {
      async findMany({ args, query }) {
        const rows = await query(args);
        if (pause) { pause = false; reportRead(); await readReleased; }
        return rows;
      },
    } } });
    const writer = service(heldClient as unknown as PrismaClient);
    let removing: Promise<unknown> | undefined, creating: Promise<unknown> | undefined;
    try {
      await writer.createTask(data.principal, data.spaceId, { id: 'root', title: 'Root' });
      pause = true;
      removing = writer.deleteTask(data.principal, data.spaceId, 'root');
      await readStarted;
      creating = service(second).createChild(data.collaborator, data.spaceId, 'root', { id: 'child', title: 'Child' })
        .then(() => 'created', (error: unknown) => getBusinessCode(error));
      let waiting = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await first.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'
        `;
        if (Number(rows[0].count) > 0) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBe(true);
      releaseRead();
      await expect(removing).resolves.toMatchObject({ deleted_task_ids: ['root'] });
      expect(await creating).toBe('TASKBOARD_TASK_NOT_FOUND');
      const board = await first.projectBoard.findUniqueOrThrow({ where: { spaceId: data.spaceId } });
      expect(await first.projectBoardTask.count({ where: { boardId: board.id } })).toBe(0);
      expect(await first.projectBoardEvent.count({ where: { boardId: board.id, operation: 'delete' } })).toBe(1);
    } finally {
      releaseRead();
      await Promise.allSettled([removing, creating]);
      await data.cleanup();
      await Promise.all([first.$disconnect(), second.$disconnect()]);
    }
  }, 20_000);

  dbIt('rejects a referenced subtree without partial writes and deletes after dependencies are removed', async () => {
    const prisma = client();
    const data = await fixture(prisma);
    const writer = service(prisma);
    try {
      await writer.createTask(data.principal, data.spaceId, { id: 'root', title: 'Root' });
      await writer.createChild(data.principal, data.spaceId, 'root', { id: 'child', title: 'Child' });
      await writer.createTask(data.principal, data.spaceId, { id: 'dependent', title: 'Dependent', depends_on: ['child'] });
      const board = await prisma.projectBoard.findUniqueOrThrow({ where: { spaceId: data.spaceId } });
      await expect(writer.deleteTask(data.principal, data.spaceId, 'root')).rejects.toMatchObject({ businessCode: 'RESOURCE_CONFLICT' });
      expect(await prisma.projectBoardTask.count({ where: { boardId: board.id } })).toBe(3);
      expect(await prisma.projectBoardEvent.count({ where: { boardId: board.id, operation: 'delete' } })).toBe(0);
      await writer.patchTask(data.principal, data.spaceId, 'dependent', { depends_on: [] });
      await expect(writer.deleteTask(data.principal, data.spaceId, 'root')).resolves.toMatchObject({ deleted_task_ids: ['root', 'child'] });
      const remaining = await prisma.projectBoardTask.findMany({ where: { boardId: board.id }, select: { id: true } });
      expect(remaining).toEqual([{ id: 'dependent' }]);
    } finally {
      await data.cleanup();
      await prisma.$disconnect();
    }
  }, 20_000);
});
