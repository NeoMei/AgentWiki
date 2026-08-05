import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const principal = request.user;
    if (!principal?.userId) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { id: true, platformRole: true, deletedAt: true, lockedAt: true, type: true },
    });
    if (!user || user.deletedAt || user.lockedAt || user.type !== 'human') {
      throw new UnauthorizedException();
    }
    if (user.platformRole !== 'super_admin') {
      throw new ForbiddenException('Platform admin access required');
    }
    return true;
  }
}
