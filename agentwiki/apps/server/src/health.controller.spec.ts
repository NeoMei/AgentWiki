import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controllerWith = (redisOverrides: Record<string, jest.Mock> = {}) => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const redis = {
      ping: jest.fn().mockResolvedValue(true),
      assertAofDurability: jest.fn().mockResolvedValue(undefined),
      ...redisOverrides,
    };
    return {
      controller: new HealthController(prisma as any, redis as any),
      prisma,
      redis,
    };
  };

  it('reports audit persistence healthy only after the Redis AOF preflight succeeds', async () => {
    const { controller, redis } = controllerWith();

    await expect(controller.check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      auditPersistence: 'ok',
    });
    expect(redis.assertAofDurability).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable when Redis is reachable but cannot confirm AOF durability', async () => {
    const { controller } = controllerWith({
      assertAofDurability: jest.fn().mockRejectedValue(new Error('WAITAOF unsupported')),
    });

    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
