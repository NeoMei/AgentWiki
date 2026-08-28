import { Module } from '@nestjs/common';
import { AuthModule } from '../core/auth/auth.module';
import { AuthorizationModule } from '../core/authorization/authorization.module';
import { SyncModule } from '../core/sync/sync.module';
import { DatabaseModule } from '../database/database.module';
import { ContentTreeController } from './content-tree.controller';
import { ContentTreeService } from './content-tree.service';

@Module({
  imports: [DatabaseModule, SyncModule, AuthorizationModule, AuthModule],
  controllers: [ContentTreeController],
  providers: [ContentTreeService],
  exports: [ContentTreeService],
})
export class ContentTreeModule {}
