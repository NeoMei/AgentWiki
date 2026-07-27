import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('RedisService strict hash operations', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const serviceWithClient = (client: Record<string, jest.Mock>) => {
    const service = new RedisService({ get: jest.fn() } as any);
    (service as any).client = client;
    return service as any;
  };

  const durabilityProbeClient = () => {
    const hashes = new Map<string, Map<string, string>>();
    const operations: string[] = [];
    const client = {
      info: jest.fn().mockImplementation(async () => {
        operations.push('INFO');
        return '# Persistence\r\naof_enabled:1\r\n';
      }),
      hset: jest.fn().mockImplementation(async (key: string, field: string, value: string) => {
        operations.push('HSET');
        const hash = hashes.get(key) ?? new Map<string, string>();
        hash.set(field, value);
        hashes.set(key, hash);
        return 1;
      }),
      call: jest.fn().mockImplementation(async () => {
        operations.push('WAITAOF');
        return [1, 0];
      }),
      hscan: jest.fn().mockImplementation(async (key: string) => {
        operations.push('HSCAN');
        const values = [...(hashes.get(key)?.entries() ?? [])].flat();
        return ['0', values];
      }),
      hdel: jest.fn().mockImplementation(async (key: string, field: string) => {
        operations.push('HDEL');
        const hash = hashes.get(key);
        const deleted = hash?.delete(field) ? 1 : 0;
        if (hash?.size === 0) hashes.delete(key);
        return deleted;
      }),
    };
    return { client, hashes, operations };
  };

  it.each([
    ['setHashField', 'hset', ['audit:pending', 'audit-1', '{"id":"audit-1"}']],
    ['scanHashFields', 'hscan', ['audit:pending', '0', 10]],
    ['deleteHashField', 'hdel', ['audit:pending', 'audit-1']],
  ])('surfaces %s persistence failures', async (method, clientMethod, args) => {
    const failure = new Error(`${clientMethod} unavailable`);
    const service = serviceWithClient({ [clientMethod]: jest.fn().mockRejectedValue(failure) });

    await expect(Promise.resolve().then(() => service[method](...args))).rejects.toBe(failure);
  });

  it('returns the next HSCAN cursor without restarting or skipping an empty page', async () => {
    const hscan = jest.fn().mockResolvedValue(['7', []]);
    const service = serviceWithClient({ hscan });

    await expect(service.scanHashFields('audit:pending', '5', 100)).resolves.toEqual({
      cursor: '7',
      entries: [],
    });
    expect(hscan).toHaveBeenCalledWith('audit:pending', '5', 'COUNT', 100);
  });

  it('returns every entry in an HSCAN page even when Redis exceeds the COUNT hint', async () => {
    const hscan = jest.fn().mockResolvedValue([
      '0',
      ['audit-1', '{"id":"audit-1"}', 'audit-2', '{"id":"audit-2"}'],
    ]);
    const service = serviceWithClient({ hscan });

    await expect(service.scanHashFields('audit:pending', '9', 1)).resolves.toEqual({
      cursor: '0',
      entries: [
        { field: 'audit-1', value: '{"id":"audit-1"}' },
        { field: 'audit-2', value: '{"id":"audit-2"}' },
      ],
    });
  });

  it('returns the Redis acknowledgement count when deleting a hash field', async () => {
    const service = serviceWithClient({ hdel: jest.fn().mockResolvedValue(1) });

    await expect(service.deleteHashField('audit:pending', 'audit-1')).resolves.toBe(1);
  });

  it('confirms a hash write with a local AOF fsync before resolving', async () => {
    const calls: string[] = [];
    const client = {
      hset: jest.fn().mockImplementation(async () => { calls.push('HSET'); }),
      call: jest.fn().mockImplementation(async () => {
        calls.push('WAITAOF');
        return [1, 0];
      }),
    };
    const service = serviceWithClient(client);

    await expect(service.setDurableHashField(
      'audit:pending', 'audit-1', '{"id":"audit-1"}',
    )).resolves.toBeUndefined();
    expect(calls).toEqual(['HSET', 'WAITAOF']);
    expect(client.call).toHaveBeenCalledWith('WAITAOF', 1, 0, 5_000);
  });

  it('rejects an unconfirmed fsync while retaining the written hash field', async () => {
    const hash = new Map<string, string>();
    const client = {
      hset: jest.fn().mockImplementation(async (_key: string, field: string, value: string) => {
        hash.set(field, value);
      }),
      call: jest.fn().mockResolvedValue([0, 0]),
    };
    const service = serviceWithClient(client);

    await expect(service.setDurableHashField(
      'audit:pending', 'audit-1', '{"id":"audit-1"}',
    )).rejects.toThrow('Redis did not confirm a local AOF fsync');
    expect(hash.get('audit-1')).toBe('{"id":"audit-1"}');
  });

  it('surfaces an unsupported WAITAOF command after the hash write', async () => {
    const unsupported = new Error("ERR unknown command 'WAITAOF'");
    const client = {
      hset: jest.fn().mockResolvedValue(1),
      call: jest.fn().mockRejectedValue(unsupported),
    };
    const service = serviceWithClient(client);

    await expect(service.setDurableHashField(
      'audit:pending', 'audit-1', '{"id":"audit-1"}',
    )).rejects.toBe(unsupported);
    expect(client.hset).toHaveBeenCalledTimes(1);
  });

  it('preflights fallback ACLs and local fsync using a temporary probe hash', async () => {
    const { client, hashes, operations } = durabilityProbeClient();
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).resolves.toBeUndefined();
    expect(operations).toEqual(['INFO', 'HSET', 'WAITAOF', 'HSCAN', 'HDEL', 'WAITAOF']);
    expect(client.info).toHaveBeenCalledWith('persistence');
    const [probeKey, probeField, probeValue] = client.hset.mock.calls[0];
    expect(probeKey).toMatch(/^audit:durability-probe:[0-9a-f-]{36}$/);
    expect(probeField).toBe('probe');
    expect(probeValue).toEqual(expect.any(String));
    expect(client.hscan).toHaveBeenCalledWith(probeKey, '0', 'COUNT', 1);
    expect(client.hdel).toHaveBeenCalledWith(probeKey, probeField);
    expect(client.call).toHaveBeenCalledTimes(2);
    expect(client.call).toHaveBeenNthCalledWith(1, 'WAITAOF', 1, 0, 5_000);
    expect(client.call).toHaveBeenNthCalledWith(2, 'WAITAOF', 1, 0, 5_000);
    expect(hashes.size).toBe(0);
  });

  it('fails preflight on missing HSET permission and still attempts probe cleanup', async () => {
    const permissionError = new Error('NOPERM this user has no permissions to run HSET');
    const { client, hashes, operations } = durabilityProbeClient();
    client.hset.mockImplementationOnce(async () => {
      operations.push('HSET');
      throw permissionError;
    });
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).rejects.toBe(permissionError);
    expect(operations).toEqual(['INFO', 'HSET', 'HDEL', 'WAITAOF']);
    expect(hashes.size).toBe(0);
  });

  it('fails preflight on missing HSCAN permission and durably removes the probe', async () => {
    const permissionError = new Error('NOPERM this user has no permissions to run HSCAN');
    const { client, hashes, operations } = durabilityProbeClient();
    client.hscan.mockImplementationOnce(async () => {
      operations.push('HSCAN');
      throw permissionError;
    });
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).rejects.toBe(permissionError);
    expect(operations).toEqual(['INFO', 'HSET', 'WAITAOF', 'HSCAN', 'HDEL', 'WAITAOF']);
    expect(hashes.size).toBe(0);
  });

  it('fails preflight on missing HDEL permission and retries cleanup before returning unhealthy', async () => {
    const permissionError = new Error('NOPERM this user has no permissions to run HDEL');
    const { client, hashes, operations } = durabilityProbeClient();
    client.hdel.mockImplementation(async () => {
      operations.push('HDEL');
      throw permissionError;
    });
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).rejects.toBe(permissionError);
    expect(operations).toEqual(['INFO', 'HSET', 'WAITAOF', 'HSCAN', 'HDEL', 'HDEL']);
    expect(client.hdel).toHaveBeenCalledTimes(2);
    expect(hashes.size).toBe(1);
  });

  it('fails preflight when probe deletion fsync is unconfirmed and retries durable cleanup', async () => {
    const { client, hashes, operations } = durabilityProbeClient();
    client.call.mockImplementation(async () => {
      operations.push('WAITAOF');
      const waitNumber = client.call.mock.calls.length;
      return waitNumber === 2 ? [0, 0] : [1, 0];
    });
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).rejects.toThrow(
      'Redis did not confirm a local AOF fsync within 5000ms',
    );
    expect(operations).toEqual([
      'INFO', 'HSET', 'WAITAOF', 'HSCAN', 'HDEL', 'WAITAOF', 'HDEL', 'WAITAOF',
    ]);
    expect(hashes.size).toBe(0);
  });

  it('rejects preflight when Redis AOF is disabled', async () => {
    const client = {
      info: jest.fn().mockResolvedValue('# Persistence\r\naof_enabled:0\r\n'),
      call: jest.fn(),
      hset: jest.fn(),
      hscan: jest.fn(),
      hdel: jest.fn(),
    };
    const service = serviceWithClient(client);

    await expect(service.assertAofDurability()).rejects.toThrow('Redis AOF persistence is not enabled');
    expect(client.call).not.toHaveBeenCalled();
    expect(client.hset).not.toHaveBeenCalled();
  });

  it('requires the AOF durability preflight before module startup resolves', async () => {
    const probe = durabilityProbeClient();
    const client = {
      ...probe.client,
      on: jest.fn(),
      disconnect: jest.fn(),
    };
    (Redis as unknown as jest.Mock).mockImplementation(() => client);
    const service = new RedisService({
      get: jest.fn().mockReturnValue('redis://redis:6379'),
    } as any);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(client.info).toHaveBeenCalledWith('persistence');
    expect(probe.operations).toEqual(['INFO', 'HSET', 'WAITAOF', 'HSCAN', 'HDEL', 'WAITAOF']);
    expect(probe.hashes.size).toBe(0);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('fails startup and disconnects when AOF durability cannot be established', async () => {
    const client = {
      on: jest.fn(),
      info: jest.fn().mockResolvedValue('# Persistence\r\naof_enabled:0\r\n'),
      call: jest.fn(),
      disconnect: jest.fn(),
    };
    (Redis as unknown as jest.Mock).mockImplementation(() => client);
    const service = new RedisService({ get: jest.fn() } as any);

    await expect(service.onModuleInit()).rejects.toThrow('Redis AOF persistence is not enabled');
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
