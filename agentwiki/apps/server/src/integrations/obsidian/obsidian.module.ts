import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SecurityModule } from '../../core/security/security.module';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { ObsidianIntegrationController } from './obsidian-integration.controller';

@Module({
  imports: [DatabaseModule, AuthModule, SecurityModule],
  providers: [ObsidianCryptoService, HumanDeviceGuard, ObsidianIntegrationService],
  controllers: [ObsidianIntegrationController],
  exports: [ObsidianCryptoService, HumanDeviceGuard, ObsidianIntegrationService],
})
export class ObsidianModule {}
