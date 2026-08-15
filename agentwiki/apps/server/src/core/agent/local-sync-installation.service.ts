import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'crypto';
import { RedisService } from '../../database/redis.service';
import { BusinessException } from '../filters/business-error';
import { AuditService } from '../security/audit.service';
import { AgentService } from './agent.service';

interface InstallationPayload {
  installationId: string;
  ownerId: string;
  agentId: string;
  scopes: string[];
  pluginVersion: string;
  serverUrl: string;
  expiresAt: string;
  issuerCredentialId?: string;
}

interface ExchangeReceipt {
  ownerId: string;
  agentId: string;
  credentialId: string;
  serverUrl: string;
  pluginVersion: string;
  scopes: string[];
  expiresAt: string;
}

export interface InstallationExchangeResult {
  apiKey: string;
  agentId: string;
  credentialId: string;
  serverUrl: string;
  pluginVersion: string;
  scopes: string[];
}

const INSTALLATION_TTL_SECONDS = 600;
const INSTALLATION_RECORD_TTL_SECONDS = 900;
const EXCHANGE_RECEIPT_TTL_SECONDS = 120;
const MAX_CODE_GENERATION_ATTEMPTS = 3;
const EXCHANGE_RATE_LIMIT = 10;
const EXCHANGE_RATE_WINDOW_SECONDS = 60;
const EXCHANGE_LOCK_TTL_SECONDS = 30;
const EXCHANGE_LOCK_ATTEMPTS = 20;
const EXCHANGE_LOCK_WAIT_MS = 50;

@Injectable()
export class LocalSyncInstallationService {
  constructor(
    private readonly redis: RedisService,
    private readonly agents: AgentService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  issueForBootstrap(input: {
    ownerId: string;
    agentId: string;
    scopes: string[];
    pluginVersion: string;
    serverUrl: string;
  }) {
    return this.create(
      input.ownerId,
      input.agentId,
      input.scopes,
      input.pluginVersion,
      input.serverUrl,
    );
  }

  async revokeCredentialAndReceipts(ownerId: string, agentId: string, credentialId: string) {
    const result = await this.agents.revokeCredential(ownerId, agentId, credentialId);
    await (async () => {
      const installationId = await this.redis.getStrict(this.credentialReceiptKey(credentialId));
      if (!installationId) return;
      await Promise.all([
        this.redis.deleteStrict(this.exchangeReceiptKey(installationId)).catch(() => undefined),
        this.redis.deleteStrict(this.credentialReceiptKey(credentialId)).catch(() => undefined),
      ]);
    })().catch(() => undefined);
    return result;
  }

  async create(
    ownerId: string,
    agentId: string,
    scopes: string[],
    pluginVersion: string,
    serverUrl: string,
    issuer?: { credentialId: string; scopes: string[] },
  ): Promise<{
    installationId: string;
    code: string;
    expiresAt: string;
    instructions: string;
  }> {
    const agent = await this.agents.getOwned(ownerId, agentId);
    if (agent.status !== 'active') {
      throw new BadRequestException('Agent must be active to create a local sync installation');
    }
    const normalizedScopes = this.agents.normalizeCredentialScopes(scopes);
    if (issuer) {
      const issuerScopes = this.agents.normalizeCredentialScopes(issuer.scopes);
      if (!issuer.credentialId || normalizedScopes.some((scope) => !issuerScopes.includes(scope))) {
        throw new ForbiddenException('Agent install scopes cannot exceed the issuing credential');
      }
    }
    this.assertSupportedVersion(pluginVersion);
    const canonicalServerUrl = serverUrl.replace(/\/+$/, '');
    this.assertSafeServerUrl(canonicalServerUrl);
    const expiresAt = new Date(Date.now() + INSTALLATION_TTL_SECONDS * 1_000).toISOString();

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const randomPart = randomBytes(18).toString('base64url').toUpperCase().replace(/_/g, '-');
      const code = `AW-${randomPart}`;
      const installationId = this.hash(code);
      const payload: InstallationPayload = {
        installationId,
        ownerId,
        agentId,
        scopes: normalizedScopes,
        pluginVersion,
        serverUrl: canonicalServerUrl,
        expiresAt,
        ...(issuer ? { issuerCredentialId: issuer.credentialId } : {}),
      };
      const stored = await this.redis.setOnce(
        this.installationKey(installationId),
        JSON.stringify(payload),
        INSTALLATION_RECORD_TTL_SECONDS,
      );
      if (stored) {
        return {
          installationId,
          code,
          expiresAt,
          instructions: this.instructions(code, pluginVersion, canonicalServerUrl),
        };
      }
    }

    throw new InternalServerErrorException(
      'Could not issue a unique local sync installation code',
    );
  }

