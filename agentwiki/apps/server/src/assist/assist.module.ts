import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { SecurityModule } from '../core/security/security.module';
import { CollaborationModule } from '../core/collaboration/collaboration.module';
import { AssistService } from './assist.service';
import { AssistQueue } from './assist.queue';
import { AssistController } from './assist.controller';
import { RedisModelHealthStore } from './model-health.store';
import { OpencodeModelCatalog } from './opencode.catalog';
import { readRoutingConfig } from './opencode.config';
import { OpencodeCliRunner } from './opencode.runner';
import { OpencodeModelRouter } from './opencode.router';

@Module({
  imports: [DatabaseModule, AuthModule, SecurityModule, CollaborationModule],
  controllers: [AssistController],
  providers: [
    AssistService,
    AssistQueue,
    OpencodeCliRunner,
    {
      provide: OpencodeModelCatalog,
      useFactory: (runner: OpencodeCliRunner, config: ConfigService) => (
        new OpencodeModelCatalog(runner, readRoutingConfig(config))
      ),
      inject: [OpencodeCliRunner, ConfigService],
    },
    RedisModelHealthStore,
    { provide: 'MODEL_HEALTH_STORE', useExisting: RedisModelHealthStore },
    OpencodeModelRouter,
    { provide: 'OPENCODE_RUNNER', useExisting: OpencodeModelRouter },
  ],
  exports: [AssistService],
})
export class AssistModule {}
