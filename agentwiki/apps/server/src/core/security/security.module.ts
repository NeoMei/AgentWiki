import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '../../database/database.module';
import { AuditService } from './audit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { AgentAuditInterceptor } from './agent-audit.interceptor';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    AuditService,
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AgentAuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class SecurityModule {}
