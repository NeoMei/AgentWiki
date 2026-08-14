import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { exchangeRequestHash } from '@neomei/agentwiki-sync-protocol';
import type {
  ExchangeObsidianCredentialRequest,
  HumanDeviceCredentialSummary,
  HumanDeviceSessionResponse,
} from '@neomei/agentwiki-sync-protocol';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../core/security/audit.service';
import { RedisService } from '../../database/redis.service';
import { SyncApiException } from './sync-error';
import { DEFAULT_SYNC_CAPABILITIES, ObsidianCryptoService } from './obsidian-crypto.service';

const INSTALLATION_TTL_MS = 10 * 60 * 1_000;
const PROVISIONAL_TTL_MS = 10 * 60 * 1_000;

@Injectable()
export class ObsidianIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ObsidianCryptoService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async createInstallation(userId: string, ipAddress: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = this.crypto.newCode();
      const codeHash = this.crypto.installationCodeHash(code);
      try {
        const installation = await this.prisma.obsidianInstallation.create({
          data: {
            id: randomUUID(),
            codeHash,
            userId,
            expiresAt: new Date(Date.now() + INSTALLATION_TTL_MS),
          },
        });
        await this.audit.record({
          action: 'obsidian.installation.create',
          outcome: 'success',
          actorUserId: userId,
          ipAddress,
          metadata: { installationId: installation.id },
        });
        return {
          protocolVersion: '1' as const,
          installationId: installation.id,
          code,
          expiresAt: installation.expiresAt.toISOString(),
        };
      } catch (error: unknown) {
        if (this.isUniqueViolation(error)) continue;
        throw error;
      }
    }
    throw new SyncApiException('CREDENTIAL_COLLISION', 'Could not issue a unique installation code');
  }

  async revokeInstallation(userId: string, installationId: string) {
    const installation = await this.prisma.obsidianInstallation.findUnique({
      where: { id: installationId },
    });
    if (!installation || installation.userId !== userId) {
      throw new SyncApiException('INSTALLATION_NOT_FOUND', 'Installation not found');
    }
    if (installation.status === 'exchanged') {
      throw new SyncApiException('INSTALLATION_ALREADY_EXCHANGED', 'Installation was already exchanged');
    }
    await this.prisma.obsidianInstallation.update({
      where: { id: installationId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'obsidian.installation.revoke',
      outcome: 'success',
      actorUserId: userId,
      metadata: { installationId },
    });
  }

  async exchange(request: ExchangeObsidianCredentialRequest, ipAddress: string) {
    await this.assertExchangeRateLimit(ipAddress);
    const codeHash = this.crypto.installationCodeHash(request.code);
    const installation = await this.prisma.obsidianInstallation.findUnique({
      where: { codeHash },
      include: { user: { select: { id: true, name: true, deletedAt: true, lockedAt: true, type: true } } },
    });
    if (!installation) {
      throw new SyncApiException('INSTALLATION_CODE_INVALID', 'Installation code is invalid');
    }
    if (installation.user.deletedAt || installation.user.lockedAt || installation.user.type !== 'human') {
      throw new SyncApiException('USER_INACTIVE', 'User account is unavailable');
    }
    const now = new Date();
    if (installation.status === 'revoked') {
      throw new SyncApiException('INSTALLATION_REVOKED', 'Installation code has been revoked');
    }
    if (installation.expiresAt <= now) {
      throw new SyncApiException('INSTALLATION_CODE_EXPIRED', 'Installation code has expired');
    }
    const requestHash = await exchangeRequestHash(request);
    if (installation.status === 'exchanged') {
      if (
        installation.exchangeId === request.exchangeId
        && installation.requestHash === requestHash
      ) {
        const credential = await this.findFamilyProvisional(installation.id, request);
        if (credential) {
          const serverInstanceId = await this.crypto.getServerInstanceId();
          return this.exchangeResponse(serverInstanceId, credential, installation);
        }
      }
      throw new SyncApiException('INSTALLATION_ALREADY_EXCHANGED', 'Installation code was already exchanged');
    }
    if (!request.supportedProtocolVersions.includes('1')) {
      throw new SyncApiException('PROTOCOL_UNSUPPORTED', 'No shared protocol version');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.obsidianInstallation.findUnique({ where: { id: installation.id } });
        if (!locked || locked.status !== 'pending') {
          throw new SyncApiException('INSTALLATION_ALREADY_EXCHANGED', 'Installation code was already exchanged');
        }
        if (locked.expiresAt <= new Date()) {
          throw new SyncApiException('INSTALLATION_CODE_EXPIRED', 'Installation code has expired');
        }
        await tx.obsidianInstallation.update({
          where: { id: installation.id },
          data: { status: 'exchanged', exchangeId: request.exchangeId, requestHash, exchangedAt: now },
        });
        const family = await this.upsertFamily(tx, installation.userId, request);
        await this.expireFamilyProvisionals(tx, family.id);
        const credentialHash = this.crypto.credentialHash(request.credential);
        const credential = await tx.humanDeviceCredential.create({
          data: {
            id: randomUUID(),
            credentialFamilyId: family.id,
            userId: installation.userId,
            deviceId: request.deviceId,
            vaultId: request.vaultId,
            deviceName: request.deviceName,
            credentialHash,
            status: 'provisional',
            provisionalExpiresAt: new Date(now.getTime() + PROVISIONAL_TTL_MS),
          },
        });
        await this.audit.record({
          action: 'obsidian.installation.exchange',
          outcome: 'success',
          actorUserId: installation.userId,
          ipAddress,
          metadata: { installationId: installation.id, credentialId: credential.id, exchangeId: request.exchangeId },
        });
        const serverInstanceId = await this.crypto.getServerInstanceId();
        return this.exchangeResponse(serverInstanceId, credential, installation);
      }, { isolationLevel: 'Serializable' });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        throw new SyncApiException('CREDENTIAL_COLLISION', 'Credential collision; retry with a fresh credential');
      }
      throw error;
    }
  }

  async getSession(principal: { userId: string; credentialId: string }) {
    const credential = await this.prisma.humanDeviceCredential.findUnique({
      where: { id: principal.credentialId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!credential || credential.userId !== principal.userId) {
      throw new SyncApiException('AUTHENTICATION_REQUIRED', 'Device credential not found');
    }
    const serverInstanceId = await this.crypto.getServerInstanceId();
    return this.sessionResponse(serverInstanceId, credential);
  }

  async activate(principal: { userId: string; credentialId: string; credentialFamilyId: string }, credentialId: string) {
    if (credentialId !== principal.credentialId) {
      throw new SyncApiException('PAYLOAD_INVALID', 'credentialId does not match the authenticated credential');
    }
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const credential = await tx.humanDeviceCredential.findUnique({
        where: { id: principal.credentialId },
      });
      if (!credential) throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential not found');
      if (credential.status === 'active') {
        const serverInstanceId = await this.crypto.getServerInstanceId();
        return this.sessionResponse(serverInstanceId, credential);
      }
      if (credential.status !== 'provisional' || !credential.provisionalExpiresAt || credential.provisionalExpiresAt <= now) {
        throw new SyncApiException('DEVICE_CREDENTIAL_EXPIRED', 'Provisional credential has expired');
      }
      await tx.humanDeviceCredential.updateMany({
        where: { credentialFamilyId: credential.credentialFamilyId, status: 'active' },
        data: { status: 'revoked', revokedAt: now },
      });
      const updated = await tx.humanDeviceCredential.update({
        where: { id: credential.id },
        data: { status: 'active', provisionalExpiresAt: null, activatedAt: now },
        include: { user: { select: { id: true, name: true } } },
      });
      await this.audit.record({
        action: 'obsidian.credential.activate',
        outcome: 'success',
        actorUserId: credential.userId,
        metadata: { credentialId: credential.id },
      });
      const serverInstanceId = await this.crypto.getServerInstanceId();
      return this.sessionResponse(serverInstanceId, updated);
    }, { isolationLevel: 'Serializable' });
  }

  async revokeCurrent(principal: { userId: string; credentialId: string }) {
    const credential = await this.prisma.humanDeviceCredential.findUnique({
      where: { id: principal.credentialId },
    });
    if (!credential || credential.userId !== principal.userId || credential.status === 'revoked') {
      throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential is already revoked');
    }
    await this.prisma.humanDeviceCredential.update({
      where: { id: credential.id },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'obsidian.credential.revoke',
      outcome: 'success',
      actorUserId: credential.userId,
      metadata: { credentialId: credential.id },
    });
  }

  async listCredentials(userId: string): Promise<HumanDeviceCredentialSummary[]> {
    const credentials = await this.prisma.humanDeviceCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return credentials.map((c) => ({
      credentialId: c.id,
      deviceId: c.deviceId,
      vaultId: c.vaultId,
      deviceName: c.deviceName,
      status: c.status as HumanDeviceCredentialSummary['status'],
      provisionalExpiresAt: c.provisionalExpiresAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
    }));
  }

  async revokeCredential(userId: string, credentialId: string) {
    const credential = await this.prisma.humanDeviceCredential.findUnique({
      where: { id: credentialId },
    });
    if (!credential || credential.userId !== userId) {
      throw new SyncApiException('INSTALLATION_NOT_FOUND', 'Credential not found');
    }
    if (credential.status === 'revoked') return;
    await this.prisma.humanDeviceCredential.update({
      where: { id: credentialId },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'obsidian.credential.revoke',
      outcome: 'success',
      actorUserId: userId,
      metadata: { credentialId },
    });
  }

  private async upsertFamily(
    tx: any,
    userId: string,
    request: ExchangeObsidianCredentialRequest,
  ) {
    try {
      return await tx.humanDeviceCredentialFamily.create({
        data: { id: randomUUID(), userId, deviceId: request.deviceId, vaultId: request.vaultId },
      });
    } catch (error: unknown) {
      if (!this.isUniqueViolation(error)) throw error;
      return tx.humanDeviceCredentialFamily.findUnique({
        where: { userId_deviceId_vaultId: { userId, deviceId: request.deviceId, vaultId: request.vaultId } },
      });
    }
  }

  private async expireFamilyProvisionals(tx: any, familyId: string) {
    await tx.humanDeviceCredential.updateMany({
      where: { credentialFamilyId: familyId, status: 'provisional' },
      data: { status: 'revoked', revokedAt: new Date() },
    });
  }

  private async findFamilyProvisional(installationId: string, request: ExchangeObsidianCredentialRequest) {
    const installation = await this.prisma.obsidianInstallation.findUnique({
      where: { id: installationId },
    });
    if (!installation) return null;
    return this.prisma.humanDeviceCredential.findFirst({
      where: {
        userId: installation.userId,
        deviceId: request.deviceId,
        vaultId: request.vaultId,
        status: 'provisional',
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private exchangeResponse(serverInstanceId: string, credential: any, installation: any) {
    return {
      protocolVersion: '1' as const,
      serverInstanceId,
      credentialId: credential.id,
      credentialStatus: 'provisional' as const,
      provisionalExpiresAt: credential.provisionalExpiresAt.toISOString(),
      user: { id: installation.user.id, displayName: installation.user.name ?? installation.user.id },
      capabilities: DEFAULT_SYNC_CAPABILITIES,
    };
  }

  private sessionResponse(serverInstanceId: string, credential: any): HumanDeviceSessionResponse {
    return {
      protocolVersion: '1',
      serverInstanceId,
      credentialId: credential.id,
      deviceId: credential.deviceId,
      deviceName: credential.deviceName,
      vaultId: credential.vaultId,
      createdAt: credential.createdAt.toISOString(),
      lastUsedAt: credential.lastUsedAt?.toISOString() ?? credential.createdAt.toISOString(),
      credentialStatus: credential.status as 'provisional' | 'active',
      provisionalExpiresAt: credential.provisionalExpiresAt?.toISOString() ?? null,
      user: { id: credential.userId, displayName: credential.user?.name ?? credential.userId },
      capabilities: DEFAULT_SYNC_CAPABILITIES,
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as any).code === 'P2002';
  }

  private async assertExchangeRateLimit(ipAddress: string): Promise<void> {
    const bucket = Math.floor(Date.now() / (15 * 60 * 1_000));
    const ipHash = this.crypto.credentialHash(`exchange:${ipAddress}`).slice(0, 16);
    const count = await this.redis.incrementWithWindow(
      `obsidian:exchange-rate:${bucket}:${ipHash}`,
      15 * 60 + 1,
    );
    if (count === null || count > 10) {
      throw new SyncApiException('RATE_LIMITED', 'Too many exchange attempts');
    }
  }
}
