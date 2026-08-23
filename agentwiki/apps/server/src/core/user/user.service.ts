import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// Fields to exclude from user responses for security
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  type: true,
  platformRole: true,
  createdAt: true,
  updatedAt: true,
  apiKeys: {
    where: { revokedAt: null },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  },
  spaces: { include: { space: true } },
};

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateUserDto) {
    return this.prisma.user.create({
      data,
      select: USER_SELECT,
    });
  }

  async findAll(skip = 0, take = 20): Promise<PaginatedResult<any>> {
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        skip,
        take,
        select: USER_SELECT,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { data, total, page: Math.floor(skip / take) + 1, limit: take };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      // Serialize account deletion with every Agent authorization write owned
      // by this user. Lock rows in the shared owner -> Agent order before
      // revoking any Credential, otherwise deletion can deadlock live writes.
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE
      `);
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Agent"
        WHERE "ownerId" = ${id}
        ORDER BY "id"
        FOR UPDATE
      `);
      const user = await tx.user.findUnique({ where: { id, deletedAt: null, type: 'human' } });
      if (!user) throw new NotFoundException('User not found');
      const ownedSpaces = await tx.spaceMember.count({
        where: { userId: id, role: 'owner', space: { deletedAt: null } },
      });
      if (ownedSpaces > 0) {
        throw new BadRequestException('Transfer ownership of every Space before deleting your account');
      }
      if (user.platformRole === 'super_admin') {
        const remaining = await tx.user.count({
          where: {
            id: { not: id }, type: 'human', platformRole: 'super_admin',
            deletedAt: null, lockedAt: null,
          },
        });
        if (remaining === 0) throw new BadRequestException('Cannot delete the last active super admin');
      }
      await tx.apiKeyCredential.updateMany({
        where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.agentCredential.updateMany({
        where: { agent: { ownerId: id }, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.agent.updateMany({
        where: { ownerId: id, revokedAt: null },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      return tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), authVersion: { increment: 1 } },
        select: USER_SELECT,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async generateApiKey(userId: string): Promise<string> {
    const rawKey = 'awk_' + randomBytes(32).toString('base64url');
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    await this.prisma.apiKeyCredential.create({
      data: {
        userId,
        prefix: rawKey.slice(0, 12),
        keyHash,
        scopes: ['*'],
      },
    });
    return rawKey;
  }

  async regenerateApiKey(userId: string): Promise<string> {
    await this.findOne(userId);
    await this.prisma.apiKeyCredential.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this.generateApiKey(userId);
  }

  async revokeApiKey(userId: string): Promise<void> {
    await this.findOne(userId);
    await this.prisma.apiKeyCredential.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

}
