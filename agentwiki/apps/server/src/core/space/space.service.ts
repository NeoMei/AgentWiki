import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateSpaceDto, UpdateSpaceDto } from '../dto/space.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface SpaceListResult<T> extends PaginatedResult<T> {
  revision: string;
  nextCursor: string | null;
  hasMore: boolean;
  resetRequired: boolean;
}

export interface SpaceListOptions {
  skip?: number;
  take?: number;
  cursor?: string;
}

interface SpaceListCursor {
  v: 1;
  createdAt: string;
  id: string;
  revision: string;
}

// Select only safe user fields (exclude password, apiKey)
const MEMBER_SELECT = {
  id: true,
  role: true,
  userId: true,
  spaceId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      email: true,
      name: true,
      type: true,
    },
  },
};

// Select page fields without embedding (which can be very large)
const PAGE_SELECT = {
  id: true,
  title: true,
  slug: true,
  content: true,
  format: true,
  parentId: true,
  spaceId: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

@Injectable()
export class SpaceService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async create(data: CreateSpaceDto, userId: string) {
    let slug = data.slug || (this.slugify(data.name) + '-' + Date.now().toString(36));

    const existing = await this.prisma.space.findUnique({ where: { slug } });
    if (existing) {
      slug = slug + '-' + Math.random().toString(36).substring(2, 8);
    }

    try {
      return await this.prisma.space.create({
        data: {
          name: data.name,
          slug,
          description: data.description,
          visibility: data.visibility ?? 'private',
          approvalPolicy: data.approvalPolicy ?? 'always-review',
          members: {
            create: {
              userId,
              role: 'owner',
            },
          },
        },
        include: { members: { select: MEMBER_SELECT } },
      });
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException('Space with this slug already exists');
      }
      throw error;
    }
  }

  async findAll(accessibleSpaceIds: string[], skip?: number, take?: number): Promise<PaginatedResult<any>>;
  async findAll(accessibleSpaceIds: string[], options?: SpaceListOptions): Promise<SpaceListResult<any>>;
  async findAll(
    accessibleSpaceIds: string[],
    skipOrOptions: number | SpaceListOptions = 0,
    legacyTake = 20,
  ): Promise<PaginatedResult<any> | SpaceListResult<any>> {
    if (typeof skipOrOptions === 'number') {
      return this.findAllByOffset(accessibleSpaceIds, skipOrOptions, legacyTake);
    }
    return this.findAllByCursor(accessibleSpaceIds, skipOrOptions);
  }

  private async findAllByOffset(accessibleSpaceIds: string[], skip: number, take: number): Promise<PaginatedResult<any>> {
    const [data, total] = await Promise.all([
      this.prisma.space.findMany({
        where: {
          deletedAt: null,
          id: { in: accessibleSpaceIds },
        },
        skip,
        take,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        include: {
          members: { select: MEMBER_SELECT },
          _count: { select: { pages: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.space.count({
        where: {
          deletedAt: null,
          id: { in: accessibleSpaceIds },
        },
      }),
    ]);
    return { data, total, page: Math.floor(skip / take) + 1, limit: take };
  }

  private async findAllByCursor(
    accessibleSpaceIds: string[],
    options: SpaceListOptions,
  ): Promise<SpaceListResult<any>> {
    const take = Math.min(Math.max(options.take ?? 20, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);
    const suppliedCursor = options.cursor ? this.decodeSpaceCursor(options.cursor) : null;

    return this.prisma.$transaction(async (tx) => {
      const keys = await tx.space.findMany({
        where: {
          deletedAt: null,
          id: { in: accessibleSpaceIds },
        },
        select: { id: true, createdAt: true },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      });
      const revision = this.spaceCollectionRevision(keys);
      const resetRequired = suppliedCursor !== null && suppliedCursor.revision !== revision;
      const activeCursor = resetRequired ? null : suppliedCursor;
      const useLegacyOffset = !activeCursor && !options.cursor && skip > 0;
      const cursorBoundary = activeCursor ? {
        OR: [
          { createdAt: { lt: new Date(activeCursor.createdAt) } },
          { createdAt: new Date(activeCursor.createdAt), id: { lt: activeCursor.id } },
        ],
      } : {};
      const rows = await tx.space.findMany({
        where: {
          deletedAt: null,
          id: { in: accessibleSpaceIds },
          ...cursorBoundary,
        },
        ...(useLegacyOffset ? { skip } : {}),
        take: take + 1,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        include: {
          members: { select: MEMBER_SELECT },
          _count: { select: { pages: { where: { deletedAt: null } } } },
        },
      });
      const hasMore = rows.length > take;
      const data = hasMore ? rows.slice(0, take) : rows;
      const last = data[data.length - 1];
      const nextCursor = hasMore && last
        ? this.encodeSpaceCursor(last.createdAt, last.id, revision)
        : null;

      return {
        data,
        total: keys.length,
        page: useLegacyOffset ? Math.floor(skip / take) + 1 : 1,
        limit: take,
        revision,
        nextCursor,
        hasMore,
        resetRequired,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private spaceCollectionRevision(keys: Array<{ id: string; createdAt: Date }>): string {
    const digest = createHash('sha256').update('agentwiki-space-list-v1\0');
    for (const key of keys) {
      const createdAt = key.createdAt instanceof Date ? key.createdAt.toISOString() : String(key.createdAt);
      digest.update(String(key.id.length)).update(':').update(key.id);
      digest.update(String(createdAt.length)).update(':').update(createdAt);
    }
    return digest.digest('base64url');
  }

  private encodeSpaceCursor(createdAt: Date | string, id: string, revision: string): string {
    const payload: SpaceListCursor = {
      v: 1,
      createdAt: createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString(),
      id,
      revision,
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeSpaceCursor(cursor: string): SpaceListCursor {
    try {
      const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<SpaceListCursor>;
      const createdAt = typeof payload.createdAt === 'string' ? new Date(payload.createdAt) : null;
      if (
        payload.v !== 1 || !createdAt || Number.isNaN(createdAt.getTime()) ||
        typeof payload.id !== 'string' || !payload.id ||
        typeof payload.revision !== 'string' || !payload.revision
      ) {
        throw new Error('invalid cursor payload');
      }
      return { v: 1, createdAt: createdAt.toISOString(), id: payload.id, revision: payload.revision };
    } catch {
      throw new BadRequestException('Space cursor is invalid');
    }
  }

  async findOne(id: string) {
    const space = await this.prisma.space.findUnique({
      where: { id, deletedAt: null },
      include: {
        members: { select: MEMBER_SELECT },
        pages: {
          where: { deletedAt: null },
          select: PAGE_SELECT,
          orderBy: { updatedAt: 'desc' },
        },
      },
    });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  async findBySlug(slug: string) {
    const space = await this.prisma.space.findUnique({
      where: { slug, deletedAt: null },
      include: {
        members: { select: MEMBER_SELECT },
        pages: {
          where: { deletedAt: null },
          select: PAGE_SELECT,
        },
      },
    });
    if (!space) throw new NotFoundException('Space not found');
    return space;
  }

  async update(id: string, data: UpdateSpaceDto) {
    await this.findOne(id);
    return this.prisma.space.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      await tx.assistTask.updateMany({
        where: { spaceId: id, status: { in: ['queued', 'running'] } },
        data: {
          status: 'failed',
          error: 'space deleted',
          completedAt: new Date(),
          lockedAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      });
      await tx.pageSearchDocument.deleteMany({ where: { page: { spaceId: id } } });
      await tx.page.updateMany({
        where: { spaceId: id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return tx.space.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }
  // ---- Member management ----

  async listMembers(spaceId: string, actorUserId: string, canManageAgentRoles: boolean) {
    await this.findOne(spaceId);
    const [humans, agentGrants] = await Promise.all([
      this.prisma.spaceMember.findMany({
        where: { spaceId },
        select: MEMBER_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.agentGrant.findMany({
        where: { spaceId, agent: { revokedAt: null } },
        select: {
          id: true,
          role: true,
          scopes: true,
          agentId: true,
          spaceId: true,
          createdAt: true,
          agent: { select: { id: true, name: true, status: true, revokedAt: true, ownerId: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return [
      ...humans.map((member) => ({ ...member, type: 'human' as const })),
      ...agentGrants.map((grant) => {
        const { ownerId, ...agent } = grant.agent;
        return {
          ...grant,
          agent,
          type: 'agent' as const,
          canManageRole: canManageAgentRoles && ownerId === actorUserId,
        };
      }),
    ];
  }

  async addMember(spaceId: string, email: string, role: 'owner' | 'admin' | 'editor' | 'viewer' = 'viewer') {
    if (role === 'owner') {
      throw new BadRequestException('Invite the member as an admin, then transfer ownership');
    }
    await this.findOne(spaceId);

    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null, type: 'human' },
    });
    if (!user) throw new NotFoundException('User not found with that email');

    const existing = await this.prisma.spaceMember.findUnique({
      where: { userId_spaceId: { userId: user.id, spaceId } },
    });
    if (existing) throw new ConflictException('User is already a member');

    return this.prisma.spaceMember.create({
      data: { userId: user.id, spaceId, role },
      select: MEMBER_SELECT,
    });
  }

  async updateMemberRole(spaceId: string, userId: string, role: 'owner' | 'editor' | 'viewer') {
    return this.updateMemberRoleAs(spaceId, userId, role, 'owner', userId);
  }

  async updateMemberRoleAs(
    spaceId: string,
    userId: string,
    role: string,
    callerRole: string,
    callerUserId?: string,
  ) {
    await this.findOne(spaceId);

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!member) throw new NotFoundException('Member not found');
      // Admins manage non-owner members only and can never touch the owner role.
      if (callerRole !== 'owner' && (member.role === 'owner' || role === 'owner')) {
        throw new ForbiddenException('Only an owner can manage the owner role');
      }
      if (role === 'owner' && member.role !== 'owner') {
        if (!callerUserId || callerUserId === userId) {
          throw new ForbiddenException('Ownership transfer requires the acting owner');
        }
        const promoted = await tx.spaceMember.update({
          where: { userId_spaceId: { userId, spaceId } },
          data: { role: 'owner' },
          select: MEMBER_SELECT,
        });
        const demoted = await tx.spaceMember.updateMany({
          where: { userId: callerUserId, spaceId, role: 'owner' },
          data: { role: 'admin' },
        });
        if (demoted.count !== 1) {
          throw new ForbiddenException('The acting user is no longer the space owner');
        }
        return promoted;
      }
      if (member.role === 'owner' && role !== 'owner') {
        const owners = await tx.spaceMember.count({ where: { spaceId, role: 'owner' } });
        if (owners <= 1) {
          throw new BadRequestException('Cannot remove the last owner; assign another owner first');
        }
      }

      return tx.spaceMember.update({
        where: { userId_spaceId: { userId, spaceId } },
        data: { role },
        select: MEMBER_SELECT,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async removeMember(spaceId: string, userId: string) {
    return this.removeMemberAs(spaceId, userId, 'owner');
  }

  async removeMemberAs(spaceId: string, userId: string, callerRole: string) {
    await this.findOne(spaceId);

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.spaceMember.findUnique({
        where: { userId_spaceId: { userId, spaceId } },
      });
      if (!member) throw new NotFoundException('Member not found');
      if (callerRole !== 'owner' && member.role === 'owner') {
        throw new ForbiddenException('Only an owner can remove an owner');
      }
      if (member.role === 'owner') {
        const owners = await tx.spaceMember.count({ where: { spaceId, role: 'owner' } });
        if (owners <= 1) {
          throw new BadRequestException('Cannot remove the last owner');
        }
      }

      return tx.spaceMember.delete({
        where: { userId_spaceId: { userId, spaceId } },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

}
