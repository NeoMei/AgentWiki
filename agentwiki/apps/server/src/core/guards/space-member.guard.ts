import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SpaceMemberGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const spaceId = request.params.id || request.body.spaceId || request.query.spaceId;

    if (!spaceId) {
      return true;
    }

    const member = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: user.userId, spaceId } },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this space');
    }

    request.memberRole = member.role;
    return true;
  }
}
