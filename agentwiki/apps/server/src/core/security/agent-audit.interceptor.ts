import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class AgentAuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest();
    const agentId = request.user?.agentId;
    if (!agentId) return next.handle();
    const action = `${request.method} ${request.route?.path || request.path}`;
    const resourceId = request.params?.id || request.params?.pageId || request.params?.spaceId;
    return next.handle().pipe(
      tap(() => void this.record(agentId, action, 'success', resourceId)),
      catchError((error) => {
        void this.record(agentId, action, error?.status === 403 ? 'denied' : 'failure', resourceId);
        return throwError(() => error);
      }),
    );
  }

  private async record(agentId: string, action: string, outcome: string, resourceId?: string) {
    await this.prisma.agentAuditEvent.create({
      data: {
        agentId,
        action,
        outcome,
        resourceId,
        resourceType: resourceId ? 'route-resource' : undefined,
      },
    });
  }
}
