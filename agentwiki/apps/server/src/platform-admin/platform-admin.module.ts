import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformSuperAdminGuard } from './platform-admin.guard';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../core/security/audit.service';
import { AuthService } from '../core/auth/auth.service';
import { RedisService } from '../database/redis.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminService,
    PlatformSuperAdminGuard,
    PrismaService,
    AuditService,
    AuthService,
    RedisService,
    JwtService,
  ],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
