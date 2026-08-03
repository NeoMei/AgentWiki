import { Injectable, NotFoundException } from '@nestjs/common';
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
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: USER_SELECT,
    });
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
