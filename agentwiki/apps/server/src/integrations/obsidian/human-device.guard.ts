import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncApiException } from './sync-error';
import { syncProtocolFromRequestPath } from './sync-request-protocol';

export interface HumanDevicePrincipal {
  userId: string;
  credentialId: string;
  credentialFamilyId: string;
  deviceId: string;
  vaultId: string;
  status: 'provisional' | 'active';
  platformRole: 'user' | 'super_admin';
}

@Injectable()
export class HumanDeviceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ObsidianCryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const protocolVersion = syncProtocolFromRequestPath(request) ?? '1';
    const error = (code: 'AUTHENTICATION_REQUIRED' | 'USER_INACTIVE' | 'DEVICE_CREDENTIAL_EXPIRED' | 'DEVICE_CREDENTIAL_REVOKED', message: string) => (
      new SyncApiException(code, message, undefined, protocolVersion)
    );
    const header = String(request.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      throw error('AUTHENTICATION_REQUIRED', 'Bearer credential required');
    }
    const credential = header.slice('Bearer '.length).trim();
    if (!credential) {
      throw error('AUTHENTICATION_REQUIRED', 'Bearer credential required');
    }
    const credentialHash = this.crypto.credentialHash(credential);
    const record = await this.prisma.humanDeviceCredential.findUnique({
      where: { credentialHash },
      include: { user: { select: { deletedAt: true, lockedAt: true, type: true, platformRole: true } } },
    });
    if (!record) {
      throw error('AUTHENTICATION_REQUIRED', 'Device credential not found');
    }
    if (record.user.deletedAt || record.user.lockedAt || record.user.type !== 'human') {
      throw error('USER_INACTIVE', 'User account is unavailable');
    }
    const now = new Date();
    if (record.status === 'provisional') {
      if (!record.provisionalExpiresAt || record.provisionalExpiresAt <= now) {
        await this.prisma.humanDeviceCredential.update({
          where: { id: record.id },
          data: { status: 'expired' },
        });
        throw error('DEVICE_CREDENTIAL_EXPIRED', 'Provisional device credential has expired');
      }
    } else if (record.status === 'expired') {
      throw error('DEVICE_CREDENTIAL_EXPIRED', 'Device credential has expired');
    } else if (record.status !== 'active') {
      throw error('DEVICE_CREDENTIAL_REVOKED', 'Device credential is not active');
    }
    await this.prisma.humanDeviceCredential.update({
      where: { id: record.id },
      data: { lastUsedAt: now },
    });
    request.user = {
      userId: record.userId,
      credentialId: record.id,
      credentialFamilyId: record.credentialFamilyId,
      deviceId: record.deviceId,
      vaultId: record.vaultId,
      status: record.status as 'provisional' | 'active',
      platformRole: record.user.platformRole as 'user' | 'super_admin',
    } satisfies HumanDevicePrincipal;
    return true;
  }
}
