interface FakeDb {
  spaces: Array<Record<string, unknown>>;
  boards: Array<Record<string, any>>;
  tasks: Array<Record<string, any>>;
  events: Array<Record<string, any>>;
  pages: Array<Record<string, any>>;
}

export function makeDb(): { prisma: any; db: FakeDb } {
  const db: FakeDb = {
    spaces: [{ id: 'space-1', name: '演示空间' }],
    boards: [],
    tasks: [],
    events: [],
    pages: [],
  };
  const sortTasks = () => [...db.tasks].sort((a, b) => a.ordinal - b.ordinal);
  const tx = {
    space: {
      findUnique: jest.fn(async ({ where }: any) => db.spaces.find((s) => s.id === where.id) ?? null),
    },
    projectBoard: {
      findUnique: jest.fn(async ({ where }: any) => db.boards.find((b) => b.spaceId === where.spaceId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: 'board-1',
          schemaVersion: 1,
          sourceType: 'manual',
          sources: [],
          eventSequence: 0,
          updatedAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        db.boards.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.boards.find((b) => b.id === where.id)!;
        const { eventSequence, ...rest } = data;
        Object.assign(row, rest);
        if (eventSequence?.increment) row.eventSequence = (row.eventSequence ?? 0) + eventSequence.increment;
        row.updatedAt = new Date();
        return row;
      }),
    },
    projectBoardTask: {
      findMany: jest.fn(async ({ where }: any) => sortTasks().filter((t) => t.boardId === where.boardId)),
      findUnique: jest.fn(async ({ where }: any) =>
        db.tasks.find((t) => t.boardId === where.boardId_id.boardId && t.id === where.boardId_id.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { createdAt: new Date(), updatedAt: new Date(), ...data };
        db.tasks.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = db.tasks.find(
          (t) => t.boardId === where.boardId_id.boardId && t.id === where.boardId_id.id,
        )!;
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
    },
    page: {
      findFirst: jest.fn(async ({ where }: any) =>
        db.pages.find((pg) => pg.id === where.id && pg.spaceId === where.spaceId) ?? null),
    },
    projectBoardEvent: {
      create: jest.fn(async ({ data }: any) => {
        db.events.push({ createdAt: new Date(), ...data });
        return data;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        db.events.filter((e) => e.boardId === where.boardId).sort((a, b) => b.sequence - a.sequence)),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    projectBoard: tx.projectBoard,
    space: tx.space,
    projectBoardTask: tx.projectBoardTask,
    projectBoardEvent: tx.projectBoardEvent,
    page: tx.page,
  };
  return { prisma: prisma as any, db };
}