  async revoke(
    ownerId: string,
    agentId: string,
    installationId: string,
  ): Promise<{ success: true }> {
    await this.agents.getOwned(ownerId, agentId);
    const key = this.installationKey(installationId);
    const stored = await this.redis.getStrict(key);
    if (!stored) throw new NotFoundException('Local sync installation not found');

    let payload: InstallationPayload;
    try {
      payload = this.parsePayload(stored, installationId);
    } catch {
      throw new NotFoundException('Local sync installation not found');
    }
    if (payload.ownerId !== ownerId || payload.agentId !== agentId) {
      throw new NotFoundException('Local sync installation not found');
    }

    await this.redis.deleteStrict(key);
    return { success: true };
  }

  async exchange(code: string, ipAddress: string): Promise<InstallationExchangeResult> {
    await this.assertExchangeRateLimit(ipAddress);
    const installationId = this.hash(code);
    const replay = await this.readExchangeReceipt(installationId);
    if (replay) return replay;

    const lockKey = this.exchangeLockKey(installationId);
    const lockOwner = randomBytes(16).toString('hex');
    let acquired = false;
    for (let attempt = 0; attempt < EXCHANGE_LOCK_ATTEMPTS; attempt += 1) {
      acquired = await this.redis.setOnce(lockKey, lockOwner, EXCHANGE_LOCK_TTL_SECONDS);
      if (acquired) break;
      await new Promise((resolve) => setTimeout(resolve, EXCHANGE_LOCK_WAIT_MS));
      const concurrentReplay = await this.readExchangeReceipt(installationId);
      if (concurrentReplay) return concurrentReplay;
    }
    if (!acquired) {
      throw new BusinessException('AUTH_RATE_LIMITED', 'Local sync code exchange is already in progress');
    }

    try {
      const lockedReplay = await this.readExchangeReceipt(installationId);
      if (lockedReplay) return lockedReplay;
      return await this.exchangeLocked(installationId, ipAddress);
    } finally {
      await this.redis.deleteIfValueMatches(lockKey, lockOwner).catch(() => undefined);
    }
  }

