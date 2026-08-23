import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService, type Principal } from '../authorization/authorization.service';
import { BusinessException } from '../filters/business-error';

@Injectable()
export class CollaborationRunAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async getHumanRun(spaceId: string, runId: string, principal: Principal) {
    if (principal.agentId) throw new BusinessException('COLLABORATION_HUMAN_PERMISSION_DENIED');
    const run = await this.prisma.collaborationRun.findFirst({ where: { id: runId, spaceId } });
    if (!run) throw new BusinessException('RESOURCE_NOT_FOUND', 'Collaboration run not found');
    await this.authorization.assertSpaceAccess(principal, spaceId, ['owner', 'admin', 'editor', 'viewer']);
    return run;
  }
}
