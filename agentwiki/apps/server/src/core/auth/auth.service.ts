import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';

export interface User {
  id: string;
  email: string;
  name: string;
  type: 'human' | 'agent';
  platformRole?: 'user' | 'super_admin';
  apiKey?: string;
  password?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async validatePassword(plain: string, hashed: string): Promise<boolean> {
    return compare(plain, hashed);
  }

  async hashPassword(plain: string): Promise<string> {
    return hash(plain, 12);
  }

  signToken(user: User): string {
    const payload = { sub: user.id, email: user.email, type: user.type, platformRole: user.platformRole };
    return this.jwtService.sign(payload);
  }

  async validateJwtUser(userId: string): Promise<{
    userId: string;
    email: string;
    name?: string;
    type: 'human';
    platformRole: 'user' | 'super_admin';
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null, type: 'human' },
      select: { id: true, email: true, name: true, type: true, platformRole: true },
    });
    if (!user) return null;
    return {
      userId: user.id,
      email: user.email,
      name: user.name || undefined,
      type: 'human',
      platformRole: user.platformRole as 'user' | 'super_admin',
    };
  }

  async validateApiKey(apiKey: string): Promise<{
    userId: string;
    email: string;
    type: string;
    credentialId: string;
    scopes: string[];
    agentId?: string;
    platformRole?: 'user' | 'super_admin';
  } | null> {
    const keyHash = createHash('sha256').update(apiKey).digest('hex');
    const credential = await this.prisma.apiKeyCredential.findUnique({
      where: { keyHash },
      include: { user: true },
    });
    if (credential && (
      credential.revokedAt ||
      credential.user.deletedAt ||
      credential.user.type !== 'human' ||
      (credential.expiresAt && credential.expiresAt <= new Date())
    )) {
      return null;
    }
    if (credential) {
      await this.prisma.apiKeyCredential.update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      });
      return {
        userId: credential.user.id,
        email: credential.user.email,
        type: credential.user.type,
        platformRole: credential.user.platformRole as 'user' | 'super_admin',
        credentialId: credential.id,
        scopes: credential.scopes,
      };
    }

    const agentCredential = await this.prisma.agentCredential.findUnique({
      where: { keyHash },
      include: { agent: { include: { owner: true } } },
    });
    if (
      !agentCredential ||
      agentCredential.revokedAt ||
      agentCredential.agent.status !== 'active' ||
      agentCredential.agent.revokedAt ||
      agentCredential.agent.owner.deletedAt ||
      (agentCredential.expiresAt && agentCredential.expiresAt <= new Date())
    ) {
      return null;
    }
    await this.prisma.agentCredential.update({
      where: { id: agentCredential.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      userId: agentCredential.agent.ownerId,
      email: agentCredential.agent.owner.email,
      type: 'agent',
      agentId: agentCredential.agentId,
      credentialId: agentCredential.id,
      scopes: agentCredential.scopes,
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null, type: 'human' },
      select: { id: true, email: true, name: true, type: true, platformRole: true, password: true },
    });
    if (!user || !user.password) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }
    const valid = await this.validatePassword(password, user.password);
    if (!valid) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }
    const token = this.signToken(user as User);
    return {
      access_token: token,
      user: { id: user.id, email: user.email, name: user.name, type: user.type, platformRole: user.platformRole },
    };
  }

  async register(email: string, password: string, name: string) {
    try {
      const hashed = await this.hashPassword(password);
      const user = await this.prisma.user.create({
        data: { email, password: hashed, name, type: 'human' },
      });
      const token = this.signToken(user as User);
      return {
        access_token: token,
        user: { id: user.id, email: user.email, name: user.name, type: user.type, platformRole: user.platformRole },
      };
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new BusinessException('RESOURCE_CONFLICT', 'Email already in use');
      }
      throw new InternalServerErrorException('Registration failed');
    }
  }
}
