import { AssistQueue } from './assist.queue';
import { AssistSessionService } from './assist-session.service';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { SpaceRevisionWriterService } from '../core/sync/space-revision-writer.service';

// Stateful persistence double keeps assertions on returned behavior and writes;
// actual PostgreSQL constraints/concurrency are covered by integration acceptance.
describe('AssistSessionService', () => {
  let service: AssistSessionService;
  let db: any;
  let tasks: any[];
  let pages: any[];
  let session: any;
  let role: string | null;
  const version = '2026-01-01T00:00:00.000Z';
  const request = (extra = {}): any => ({ clientRequestId: 'r1', intent: 'Explain this', mode: 'question', pageId: 'p1', ...extra });
  beforeEach(() => {
    tasks = [];
    role = 'viewer';
    pages = ['p1', 'p2'].map(id => ({ id, spaceId: 's1', title: id, content: `saved ${id}`, updatedAt: new Date(version) }));
    session = { id: 'session1', spaceId: 's1', requestedByUserId: 'u1', title: 'Chat', createdAt: new Date(version), updatedAt: new Date(version) };
    const matches = (row: any, where: any) => Object.entries(where || {}).every(([key, value]: any) => {
      if (key === 'status' && value?.in) return value.in.includes(row.status);
      return row[key] === value;
    });
    db = {
      $transaction: async (fn: any) => fn(db), $executeRaw: jest.fn().mockResolvedValue(1), $queryRaw: jest.fn().mockResolvedValue([{ id: 'u1' }]),
      user: { findUnique: async ({ where }: any) => where.id === 'u1' ? { id: 'u1', type: 'human', platformRole: 'user' } : null },
      space: { findUnique: async ({ where }: any) => where.id === 's1' ? { id: 's1' } : null },
      spaceMember: { findUnique: async () => role ? { role } : null },
      page: { findFirst: async ({ where }: any) => pages.find(p => p.id === where.id && p.spaceId === where.spaceId) ?? null,
        count: async ({ where }: any) => pages.filter(p => where.id.in.includes(p.id) && p.spaceId === where.spaceId).length },
      assistSession: {
        findFirst: async ({ where }: any) => matches(session, where) ? session : null,
        findMany: jest.fn(async () => [session]), create: async ({ data }: any) => ({ ...session, ...data }),
        update: async ({ data }: any) => Object.assign(session, data),
      },
      assistTask: {
        findFirst: async ({ where }: any) => tasks.find(t => matches(t, where)) ?? null,
        findMany: async ({ where }: any) => tasks.filter(t => matches(t, where)),
        count: async ({ where }: any) => tasks.filter(t => matches(t, where)).length,
        create: jest.fn(async ({ data }: any) => { const row = { id: `t${tasks.length + 1}`, createdAt: new Date(), ...data }; tasks.push(row); return row; }),
        updateMany: async ({ where, data }: any) => { const found = tasks.filter(t => matches(t, where)); found.forEach(t => Object.assign(t, data)); return { count: found.length }; },
      },
    };
    service = new AssistSessionService(db, new AuthorizationService(db), new SpaceRevisionWriterService(db, {} as any), { get: () => undefined } as any);
  });

  it('creates a human-owned session with bounded title and current read authorization', async () => {
    const created = await service.create('s1', 'u1', ' Topic ');
    expect(created).toMatchObject({ title: 'Topic', spaceId: 's1' });
    await expect(service.create('s1', 'u1', 'x'.repeat(121))).rejects.toThrow('title');
    await expect(service.create('foreign', 'u1')).rejects.toThrow();
    await expect(service.create('s1', 'u2')).rejects.toThrow();
    role = null;
    await expect(service.create('s1', 'u1')).rejects.toThrow();
  });

  it('allows a viewer question with canonical current and reference snapshots and flat history', async () => {
    const turn = await service.send('session1', 'u1', request({ referencePageIds: ['p2'] }));
    expect(turn.mode).toBe('question');
    expect(turn.pageSnapshot?.content).toBe('saved p1');
    expect(turn.references).toEqual([{ pageId: 'p2', title: 'p2', updatedAt: version }]);
    expect(turn.result?.changes).toBeUndefined();
    expect(tasks[0].context.references[0].content).toBe('saved p2');
    const detail = await service.get('session1', 'u1');
    expect(detail).toMatchObject({ id: 'session1', spaceId: 's1', turns: [{ id: turn.id }] });
    expect(detail).not.toHaveProperty('session');
    expect(JSON.stringify(detail)).not.toContain('saved p2');
  });
  it('denies a viewer proposal', async () => {
    await expect(service.send('session1', 'u1', request({ mode: 'proposal' }))).rejects.toThrow();
    expect(tasks).toHaveLength(0);
  });
  it('returns the original request on retry but rejects a different active turn', async () => {
    const firstTask = await service.send('session1', 'u1', request());
    const secondTask = await service.send('session1', 'u1', request());
    expect(secondTask.id).toBe(firstTask.id);
    await expect(service.send('session1', 'u1', request({ clientRequestId: 'r2' }))).rejects.toMatchObject({ status: 409 });
    expect(tasks).toHaveLength(1);
  });
  it('denies another account and deleted or cross-Space references', async () => {
    await expect(service.get('session1', 'u2')).rejects.toThrow();
    await expect(service.send('session1', 'u1', request({ referencePageIds: ['foreign'] }))).rejects.toThrow();
    await service.send('session1', 'u1', request({ referencePageIds: ['p2'] }));
    pages = pages.filter(p => p.id !== 'p2');
    await expect(service.get('session1', 'u1')).rejects.toThrow();
    await expect(service.cancel('t1', 'u1')).rejects.toThrow();
  });
  it('does not return history after membership loss', async () => {
    await service.send('session1', 'u1', request());
    role = null;
    await expect(service.get('session1', 'u1')).rejects.toThrow();
    await expect(service.list('s1', 'u1')).rejects.toThrow();
  });
  it('replays immutable prior page and reference contents for a cross-page follow-up', async () => {
    pages[0].content = 'Original A detail: A_UNQUOTED_714';
    pages[1].content = 'Original R detail: R_UNQUOTED_829';
    pages.push({ id: 'p3', spaceId: 's1', title: 'B', content: 'Current B', updatedAt: new Date(version) });
    await service.send('session1', 'u1', request({ referencePageIds: ['p2'] }));
    tasks[0].status = 'done'; tasks[0].result = { summary: 'A is a document. The source details were not quoted.' };
    // The model must receive the captured originals, not current source bodies.
    pages[0].content = 'Changed A'; pages[0].updatedAt = new Date('2026-02-01');
    pages[1].content = 'Changed R'; pages[1].updatedAt = new Date('2026-02-01');
    await service.send('session1', 'u1', request({ clientRequestId: 'followup', pageId: 'p3', intent: 'What were the original A and R details?' }));
    const runtime = { run: jest.fn().mockResolvedValue({ summary: 'Follow-up answer' }) };
    db.assistTask.count = async () => 1;
    db.assistTask.updateMany = async () => ({ count: 1 });
    const queue = new AssistQueue(db, { get: () => undefined } as any, runtime, {} as any,
      new AuthorizationService(db), new SpaceRevisionWriterService(db, {} as any), service);
    await (queue as any).processOne({ ...tasks[1], leaseExpiresAtMs: Date.now() + 60_000 });
    expect(runtime.run).toHaveBeenCalledTimes(1);
    const input = runtime.run.mock.calls[0][0];
    expect(JSON.stringify(input.history)).toContain('A_UNQUOTED_714');
    expect(JSON.stringify(input.history)).toContain('R_UNQUOTED_829');
    expect(input.history[0]).toMatchObject({
      pageSnapshot: { title: 'p1', content: 'Original A detail: A_UNQUOTED_714', updatedAt: version },
      references: [{ pageId: 'p2', title: 'p2', content: 'Original R detail: R_UNQUOTED_829', updatedAt: version }],
    });
    expect(JSON.stringify(input.history)).not.toContain('Changed A');
    expect(JSON.stringify(input.history)).not.toContain('Changed R');
    expect(input.historyWindow).toMatchObject({ included: 1, omitted: 0 });
    expect(JSON.stringify(input.history).length).toBeLessThanOrEqual(120_000);
  });

  it('counts immutable history sources and JSON framing within the 120000-character window', async () => {
    pages[0].content = 'a'.repeat(40_000);
    pages[1].content = 'r'.repeat(39_000);
    pages.push({ id: 'p3', spaceId: 's1', title: 'B', content: 'B', updatedAt: new Date(version) });
    await service.send('session1', 'u1', request({ referencePageIds: ['p2'] }));
    tasks[0].status = 'done'; tasks[0].result = { summary: 's'.repeat(40_000) };
    await service.send('session1', 'u1', request({ clientRequestId: 'next', pageId: 'p3' }));
    const initial = await service.executionContext(db, tasks[1]);
    expect(initial.history).toHaveLength(1);
    const itemLength = JSON.stringify(initial.history[0]).length;
    tasks[0].result.summary += 's'.repeat(120_000 - itemLength);
    expect(tasks[0].result.summary.length).toBeLessThanOrEqual(50_000);
    const bounded = await service.executionContext(db, tasks[1]);
    expect(JSON.stringify(bounded.history).length).toBeLessThanOrEqual(120_000);
    expect(bounded.historyWindow).toMatchObject({ included: 0, omitted: 1 });
  });

  it.each(['deleted-source', 'moved-reference', 'proposal-role-loss'])('omits only the inaccessible %s session from list without leaking its title', async reason => {
    role = reason === 'proposal-role-loss' ? 'editor' : 'viewer';
    const bad = { ...session, title: 'PRIVATE INACCESSIBLE TITLE' };
    session = bad;
    await service.send(bad.id, 'u1', request({ mode: reason === 'proposal-role-loss' ? 'proposal' : 'question', referencePageIds: reason === 'moved-reference' ? ['p2'] : [] }));
    tasks[0].status = 'done'; tasks[0].result = { summary: 'private historical answer' };
    const good = { ...session, id: 'good', title: 'Good conversation' };
    const fresh = { ...session, id: 'fresh', title: 'New conversation' };
    db.assistSession.findMany.mockResolvedValue([bad, good, fresh]);
    db.assistSession.findFirst = async ({ where }: any) => [bad, good, fresh].find(row => row.id === where.id && row.requestedByUserId === where.requestedByUserId) ?? null;
    if (reason === 'deleted-source') pages = pages.filter(page => page.id !== 'p1');
    if (reason === 'moved-reference') pages[1].spaceId = 'foreign';
    if (reason === 'proposal-role-loss') role = 'viewer';
    const summaries = await service.list('s1', 'u1');
    expect(summaries.map(row => row.id)).toEqual(['good', 'fresh']);
    expect(JSON.stringify(summaries)).not.toContain('PRIVATE');
    expect(JSON.stringify(summaries)).not.toContain('private historical answer');
    await expect(service.get(bad.id, 'u1')).rejects.toThrow();
    await expect(service.send(bad.id, 'u1', request({ clientRequestId: 'after-loss' }))).rejects.toThrow();
    await expect(service.get(good.id, 'u1')).resolves.toMatchObject({ id: 'good', turns: [] });
  });

  it('propagates database failures from session list validation', async () => {
    await service.send('session1', 'u1', request());
    const unavailable = Object.assign(new Error('Database unavailable'), { code: 'P1001' });
    db.page.count = async () => { throw unavailable; };
    await expect(service.list('s1', 'u1')).rejects.toBe(unavailable);
  });

  it('uses canonical completed answers in bounded model history', async () => {
    await service.send('session1', 'u1', request());
    tasks[0].status = 'done'; tasks[0].result = { summary: 'previous answer', raw: 'SECRET', model: 'hidden' };
    await service.send('session1', 'u1', request({ clientRequestId: 'r2' }));
    const modelInput = await service.executionContext(db, tasks[1]);
    expect(modelInput.history[modelInput.history.length - 1].answer).toBe('previous answer');
    const detail = await service.get('session1', 'u1');
    expect(detail.turns[0].result).toEqual({ summary: 'previous answer' });
  });
  it('persists cancellation and allows a following turn', async () => {
    const turn = await service.send('session1', 'u1', request());
    const cancelledTask = await service.cancel(turn.id, 'u1');
    expect(cancelledTask.status).toBe('cancelled');
    expect((await service.send('session1', 'u1', request({ clientRequestId: 'r2' }))).status).toBe('queued');
  });
  it('rejects stale and oversized snapshots before queue insertion', async () => {
    await expect(service.send('session1', 'u1', request({ snapshot: { title: 'p1', content: 'draft', updatedAt: '2020-01-01' } }))).rejects.toThrow('stale');
    await expect(service.send('session1', 'u1', request({ snapshot: { title: 'p1', content: 'x'.repeat(50_000), updatedAt: version } }))).rejects.toThrow('snapshot');
    expect(tasks).toHaveLength(0);
  });
  it.each([
    { intent: 'x'.repeat(10_001) }, { referencePageIds: ['1', '2', '3', '4', '5', '6'] },
    { mode: 'other' }, { noteIds: ['x'.repeat(129)] },
  ])('rejects unbounded or invalid request %j', async (extra) => {
    await expect(service.send('session1', 'u1', request(extra))).rejects.toThrow();
    expect(tasks).toHaveLength(0);
  });
  it('recovers an idempotency uniqueness race using the committed winner', async () => {
    const create = db.assistTask.create.getMockImplementation();
    db.assistTask.create.mockImplementationOnce(async (args: any) => {
      await create(args); // Another writer won before our insert.
      throw Object.assign(new Error('unique request'), { code: 'P2002' });
    });
    const turn = await service.send('session1', 'u1', request());
    expect(turn.id).toBe(tasks[0].id);
    expect(tasks).toHaveLength(1);
  });
  it('serializes concurrent retries and different requests through transactions', async () => {
    let tail = Promise.resolve();
    db.$transaction = (fn: any) => {
      const operation = tail.then(() => fn(db));
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    };
    const [first, retry, competing] = await Promise.allSettled([
      service.send('session1', 'u1', request()),
      service.send('session1', 'u1', request()),
      service.send('session1', 'u1', request({ clientRequestId: 'r2' })),
    ]);
    expect(first.status).toBe('fulfilled');
    expect(retry).toEqual(first);
    expect(competing.status).toBe('rejected');
    if (competing.status === 'rejected') expect(competing.reason.status).toBe(409);
    expect(tasks).toHaveLength(1);
  });
  it('bounds the model window to the last ten completed turns and reports omissions', async () => {
    for (let i = 0; i < 12; i++) {
      await service.send('session1', 'u1', request({ clientRequestId: `r${i}` }));
      tasks[i].status = 'done'; tasks[i].result = { summary: `answer ${i}` };
    }
    await service.send('session1', 'u1', request({ clientRequestId: 'current' }));
    let context = await service.executionContext(db, tasks[12]);
    expect(context.history).toHaveLength(10);
    expect(context.history[0].answer).toBe('answer 2');
    expect(context.historyWindow).toMatchObject({ included: 10, omitted: 2 });
    tasks[10].result.summary = 'b'.repeat(70_000);
    tasks[11].result.summary = 'a'.repeat(70_000);
    context = await service.executionContext(db, tasks[12]);
    expect(context.history).toHaveLength(1);
    expect(context.historyWindow.omitted).toBe(11);
  });
  it('preserves original source, selection and explicit note IDs after the page changes', async () => {
    const target = { kind: 'selection', from: 4, to: 7, quote: 'OLD', prefix: 'pre ', suffix: ' post', baseUpdatedAt: version };
    await service.send('session1', 'u1', request({ intent: 'Selected note: explain OLD', noteIds: ['local-note-7'],
      snapshot: { title: 'original title', content: 'pre OLD post', updatedAt: version, draftRevision: 8, remoteRevision: 3, assistTarget: target } }));
    tasks[0].status = 'done'; tasks[0].result = { summary: 'answer' };
    pages[0].title = 'new title'; pages[0].content = 'new source'; pages[0].updatedAt = new Date('2026-02-01');
    const detail = await service.get('session1', 'u1');
    expect(detail.turns[0]).toMatchObject({ intent: 'Selected note: explain OLD', noteIds: ['local-note-7'],
      pageSnapshot: { title: 'original title', content: 'pre OLD post', updatedAt: version, assistTarget: target } });
    await expect(service.executionContext(db, tasks[0])).rejects.toThrow('stale');
  });
  it('fails closed after the original page is physically deleted', async () => {
    await service.send('session1', 'u1', request());
    tasks[0].pageId = null;
    await expect(service.get('session1', 'u1')).rejects.toThrow('source');
  });
  it('returns at most fifty summaries with no source or account internals', async () => {
    const summaries = await service.list('s1', 'u1');
    expect(summaries).toEqual([{ id: 'session1', spaceId: 's1', title: 'Chat', createdAt: version, updatedAt: version }]);
    expect(db.assistSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50, where: { spaceId: 's1', requestedByUserId: 'u1' } }));
  });

  it('persists only explicitly sent annotations with their original quote and comment', async () => {
    const annotations = [{ id: 'n1', body: 'Explain this claim', quote: 'saved' }];
    const turn = await service.send('session1', 'u1', request({ noteIds: ['n1'], annotations }));
    expect(turn).toMatchObject({ annotations });
    expect((await service.get('session1', 'u1')).turns[0]).toMatchObject({ annotations });
  });
  it.each([
    [[{ id: 'unselected', body: 'comment', quote: 'saved' }]],
    [[{ id: 'n1', body: 'comment', quote: 'foreign source' }]],
    [[{ id: 'n1', body: 'x'.repeat(10_000), quote: 'saved' }]],
  ])('rejects unselected, foreign or unbounded annotations', async annotations => {
    await expect(service.send('session1', 'u1', request({ noteIds: ['n1'], annotations }))).rejects.toThrow();
    expect(tasks).toHaveLength(0);
  });

  it('rejects context overflow and the 101st turn without silently trimming', async () => {
    pages[1].content = 'x'.repeat(100_000);
    await expect(service.send('session1', 'u1', request({ referencePageIds: ['p2'] }))).rejects.toThrow('context');
    tasks = Array.from({ length: 100 }, (_, i) => ({ id: `${i}`, sessionId: 'session1', requestedByUserId: 'u1', spaceId: 's1', pageId: 'p1', status: 'done', mode: 'question', intent: 'a', context: { pageId: 'p1', references: [], noteIds: [] } }));
    await expect(service.send('session1', 'u1', request())).rejects.toThrow('100');
  });
});
