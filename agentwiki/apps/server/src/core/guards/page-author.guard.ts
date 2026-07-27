import { Injectable, CanActivate, ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PageAuthorGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const pageId = request.params.id;

    if (!pageId) {
      return true;
    }

    const page = await this.prisma.page.findUnique({
      where: { id: pageId, deletedAt: null },
      include: { space: { include: { members: true } } },
    });

    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // Author can always edit their own pages
    if (page.authorId === user.userId) {
      return true;
    }

    // Space owners and editors can edit any page in the space
    const memberRole = page.space.members.find(
      (m) => m.userId === user.userId,
    );
    if (memberRole && (memberRole.role === 'owner' || memberRole.role === 'editor')) {
      return true;
    }

    throw new ForbiddenException('You do not have permission to modify this page');
  }
}
