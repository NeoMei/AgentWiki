import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../core/security/audit.service';
import { AuthService } from '../core/auth/auth.service';

export interface Stats {
  users: {
    total: number;
    active: number;
    locked: number;
    deleted: number;
    new7d: number;
    new30d: number;
  };
  spaces: number;
  pages: number;
  agents: number;
  userTrend30d: number[];
  recentUsers: Array<{
    id: string;
    name: string | null;
    email: string;
    createdAt: Date;
    status: 'active' | 'locked' | 'deleted';
  }>;
}

export interface UserRow {
  id: string;
  name: string | null;
  email: string;
  platformRole: string;
  lockedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  spaceCount: number;
  agentCount: number;
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  async stats(): Promise<Stats> {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 86400000);
    const d30 = new Date(now.getTime() - 30 * 86400000);

    const [total, active, locked, deleted, new7d, new30d, spaces, pages, agents] = await Promise.all([
      this.prisma.user.count({ where: { type: 'human' } }),
      this.prisma.user.count({ where: { type: 'human', deletedAt: null, lockedAt: null } }),
      this.prisma.user.count({ where: { type: 'human', deletedAt: null, lockedAt: { not: null } } }),
      this.prisma.user.count({ where: { type: 'human', deletedAt: { not: null } } }),
      this.prisma.user.count({ where: { type: 'human', createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { type: 'human', createdAt: { gte: d30 } } }),
      this.prisma.space.count({ where: { deletedAt: null } }),
      this.prisma.page.count({ where: { deletedAt: null } }),
      this.prisma.agent.count({ where: { revokedAt: null } }),
    ]);

    const recentUsers = await this.prisma.user.findMany({
      where: { type: 'human' },
      select: { id: true, name: true, email: true, createdAt: true, lockedAt: true, deletedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const trend: number[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 86400000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      const count = await this.prisma.user.count({
        where: { type: 'human', createdAt: { gte: dayStart, lt: dayEnd } },
      });
      trend.push(count);
    }

    return {
      users: { total, active, locked, deleted, new7d, new30d },
      spaces,
      pages,
      agents,
      userTrend30d: trend,
      recentUsers: recentUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        createdAt: u.createdAt,
        status: u.deletedAt ? 'deleted' as const : u.lockedAt ? 'locked' as const : 'active' as const,
      })),
    };
  }

  async listUsers(params: {
    query?: string;
    status?: string;
    platformRole?: string;
    page?: number;
    limit?: number;
  }): Promise<{ users: UserRow[]; total: number }> {
    const { query, status, platformRole, page = 1, limit = 20 } = params;
    const effectiveLimit = Math.min(limit, 50);
    const skip = (page - 1) * effectiveLimit;

    const where: any = { type: 'human' };
    if (query) {
      where.OR = [
        { email: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ];
    }
    if (status === 'active') {
      where.deletedAt = null;
      where.lockedAt = null;
    } else if (status === 'locked') {
      where.deletedAt = null;
      where.lockedAt = { not: null };
    } else if (status === 'deleted') {
      where.deletedAt = { not: null };
    }
    if (platformRole && platformRole !== 'all') {
      where.platformRole = platformRole;
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          platformRole: true,
          lockedAt: true,
          deletedAt: true,
          createdAt: true,
          _count: { select: { spaces: true, ownedAgents: true } },
        },
        skip,
        take: effectiveLimit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      total,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        platformRole: u.platformRole,
        lockedAt: u.lockedAt,
        deletedAt: u.deletedAt,
        createdAt: u.createdAt,
        spaceCount: u._count.spaces,
        agentCount: u._count.ownedAgents,
      })),
    };
  }

  async resetPassword(actorUserId: string, targetId: string): Promise<string> {
    if (actorUserId === targetId) throw new ConflictException('Cannot reset your own password');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetId, type: 'human' } });
      if (!user) throw new NotFoundException('User not found');
      if (user.deletedAt) throw new ConflictException('Cannot reset password of a deleted user');

      const defaultPassword = `${randomBytes(18).toString('base64url')}Aa1!`;

      const hashed = await this.auth.hashPassword(defaultPassword);
      await tx.user.update({
        where: { id: targetId },
        data: { password: hashed, mustChangePassword: true, authVersion: { increment: 1 } },
      });
      await tx.apiKeyCredential.updateMany({
        where: { userId: targetId, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.agentCredential.updateMany({
        where: { agent: { ownerId: targetId }, revokedAt: null }, data: { revokedAt: new Date() },
      });

      return defaultPassword;
    }).then(async (pwd) => {
      await this.audit.record({ actorUserId, action: 'platform_user.password_reset', outcome: 'success', metadata: { targetId } });
      return pwd;
    });
  }

  async lockUser(actorUserId: string, targetId: string) {
    if (actorUserId === targetId) throw new ConflictException('Cannot lock your own account');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetId, type: 'human' } });
      if (!user) throw new NotFoundException('User not found');
      if (user.deletedAt) throw new ConflictException('Cannot lock a deleted user');
      if (user.lockedAt) return { locked: true, alreadyLocked: true };

      if (user.platformRole === 'super_admin') {
        const count = await tx.user.count({
          where: { type: 'human', platformRole: 'super_admin', deletedAt: null, lockedAt: null, id: { not: targetId } },
        });
        if (count === 0) throw new ConflictException('Cannot remove the last active super admin');
      }

      await tx.user.update({
        where: { id: targetId },
        data: { lockedAt: new Date(), authVersion: { increment: 1 } },
      });
      return { locked: true };
    }).then(async (result) => {
      await this.audit.record({ actorUserId, action: 'platform_user.lock', metadata: { targetId }, outcome: 'success' });
      return result;
    });
  }

  async unlockUser(actorUserId: string, targetId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetId, type: 'human' } });
      if (!user) throw new NotFoundException('User not found');
      if (!user.lockedAt) return { unlocked: true, alreadyUnlocked: true };

      await tx.user.update({
        where: { id: targetId },
        data: { lockedAt: null, authVersion: { increment: 1 } },
      });
      return { unlocked: true };
    }).then(async (result) => {
      await this.audit.record({ actorUserId, action: 'platform_user.unlock', metadata: { targetId }, outcome: 'success' });
      return result;
    });
  }

  async deleteUser(actorUserId: string, targetId: string) {
    if (actorUserId === targetId) throw new ConflictException('Cannot delete your own account');

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: targetId, type: 'human' } });
      if (!user) throw new NotFoundException('User not found');
      if (user.deletedAt) return { deleted: true, alreadyDeleted: true };

      if (user.platformRole === 'super_admin') {
        const count = await tx.user.count({
          where: { type: 'human', platformRole: 'super_admin', deletedAt: null, lockedAt: null, id: { not: targetId } },
        });
        if (count === 0) throw new ConflictException('Cannot remove the last active super admin');
      }

      await tx.user.update({
        where: { id: targetId },
        data: { deletedAt: new Date(), authVersion: { increment: 1 } },
      });
      return { deleted: true };
    }).then(async (result) => {
      await this.audit.record({ actorUserId, action: 'platform_user.delete', metadata: { targetId }, outcome: 'success' });
      return result;
    });
  }
}
