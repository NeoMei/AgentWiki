import { ConfigService } from '@nestjs/config';
import { TemplateEffectsService } from './template-effects.service';

type StoredJob = {
  id: string;
  instantiationId: string;
  spaceId: string;
  effectKey: string;
  kind: string;
  payload: unknown;
  status: string;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
};

const NOW = new Date('2026-09-06T00:00:00.000Z');

function job(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1', instantiationId: 'instantiation-1', spaceId: 'space-1',
    effectKey: 'page-index:page-1', kind: 'page_index', payload: { pageId: 'page-1' },
    status: 'pending', attempts: 0, availableAt: NOW, lockedAt: null, lastError: null,
    createdAt: NOW, ...overrides,
  };
}

function matches(job: StoredJob, where: Record<string, any>): boolean {
  if (where.id !== undefined && job.id !== where.id) return false;
  if (where.status !== undefined && job.status !== where.status) return false;
  if (where.attempts !== undefined && job.attempts !== where.attempts) return false;
  if (where.lockedAt !== undefined) {
    if (where.lockedAt === null && job.lockedAt !== null) return false;
    if (where.lockedAt instanceof Date && job.lockedAt?.getTime() !== where.lockedAt.getTime()) return false;
  }
  return true;
}

function createHarness(initial: StoredJob[], options: {
  pages?: Array<{ id: string; spaceId: string; deletedAt: Date | null }>;
  spaces?: Array<{ id: string; deletedAt: Date | null }>;
  runs?: Array<{ id: string; spaceId: string }>;
  role?: string;
  indexPage?: (pageId: string) => Promise<{ lexicalIndexed: boolean; semanticIndexed: boolean }>;
  refresh?: (spaceId: string) => Promise<any>;
  publishCurrentRun?: (runId: string) => Promise<void>;
} = {}) {
  const jobs = initial;
  const pages = options.pages ?? [{ id: 'page-1', spaceId: 'space-1', deletedAt: null }];
  const spaces = options.spaces ?? [{ id: 'space-1', deletedAt: null }];
  const runs = options.runs ?? [{ id: 'run-1', spaceId: 'space-1' }];
  const templateEffectJob = {
    findMany: jest.fn(async ({ where, take }: any) => jobs
      .filter((candidate) => (
        (candidate.status === 'pending' && candidate.attempts < 8 && candidate.availableAt <= where.OR[0].availableAt.lte)
        || (candidate.status === 'processing' && candidate.lockedAt !== null && candidate.lockedAt <= where.OR[1].lockedAt.lte)
      ))
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, take)
      .map((candidate) => ({ ...candidate }))),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const selected = jobs.filter((candidate) => matches(candidate, where));
      for (const candidate of selected) {
        Object.assign(candidate, data, {
          attempts: data.attempts?.increment === undefined
            ? data.attempts ?? candidate.attempts
            : candidate.attempts + data.attempts.increment,
        });
      }
      return { count: selected.length };
    }),
  };
  const prisma = {
    templateEffectJob,
    page: { findUnique: jest.fn(async ({ where }: any) => pages.find((item) => item.id === where.id) ?? null) },
    space: { findUnique: jest.fn(async ({ where }: any) => spaces.find((item) => item.id === where.id) ?? null) },
    collaborationRun: { findUnique: jest.fn(async ({ where }: any) => runs.find((item) => item.id === where.id) ?? null) },
    $transaction: jest.fn(async (operation: any) => operation({ templateEffectJob })),
  } as any;
  const search = { indexPage: jest.fn(options.indexPage ?? (async () => ({ lexicalIndexed: true, semanticIndexed: true }))) } as any;
  const graph = { refresh: jest.fn(options.refresh ?? (async () => ({ llm: { changeSetId: null, proposed: 0, reason: 'not_enough_pages' } }))) } as any;
  const events = { publishCurrentRun: jest.fn(options.publishCurrentRun ?? (async () => undefined)) } as any;
  const config = { get: jest.fn((key: string, fallback?: string) => key === 'PROCESS_ROLE' ? options.role ?? 'api' : fallback) } as any as ConfigService;
  const service = new TemplateEffectsService(prisma, config, search, graph, events);
  return { service, jobs, prisma, search, graph, events };
}

