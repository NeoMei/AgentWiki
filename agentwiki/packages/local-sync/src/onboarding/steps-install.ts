import { AgentWikiClient } from '../agentwiki-client.js';
import { assertConfirmedGatewayConfig } from '../installer/client-config.js';
import { assertConfirmedBootstrap, installExchangedGateway, productionDependencies } from './install.js';
import type { StepState } from './steps.js';

/** Cache remote receipts before touching user configuration; reuse secure installer validation/backup/hash checks. */
export async function installStepConnection(
  state: StepState,
  home: string,
  save: () => Promise<void>,
): Promise<void> {
  const bootstrap = state.bootstrap!;
  assertConfirmedBootstrap(bootstrap, state.plan!);
  await assertConfirmedGatewayConfig(state.clientType, state.sessionId, state.configHash!, home);
  const request: typeof fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const client = new AgentWikiClient(request);
  if (!state.exchange) {
    state.exchange = await client.exchange(state.serverBaseUrl, bootstrap.installation.code);
    await save();
  }
  if (new URL(state.exchange.serverUrl).origin !== new URL(state.serverBaseUrl).origin)
    throw new Error('PACKAGE_INTEGRITY_FAILED: exchange server origin changed');
  const deps = productionDependencies(request);
  const result = await installExchangedGateway(
    {
      home,
      client: state.clientType,
      connectionId: state.sessionId,
      expectedConfigHash: state.configHash!,
      expectedAgentId: bootstrap.agent.id,
      expectedSpaceId: bootstrap.space.id,
      expectedRole: bootstrap.grant.role,
      expectedScopes: bootstrap.grant.scopes,
      expectedPluginVersion: '0.10.0',
      exchange: state.exchange,
      retainOnFailure: true,
      onConfigured: async (backupPath) => {
        state.configured = true;
        state.configBackupPath = backupPath;
        await save();
      },
    },
    // loadExisting identifies a replay of this exact connection. An old session
    // archive flag cannot establish ownership of the current active state.
    deps,
  );
  state.manifestHash = result.manifestHash;
}
