import {
  scopesForAgentAccessRole,
  type AgentAccessRole,
} from '@neomei/agentwiki-sync-protocol';
import type { BootstrapResult } from './client.js';
import { OnboardingClient } from './client.js';
import type { BootstrapInstallFn } from './coordinator.js';
import { OnboardingError } from './errors.js';
import { AgentWikiClient, type ExchangeResult } from '../agentwiki-client.js';
import { installSkill, packagedSkillSource } from '../agent-clients.js';
import { loadConfig, loadCredentials, saveConfig, saveCredentials, type LocalSyncConnection } from '../config.js';
import { archiveLegacyState, initCleanState, restoreArchivedState, type ArchiveResult } from '../installer/archive.js';
import { installGatewayEntry } from '../installer/client-config.js';
import { gatewayCommand } from '../installer/plan.js';
import { verifyGateway, type VerifyResult } from './verifier.js';

type InstallInput = Parameters<BootstrapInstallFn>[0];

export interface BootstrapInstallerDeps {
  bootstrap(input: InstallInput): Promise<BootstrapResult>;
  loadExisting(home: string, connectionId: string): Promise<{ connection: LocalSyncConnection; apiKey: string } | null>;
  archive(home: string): Promise<ArchiveResult | null>;
  initialize(home: string): Promise<void>;
  exchange(serverBaseUrl: string, code: string): Promise<ExchangeResult>;
  saveConnection(home: string, connection: LocalSyncConnection, apiKey: string): Promise<void>;
  installSkill(home: string, client: InstallInput['client']): Promise<unknown>;
  installClient(
    client: InstallInput['client'],
    connectionId: string,
    expectedConfigHash: string,
    home: string,
    serverBaseUrl?: string,
  ): Promise<{ backupPath: string; rollback: () => Promise<void> }>;
  verify(connectionId: string, home: string): Promise<VerifyResult>;
  verifyAccess(
    connection: LocalSyncConnection,
    apiKey: string,
    expected: { agentId: string; spaceId: string; role: AgentAccessRole; scopes: string[] },
  ): Promise<void>;
  revokeCredential(connection: LocalSyncConnection, apiKey: string): Promise<void>;
  restore(home: string, archive: ArchiveResult | null): Promise<void>;
}

export function createBootstrapInstaller(overrides: Partial<BootstrapInstallerDeps> = {}): BootstrapInstallFn {
  const deps = { ...productionDependencies(), ...overrides };
  return async (input) => {
    const bootstrap = await deps.bootstrap(input);
    assertConfirmedBootstrap(bootstrap, input.serverPlan);
    let rollbackConfig: (() => Promise<void>) | undefined;
    try {
      const existing = await deps.loadExisting(input.home, input.connectionId);
      let connection: LocalSyncConnection;
      let apiKey: string;
      if (existing) {
        connection = existing.connection;
        apiKey = existing.apiKey;
        if (connection.agentId !== bootstrap.agent.id || connection.pluginVersion !== input.serverPlan.packageVersion) {
          throw new OnboardingError({
            code: 'PACKAGE_INTEGRITY_FAILED',
            message: 'saved onboarding connection does not match the bootstrap result',
            retryable: false,
          });
        }
      } else {
        const exchange = await deps.exchange(input.serverBaseUrl, bootstrap.installation.code);
        assertExchange(exchange, bootstrap, input.serverPlan.packageVersion);
        const installed = await installExchangedGateway({
          home: input.home,
          client: input.client,
          connectionId: input.connectionId,
          expectedConfigHash: input.expectedConfigHash,
          expectedAgentId: bootstrap.agent.id,
          expectedSpaceId: bootstrap.space.id,
          expectedRole: bootstrap.grant.role,
          expectedScopes: bootstrap.grant.scopes,
          expectedPluginVersion: input.serverPlan.packageVersion,
          exchange,
        }, deps);
        return {
          bootstrap,
          reloadRequired: input.client === 'opencode',
          configBackupPath: installed.configBackupPath,
          manifestHash: installed.manifestHash,
          connectionId: input.connectionId,
        };
      }
      const installed = await deps.installClient(
        input.client,
        input.connectionId,
        input.expectedConfigHash,
        input.home,
        connection.serverUrl,
      );
      rollbackConfig = installed.rollback;

      const verified = await deps.verify(input.connectionId, input.home);
      if (!verified.ok) {
        throw new OnboardingError({
          code: 'MCP_HANDSHAKE_FAILED',
          message: verified.errors.join('; ') || 'gateway verification failed',
          retryable: true,
        });
      }
      await deps.verifyAccess(connection, apiKey, {
        agentId: bootstrap.agent.id,
        spaceId: bootstrap.space.id,
        role: bootstrap.grant.role,
        scopes: bootstrap.grant.scopes,
      });

      return {
        bootstrap,
        reloadRequired: input.client === 'opencode',
        configBackupPath: installed.backupPath,
        manifestHash: verified.manifestHash,
        connectionId: input.connectionId,
      };
    } catch (error) {
      let rollbackFailed = false;
      try {
        await rollbackConfig?.();
      } catch {
        rollbackFailed = true;
      }
      if (rollbackFailed) {
        throw new OnboardingError({
          code: 'SYNC_FAILED',
          message: 'gateway replay failed; cleanup is incomplete: client configuration rollback',
          retryable: false,
          nextAction: 'Restore the client configuration from the latest backup before retrying.',
        });
      }
      throw error;
    }
  };
}

