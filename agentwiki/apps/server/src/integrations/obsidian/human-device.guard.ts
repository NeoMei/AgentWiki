import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ObsidianCryptoService } from './obsidian-crypto.service';
import { SyncApiException } from './sync-error';

export interface HumanDevicePrincipal {
  userId: string;
  credentialId: string;
  credentialFamilyId: string;
  deviceId: string;
  vaultId: string;
  status: 'provisional' | 'active';
}

@Injectable()
export class HumanDeviceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: ObsidianCryptoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = String(request.headers.authorization || '');
    if (!header.startsWith('Bearer ')) {
      throw new SyncApiException('AUTHENTICATION_REQUIRED', 'Bearer credential required');
    }
    const credential = header.slice('Bearer '.length).trim();
    if (!credential) {
      throw new SyncApiException('AUTHENTICATION_REQUIRED', 'Bearer credential required');
    }
    const credentialHash = this.crypto.credentialHash(credential);
    const record = await this.prisma.humanDeviceCredential.findUnique({
      where: { credentialHash },
      include: { user: { select: { deletedAt: true, lockedAt: true, type: true } } },
    });
    if (!record) {
      throw new SyncApiException('AUTHENTICATION_REQUIRED', 'Device credential not found');
    }
    if (record.user.deletedAt || record.user.lockedAt || record.user.type !== 'human') {
      throw new SyncApiException('USER_INACTIVE', 'User account is unavailable');
    }
    const now = new Date();
    if (record.status === 'provisional') {
      if (!record.provisionalExpiresAt || record.provisionalExpiresAt <= now) {
        await this.prisma.humanDeviceCredential.update({
          where: { id: record.id },
          data: { status: 'expired' },
        });
        throw new SyncApiException('DEVICE_CREDENTIAL_EXPIRED', 'Provisional device credential has expired');
      }
    } else if (record.status !== 'active') {
      throw new SyncApiException('DEVICE_CREDENTIAL_REVOKED', 'Device credential is not active');
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
    } satisfies HumanDevicePrincipal;
    return true;
  }
}
