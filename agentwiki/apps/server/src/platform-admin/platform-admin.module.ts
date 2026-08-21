import { Module } from '@nestjs/common';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformSuperAdminGuard } from './platform-admin.guard';
import { AuthModule } from '../core/auth/auth.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService, PlatformSuperAdminGuard],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