export interface ExchangedGatewayInstallInput {
  home: string;
  client: InstallInput['client'];
  connectionId: string;
  expectedConfigHash: string;
  expectedAgentId: string;
  expectedSpaceId: string;
  expectedRole: AgentAccessRole;
  expectedScopes: string[];
  expectedPluginVersion: '0.6.0';
  exchange: ExchangeResult;
}

export async function installExchangedGateway(
  input: ExchangedGatewayInstallInput,
  overrides: Partial<BootstrapInstallerDeps> = {},
): Promise<{
  connection: LocalSyncConnection;
  configBackupPath: string;
  manifestHash: string;
}> {
  const deps = { ...productionDependencies(), ...overrides };
  assertExchangePackage(input.exchange, {
    agentId: input.expectedAgentId,
    spaceId: input.expectedSpaceId,
    role: input.expectedRole,
    scopes: input.expectedScopes,
    pluginVersion: input.expectedPluginVersion,
  });

  const connection: LocalSyncConnection = {
    id: input.connectionId,
    serverUrl: input.exchange.serverUrl,
    agentId: input.exchange.agentId,
    credentialId: input.exchange.credentialId,
    pluginVersion: input.exchange.pluginVersion,
    client: input.client,
    mcpName: 'agentwiki',
  };
  const existing = await deps.loadExisting(input.home, input.connectionId);
  if (existing) {
    if (
      existing.connection.agentId !== connection.agentId
      || existing.connection.credentialId !== connection.credentialId
      || existing.connection.serverUrl !== connection.serverUrl
      || existing.connection.pluginVersion !== connection.pluginVersion
      || existing.connection.client !== connection.client
      || existing.connection.mcpName !== connection.mcpName
      || existing.apiKey !== input.exchange.apiKey
    ) {
      throw new OnboardingError({
        code: 'PACKAGE_INTEGRITY_FAILED',
        message: 'existing local connection does not match the installation exchange replay',
        retryable: false,
      });
    }
    let rollbackConfig: (() => Promise<void>) | undefined;
    try {
      const installed = await deps.installClient(
        input.client,
        input.connectionId,
        input.expectedConfigHash,
        input.home,
        input.exchange.serverUrl,
      );
      rollbackConfig = installed.rollback;
      const verified = await deps.verify(input.connectionId, input.home);
      if (!verified.ok) {
        throw new OnboardingError({
          code: 'MCP_HANDSHAKE_FAILED',
          message: verified.errors.join('; ') || 'gateway verification failed',
          retryable: true,
        });
      }
      await deps.verifyAccess(existing.connection, existing.apiKey, {
        agentId: input.expectedAgentId,
        spaceId: input.expectedSpaceId,
        role: input.expectedRole,
        scopes: input.expectedScopes,
      });
      return {
        connection: existing.connection,
        configBackupPath: installed.backupPath,
        manifestHash: verified.manifestHash,
      };
    } catch (error) {
      let replayRollbackFailed = false;
      try {
        await rollbackConfig?.();
      } catch {
        replayRollbackFailed = true;
      }
      if (replayRollbackFailed) {
        throw new OnboardingError({
          code: 'SYNC_FAILED',
          message: 'gateway replay failed; cleanup is incomplete: client configuration rollback',
          retryable: false,
          nextAction: 'Restore the client configuration from the latest backup before retrying.',
        });
      }
      throw error;
    }
  }
  let archive: ArchiveResult | null = null;
  let rollbackConfig: (() => Promise<void>) | undefined;
  let activatedState = false;
  try {
    archive = await deps.archive(input.home);
    await deps.initialize(input.home);
    activatedState = true;
    await deps.saveConnection(input.home, connection, input.exchange.apiKey);
    await deps.installSkill(input.home, input.client);
    const installed = await deps.installClient(
      input.client,
      input.connectionId,
      input.expectedConfigHash,
      input.home,
      input.exchange.serverUrl,
    );
    rollbackConfig = installed.rollback;
    const verified = await deps.verify(input.connectionId, input.home);
    if (!verified.ok) {
      throw new OnboardingError({
        code: 'MCP_HANDSHAKE_FAILED',
        message: verified.errors.join('; ') || 'gateway verification failed',
        retryable: true,
      });
    }
    await deps.verifyAccess(connection, input.exchange.apiKey, {
      agentId: input.expectedAgentId,
      spaceId: input.expectedSpaceId,
      role: input.expectedRole,
      scopes: input.expectedScopes,
    });
    return {
      connection,
      configBackupPath: installed.backupPath,
      manifestHash: verified.manifestHash,
    };
  } catch (error) {
    let rollbackFailed = false;
    let restoreFailed = false;
    let revokeFailed = false;
    try {
      await rollbackConfig?.();
    } catch {
      rollbackFailed = true;
    }
    try {
      await deps.revokeCredential(connection, input.exchange.apiKey);
    } catch {
      revokeFailed = true;
    }
    if (activatedState) {
      try {
        await deps.restore(input.home, archive);
      } catch {
        restoreFailed = true;
      }
    }
    if (rollbackFailed || restoreFailed || revokeFailed) {
      const incomplete = [
        rollbackFailed ? 'client configuration rollback' : null,
        restoreFailed ? 'local state restore' : null,
        revokeFailed ? `credential ${connection.credentialId} revoke` : null,
      ].filter(Boolean).join(', ');
      throw new OnboardingError({
        code: 'SYNC_FAILED',
        message: `gateway installation failed; cleanup is incomplete: ${incomplete}`,
        retryable: false,
        nextAction: `Repair ${incomplete} manually before retrying.`,
      });
    }
    throw error;
  }
}

