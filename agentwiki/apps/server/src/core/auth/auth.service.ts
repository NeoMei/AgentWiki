import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { BusinessException } from '../filters/business-error';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { scopesForAgentGrant, type AgentAccessRole } from '@neomei/agentwiki-sync-protocol';

export interface User {
  id: string;
  email: string;
  name: string;
  type: 'human' | 'agent';
  platformRole?: 'user' | 'super_admin';
  authVersion?: number;
  mustChangePassword?: boolean;
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
    const payload = {
      sub: user.id,
      email: user.email,
      type: user.type,
      platformRole: user.platformRole,
      authVersion: user.authVersion ?? 0,
      passwordChangeRequired: user.mustChangePassword ?? false,
    };
    return this.jwtService.sign(payload);
  }

  async validateJwtUser(userId: string): Promise<{
    userId: string;
    email: string;
    name?: string;
    type: 'human';
    platformRole: 'user' | 'super_admin';
    authVersion?: number;
    mustChangePassword?: boolean;
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null, type: 'human' },
      select: {
        id: true, email: true, name: true, type: true,
        platformRole: true, lockedAt: true, authVersion: true, mustChangePassword: true,
      },
    });
    if (!user || user.lockedAt) return null;
    return {
      userId: user.id,
      email: user.email,
      name: user.name || undefined,
      type: 'human',
      platformRole: user.platformRole as 'user' | 'super_admin',
      authVersion: user.authVersion,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async validateApiKey(apiKey: string): Promise<{
    userId: string;
    email: string;
    type: string;
    credentialId: string;
    scopes: string[];
    agentId?: string;
    agentRole?: AgentAccessRole;
    authorizationId?: string;
    authorizationSpaceId?: string;
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
      credential.user.lockedAt ||
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
      include: {
        agent: { include: { owner: true } },
        authorization: true,
      },
    });
    if (
      !agentCredential ||
      agentCredential.revokedAt ||
      agentCredential.agent.status !== 'active' ||
      agentCredential.agent.revokedAt ||
      agentCredential.agent.owner.deletedAt ||
      agentCredential.agent.owner.lockedAt ||
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
      authorizationId: agentCredential.authorizationId,
      authorizationSpaceId: agentCredential.authorization.spaceId,
      agentRole: agentCredential.authorization.role,
      credentialId: agentCredential.id,
      scopes: scopesForAgentGrant(
        agentCredential.authorization.role,
        agentCredential.authorization.folderScopes,
      ),
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null, type: 'human' },
      select: {
        id: true, email: true, name: true, type: true, platformRole: true,
        password: true, lockedAt: true, authVersion: true, mustChangePassword: true,
      },
    });
    if (!user || !user.password || user.lockedAt) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }
    const valid = await this.validatePassword(password, user.password);
    if (!valid) {
      throw new BusinessException('AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }
    const token = this.signToken(user as User);
    return {
      access_token: token,
      user: {
        id: user.id, email: user.email, name: user.name,
        type: user.type, platformRole: user.platformRole,
        mustChangePassword: user.mustChangePassword,
      },
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

  async changeRequiredPassword(userId: string, newPassword: string, defaultPassword?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null, type: 'human' },
      select: { id: true, mustChangePassword: true, password: true, authVersion: true },
    });
    if (!user || !user.mustChangePassword) {
      throw new UnauthorizedException('Password change not required');
    }
    if (
      (defaultPassword && newPassword === defaultPassword) ||
      (user.password && await this.validatePassword(newPassword, user.password))
    ) {
      throw new BusinessException('AUTH_PASSWORD_POLICY', 'New password cannot be the current temporary password');
    }
    if (newPassword.length < 8) {
      throw new BusinessException('AUTH_PASSWORD_POLICY', 'Password must be at least 8 characters');
    }
    const hashed = await this.hashPassword(newPassword);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashed,
        mustChangePassword: false,
        authVersion: { increment: 1 },
      },
      select: {
        id: true, email: true, name: true, type: true,
        platformRole: true, authVersion: true, mustChangePassword: true,
      },
    });
    const token = this.signToken(updated as User);
    return {
      access_token: token,
      user: {
        id: updated.id, email: updated.email, name: updated.name,
        type: updated.type, platformRole: updated.platformRole,
        mustChangePassword: false,
      },
    };
  }
}
