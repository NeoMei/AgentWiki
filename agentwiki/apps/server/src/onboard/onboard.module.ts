import { Module } from '@nestjs/common';
import { OnboardController } from './onboard.controller';

@Module({
  controllers: [OnboardController],
})
export class OnboardModule {}