function productionDependencies(): BootstrapInstallerDeps {
  const onboarding = new OnboardingClient();
  const agentwiki = new AgentWikiClient();
  return {
    bootstrap: (input) => onboarding.bootstrap({
      serverBaseUrl: input.serverBaseUrl,
      onboardingToken: input.onboardingToken,
      idempotencyKey: input.idempotencyKey,
      serverPlan: input.serverPlan,
      serverPlanHash: input.serverPlanHash,
    }),
    loadExisting: async (home, connectionId) => {
      const config = await loadConfig(home);
      const connection = config.connections[connectionId];
      if (!connection) return null;
      const credentials = await loadCredentials(home);
      const apiKey = credentials.credentials[connection.credentialId]?.apiKey;
      return apiKey ? { connection, apiKey } : null;
    },
    archive: archiveLegacyState,
    initialize: initCleanState,
    exchange: (serverBaseUrl, code) => agentwiki.exchange(serverBaseUrl, code),
    saveConnection: async (home, connection, apiKey) => {
      const config = await loadConfig(home);
      config.connections = { [connection.id]: connection };
      config.defaultConnectionId = connection.id;
      const credentials = await loadCredentials(home);
      credentials.credentials = { [connection.credentialId]: { apiKey } };
      await saveConfig(home, config);
      await saveCredentials(home, credentials);
    },
    installSkill: (home, client) => installSkill(home, packagedSkillSource, client),
    installClient: installGatewayEntry,
    verify: (connectionId, home) => verifyGateway({
      command: process.env.AGENTWIKI_E2E_CLI_FILE
        ? [process.execPath, process.env.AGENTWIKI_E2E_CLI_FILE, 'gateway', '--connection', connectionId]
        : gatewayCommand(connectionId),
      cwd: home,
      env: { ...process.env, HOME: home } as Record<string, string>,
    }),
    verifyAccess: async (connection, apiKey, expected) => {
      const access = await agentwiki.access(connection, apiKey);
      const agent = access.access.find((candidate) => candidate.id === expected.agentId);
      const hasSpace = agent?.grants.some((grant) => (
        grant.space.id === expected.spaceId && grant.role === expected.role
      )) ?? false;
      const hasCredential = agent?.credentials.some((credential) => (
        credential.id === connection.credentialId
        && credential.active
        && credential.authorization.id.length > 0
        && credential.authorization.space.id === expected.spaceId
        && credential.authorization.role === expected.role
        && sameScopes(credential.authorization.scopes, expected.scopes)
      )) ?? false;
      if (agent?.status !== 'active' || !hasSpace || !hasCredential) {
        throw new OnboardingError({
          code: 'TOOLSET_MISMATCH',
          message: 'gateway remote identity or bound Space authorization verification failed',
          retryable: false,
        });
      }
    },
    revokeCredential: (connection, apiKey) => agentwiki.revokeCurrentCredential(connection, apiKey),
    restore: restoreArchivedState,
  };
}

