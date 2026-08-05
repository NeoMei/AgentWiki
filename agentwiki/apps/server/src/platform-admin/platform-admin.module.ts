import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformSuperAdminGuard } from './platform-admin.guard';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../core/security/audit.service';
import { AuthService } from '../core/auth/auth.service';
import { RedisService } from '../database/redis.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') || process.env.JWT_SECRET,
      }),
    }),
  ],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminService,
    PlatformSuperAdminGuard,
    PrismaService,
    AuditService,
    AuthService,
    RedisService,
    ConfigService,
  ],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