  private async exchangeLocked(
    installationId: string,
    ipAddress: string,
  ): Promise<InstallationExchangeResult> {
    const stored = await this.redis.getStrict(this.installationKey(installationId));
    if (!stored) throw new BusinessException('LOCAL_SYNC_CODE_INVALID');

    const payload = this.parsePayload(stored, installationId);
    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      throw new BusinessException('LOCAL_SYNC_CODE_EXPIRED');
    }
    this.assertSupportedVersion(payload.pluginVersion);
    const agent = await this.agents.getOwned(payload.ownerId, payload.agentId);
    if (agent.status !== 'active') {
      throw new BadRequestException('Agent must be active to exchange a local sync installation');
    }
    const scopes = this.agents.normalizeCredentialScopes(payload.scopes);
    if (payload.issuerCredentialId) {
      await this.agents.assertCredentialCanDelegate(
        payload.ownerId,
        payload.agentId,
        payload.issuerCredentialId,
        scopes,
      );
    }
    const rawKey = this.installationApiKey(installationId);
    const credential = await this.agents.createInstallationCredential(
      payload.ownerId,
      payload.agentId,
      installationId,
      rawKey,
      scopes,
    );
    try {
      await this.audit.record({
        action: 'local-sync.installation.exchange',
        outcome: 'success',
        actorAgentId: payload.agentId,
        ipAddress,
        metadata: {
          credentialId: credential.id,
          installationId,
          pluginVersion: payload.pluginVersion,
          scopes,
        },
      });

      const result: InstallationExchangeResult = {
        apiKey: rawKey,
        agentId: payload.agentId,
        credentialId: credential.id,
        serverUrl: payload.serverUrl,
        pluginVersion: payload.pluginVersion,
        scopes,
      };
      const remainingSeconds = Math.max(
        1,
        Math.ceil((new Date(payload.expiresAt).getTime() - Date.now()) / 1_000),
      );
      const receiptTtl = Math.min(EXCHANGE_RECEIPT_TTL_SECONDS, remainingSeconds);
      const receipt: ExchangeReceipt = {
        ownerId: payload.ownerId,
        agentId: payload.agentId,
        credentialId: credential.id,
        serverUrl: payload.serverUrl,
        pluginVersion: payload.pluginVersion,
        scopes,
        expiresAt: payload.expiresAt,
      };
      await this.redis.setStrict(
        this.credentialReceiptKey(credential.id),
        installationId,
        receiptTtl,
      );
      await this.redis.setStrict(
        this.exchangeReceiptKey(installationId),
        JSON.stringify(receipt),
        receiptTtl,
      );
      await this.redis.deleteStrict(this.installationKey(installationId)).catch(() => undefined);
      return result;
    } catch (error) {
      await Promise.all([
        this.redis.deleteStrict(this.exchangeReceiptKey(installationId)).catch(() => undefined),
        this.redis.deleteStrict(this.credentialReceiptKey(credential.id)).catch(() => undefined),
      ]);
      throw error;
    }
  }

  private async readExchangeReceipt(
    installationId: string,
  ): Promise<InstallationExchangeResult | null> {
    const serialized = await this.redis.getStrict(this.exchangeReceiptKey(installationId));
    if (!serialized) return null;
    let credentialId: string | undefined;
    let receipt: ExchangeReceipt;
    try {
      const value = JSON.parse(serialized) as Record<string, unknown>;
      if (
        typeof value.ownerId !== 'string'
        || typeof value.agentId !== 'string'
        || typeof value.credentialId !== 'string'
        || typeof value.serverUrl !== 'string'
        || typeof value.pluginVersion !== 'string'
        || typeof value.expiresAt !== 'string'
        || !Array.isArray(value.scopes)
        || value.scopes.some((scope) => typeof scope !== 'string')
      ) {
        throw new Error('invalid exchange receipt');
      }
      receipt = value as unknown as ExchangeReceipt;
      credentialId = receipt.credentialId;
    } catch {
      await this.deleteReceipt(installationId, credentialId);
      throw new BusinessException('LOCAL_SYNC_CODE_INVALID');
    }

    if (new Date(receipt.expiresAt).getTime() <= Date.now()) {
      await this.deleteReceipt(installationId, credentialId);
      return null;
    }
    try {
      await this.agents.assertCredentialCanDelegate(
        receipt.ownerId,
        receipt.agentId,
        receipt.credentialId,
        receipt.scopes,
      );
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.deleteReceipt(installationId, credentialId);
      throw new BusinessException('LOCAL_SYNC_CODE_INVALID');
    }
    return {
      apiKey: this.installationApiKey(installationId),
      agentId: receipt.agentId,
      credentialId: receipt.credentialId,
      serverUrl: receipt.serverUrl,
      pluginVersion: receipt.pluginVersion,
      scopes: receipt.scopes,
    };
  }

  private async deleteReceipt(installationId: string, credentialId?: string): Promise<void> {
    await Promise.all([
      this.redis.deleteStrict(this.exchangeReceiptKey(installationId)).catch(() => undefined),
      ...(credentialId
        ? [this.redis.deleteStrict(this.credentialReceiptKey(credentialId)).catch(() => undefined)]
        : []),
    ]);
  }

  private assertSupportedVersion(pluginVersion: string): void {
    const supported = this.config.get<string>('LOCAL_SYNC_PACKAGE_VERSION');
    if (!supported || pluginVersion !== supported) {
      throw new BusinessException('LOCAL_SYNC_VERSION_UNSUPPORTED');
    }
  }

  private assertSafeServerUrl(serverUrl: string): void {
    try {
      const parsed = new URL(serverUrl);
      const shellSafeUrlPart = /^[a-zA-Z0-9._~:/-]*$/;
      if (
        !['http:', 'https:'].includes(parsed.protocol)
        || parsed.username
        || parsed.password
        || parsed.search
        || parsed.hash
        || !shellSafeUrlPart.test(parsed.hostname)
        || !shellSafeUrlPart.test(parsed.pathname)
        || !shellSafeUrlPart.test(parsed.port)
      ) {
        throw new Error('Unsafe server URL');
      }
    } catch {
      throw new BusinessException(
        'LOCAL_SYNC_VERSION_UNSUPPORTED',
        'Server URL contains unsafe characters',
      );
    }
  }

  private async assertExchangeRateLimit(ipAddress: string): Promise<void> {
    const bucket = Math.floor(Date.now() / (EXCHANGE_RATE_WINDOW_SECONDS * 1_000));
    const ipHash = this.hash(ipAddress).slice(0, 16);
    const count = await this.redis.incrementWithWindow(
      `local-sync:exchange-rate:${bucket}:${ipHash}`,
      EXCHANGE_RATE_WINDOW_SECONDS + 1,
    );
    if (count === null || count > EXCHANGE_RATE_LIMIT) {
      throw new BusinessException('AUTH_RATE_LIMITED', 'Too many local sync code attempts');
    }
  }

  private parsePayload(serialized: string, expectedInstallationId: string): InstallationPayload {
    try {
      const value = JSON.parse(serialized) as Record<string, unknown>;
      if (
        value.installationId !== expectedInstallationId
        || typeof value.ownerId !== 'string'
        || typeof value.agentId !== 'string'
        || !Array.isArray(value.scopes)
        || value.scopes.some((scope) => typeof scope !== 'string')
        || typeof value.pluginVersion !== 'string'
        || typeof value.serverUrl !== 'string'
        || typeof value.expiresAt !== 'string'
        || (value.issuerCredentialId !== undefined && typeof value.issuerCredentialId !== 'string')
        || !Number.isFinite(new Date(value.expiresAt).getTime())
      ) {
        throw new Error('Invalid installation payload');
      }
      return value as unknown as InstallationPayload;
    } catch {
      throw new BusinessException('LOCAL_SYNC_CODE_INVALID');
    }
  }

  private installationKey(installationId: string): string {
    return `local-sync:install:${installationId}`;
  }

  private exchangeReceiptKey(installationId: string): string {
    return `local-sync:install-receipt:${installationId}`;
  }

  private exchangeLockKey(installationId: string): string {
    return `local-sync:install-lock:${installationId}`;
  }

  private credentialReceiptKey(credentialId: string): string {
    return `local-sync:credential-receipt:${credentialId}`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private installationApiKey(installationId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') || process.env.JWT_SECRET;
    if (!secret) throw new InternalServerErrorException('JWT_SECRET is required');
    return `agk_${createHmac('sha256', secret)
      .update(`local-sync-installation:${installationId}`)
      .digest('base64url')}`;
  }

  private instructions(code: string, pluginVersion: string, serverUrl: string): string {
    return [
      'Run this pinned command with your local Agent:',
      `npx --yes @neomei/agentwiki-local-sync@${pluginVersion} onboard --server ${serverUrl} --code ${code} --protocol ndjson --agent auto`,
      'After installation, report the complete doctor output to the user.',
      'Installation only configures the unified agentwiki gateway; it does not scan or sync local knowledge.',
    ].join('\n');
  }
}