function assertExchange(exchange: ExchangeResult, bootstrap: BootstrapResult, version: '0.6.0'): void {
  assertExchangePackage(exchange, {
    agentId: bootstrap.agent.id,
    spaceId: bootstrap.space.id,
    role: bootstrap.grant.role,
    scopes: bootstrap.grant.scopes,
    pluginVersion: version,
  });
}

function assertConfirmedBootstrap(bootstrap: BootstrapResult, plan: InstallInput['serverPlan']): void {
  const canonicalScopes = scopesForAgentAccessRole(plan.role);
  const wrongExistingSpace = plan.space.mode === 'existing' && bootstrap.space.id !== plan.space.id;
  const wrongCreatedSpace = plan.space.mode === 'create' && bootstrap.space.name !== plan.space.name;
  if (
    wrongExistingSpace
    || wrongCreatedSpace
    || bootstrap.agent.name !== plan.agentName
    || bootstrap.grant.role !== plan.role
    || !sameScopes(bootstrap.grant.scopes, canonicalScopes)
  ) {
    throw new OnboardingError({
      code: 'PACKAGE_INTEGRITY_FAILED',
      message: 'bootstrap access package does not match the confirmed plan',
      retryable: false,
    });
  }
}

function assertExchangePackage(
  exchange: ExchangeResult,
  expected: {
    agentId: string;
    spaceId: string;
    role: AgentAccessRole;
    scopes: string[];
    pluginVersion: '0.6.0';
  },
): void {
  const canonicalScopes = scopesForAgentAccessRole(expected.role);
  if (
    expected.pluginVersion !== '0.6.0'
    || exchange.pluginVersion !== '0.6.0'
    || exchange.pluginVersion !== expected.pluginVersion
    || exchange.agentId !== expected.agentId
    || exchange.spaceId !== expected.spaceId
    || exchange.role !== expected.role
    || !sameScopes(expected.scopes, canonicalScopes)
    || !sameScopes(exchange.scopes, canonicalScopes)
  ) {
    throw new OnboardingError({
      code: 'PACKAGE_INTEGRITY_FAILED',
      message: 'installation exchange does not match the confirmed Agent, Space, role, scopes, or package version',
      retryable: false,
    });
  }
}

function sameScopes(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((scope, index) => scope === expected[index]);
}
