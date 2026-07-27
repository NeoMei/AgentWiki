import { Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

describe('AuditService persistence boundary', () => {
  const redisDouble = (overrides: Partial<Record<'setDurableHashField' | 'scanHashFields' | 'deleteHashField', jest.Mock>> = {}) => ({
    setDurableHashField: jest.fn().mockResolvedValue(undefined),
    scanHashFields: jest.fn().mockResolvedValue({ cursor: '0', entries: [] }),
    deleteHashField: jest.fn().mockResolvedValue(1),
    ...overrides,
  });

  const serviceWith = (create: jest.Mock, redis = redisDouble()) => ({
    service: new (AuditService as any)({ securityAuditEvent: { create } }, redis) as AuditService,
    redis,
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves after durably queuing an audit event when the database is unavailable', async () => {
    const databaseFailure = new Error('database unavailable');
    const create = jest.fn().mockRejectedValue(databaseFailure);
    const { service, redis } = serviceWith(create);

    await expect(service.record({
      action: 'auth.login',
      outcome: 'failure',
      actorUserId: 'user-1',
      ipAddress: '203.0.113.30',
      userAgent: 'test-agent',
      metadata: { reason: 'invalid-password' },
    })).resolves.toBeUndefined();

    const attemptedData = create.mock.calls[0][0].data;
    expect(attemptedData.id).toEqual(expect.any(String));
    expect(redis.setDurableHashField).toHaveBeenCalledWith(
      'audit:pending',
      attemptedData.id,
      JSON.stringify(attemptedData),
    );
  });

  it.each([
    ['local AOF fsync is not confirmed', new Error('Redis did not confirm a local AOF fsync within 1000ms')],
    ['WAITAOF is unsupported', new Error("ERR unknown command 'WAITAOF'")],
  ])('rejects with both causes when database fails and %s', async (_case, durabilityFailure) => {
    const databaseFailure = new Error('database unavailable');
    const { service } = serviceWith(
      jest.fn().mockRejectedValue(databaseFailure),
      redisDouble({ setDurableHashField: jest.fn().mockRejectedValue(durabilityFailure) }),
    );

    let caught: unknown;
    try {
      await service.record({ action: 'personal_token.rotate', outcome: 'success', actorUserId: 'user-1' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([databaseFailure, durabilityFailure]);
    expect((caught as AggregateError & { cause?: unknown }).cause).toBe(databaseFailure);
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining(
      'pending Redis field may remain, but local AOF durability was not confirmed',
    ));
  });

  it('persists a complete successful audit event with a stable ID without queuing it', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const { service, redis } = serviceWith(create);

    await expect(service.record({
      action: 'personal_token.rotate',
      outcome: 'success',
      actorUserId: 'user-1',
      actorAgentId: 'agent-1',
      ipAddress: '203.0.113.31',
      userAgent: 'test-agent',
      metadata: { credentialId: 'credential-1' },
    })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        action: 'personal_token.rotate',
        outcome: 'success',
        actorUserId: 'user-1',
        actorAgentId: 'agent-1',
        ipAddress: '203.0.113.31',
        userAgent: 'test-agent',
        metadata: { credentialId: 'credential-1' },
      },
    });
    expect(redis.setDurableHashField).not.toHaveBeenCalled();
  });

  it('drains a queued event into the database and acknowledges it in Redis', async () => {
    const queued = {
      id: 'audit-queued', action: 'auth.register', outcome: 'success', actorUserId: 'user-1',
      ipAddress: '203.0.113.32', userAgent: 'test-agent', metadata: { source: 'fallback' },
    };
    const redis = redisDouble({
      scanHashFields: jest.fn().mockResolvedValue({
        cursor: '0',
        entries: [{ field: queued.id, value: JSON.stringify(queued) }],
      }),
    });
    const create = jest.fn().mockResolvedValue({ id: queued.id });
    const { service } = serviceWith(create, redis);

    await expect((service as any).drainPending(10)).resolves.toBe(1);
    expect(create).toHaveBeenCalledWith({ data: queued });
    expect(redis.deleteHashField).toHaveBeenCalledWith('audit:pending', queued.id);
  });

  it('acknowledges a queued event already persisted under the same audit ID', async () => {
    const queued = { id: 'audit-duplicate', action: 'auth.register', outcome: 'success' };
    const redis = redisDouble({
      scanHashFields: jest.fn().mockResolvedValue({
        cursor: '0',
        entries: [{ field: queued.id, value: JSON.stringify(queued) }],
      }),
    });
    const { service } = serviceWith(jest.fn().mockRejectedValue({ code: 'P2002' }), redis);

    await expect((service as any).drainPending(10)).resolves.toBe(1);
    expect(redis.deleteHashField).toHaveBeenCalledWith('audit:pending', queued.id);
  });

  it('leaves a queued event pending when its database retry fails', async () => {
    const queued = { id: 'audit-pending', action: 'auth.register', outcome: 'success' };
    const redis = redisDouble({
      scanHashFields: jest.fn().mockResolvedValue({
        cursor: '0',
        entries: [{ field: queued.id, value: JSON.stringify(queued) }],
      }),
    });
    const { service } = serviceWith(jest.fn().mockRejectedValue(new Error('still unavailable')), redis);

    await expect((service as any).drainPending(10)).resolves.toBe(0);
    expect(redis.deleteHashField).not.toHaveBeenCalled();
  });

  it('retains the HSCAN cursor so a bad first page cannot starve a later valid event', async () => {
    const malformedEntries = Array.from({ length: 100 }, (_, index) => ({
      field: `audit-invalid-${index}`,
      value: '{invalid-json',
    }));
    const valid = { id: 'audit-later', action: 'auth.register', outcome: 'success' };
    const redis = redisDouble({
      scanHashFields: jest.fn()
        .mockResolvedValueOnce({ cursor: '42', entries: malformedEntries })
        .mockResolvedValueOnce({
          cursor: '0',
          entries: [{ field: valid.id, value: JSON.stringify(valid) }],
        }),
    });
    const create = jest.fn().mockResolvedValue({ id: valid.id });
    const { service } = serviceWith(create, redis);

    await expect((service as any).drainPending(100)).resolves.toBe(100);
    await expect((service as any).drainPending(100)).resolves.toBe(1);

    expect(redis.scanHashFields).toHaveBeenNthCalledWith(1, 'audit:pending', '0', 100);
    expect(redis.scanHashFields).toHaveBeenNthCalledWith(2, 'audit:pending', '42', 100);
    expect(redis.setDurableHashField).toHaveBeenCalledTimes(100);
    expect(redis.setDurableHashField).toHaveBeenCalledWith(
      'audit:dead',
      'audit-invalid-0',
      expect.any(String),
    );
    expect(create).toHaveBeenCalledWith({ data: valid });
    expect(redis.deleteHashField).toHaveBeenCalledWith('audit:pending', valid.id);
  });

  it('durably dead-letters a permanent Prisma failure before deleting it from pending', async () => {
    const queued = { id: 'audit-invalid-reference', action: 'auth.register', outcome: 'success' };
    const operations: string[] = [];
    const redis = redisDouble({
      scanHashFields: jest.fn().mockResolvedValue({
        cursor: '0',
        entries: [{ field: queued.id, value: JSON.stringify(queued) }],
      }),
      setDurableHashField: jest.fn().mockImplementation(async () => {
        operations.push('dead-letter');
      }),
      deleteHashField: jest.fn().mockImplementation(async () => {
        operations.push('delete-pending');
        return 1;
      }),
    });
    const { service } = serviceWith(jest.fn().mockRejectedValue({ code: 'P2003' }), redis);

    await expect((service as any).drainPending(10)).resolves.toBe(1);

    expect(operations).toEqual(['dead-letter', 'delete-pending']);
    const deadLetter = JSON.parse(redis.setDurableHashField.mock.calls[0][2]);
    expect(redis.setDurableHashField).toHaveBeenCalledWith('audit:dead', queued.id, expect.any(String));
    expect(deadLetter).toEqual({
      auditId: queued.id,
      failedAt: expect.any(String),
      reason: 'prisma:P2003',
      payload: JSON.stringify(queued),
    });
    expect(redis.deleteHashField).toHaveBeenCalledWith('audit:pending', queued.id);
  });

  it('advances the HSCAN cursor while retaining an event whose retry failure is transient', async () => {
    const first = { id: 'audit-transient', action: 'auth.register', outcome: 'success' };
    const second = { id: 'audit-next-page', action: 'auth.register', outcome: 'success' };
    const redis = redisDouble({
      scanHashFields: jest.fn()
        .mockResolvedValueOnce({
          cursor: '9',
          entries: [{ field: first.id, value: JSON.stringify(first) }],
        })
        .mockResolvedValueOnce({
          cursor: '0',
          entries: [{ field: second.id, value: JSON.stringify(second) }],
        }),
    });
    const create = jest.fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ id: second.id });
    const { service } = serviceWith(create, redis);

    await expect((service as any).drainPending(10)).resolves.toBe(0);
    await expect((service as any).drainPending(10)).resolves.toBe(1);

    expect(redis.scanHashFields).toHaveBeenNthCalledWith(1, 'audit:pending', '0', 10);
    expect(redis.scanHashFields).toHaveBeenNthCalledWith(2, 'audit:pending', '9', 10);
    expect(redis.deleteHashField).not.toHaveBeenCalledWith('audit:pending', first.id);
    expect(redis.deleteHashField).toHaveBeenCalledWith('audit:pending', second.id);
  });

  it('keeps malformed pending data when durable dead-letter fsync is not confirmed', async () => {
    const durabilityFailure = new Error('Redis did not confirm a local AOF fsync within 1000ms');
    const redis = redisDouble({
      scanHashFields: jest.fn().mockResolvedValue({
        cursor: '0',
        entries: [{ field: 'audit-malformed', value: '{invalid-json' }],
      }),
      setDurableHashField: jest.fn().mockRejectedValue(durabilityFailure),
    });
    const { service } = serviceWith(jest.fn(), redis);

    await expect((service as any).drainPending(10)).resolves.toBe(0);
    expect(redis.deleteHashField).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining(
      'Failed to durably dead-letter audit event audit-malformed',
    ));
  });

  it('drains on startup, polls, and stops polling on module destroy', async () => {
    jest.useFakeTimers();
    const redis = redisDouble();
    const { service } = serviceWith(jest.fn(), redis);

    try {
      await (service as any).onModuleInit();
      expect(redis.scanHashFields).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.scanHashFields).toHaveBeenCalledTimes(2);

      (service as any).onModuleDestroy();
      await jest.advanceTimersByTimeAsync(30_000);
      expect(redis.scanHashFields).toHaveBeenCalledTimes(2);
    } finally {
      (service as any).onModuleDestroy?.();
    }
  });
});
