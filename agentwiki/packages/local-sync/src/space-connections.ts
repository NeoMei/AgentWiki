import { loadConfig, loadCredentials, type LocalSyncConnection } from './config.js';
import { AgentWikiClient } from './agentwiki-client.js';
import { SAFE_SPACE_ID_PATTERN } from './workspace/layout.js';

/** Load exactly the selected Agent identity; never merge keys from other connections. */
export async function loadAgentConnection(home: string, connectionId: string) {
  const config = await loadConfig(home);
  const connection = config.connections[connectionId];
  if (!connection) throw new Error(`connection ${connectionId} not found`);
  const credentials = await loadCredentials(home);
  if (!credentials.credentials[connection.credentialId]) throw new Error('Agent credential not found');
  return { connection, credentials };
}

/** Knowledge workflows may consume local caches, so verify live access before doing so. */
export async function authorizedAgentCredential(home: string, connection: LocalSyncConnection, spaceId: string, client: AgentWikiClient) {
  if (!SAFE_SPACE_ID_PATTERN.test(spaceId)) throw new Error('Invalid Space ID');
  const credentials = await loadCredentials(home);
  const key = credentials.credentials[connection.credentialId];
  if (!key) throw new Error('Agent credential not found');
  const access = await client.access(connection, key.apiKey);
  const agent = access.access.find((item) => item.id === connection.agentId);
  if (agent?.status !== 'active'
    || !agent.credentials.some((item) => item.id === connection.credentialId && item.active)
    || !agent.grants.some((grant) => grant.space.id === spaceId)) {
    throw new Error(`Space access denied: ${spaceId}`);
  }
  return key;
}
