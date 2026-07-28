import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { LocalSyncInstallationController } from './local-sync-installation.controller';
import { LocalSyncInstallationService } from './local-sync-installation.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  providers: [AgentService, LocalSyncInstallationService],
  controllers: [AgentController, LocalSyncInstallationController],
  exports: [AgentService],
})
export class AgentModule {}
