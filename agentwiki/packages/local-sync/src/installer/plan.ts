/**
 * Onboarding installer plan: the single gateway command, preflight result,
 * and installation contract.
 *
 * The only command written to any client configuration is the pinned 0.3.0
 * gateway entry. It never carries a remote URL, installation code, or API key.
 */
import { createHash } from 'node:crypto';
import type { AgentClient } from '../agent-clients.js';

export const GATEWAY_MCP_NAME = 'agentwiki';
export const GATEWAY_PACKAGE_VERSION = '0.3.4';

/** The exact command written into every supported client configuration. */
export function gatewayCommand(connectionId: string): string[] {
  return [
    'npx',
    '--yes',
    `@neomei/agentwiki-local-sync@${GATEWAY_PACKAGE_VERSION}`,
    'gateway',
    '--connection',
    connectionId,
  ];
}

/** Strings that identify an MCP entry as pointing at AgentWiki (legacy or current). */
export const AGENTWIKI_SERVER_HINTS = ['agentwiki', 'AgentWiki', 'agentwiki-local', 'agentwiki-quukk'];

export interface PreflightPlan {
  client: AgentClient;
  configPath: string;
  configHash: string;
  /** MCP entry names that point at the current AgentWiki server (to be replaced). */
  oldAgentWikiEntries: string[];
  /** An unknown third-party already occupies the `agentwiki` name. */
  hasConflict: boolean;
  backupPath: string;
  command: string[];
  /** True when the host Agent cannot hot-reload MCP without restart. */
  reloadRequired: boolean;
}

export interface InstallResult {
  written: boolean;
  backupPath: string;
  rollback: () => Promise<void>;
}

/** SHA-256 of a config blob, used to detect concurrent modification. */
export function hashConfig(config: string): string {
  return createHash('sha256').update(config, 'utf8').digest('hex');
}

/** True if an MCP entry name or command looks like it belongs to AgentWiki. */
export function looksLikeAgentWikiEntry(name: string, commandText: string): boolean {
  const lower = commandText.toLowerCase();
  if (name === GATEWAY_MCP_NAME) return false; // the new gateway name itself
  return (
    AGENTWIKI_SERVER_HINTS.some((hint) => name.toLowerCase().includes(hint.toLowerCase())) ||
    lower.includes('agentwiki-local-sync') ||
    lower.includes('agentwiki.quukk')
  );
}
