import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { AttachmentConfig } from './attachments/attachment.config';
import {
  ATTACHMENT_STORAGE,
  type AttachmentStorage,
} from './attachments/attachment-storage';
import { ATTACHMENT_CONFIG } from './attachments/attachment.service';
import { PrismaService } from './database/prisma.service';
import { RedisService } from './database/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ATTACHMENT_STORAGE)
    private readonly attachmentStorage: AttachmentStorage,
    @Inject(ATTACHMENT_CONFIG)
    private readonly attachmentConfig: AttachmentConfig,
  ) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const redisHealthy = await this.redis.ping();
      if (!redisHealthy) throw new Error('Redis unavailable');
      await this.redis.assertAofDurability();
      const attachmentStorage = await this.attachmentStorage.probe();
      if (
        !attachmentStorage.writable
        || attachmentStorage.availableBytes < this.attachmentConfig.minFreeBytes
      ) {
        throw new Error('Attachment storage unavailable');
      }
      return {
        status: 'ok',
        database: 'ok',
        redis: 'ok',
        auditPersistence: 'ok',
        attachmentStorage: 'ok',
      };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
