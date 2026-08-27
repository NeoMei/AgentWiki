import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controllerWith = (
    redisOverrides: Record<string, jest.Mock> = {},
    storageOverrides: Record<string, jest.Mock> = {},
  ) => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const redis = {
      ping: jest.fn().mockResolvedValue(true),
      assertAofDurability: jest.fn().mockResolvedValue(undefined),
      ...redisOverrides,
    };
    const storage = {
      probe: jest.fn().mockResolvedValue({ writable: true, availableBytes: 2_000n }),
      ...storageOverrides,
    };
    const attachmentConfig = { minFreeBytes: 1_000n };
    return {
      controller: new HealthController(
        prisma as any,
        redis as any,
        storage as any,
        attachmentConfig as any,
      ),
      prisma,
      redis,
      storage,
    };
  };

  it('reports audit persistence healthy only after the Redis AOF preflight succeeds', async () => {
    const { controller, redis } = controllerWith();

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      auditPersistence: 'ok',
      attachmentStorage: 'ok',
    });
    expect(redis.assertAofDurability).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when Redis is reachable but cannot confirm AOF durability', async () => {
    const { controller } = controllerWith({
      assertAofDurability: jest.fn().mockRejectedValue(new Error('WAITAOF unsupported')),
    });

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports unavailable when attachment storage probing fails', async () => {
    const { controller } = controllerWith({}, {
      probe: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    });

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports unavailable when attachment storage free bytes are below the configured minimum', async () => {
    const { controller } = controllerWith({}, {
      probe: jest.fn().mockResolvedValue({ writable: true, availableBytes: 999n }),
    });

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