describe('TemplateEffectsService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => jest.useRealTimers());

  it('backs off after semantic partial indexing and completes on the second attempt', async () => {
    let calls = 0;
    const h = createHarness([job()], {
      indexPage: async () => (++calls === 1
        ? { lexicalIndexed: true, semanticIndexed: false }
        : { lexicalIndexed: true, semanticIndexed: true }),
    });

    await h.service.drain();
    expect(h.jobs[0]).toMatchObject({
      status: 'pending', attempts: 1, lockedAt: null,
      availableAt: new Date('2026-09-06T00:00:01.000Z'),
      lastError: 'PAGE_INDEX_SEMANTIC_PENDING',
    });

    jest.advanceTimersByTime(1_000);
    await h.service.drain();
    expect(h.jobs[0]).toMatchObject({ status: 'done', attempts: 2, lockedAt: null, lastError: null });
  });

  it('moves the eighth handler failure to failed without leaking exception text', async () => {
    const h = createHarness([job({ attempts: 7 })], {
      indexPage: async () => { throw new Error('secret-provider-token'); },
    });

    await h.service.drain();

    expect(h.jobs[0]).toMatchObject({
      status: 'failed', attempts: 8, lockedAt: null, lastError: 'TEMPLATE_EFFECT_HANDLER_FAILED',
    });
  });

  it('terminally fails an expired eighth claim without starting a ninth handler attempt', async () => {
    const h = createHarness([job({
      status: 'processing', attempts: 8,
      lockedAt: new Date('2026-09-05T23:54:59.000Z'),
    })]);

    await h.service.drain();

    expect(h.jobs[0]).toMatchObject({
      status: 'failed', attempts: 8, lockedAt: null, lastError: 'TEMPLATE_EFFECT_CLAIM_EXPIRED',
    });
    expect(h.search.indexPage).not.toHaveBeenCalled();
  });

  it('recovers an expired processing claim and increments its fenced attempt', async () => {
    const h = createHarness([job({
      status: 'processing', attempts: 1,
      lockedAt: new Date('2026-09-05T23:54:59.000Z'),
    })]);

    await h.service.drain();

    expect(h.jobs[0]).toMatchObject({ status: 'done', attempts: 2, lockedAt: null });
  });

  it('does not let a stale claimant finalize a newer completed attempt', async () => {
    let releaseFirst!: () => void;
    const firstHandler = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const shared = [job()];
    const first = createHarness(shared, {
      indexPage: async () => { await firstHandler; return { lexicalIndexed: true, semanticIndexed: true }; },
    });
    const second = createHarness(shared);

    const firstDrain = first.service.drain();
    await Promise.resolve();
    await Promise.resolve();
    expect(shared[0]).toMatchObject({ status: 'processing', attempts: 1 });
    jest.advanceTimersByTime(300_001);
    await second.service.drain();
    expect(shared[0]).toMatchObject({ status: 'done', attempts: 2 });

    releaseFirst();
    await firstDrain;
    expect(shared[0]).toMatchObject({ status: 'done', attempts: 2, lastError: null });
  });

  it('allows only one of two concurrent drains to dispatch the same job', async () => {
    const shared = [job()];
    let handled = 0;
    const options = { indexPage: async () => { handled += 1; return { lexicalIndexed: true, semanticIndexed: true }; } };
    const first = createHarness(shared, options);
    const second = createHarness(shared, options);

    await Promise.all([first.service.drain(), second.service.drain()]);

    expect(handled).toBe(1);
    expect(shared[0]).toMatchObject({ status: 'done', attempts: 1 });
  });

  it('dispatches all three exact ID-only handler payloads', async () => {
    const h = createHarness([
      job(),
      job({ id: 'job-2', effectKey: 'space-graph:space-1', kind: 'space_graph', payload: { spaceId: 'space-1' } }),
      job({ id: 'job-3', effectKey: 'collaboration-run:run-1', kind: 'collaboration_run', payload: { runId: 'run-1' } }),
    ]);

    await h.service.drain();

    expect(h.jobs.map((item) => item.status)).toEqual(['done', 'done', 'done']);
    expect(h.search.indexPage).toHaveBeenCalledWith('page-1', { requireSemanticWrite: true });
    expect(h.graph.refresh).toHaveBeenCalledWith('space-1');
    expect(h.events.publishCurrentRun).toHaveBeenCalledWith('run-1');
  });

  it.each(['llm_unavailable', 'rate_limited', 'proposal_pending', 'no_author'])(
    'retries graph refresh while the optional LLM layer is deferred with %s', async (reason) => {
      const h = createHarness([job({ kind: 'space_graph', payload: { spaceId: 'space-1' } })], {
        refresh: async () => ({ llm: { changeSetId: null, proposed: 0, reason } }),
      });

      await h.service.drain();

      expect(h.jobs[0]).toMatchObject({
        status: 'pending', attempts: 1, lastError: `SPACE_GRAPH_LLM_DEFERRED:${reason}`,
      });
    },
  );

  it.each(['not_enough_pages', 'no_valid_proposals'])(
    'completes graph refresh for the truthful terminal reason %s', async (reason) => {
      const h = createHarness([job({ kind: 'space_graph', payload: { spaceId: 'space-1' } })], {
        refresh: async () => ({ llm: { changeSetId: null, proposed: 0, reason } }),
      });

      await h.service.drain();

      expect(h.jobs[0]).toMatchObject({ status: 'done', attempts: 1, lastError: null });
    },
  );

  it('fails malformed and cross-Space payloads closed with stable codes', async () => {
    const h = createHarness([
      job({ id: 'job-bad', payload: { pageId: 'page-1', content: '# secret' } }),
      job({ id: 'job-cross', effectKey: 'page-index:page-2', payload: { pageId: 'page-2' } }),
    ], { pages: [{ id: 'page-2', spaceId: 'space-2', deletedAt: null }] });

    await h.service.drain();

    expect(h.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job-bad', status: 'pending', lastError: 'TEMPLATE_EFFECT_PAYLOAD_INVALID' }),
      expect.objectContaining({ id: 'job-cross', status: 'pending', lastError: 'TEMPLATE_EFFECT_SCOPE_MISMATCH' }),
    ]));
    expect(h.search.indexPage).not.toHaveBeenCalled();
  });

  it('uses terminal cleanup or no-op semantics for archived resources', async () => {
    const h = createHarness([
      job(),
      job({ id: 'job-2', effectKey: 'space-graph:space-1', kind: 'space_graph', payload: { spaceId: 'space-1' } }),
      job({ id: 'job-3', effectKey: 'collaboration-run:missing-run', kind: 'collaboration_run', payload: { runId: 'missing-run' } }),
    ], {
      pages: [{ id: 'page-1', spaceId: 'space-1', deletedAt: NOW }],
      spaces: [{ id: 'space-1', deletedAt: NOW }], runs: [],
    });

    await h.service.drain();

    expect(h.jobs.map((item) => item.status)).toEqual(['done', 'done', 'done']);
    expect(h.search.indexPage).toHaveBeenCalledWith('page-1', { requireSemanticWrite: true });
    expect(h.graph.refresh).not.toHaveBeenCalled();
    expect(h.events.publishCurrentRun).not.toHaveBeenCalled();
  });

  it('does not poll in the API role and drains immediately and periodically in worker role', async () => {
    const api = createHarness([job()], { role: 'api' });
    await api.service.onModuleInit();
    await jest.advanceTimersByTimeAsync(2_000);
    expect(api.jobs[0].status).toBe('pending');
    api.service.onModuleDestroy();

    const worker = createHarness([job()], { role: 'worker' });
    await worker.service.onModuleInit();
    expect(worker.jobs[0].status).toBe('done');
    worker.jobs.push(job({ id: 'job-next', effectKey: 'page-index:page-next', payload: { pageId: 'page-next' } }));
    await jest.advanceTimersByTimeAsync(1_000);
    expect(worker.jobs.find((item) => item.id === 'job-next')?.status).toBe('done');
    worker.service.onModuleDestroy();
  });
});
