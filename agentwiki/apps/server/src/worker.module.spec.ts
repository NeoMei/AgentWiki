import { Test, TestingModule } from '@nestjs/testing';
import { AssistQueue } from './assist/assist.queue';
import { AssistSessionService } from './assist/assist-session.service';
import { PrismaService } from './database/prisma.service';
import { WorkerModule } from './worker.module';
import { TemplateEffectsService } from './page-templates/template-effects.service';

describe('WorkerModule dependency graph', () => {
  let moduleRef: TestingModule | undefined;

  beforeAll(() => {
    process.env.PROCESS_ROLE = 'api';
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  it('executes a session turn through the standalone worker dependency graph', async () => {
    const version = new Date('2026-01-01T00:00:00.000Z');
    const task = { id: 't1', sessionId: 'session1', requestedByUserId: 'u1', spaceId: 's1', pageId: 'p1', mode: 'question',
      status: 'running', intent: 'Explain', createdAt: version,
      pageSnapshot: { title: 'Source', content: 'worker fixture source', updatedAt: version.toISOString() },
      context: { pageId: 'p1', references: [], noteIds: [] } };
    const db: any = {
      $transaction: async (fn: any) => fn(db), $queryRaw: async () => [{ id: 'u1' }], $executeRaw: async () => 1,
      user: { findUnique: async () => ({ id: 'u1', type: 'human', platformRole: 'user' }) },
      space: { findUnique: async () => ({ id: 's1' }) }, spaceMember: { findUnique: async () => ({ role: 'viewer' }) },
      page: { count: async () => 1, findFirst: async () => ({ id: 'p1', title: 'Source', content: 'worker fixture source', updatedAt: version }) },
      assistSession: { findFirst: async () => ({ id: 'session1', requestedByUserId: 'u1', spaceId: 's1' }) },
      assistTask: { count: async () => 1, findMany: async () => [task], updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const runner = { run: jest.fn(async () => ({ summary: 'Worker answer' })) };
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider('OPENCODE_RUNNER').useValue(runner).compile();
    const queue = moduleRef.get(AssistQueue);
    await (queue as any).processOne({ ...task, leaseExpiresAtMs: Date.now() + 60_000 });
    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ mode: 'question', context: { pageId: 'p1', references: [], noteIds: [] } }));
    expect(db.assistTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'done', result: { summary: 'Worker answer' } }) }));
    expect(moduleRef.get(AssistSessionService)).toBeDefined();
  });

  it('compiles without importing HTTP controllers or guards', async () => {
    moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(moduleRef.get(WorkerModule)).toBeDefined();
    expect(moduleRef.get(TemplateEffectsService)).toBeDefined();
  });
});
