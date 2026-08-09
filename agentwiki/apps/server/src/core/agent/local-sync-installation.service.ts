import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
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

const INSTALLATION_TTL_SECONDS = 600;
const MAX_CODE_GENERATION_ATTEMPTS = 3;
const EXCHANGE_RATE_LIMIT = 10;
const EXCHANGE_RATE_WINDOW_SECONDS = 60;

@Injectable()
export class LocalSyncInstallationService {
  constructor(
    private readonly redis: RedisService,
    private readonly agents: AgentService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

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
        INSTALLATION_TTL_SECONDS,
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

  async exchange(code: string, ipAddress: string): Promise<{
    apiKey: string;
    agentId: string;
    credentialId: string;
    serverUrl: string;
    pluginVersion: string;
    scopes: string[];
  }> {
    await this.assertExchangeRateLimit(ipAddress);
    const installationId = this.hash(code);
    const stored = await this.redis.getDel(this.installationKey(installationId));
    if (!stored) throw new BusinessException('LOCAL_SYNC_CODE_INVALID');

    const payload = this.parsePayload(stored, installationId);
    if (new Date(payload.expiresAt).getTime() <= Date.now()) {
      throw new BusinessException('LOCAL_SYNC_CODE_INVALID');
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
    const credential = await this.agents.createCredential(payload.ownerId, payload.agentId, {
      name: 'Local sync plugin',
      scopes,
    });
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

      return {
        apiKey: credential.apiKey,
        agentId: payload.agentId,
        credentialId: credential.id,
        serverUrl: payload.serverUrl,
        pluginVersion: payload.pluginVersion,
        scopes,
      };
    } catch (error) {
      try {
        await this.agents.revokeCredential(payload.ownerId, payload.agentId, credential.id);
      } catch {
        // Preserve the original audit failure after attempting cleanup.
      }
      throw error;
    }
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

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private instructions(code: string, pluginVersion: string, serverUrl: string): string {
    return [
      'Run this pinned command with your local Agent:',
      `npx --yes @neomei/agentwiki-local-sync@${pluginVersion} connect --server ${serverUrl} --code ${code} --agent auto`,
      'After installation, report the complete doctor output to the user.',
      'Installation only configures the connection; it does not scan or sync local knowledge.',
    ].join('\n');
  }
}
