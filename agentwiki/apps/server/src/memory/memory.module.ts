import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../core/auth/auth.module';
import { MemoryController } from './memory.controller';
import { MemoryService } from './memory.service';
import { LlmModule } from '../integrations/llm/llm.module';
import { MemoryMaintenance } from './memory.maintenance';

@Module({
  imports: [DatabaseModule, AuthModule, LlmModule],
  providers: [MemoryService, MemoryMaintenance],
  controllers: [MemoryController],
  exports: [MemoryService],
})
export class MemoryModule {}
