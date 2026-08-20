import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SecurityModule } from '../../core/security/security.module';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { ObsidianIntegrationController } from './obsidian-integration.controller';
import { SyncV1Controller } from './sync-v1.controller';
import { SyncRevisionService } from './sync-revision.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { SpaceRevisionWriterService } from '../../core/sync/space-revision-writer.service';
import { PushSessionService } from './push-session.service';
import { SearchModule } from '../../core/search/search.module';
import { KnowledgeGraphModule } from '../../knowledge-graph/knowledge-graph.module';

@Module({
  imports: [DatabaseModule, AuthModule, SecurityModule, SearchModule, KnowledgeGraphModule],
  providers: [
    ObsidianCryptoService,
    HumanDeviceGuard,
    ObsidianIntegrationService,
    SyncRevisionService,
    SyncCursorService,
    SyncCapabilitiesService,
    SpaceRevisionWriterService,
    PushSessionService,
  ],
  controllers: [ObsidianIntegrationController, SyncV1Controller],
  exports: [
    ObsidianCryptoService,
    HumanDeviceGuard,
    ObsidianIntegrationService,
    SyncRevisionService,
    SyncCursorService,
    SyncCapabilitiesService,
    SpaceRevisionWriterService,
    PushSessionService,
  ],
})
export class ObsidianModule {}
