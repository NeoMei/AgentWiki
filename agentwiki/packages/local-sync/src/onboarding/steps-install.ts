import { AgentWikiClient } from '../agentwiki-client.js';
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
      expectedPluginVersion: '0.9.1',
      exchange: state.exchange,
      retainOnFailure: true,
      onConfigured: async (backupPath) => {
        state.configured = true;
        state.configBackupPath = backupPath;
        await save();
      },
    },
    {
      ...deps,
      // Do not repeatedly archive a partially installed state after a process crash.
      archive: async () => {
        if (state.archiveStarted) return null;
        const archive = await deps.archive(home);
        state.archiveStarted = true;
        await save();
        return archive;
      },
    },
  );
  state.manifestHash = result.manifestHash;
}
