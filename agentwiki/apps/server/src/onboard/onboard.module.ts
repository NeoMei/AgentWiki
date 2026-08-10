import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { OnboardController } from './onboard.controller';
import { OnboardDeviceService } from './onboard-device.service';
import { OnboardingTokenGuard } from './onboarding-token.guard';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OnboardController],
  providers: [OnboardDeviceService, OnboardingTokenGuard],
  exports: [OnboardingTokenGuard],
})
export class OnboardModule {}
