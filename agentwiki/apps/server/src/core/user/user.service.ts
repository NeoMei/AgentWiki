import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';
import { recordUniHubSourceLifecycle } from '../auth/unihub/unihub-lifecycle.service';
import { lockConnectionOwner, PERSONAL_KEY_ROTATION_ID_PREFIX } from './personal-key-rotation';
import { BusinessException } from '../filters/business-error';
import { decryptPersonalApiKey, encryptPersonalApiKey } from './personal-key-secret';

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
        where: { userId: id, revokedAt: null }, data: { revokedAt: new Date(), encryptedKey: null },
      });
      await tx.agentCredential.updateMany({
        where: { agent: { ownerId: id }, revokedAt: null }, data: { revokedAt: new Date() },
      });
      await tx.agent.updateMany({
        where: { ownerId: id, revokedAt: null },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      await recordUniHubSourceLifecycle(tx, id, user.authVersion, 'deleted');
      return tx.user.update({
        where: { id },
        data: { deletedAt: new Date(), authVersion: { increment: 1 } },
        select: USER_SELECT,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async revealApiKey(userId: string): Promise<string> {
    const credential = await this.prisma.apiKeyCredential.findFirst({
      where: {
        userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        user: { type: 'human', deletedAt: null, lockedAt: null, mustChangePassword: false },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { keyHash: true, encryptedKey: true },
    });
    if (!credential) throw new NotFoundException('No active personal access token');
    if (!credential.encryptedKey) throw new BusinessException('PERSONAL_TOKEN_LEGACY');

    try {
      return decryptPersonalApiKey(credential.encryptedKey, userId, credential.keyHash);
    } catch {
      throw new ServiceUnavailableException('Could not read the current personal access token');
    }
  }

  async regenerateApiKey(userId: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockActiveUser(tx, userId);
      const historicalKey = await tx.apiKeyCredential.findFirst({
        where: { userId },
        select: { id: true },
      });
      if (historicalKey) {
        await tx.$queryRaw(Prisma.sql`
          SELECT "id" FROM "Agent" WHERE "ownerId" = ${userId}
          ORDER BY "id" FOR UPDATE
        `);
        const revokedAt = new Date();
        await tx.apiKeyCredential.updateMany({
          where: { userId, revokedAt: null }, data: { revokedAt, encryptedKey: null },
        });
        await tx.agentCredential.updateMany({
          where: { agent: { ownerId: userId }, revokedAt: null }, data: { revokedAt },
        });
        // Keep device and bootstrap records so fresh approval can recover the
        // original resources. Expired sessions cannot issue or replay a code.
        await tx.onboardingDeviceSession.updateMany({
          where: {
            authorizedUserId: userId,
            purpose: { in: ['agent-connect', 'full-onboarding'] },
            status: { in: ['approved', 'authorized'] },
          },
          data: { status: 'expired' },
        });
      }

      const rawKey = 'awk_' + randomBytes(32).toString('base64url');
      const keyHash = createHash('sha256').update(rawKey).digest('hex');
      await tx.apiKeyCredential.create({
        data: {
          ...(historicalKey ? { id: PERSONAL_KEY_ROTATION_ID_PREFIX + randomUUID() } : {}),
          userId,
          prefix: rawKey.slice(0, 12),
          keyHash,
          encryptedKey: encryptPersonalApiKey(rawKey, userId, keyHash),
          scopes: ['*'],
        },
      });
      return rawKey;
    });
  }

  async revokeApiKey(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockActiveUser(tx, userId);
      await tx.apiKeyCredential.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), encryptedKey: null },
      });
    });
  }

  private async lockActiveUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await lockConnectionOwner(tx, userId);
    const user = await tx.user.findUnique({
      where: { id: userId, type: 'human', deletedAt: null, lockedAt: null },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
  }
}
