import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEventInput {
  action: string;
  outcome: 'success' | 'failure' | 'denied';
  actorUserId?: string;
  actorAgentId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput): Promise<void> {
    try {
      await this.prisma.securityAuditEvent.create({
        data: {
          action: event.action,
          outcome: event.outcome,
          actorUserId: event.actorUserId,
          actorAgentId: event.actorAgentId,
          ipAddress: event.ipAddress,
          userAgent: event.userAgent,
          metadata: event.metadata as any,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to persist audit event ${event.action}: ${error.message}`);
    }
  }
}
