/**
 * Onboarding installer plan: the single gateway command, preflight result,
 * and installation contract.
 *
 * The only command written to any client configuration is the pinned release
 * gateway entry. It never carries a remote URL, installation code, or API key.
 */
import { createHash } from 'node:crypto';
import type { AgentClient } from '../agent-clients.js';
import { localGatewayCommand, type InstalledGatewayRuntime } from './gateway-runtime.js';

export const GATEWAY_MCP_NAME = 'agentwiki';
export { GATEWAY_PACKAGE_NAME, GATEWAY_PACKAGE_VERSION } from './package-release.js';

/**
 * The exact command written into every supported client configuration.
 *
 * It always points at the locally installed runtime. Starting MCP through npx
 * would repeat a registry download on every Agent launch and fail on machines
 * that cannot reach the registry, including hosts with no network on startup.
 */
export function gatewayCommand(
  runtime: Pick<InstalledGatewayRuntime, 'nodePath' | 'cliPath'>,
  connectionId: string,
): string[] {
  return localGatewayCommand(runtime, connectionId);
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
