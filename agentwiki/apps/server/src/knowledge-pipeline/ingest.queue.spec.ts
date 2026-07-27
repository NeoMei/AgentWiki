import { IngestQueue } from './ingest.queue';

describe('IngestQueue process roles', () => {
  it('does not recover, poll or execute ingestion in the API process', async () => {
    const prisma = { ingestRun: { findFirst: jest.fn(), updateMany: jest.fn() } } as any;
    const sources = { recoverInterruptedRuns: jest.fn(), processRun: jest.fn() } as any;
    const queue = new IngestQueue(prisma, { get: jest.fn((key: string) => key === 'PROCESS_ROLE' ? 'api' : undefined) } as any, sources);
    await queue.onModuleInit();
    queue.enqueue();
    await Promise.resolve();
    expect(sources.recoverInterruptedRuns).not.toHaveBeenCalled();
    expect(prisma.ingestRun.findFirst).not.toHaveBeenCalled();
    expect(sources.processRun).not.toHaveBeenCalled();
    queue.onModuleDestroy();
  });

  it('recovers interrupted work and polls when launched as a worker', async () => {
    const prisma = { ingestRun: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() } } as any;
    const sources = { recoverInterruptedRuns: jest.fn().mockResolvedValue(undefined), processRun: jest.fn() } as any;
    const queue = new IngestQueue(prisma, { get: jest.fn((key: string) => key === 'PROCESS_ROLE' ? 'worker' : key === 'INGEST_QUEUE_POLL_MS' ? 60_000 : undefined) } as any, sources);
    await queue.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sources.recoverInterruptedRuns).toHaveBeenCalledTimes(1);
    expect(prisma.ingestRun.findFirst).toHaveBeenCalled();
    queue.onModuleDestroy();
  });

  it('claims work with an expiring worker lease and fences processing by worker id', async () => {
    const prisma = {
      ingestRun: {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'run-1' }).mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    } as any;
    const sources = { recoverInterruptedRuns: jest.fn().mockResolvedValue(undefined), processRun: jest.fn().mockResolvedValue(undefined) } as any;
    const config = { get: jest.fn((key: string) => ({
      PROCESS_ROLE: 'worker', INGEST_QUEUE_POLL_MS: 60_000, INGEST_LEASE_MS: 30_000, INGEST_CONCURRENCY: 1,
    } as Record<string, unknown>)[key]) } as any;
    const queue = new IngestQueue(prisma, config, sources);
    await queue.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    const claim = prisma.ingestRun.updateMany.mock.calls[0][0];
    expect(claim.data.leaseOwner).toEqual(expect.any(String));
    expect(claim.data.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(sources.processRun).toHaveBeenCalledWith('run-1', claim.data.leaseOwner);
    queue.onModuleDestroy();
  });
});
