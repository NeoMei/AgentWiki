import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule],
  providers: [PrismaService],
  exports: [PrismaService, RedisModule],
})
export class DatabaseModule {}
