import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './database/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const redisHealthy = await this.redis.ping();
      if (!redisHealthy) throw new Error('Redis unavailable');
      await this.redis.assertAofDurability();
      return { status: 'ok', database: 'ok', redis: 'ok', auditPersistence: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
