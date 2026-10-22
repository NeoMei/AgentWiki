import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes } from 'crypto';
import {
  AgentAccessRoleSchema,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';
import { RedisService } from '../../database/redis.service';
import { BusinessException } from '../filters/business-error';
import {
  CURRENT_LOCAL_SYNC_VERSION,
  isSupportedLocalSyncVersion,
  type SupportedLocalSyncVersion,
} from '../local-sync-version';
import { AuditService } from '../security/audit.service';
import { AgentService } from './agent.service';

interface InstallationPayload {
  installationId: string;
  ownerId: string;
  agentId: string;
  spaceId: string;
  role: AgentAccessRole;
  pluginVersion: string;
  serverUrl: string;
  expiresAt: string;
}

interface ExchangeReceipt {
  ownerId: string;
  agentId: string;
  spaceId: string;
  credentialId: string;
  grantId: string;
  role: AgentAccessRole;
  serverUrl: string;
  pluginVersion: SupportedLocalSyncVersion;
  expiresAt: string;
}

export interface InstallationExchangeResult {
  credentialScope: 'agent';
  apiKey: string;
  agentId: string;
  spaceId: string;
  credentialId: string;
  role: AgentAccessRole;
  serverUrl: string;
  pluginVersion: SupportedLocalSyncVersion;
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
    spaceId: string;
    role: AgentAccessRole;
    pluginVersion: string;
    serverUrl: string;
  }) {
    return this.create(
      input.ownerId,
      input.agentId,
      input.spaceId,
      input.role,
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
    spaceId: string,
    role: AgentAccessRole,
    pluginVersion: string,
    serverUrl: string,
    isSuperAdmin = false,
  ): Promise<{
    installationId: string;
    code: string;
    expiresAt: string;
    instructions: string;
  }> {
    this.assertSupportedVersion(pluginVersion);
    const canonicalServerUrl = serverUrl.replace(/\/+$/, '');
    this.assertSafeServerUrl(canonicalServerUrl);
    await this.agents.assertCanIssueConnection(ownerId, agentId, spaceId, isSuperAdmin, role);
    const expiresAt = new Date(Date.now() + INSTALLATION_TTL_SECONDS * 1_000).toISOString();

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const randomPart = randomBytes(18).toString('base64url').toUpperCase().replace(/_/g, '-');
      const code = `AW-${randomPart}`;
      const installationId = this.hash(code);
      const payload: InstallationPayload = {
        installationId,
        ownerId,
        agentId,
        spaceId,
        role,
        pluginVersion,
        serverUrl: canonicalServerUrl,
        expiresAt,
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
          instructions: this.instructions(code, pluginVersion, canonicalServerUrl, agentId, spaceId),
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
    const rawKey = this.installationApiKey(installationId);
    const credential = await this.agents.exchangeConnectionIntent({
      ownerId: payload.ownerId,
      agentId: payload.agentId,
      spaceId: payload.spaceId,
      role: payload.role,
      installationId,
      rawKey,
    });
    const scopes = credential.scopes;
    try {
      await this.audit.record({
        action: 'local-sync.installation.exchange',
        outcome: 'success',
        actorAgentId: payload.agentId,
        ipAddress,
        metadata: {
          credentialId: credential.id,
          installationId,
          spaceId: payload.spaceId,
          role: payload.role,
          pluginVersion: payload.pluginVersion,
          scopes,
        },
      });

      const result: InstallationExchangeResult = {
        credentialScope: 'agent',
        apiKey: rawKey,
        agentId: payload.agentId,
        spaceId: payload.spaceId,
        credentialId: credential.id,
        role: payload.role,
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
        spaceId: payload.spaceId,
        credentialId: credential.id,
        grantId: credential.grantId,
        role: payload.role,
        serverUrl: payload.serverUrl,
        pluginVersion: payload.pluginVersion,
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
      credentialId = typeof value.credentialId === 'string' ? value.credentialId : undefined;
      if (
        typeof value.ownerId !== 'string'
        || typeof value.agentId !== 'string'
        || typeof value.spaceId !== 'string'
        || typeof value.credentialId !== 'string'
        || typeof value.grantId !== 'string'
        || !AgentAccessRoleSchema.safeParse(value.role).success
        || typeof value.serverUrl !== 'string'
        || !isSupportedLocalSyncVersion(value.pluginVersion)
        || typeof value.expiresAt !== 'string'
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
      const authorization = await this.agents.assertConnectionReceipt({
        ownerId: receipt.ownerId,
        agentId: receipt.agentId,
        credentialId: receipt.credentialId,
        grantId: receipt.grantId,
        spaceId: receipt.spaceId,
        role: receipt.role,
      });
      return {
        credentialScope: 'agent',
        apiKey: this.installationApiKey(installationId),
        agentId: receipt.agentId,
        spaceId: receipt.spaceId,
        credentialId: receipt.credentialId,
        role: receipt.role,
        serverUrl: receipt.serverUrl,
        pluginVersion: receipt.pluginVersion,
        scopes: authorization.scopes,
      };
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      await this.deleteReceipt(installationId, credentialId);
      throw new BusinessException('LOCAL_SYNC_CODE_INVALID');
    }
  }

  private async deleteReceipt(installationId: string, credentialId?: string): Promise<void> {
    await Promise.all([
      this.redis.deleteStrict(this.exchangeReceiptKey(installationId)).catch(() => undefined),
      ...(credentialId
        ? [this.redis.deleteStrict(this.credentialReceiptKey(credentialId)).catch(() => undefined)]
        : []),
    ]);
  }

  private assertSupportedVersion(
    pluginVersion: string,
  ): asserts pluginVersion is SupportedLocalSyncVersion {
    const configured = this.config.get<string>('LOCAL_SYNC_PACKAGE_VERSION');
    if (
      !isSupportedLocalSyncVersion(configured)
      || !isSupportedLocalSyncVersion(pluginVersion)
    ) {
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
        || typeof value.spaceId !== 'string'
        || !AgentAccessRoleSchema.safeParse(value.role).success
        || typeof value.pluginVersion !== 'string'
        || typeof value.serverUrl !== 'string'
        || typeof value.expiresAt !== 'string'
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

  private instructions(code: string, pluginVersion: string, serverUrl: string, agentId: string, spaceId: string): string {
    // Historical packages keep their supported client options. The current
    // candidate and its public setup instructions must be released together.
    const genericMcp = pluginVersion === '0.13.2' || pluginVersion === '0.13.3' || pluginVersion === '0.13.4' || pluginVersion === CURRENT_LOCAL_SYNC_VERSION;
    const hostAwarePreparation = pluginVersion === '0.13.4' || pluginVersion === CURRENT_LOCAL_SYNC_VERSION;
    return [
      `This installation code is bound to the selected Agent ID ${JSON.stringify(agentId)} and Space ID ${JSON.stringify(spaceId)}. Preserve that identity; do not create or rename an Agent based on a client label, sample, or old connection.`,
      ...(hostAwarePreparation ? [
        'Identify the actual current host from its runtime or host metadata before any command. Use --agent codex for Codex, --agent claude for Claude Code, --agent opencode for OpenCode, or --agent workbuddy for that host. Use --agent generic only for other local stdio MCP hosts. If the host cannot be identified, ask the user rather than guessing from an Agent display name.',
        `Before the first npx invocation, read the plain-text runtime preparation at ${serverUrl}/onboard/runtime?client=<host-client>&packageVersion=${pluginVersion}, replacing <host-client> with the identified preset. Complete that preparation in this host and reuse its runner if specified. This preparation does not start onboarding; continue with the same code below.`,
        '--agent selects the host configuration format, not the server Agent name or identity. Replace <host-client> below with the same identified preset before running it.',
      ] : []),
      genericMcp
        ? 'Run this pinned command with your current Agent, which must support local stdio MCP:'
        : 'Run this pinned command with your local Codex, Claude Code, or OpenCode Agent:',
      `npx --yes @neomei/agentwiki-local-sync@${pluginVersion} onboard --server ${serverUrl} --code ${code} --protocol ndjson --agent ${hostAwarePreparation ? '<host-client>' : genericMcp ? 'generic' : 'auto'}`,
      ...(genericMcp ? [
        hostAwarePreparation
          ? 'The generic mode exports MCP settings for import into this host. Known host presets write only that host configuration; preserve other client settings.'
          : 'The generic mode exports MCP settings for import into this host. For WorkBuddy native configuration, replace --agent generic with --agent workbuddy; use --agent codex, claude, or opencode only for those hosts.',
        'Follow the returned configurationMode, configPath, and hostActivationSteps. For manual-import, import mcpServers.agentwiki or create a stdio MCP service with the exact command and args, preserving other host settings. If you cannot operate the settings, show the export path and wait for the user to finish.',
      ] : []),
      'Enable agentwiki and approve the client MCP/tool permissions; browser or website account approval does not replace client authorization.',
      'Reload MCP after installation. If reload is unavailable, tools remain missing, or they still show the old Agent/Spaces, fully quit and restart the client, then start a new conversation. Compare onboard_status gateway.connection (connectionId, agentId, client) with the installation result before treating a denied read as missing Space authorization. For older gateways without this field, check the running process and client configuration --connection arguments.',
      'After installation, report the complete doctor output to the user.',
      'Configuration and gateway checks do not verify the host. Use this host\'s agentwiki MCP wiki_* tools to read a known page the user can access and verify its title and content before reporting successful host access.',
      'Installation only configures the unified agentwiki gateway; it does not scan or sync local knowledge.',
    ].join('\n');
  }
}
