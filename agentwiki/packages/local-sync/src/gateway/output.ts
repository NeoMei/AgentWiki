import { redactSecrets } from '../agentwiki-client.js';

/** Serialize MCP responses without ever exposing local credentials. */
export function formatMcpOutput(result: unknown): string {
  return redactSecrets(JSON.stringify(result, null, 2));
}
