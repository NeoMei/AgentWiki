/**
 * Onboarding installer plan: the single gateway command, preflight result,
 * and installation contract.
 *
 * The only command written to any client configuration is the pinned release
 * gateway entry. It never carries a remote URL, installation code, or API key.
 */
import { createHash } from 'node:crypto';
import type { AgentClient } from '../agent-clients.js';

export const GATEWAY_MCP_NAME = 'agentwiki';
export const GATEWAY_PACKAGE_VERSION = '0.6.1';

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

const LEGACY_LOCAL_SYNC_NAMES = [
  /^agentwiki-local(?:-|$)/i,
  /^agentwiki-legacy(?:-|$)/i,
  /^agentwiki-quukk(?:-|$)/i,
];

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

/** True if an MCP entry is an owned legacy local-sync entry or targets this server. */
export function looksLikeAgentWikiEntry(
  name: string,
  commandText: string,
  serverBaseUrl?: string,
): boolean {
  const lower = commandText.toLowerCase();
  if (name === GATEWAY_MCP_NAME) return false; // the new gateway name itself
  if (LEGACY_LOCAL_SYNC_NAMES.some((pattern) => pattern.test(name))) return true;
  if (lower.includes('agentwiki-local-sync')) return true;
  if (!serverBaseUrl) return false;
  try {
    const base = serverBaseUrl.replace(/\/+$/, '');
    const endpoint = new URL(`${base}/mcp`).toString().replace(/\/$/, '').toLowerCase();
    const urls = commandText.match(/https?:\/\/[^\s"'\\]+/gi) ?? [];
    return urls.some((value) => {
      try {
        return new URL(value).toString().replace(/\/$/, '').toLowerCase() === endpoint;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
