import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { SecurityModule } from '../core/security/security.module';
import { AssistService } from './assist.service';
import { AssistQueue } from './assist.queue';
import { AssistController } from './assist.controller';
import { OpencodeCliRunner } from './opencode.runner';

@Module({
  imports: [DatabaseModule, AuthModule, SecurityModule],
  controllers: [AssistController],
  providers: [AssistService, AssistQueue, { provide: 'OPENCODE_RUNNER', useClass: OpencodeCliRunner }, OpencodeCliRunner],
  exports: [AssistService],
})
export class AssistModule {}
