import { loadConfig, loadCredentials, connectionForSpace, type LocalSyncConfig } from './config.js';
import { AgentWikiClient } from './agentwiki-client.js';

/** Aggregate only one Agent on one server in the selected host client. */
export async function loadSpaceConnections(home: string, connectionId: string) {
  const config = await loadConfig(home);
  const connection = config.connections[connectionId];
  if (!connection) throw new Error(`connection ${connectionId} not found`);
  const credentials = await loadCredentials(home);
  if (!credentials.credentials[connection.credentialId]) throw new Error(`credential ${connection.credentialId} not found`);
  const candidates = Object.values(config.connections).filter((target) =>
    target.agentId === connection.agentId && target.serverUrl.replace(/\/+$/, '') === connection.serverUrl.replace(/\/+$/, '') && target.client === connection.client,
  );
  // Older packages did not persist spaceId. Infer only the current credential's
  // own authorization, never all grants belonging to this Agent.
  if (candidates.some((target) => !target.spaceId)) {
    const client = new AgentWikiClient((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }));
    await Promise.all(candidates.map(async (target, index) => {
      if (target.spaceId) return;
      const secret = credentials.credentials[target.credentialId];
      if (!secret) return;
      try {
        const access = await client.access(target, secret.apiKey);
        const record = access.access.find((agent) => agent.id === target.agentId)?.credentials.find((item) => item.id === target.credentialId && item.active);
        if (record?.authorization.space.id) candidates[index] = { ...target, spaceId: record.authorization.space.id };
      } catch { /* Keep the binding unresolved; never infer it from another credential. */ }
    }));
  }
  const group: LocalSyncConfig = { ...config, connections: Object.fromEntries(candidates.map((target) => [target.id, target])) };
  const unresolved = candidates.filter((target) => !target.spaceId);
  const targets = [...new Set(candidates.flatMap((target) => target.spaceId ? [target.spaceId] : []))]
    .map((spaceId) => connectionForSpace(group, spaceId));
  return { connection, credentials, group, targets, unresolved };
}
