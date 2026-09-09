import { ObsidianModule } from '../integrations/obsidian/obsidian.module';
import { ObsidianDeviceController } from '../integrations/obsidian/obsidian-device.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { AgentModule } from '../core/agent/agent.module';
import { DatabaseModule } from '../database/database.module';
import { OnboardController } from './onboard.controller';
import { OnboardBootstrapService } from './onboard-bootstrap.service';
import { OnboardDeviceService } from './onboard-device.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';

@Module({
  imports: [DatabaseModule, AuthModule, AgentModule, ObsidianModule],
  controllers: [OnboardController, ObsidianDeviceController],
  providers: [OnboardDeviceService, OnboardBootstrapService, OnboardingTokenGuard],
  exports: [OnboardingTokenGuard],
})
export class OnboardModule {}
