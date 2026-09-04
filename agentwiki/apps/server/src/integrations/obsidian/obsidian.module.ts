import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SecurityModule } from '../../core/security/security.module';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { HumanDeviceGuard } from './human-device.guard';
import { ObsidianIntegrationService } from './obsidian-integration.service';
import { ObsidianIntegrationController } from './obsidian-integration.controller';
import { SyncV1Controller } from './sync-v1.controller';
import { SyncV2Controller } from './sync-v2.controller';
import { SyncV2RevisionService } from './sync-v2-revision.service';
import { SyncRevisionService } from './sync-revision.service';
import { SyncCursorService } from './sync-cursor.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { PushSessionService } from './push-session.service';
import { SearchModule } from '../../core/search/search.module';
import { KnowledgeGraphModule } from '../../knowledge-graph/knowledge-graph.module';
import { ContentTreeModule } from '../../content-tree/content-tree.module';
import { SyncModule } from '../../core/sync/sync.module';
import { SyncV3BootstrapService } from './sync-v3-bootstrap.service';

@Module({
  imports: [DatabaseModule, AuthModule, SecurityModule, SearchModule, KnowledgeGraphModule, ContentTreeModule, SyncModule],
  providers: [
    ObsidianCryptoService,
    HumanDeviceGuard,
    ObsidianIntegrationService,
    SyncRevisionService,
    SyncV2RevisionService,
    SyncCursorService,
    SyncCapabilitiesService,
    PushSessionService,
    SyncV3BootstrapService,
  ],
  controllers: [ObsidianIntegrationController, SyncV1Controller, SyncV2Controller],
  exports: [
    ObsidianCryptoService,
    HumanDeviceGuard,
    ObsidianIntegrationService,
    SyncRevisionService,
    SyncV2RevisionService,
    SyncCursorService,
    SyncCapabilitiesService,
    PushSessionService,
    SyncV3BootstrapService,
  ],
})
export class ObsidianModule {}
