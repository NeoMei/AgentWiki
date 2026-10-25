import { Prisma } from '@prisma/client';
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
  let folders: any[];
  let session: any;
  let role: string | null;
  const version = '2026-01-01T00:00:00.000Z';
  const request = (extra = {}): any => ({ clientRequestId: 'r1', intent: 'Explain this', mode: 'question', pageId: 'p1', ...extra });
  beforeEach(() => {
    tasks = [];
    role = 'viewer';
    folders = [];
    pages = ['p1', 'p2'].map(id => ({ id, spaceId: 's1', title: id, content: `saved ${id}`, updatedAt: new Date(version) }));
    session = { id: 'session1', spaceId: 's1', requestedByUserId: 'u1', title: 'Chat', createdAt: new Date(version), updatedAt: new Date(version) };
    const matches = (row: any, where: any) => Object.entries(where || {}).every(([key, value]: any) => {
      if (key === 'OR') return value.some((condition: any) => matches(row, condition));
      if (value?.in) return value.in.includes(row[key] ?? null);
      return (row[key] ?? null) === value;
    });
    db = {
      $transaction: async (fn: any) => fn(db), $executeRaw: jest.fn().mockResolvedValue(1), $queryRaw: jest.fn(async (query: any) => {
        if (!query.sql?.includes('jsonb_array_elements')) return [{ id: 'u1' }];
        return tasks.filter(task => task.sessionId === query.values[0]).map(task => {
          const directory = task.context?.directory;
          return { ...task, context: Array.isArray(directory?.documents) ? { ...task.context, directory: { ...directory,
            documents: directory.documents.map((document: any) => typeof document?.content === 'string' ? { ...document, content: '' } : document),
          } } : task.context };
        });
      }),
      user: { findUnique: async ({ where }: any) => where.id === 'u1' ? { id: 'u1', type: 'human', platformRole: 'user' } : null },
      space: { findUnique: async ({ where }: any) => where.id === 's1' ? { id: 's1' } : null },
      spaceMember: { findUnique: async () => role ? { role } : null },
      folder: { findMany: async ({ where, take }: any) => folders.filter(f => matches(f, where)).slice(0, take),
        findFirst: async ({ where }: any) => folders.find(f => matches(f, where)) ?? null },
      page: { findFirst: async ({ where }: any) => pages.find(p => matches(p, where)) ?? null,
        findMany: async ({ where, take, skip = 0 }: any) => pages.filter(p => matches(p, where)).slice(skip, skip + take),
        count: async ({ where }: any) => pages.filter(p => matches(p, where)).length },
      assistSession: {
        findFirst: async ({ where }: any) => matches(session, where) ? session : null,
        findMany: jest.fn(async () => [session]), create: async ({ data }: any) => ({ ...session, ...data }),
        update: async ({ data }: any) => Object.assign(session, data),
      },
      assistTask: {
        findFirst: async ({ where }: any) => tasks.find(t => matches(t, where)) ?? null,
        findMany: async ({ where }: any) => tasks.filter(t => matches(t, where)),
        count: async ({ where }: any) => tasks.filter(t => matches(t, where)).length,
        create: jest.fn(async ({ data }: any) => { const row = { id: `t${tasks.length + 1}`, createdAt: new Date(), ...data, ...(data.pageSnapshot === Prisma.DbNull ? { pageSnapshot: null } : {}) }; tasks.push(row); return row; }),
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

  it('returns only sanitized structured running progress separately from answers', async () => {
    await service.send('session1', 'u1', request());
    tasks[0].status = 'running';
    tasks[0].result = { progress: { phase: 'generating', attempt: 2, message: 'SECRET reasoning', model: 'SECRET model' }, raw: 'SECRET provider output' };
    const turn = (await service.get('session1', 'u1')).turns[0];
    expect(turn.progress).toEqual({ phase: 'generating', attempt: 2 });
    expect(turn.progressText).toBe('');
    expect(turn.result).toBeNull();
    expect(JSON.stringify(turn)).not.toContain('SECRET');
  });

  it.each(['queued', 'done', 'failed', 'cancelled'])('hides stale progress for a %s turn', async status => {
    await service.send('session1', 'u1', request());
    tasks[0].status = status;
    tasks[0].result = { progress: { phase: 'generating', attempt: 2 }, summary: 'answer' };
    const turn = (await service.get('session1', 'u1')).turns[0];
    expect(turn).not.toHaveProperty('progress');
    expect(turn.result).toEqual(status === 'done' ? { summary: 'answer' } : null);
  });

  it.each(['queued', 'failed', 'cancelled'])('does not display an abandoned partial answer for a %s turn', async status => {
    await service.send('session1', 'u1', request());
    tasks[0].status = status;
    tasks[0].progressText = 'Unfinished answer from an interrupted attempt';
    const turn = (await service.get('session1', 'u1')).turns[0];
    expect(turn.progressText).toBe('');
    expect(turn.result).toBeNull();
  });

  it('returns the safe timeout reason in the view and subsequent history without exposing diagnostics', async () => {
    await service.send('session1', 'u1', request());
    tasks[0].status = 'failed'; tasks[0].error = 'SECRET stderr';
    tasks[0].result = { failure: { code: 'timeout', message: 'SECRET provider response' }, raw: 'SECRET body' };
    const turn = (await service.get('session1', 'u1')).turns[0];
    expect(turn).toMatchObject({ failureCode: 'timeout', result: null });
    expect(turn.error).toMatch(/timed out/);
    expect(JSON.stringify(turn)).not.toContain('SECRET');
    await service.send('session1', 'u1', request({ clientRequestId: 'r2', intent: 'Why did that fail?' }));
    const history = (await service.executionContext(db, tasks[1])).history;
    expect(history[0]).toMatchObject({ failureCode: 'timeout', error: expect.stringMatching(/timed out/) });
    expect(history[0].error).toContain('does not indicate missing document permissions');
    expect(JSON.stringify(history)).not.toContain('SECRET');
  });

  it.each(['SECRET provider error', '__proto__', 'constructor', null, {}])('rejects an unknown stored failure category %j', async code => {
    await service.send('session1', 'u1', request());
    tasks[0].status = 'failed'; tasks[0].error = 'SECRET stderr'; tasks[0].result = { failure: { code } };
    const turn = (await service.get('session1', 'u1')).turns[0];
    expect(turn).not.toHaveProperty('failureCode');
    expect(turn.error).toBe('Assistant failed; retry with a new turn');
    expect(JSON.stringify(turn)).not.toContain('SECRET');
  });

  it.each([
    { phase: 'SECRET provider message' }, { phase: 'waiting', attempt: 0 },
    { phase: 'waiting', attempt: 101 }, { phase: 'waiting', attempt: 1.5 }, { phase: 'waiting', attempt: '2' },
  ])('omits malformed stored progress %j', async progress => {
    await service.send('session1', 'u1', request());
    tasks[0].status = 'running'; tasks[0].result = { progress };
    expect((await service.get('session1', 'u1')).turns[0]).not.toHaveProperty('progress');
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
  it('defaults omitted mode to automatic answers for viewers and exposes only read actions', async () => {
    const turn = await service.send('session1', 'u1', request({ mode: undefined }));
    expect(turn.mode).toBe('auto');
    expect((await service.executionContext(db, tasks[0]) as any).actions).toEqual({ update: false, create: false });
  });
  it('allows automatic directory conversations and derives write actions from live membership', async () => {
    role = 'editor';
    await service.send('session1', 'u1', request({ mode: 'auto', pageId: null, directory: { folderId: null } }));
    expect((await service.executionContext(db, tasks[0]) as any).actions).toEqual({ update: false, create: true });
    role = 'viewer';
    expect((await service.executionContext(db, tasks[0]) as any).actions).toEqual({ update: false, create: false });
  });
  it('keeps existing administrator editing capabilities in automatic mode', async () => {
    role = 'admin';
    await service.send('session1', 'u1', request({ mode: 'auto' }));
    expect((await service.executionContext(db, tasks[0])).actions).toEqual({ update: true, create: true });
  });
  it('reuses a completed automatic turn for the same idempotency key', async () => {
    role = 'editor';
    const first = await service.send('session1', 'u1', request({ mode: 'auto' }));
    tasks[0].status = 'done'; tasks[0].result = { action: 'answer', summary: 'Done' };
    expect((await service.send('session1', 'u1', request({ mode: 'auto' }))).id).toBe(first.id);
    expect(tasks).toHaveLength(1);
  });
  it('returns automatic write receipts and preserves them in canonical history', async () => {
    role = 'editor';
    await service.send('session1', 'u1', request({ mode: 'auto' }));
    const document = { operation: 'updated', pageId: 'p1', title: 'p1', updatedAt: version, url: '/pages/p1' };
    tasks[0].status = 'done'; tasks[0].result = { action: 'update', summary: 'Saved', changes: 'new body', document, raw: 'private' };
    const result = (await service.get('session1', 'u1')).turns[0].result;
    expect(result).toEqual({ action: 'update', summary: 'Saved', changes: 'new body', document });
    await service.send('session1', 'u1', request({ mode: 'auto', clientRequestId: 'r2' }));
    expect((await service.executionContext(db, tasks[1])).history[0]).toMatchObject({ action: 'update', document });
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
  it('replays a sanitized failed turn so a follow-up can continue the same Session', async () => {
    await service.send('session1', 'u1', request({ intent: 'Summarize every document in this directory' }));
    tasks[0].status = 'failed'; tasks[0].error = 'SECRET provider response';
    await service.send('session1', 'u1', request({ clientRequestId: 'r2', intent: '继续' }));
    const modelInput = await service.executionContext(db, tasks[1]);
    expect(modelInput.history[0]).toMatchObject({
      status: 'failed',
      intent: 'Summarize every document in this directory',
      error: 'Assistant failed; retry with a new turn',
    });
    expect(JSON.stringify(modelInput.history)).not.toContain('SECRET provider response');
    expect(modelInput.historyWindow).toMatchObject({ included: 1, omitted: 0 });
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

  describe('directory context', () => {
    beforeEach(() => {
      folders = [
        { id: 'f1', name: 'Current folder', parentId: null, spaceId: 's1' },
        { id: 'child', name: 'Child', parentId: 'f1', spaceId: 's1' },
        { id: 'other', name: 'Other', parentId: null, spaceId: 's1' },
        { id: 'foreign', name: 'Foreign', parentId: null, spaceId: 's2' },
        { id: 'deleted', name: 'Deleted', parentId: null, spaceId: 's1', deletedAt: new Date(version) },
        { id: 'hidden-child', name: 'Hidden child', parentId: 'deleted', spaceId: 's1' },
      ];
      pages = [
        ...Array.from({ length: 7 }, (_, i) => ({ id: `p${i + 1}`, folderId: i < 4 ? 'f1' : 'child', spaceId: 's1', title: `Page ${i + 1}`, content: `DIRECTORY_BODY_${i + 1}`, updatedAt: new Date(version) })),
        { id: 'root', folderId: null, spaceId: 's1', title: 'Root', content: 'ROOT_BODY', updatedAt: new Date(version) },
        { id: 'outside', folderId: 'other', spaceId: 's1', title: 'Outside', content: 'OUTSIDE_BODY', updatedAt: new Date(version) },
        { id: 'cross-space', folderId: 'foreign', spaceId: 's2', title: 'Foreign', content: 'FOREIGN_BODY', updatedAt: new Date(version) },
        { id: 'trash', folderId: 'f1', spaceId: 's1', title: 'Trash', content: 'DELETED_BODY', updatedAt: new Date(version), deletedAt: new Date(version) },
        { id: 'hidden', folderId: 'hidden-child', spaceId: 's1', title: 'Hidden', content: 'HIDDEN_BODY', updatedAt: new Date(version) },
      ];
    });

    it('captures the current database folder recursively beyond the five manual references', async () => {
      const turn: any = await service.send('session1', 'u1', request());
      expect(turn.directory).toEqual({ folderId: 'f1', title: 'Current folder', recursive: true, pageCount: 7 });
      expect(tasks[0].context.directory.documents.map((p: any) => p.pageId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
      expect(turn.references).toEqual([]);
      expect(JSON.stringify(turn.directory)).not.toContain('DIRECTORY_BODY');
      expect(JSON.stringify(tasks[0].context.directory)).not.toMatch(/OUTSIDE_BODY|FOREIGN_BODY|DELETED_BODY|HIDDEN_BODY/);
    });

    it.each([null, undefined])('runs a question without a page snapshot or version (%s)', async pageId => {
      const turn: any = await service.send('session1', 'u1', request({ pageId, directory: { folderId: 'f1' } }));
      expect(turn).toMatchObject({ pageId: null, pageSnapshot: null, directory: { folderId: 'f1', pageCount: 7 } });
      const execution = await service.executionContext(db, tasks[0]);
      expect(execution.context.pageId).toBeNull();
      expect((execution.context as any).directory.documents).toHaveLength(7);
      const runtime = { run: jest.fn().mockResolvedValue({ summary: 'Directory answer' }) };
      db.assistTask.count = async () => 1;
      db.assistTask.updateMany = async () => ({ count: 1 });
      const queue = new AssistQueue(db, { get: () => undefined } as any, runtime, {} as any,
        new AuthorizationService(db), new SpaceRevisionWriterService(db, {} as any), service);
      await (queue as any).processOne({ ...tasks[0], leaseExpiresAtMs: Date.now() + 60_000 });
      expect(runtime.run).toHaveBeenCalledTimes(1);
      expect(runtime.run.mock.calls[0][0].context.directory.documents).toHaveLength(7);
    });

    it.each([true, false])('restricts Space root recursive=%s to live visible folders', async recursive => {
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: null, recursive } }));
      const ids = tasks[0].context.directory.documents.map((doc: any) => doc.pageId);
      expect(ids).toEqual(recursive ? ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'root', 'outside'] : ['root']);
    });

    it('supports direct-only and empty directories without inventing references', async () => {
      await service.send('session1', 'u1', request({ directory: { folderId: 'f1', recursive: false } }));
      expect(tasks[0].context.directory.documents).toHaveLength(4);
      tasks[0].status = 'done';
      folders.push({ id: 'empty', name: 'Empty', parentId: null, spaceId: 's1' });
      const turn: any = await service.send('session1', 'u1', request({ clientRequestId: 'empty', pageId: null, directory: { folderId: 'empty' } }));
      expect(turn.directory).toMatchObject({ title: 'Empty', pageCount: 0 });
    });

    it('keeps large directory bodies outside the manual 100000-character context budget and history', async () => {
      pages[1].content = 'UNQUOTED_DIRECTORY_DETAIL' + 'd'.repeat(150_000);
      await service.send('session1', 'u1', request());
      tasks[0].status = 'done'; tasks[0].result = { summary: 'First answer' };
      await service.send('session1', 'u1', request({ clientRequestId: 'next' }));
      const execution: any = await service.executionContext(db, tasks[1], true);
      expect(execution.context.directory.documents[1].content.length).toBeGreaterThan(150_000);
      expect(execution.history[0].directory).toEqual({ folderId: 'f1', title: 'Current folder', recursive: true, pageCount: 7 });
      expect(JSON.stringify(execution.history)).not.toContain('UNQUOTED_DIRECTORY_DETAIL');
      expect(JSON.stringify((await service.get('session1', 'u1')).turns)).not.toContain('UNQUOTED_DIRECTORY_DETAIL');
    });

    it.each(['foreign', 'missing', 'deleted', 'hidden-child'])('rejects inaccessible or forged folder %s', async folderId => {
      await expect(service.send('session1', 'u1', request({ directory: { folderId } }))).rejects.toThrow(/directory/i);
      expect(tasks).toHaveLength(0);
    });

    it.each([
      { pageId: null }, { pageId: '' }, { directory: null }, { directory: [] },
      { directory: {} }, { directory: { folderId: 123 } }, { directory: { folderId: ' ' } },
      { directory: { folderId: 'f1', recursive: 'true' } }, { directory: { folderId: 'f1', recursive: null } },
      { directory: { folderId: 'f1', documents: [{ content: 'forged' }] } },
      { pageId: null, mode: 'proposal', directory: { folderId: null } },
      { pageId: null, directory: { folderId: null }, snapshot: { title: 'forged', content: 'forged' } },
      { pageId: null, directory: { folderId: null }, noteIds: ['n1'], annotations: [{ id: 'n1', body: 'note', quote: '' }] },
    ])('rejects invalid or ambiguous directory request %j', async extra => {
      role = 'editor';
      await expect(service.send('session1', 'u1', request(extra))).rejects.toThrow();
      expect(tasks).toHaveLength(0);
    });

    it.each(['revoked', 'page-deleted', 'page-moved', 'page-cross-space', 'folder-deleted', 'folder-cross-space', 'child-moved'])('blocks stored directory content after %s', async reason => {
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }));
      tasks[0].status = 'done'; tasks[0].result = { summary: 'SECRET historical answer' };
      if (reason === 'revoked') role = null;
      if (reason === 'page-deleted') pages[1].deletedAt = new Date(version);
      if (reason === 'page-moved') pages[1].folderId = 'other';
      if (reason === 'page-cross-space') pages[1].spaceId = 's2';
      if (reason === 'folder-deleted') folders[0].deletedAt = new Date(version);
      if (reason === 'folder-cross-space') folders[0].spaceId = 's2';
      if (reason === 'child-moved') folders[1].parentId = 'other';
      await expect(service.get('session1', 'u1')).rejects.toThrow();
      await expect(service.executionContext(db, tasks[0])).rejects.toThrow();
      if (reason !== 'revoked') expect(await service.list('s1', 'u1')).toEqual([]);
    });

    it.each(['documents', 'characters', 'folders'])('rejects directory %s overflow explicitly instead of truncating', async limit => {
      if (limit === 'documents') pages = Array.from({ length: 1001 }, (_, i) => ({ ...pages[0], id: `large${i}` }));
      if (limit === 'characters') pages[1].content = 'd'.repeat(5_000_000);
      if (limit === 'folders') folders = Array.from({ length: 10001 }, (_, i) => ({ id: `f${i}`, name: 'Folder', parentId: null, spaceId: 's1' }));
      await expect(service.send('session1', 'u1', request({ pageId: null, directory: { folderId: null } }))).rejects.toThrow(/directory.*(limit|large|maximum)/i);
      expect(tasks).toHaveLength(0);
    });

    it.each(['documents', 'characters', 'folders'])('keeps an automatic page question and proposal usable after directory %s overflow', async limit => {
      role = 'editor';
      if (limit === 'documents') pages.push(...Array.from({ length: 1001 }, (_, i) => ({ ...pages[0], id: `large${i}` })));
      if (limit === 'characters') pages[1].content = 'd'.repeat(5_000_000);
      if (limit === 'folders') folders.push(...Array.from({ length: 10001 }, (_, i) => ({ id: `large-folder${i}`, name: 'Folder', parentId: null, spaceId: 's1' })));
      for (const mode of ['question', 'proposal']) {
        const turn: any = await service.send('session1', 'u1', request({ clientRequestId: mode, mode }));
        expect(turn.status).toBe('queued');
        expect(turn.pageSnapshot.content).toBe('DIRECTORY_BODY_1');
        expect(turn.directory).toMatchObject({ folderId: 'f1', title: 'Current folder', recursive: true, pageCount: 0, unavailableReason: expect.stringMatching(/directory.*(limit|large|maximum)/i) });
        expect(tasks[tasks.length - 1].context.directory.documents).toEqual([]);
        const execution: any = await service.executionContext(db, tasks[tasks.length - 1]);
        expect(execution.context.directory.unavailableReason).toBe(turn.directory.unavailableReason);
        const readback = await service.get('session1', 'u1');
        expect(readback.turns[readback.turns.length - 1]).toMatchObject({ directory: turn.directory });
        tasks[tasks.length - 1].status = 'done'; tasks[tasks.length - 1].result = { summary: 'Single page result' };
      }
      const execution: any = await service.executionContext(db, tasks[tasks.length - 1]);
      expect(execution.history[0].directory.unavailableReason).toMatch(/directory/i);
    });

    it.each(['deleted-folder', 'cross-space-folder', 'deleted-ancestor', 'revoked', 'database-error'])('does not hide %s behind automatic resource fallback', async reason => {
      folders.push(...Array.from({ length: 10001 }, (_, i) => ({ id: `large-folder${i}`, name: 'Folder', parentId: null, spaceId: 's1' })));
      if (reason === 'deleted-folder') folders[0].deletedAt = new Date(version);
      if (reason === 'cross-space-folder') folders[0].spaceId = 's2';
      if (reason === 'deleted-ancestor') folders[0].parentId = 'deleted';
      if (reason === 'revoked') role = null;
      if (reason === 'database-error') db.folder.findMany = () => { throw new Error('Database unavailable'); };
      await expect(service.send('session1', 'u1', request())).rejects.toThrow();
      expect(tasks).toHaveLength(0);
    });

    it('rechecks the unavailable directory identity after an automatic fallback', async () => {
      folders.push(...Array.from({ length: 10001 }, (_, i) => ({ id: `large-folder${i}`, name: 'Folder', parentId: null, spaceId: 's1' })));
      await service.send('session1', 'u1', request());
      folders[0].deletedAt = new Date(version);
      await expect(service.get('session1', 'u1')).rejects.toThrow(/directory/i);
      await expect(service.executionContext(db, tasks[0])).rejects.toThrow(/directory/i);
      expect(await service.list('s1', 'u1')).toEqual([]);
    });

    it('still rejects an explicitly requested oversized directory with a page', async () => {
      pages[1].content = 'd'.repeat(5_000_000);
      await expect(service.send('session1', 'u1', request({ directory: { folderId: 'f1' } }))).rejects.toThrow(/directory.*(limit|large|maximum)/i);
      expect(tasks).toHaveLength(0);
    });

    it('captures multiple bounded batches without losing pages or changing their order', async () => {
      pages = Array.from({ length: 61 }, (_, i) => ({ ...pages[0], id: `doc${String(i + 1).padStart(3, '0')}` }));
      const read = db.page.findMany;
      let largestBatch = 0;
      db.page.findMany = async (args: any) => { const rows = await read(args); largestBatch = Math.max(largestBatch, rows.length); return rows; };
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }));
      expect(tasks[0].context.directory.documents.map((doc: any) => doc.pageId)).toEqual(Array.from({ length: 61 }, (_, i) => `doc${String(i + 1).padStart(3, '0')}`));
      expect(largestBatch).toBeLessThanOrEqual(25);
    });

    it('rejects a document-count overflow before reading any directory bodies', async () => {
      pages = Array.from({ length: 1001 }, (_, i) => ({ ...pages[0], id: `doc${i}` }));
      db.page.findMany = () => { throw new Error('Directory bodies should not be loaded'); };
      await expect(service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }))).rejects.toThrow(/Directory.*1000 documents/);
    });

    it('stops loading directory batches when accumulated content exceeds the limit', async () => {
      pages = Array.from({ length: 80 }, (_, i) => ({ ...pages[0], id: `doc${i}`, content: 'x'.repeat(200_000) }));
      const read = db.page.findMany;
      let bodiesLoaded = 0;
      db.page.findMany = async (args: any) => { const rows = await read(args); bodiesLoaded += rows.length; return rows; };
      await expect(service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }))).rejects.toThrow(/Directory.*5000000/);
      expect(bodiesLoaded).toBeLessThanOrEqual(25);
      expect(tasks).toHaveLength(0);
    });

    it('loads directory bodies once for runtime execution and omits them during repeated authorization', async () => {
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }));
      tasks[0].status = 'done'; tasks[0].result = { summary: 'Past result' };
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' }, clientRequestId: 'current' }));
      const authorized: any = await service.executionContext(db, tasks[1]);
      expect(authorized.context.directory.documents[1].content).toBe('');
      expect(JSON.stringify(authorized)).not.toContain('DIRECTORY_BODY');
      const read = db.assistTask.findFirst;
      let bodyReads = 0;
      db.assistTask.findFirst = async (args: any) => { if (args.select?.context) bodyReads += 1; return read(args); };
      const runtime = { run: jest.fn(async (input: any) => {
        expect(input.context.directory.documents[1].content).toBe('DIRECTORY_BODY_2');
        expect(JSON.stringify(input.history)).not.toContain('DIRECTORY_BODY');
        await input.isActive(); await input.isActive();
        input.onProgress({ phase: 'generating', attempt: 1 });
        input.onAnswerText('Answer');
        return { summary: 'Answer' };
      }) };
      db.assistTask.count = async () => 1;
      db.assistTask.updateMany = async () => ({ count: 1 });
      const queue = new AssistQueue(db, { get: () => undefined } as any, runtime, {} as any,
        new AuthorizationService(db), new SpaceRevisionWriterService(db, {} as any), service);
      await (queue as any).processOne({ ...tasks[1], leaseExpiresAtMs: Date.now() + 60_000 });
      expect(runtime.run).toHaveBeenCalledTimes(1);
      expect(bodyReads).toBe(1);
    });

    it('keeps send-time directory bodies immutable while reading only live metadata', async () => {
      await service.send('session1', 'u1', request({ pageId: null, directory: { folderId: 'f1' } }));
      pages[1].content = 'NEW_CONTENT'; pages[1].updatedAt = new Date('2026-02-01');
      db.page.findMany = () => { throw new Error('Current bodies must not be reloaded during authorization'); };
      const execution: any = await service.executionContext(db, tasks[0], true);
      expect(execution.context.directory.documents[1]).toMatchObject({ pageId: 'p2', content: 'DIRECTORY_BODY_2', updatedAt: version });
    });

    it.each([
      null, {}, { folderId: 'f1', title: 'Folder', recursive: true, documents: [{ pageId: 'p1' }] },
      { folderId: 'f1', title: 'Folder', recursive: true, documents: [
        { pageId: 'p1', title: 'Page', content: 'SECRET', updatedAt: version, folderId: 'f1' },
        { pageId: 'p1', title: 'Page', content: 'SECRET', updatedAt: version, folderId: 'f1' },
      ] },
    ])('fails closed on malformed stored directory context %j', async directory => {
      await service.send('session1', 'u1', request());
      tasks[0].context.directory = directory;
      await expect(service.get('session1', 'u1')).rejects.toThrow(/directory/i);
    });

    it('keeps persisted sessions without directory snapshots readable', async () => {
      await service.send('session1', 'u1', request());
      delete tasks[0].context.directory;
      expect((await service.get('session1', 'u1')).turns[0]).not.toHaveProperty('directory');
      await expect(service.executionContext(db, tasks[0])).resolves.toMatchObject({ context: { pageId: 'p1' } });
    });
  });

});
