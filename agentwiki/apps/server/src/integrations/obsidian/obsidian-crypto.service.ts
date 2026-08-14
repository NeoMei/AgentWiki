import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import type { SyncCapabilities } from '@neomei/agentwiki-sync-protocol';

export const DEFAULT_SYNC_CAPABILITIES: SyncCapabilities = {
  maxPageBytes: 1_048_576,
  maxBatchBytes: 4_194_304,
  maxBatchItems: 100,
  maxChangeCount: 5_000,
  maxConfirmationBytes: 4_194_304,
  maxClientSpacePages: 5_000,
  maxClientManifestBytes: 4_194_304,
  maxClientTotalBodyBytes: 104_857_600,
  maxResponseBytes: 4_194_304,
  maxPageItems: 100,
  pushSessionTtlSeconds: 900,
};

@Injectable()
export class ObsidianCryptoService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private get pepper(): Buffer {
    const value = this.config.get<string>('AGENTWIKI_SERVER_PEPPER');
    if (!value) throw new Error('AGENTWIKI_SERVER_PEPPER environment variable is required');
    return Buffer.from(value, 'utf8');
  }

  private get deploymentSeed(): Buffer {
    const value = this.config.get<string>('AGENTWIKI_DEPLOYMENT_SEED');
    if (!value) throw new Error('AGENTWIKI_DEPLOYMENT_SEED environment variable is required');
    const seed = Buffer.from(value, 'base64');
    if (seed.length !== 32) {
      throw new Error('AGENTWIKI_DEPLOYMENT_SEED must decode to exactly 32 bytes');
    }
    return seed;
  }

  private hmacHex(domain: string, value: string): string {
    return createHmac('sha256', this.pepper).update(domain).update('\0').update(value).digest('hex');
  }

  installationCodeHash(code: string): string {
    return this.hmacHex('obsidian-installation-code', code);
  }

  credentialHash(credential: string): string {
    return this.hmacHex('human-device-credential', credential);
  }

  deploymentSeedHash(): string {
    return createHmac('sha256', this.pepper)
      .update('agentwiki-deployment-seed')
      .update('\0')
      .update(this.deploymentSeed)
      .digest('hex');
  }

  batchReceipt(sessionId: string, batchIndex: number, batchHash: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${sessionId}\n${batchIndex}\n${batchHash}`)
      .digest('base64url');
  }

  newCode(): string {
    // At least 20 cryptographically secure random bytes, base64url encoded.
    return randomBytes(32).toString('base64url');
  }

  async getServerInstanceId(): Promise<string> {
    const seedHash = this.deploymentSeedHash();
    const existing = await this.prisma.serverInstanceIdentity.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      if (existing.deploymentSeedHash !== seedHash) {
        throw new Error(
          'AGENTWIKI_DEPLOYMENT_SEED does not match the persisted server instance identity; run instance rotate --confirm-new-deployment in maintenance mode',
        );
      }
      return existing.instanceId;
    }
    const created = await this.prisma.serverInstanceIdentity.create({
      data: { instanceId: randomUUID(), deploymentSeedHash: seedHash },
    });
    return created.instanceId;
  }
}
