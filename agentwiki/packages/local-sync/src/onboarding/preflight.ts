/**
 * Real preflight implementation: analyse the host Agent's MCP configuration,
 * without changing either the host config or local AgentWiki state.
 *
 * This wires the coordinator's injected PreflightFn to the installer modules.
 */
import type { ClientType } from './client.js';
import { analyzeConfig } from '../installer/client-config.js';
import type { AgentClient } from '../agent-clients.js';

export interface PreflightResult {
  configHash: string;
  oldEntries: string[];
  hasConflict: boolean;
  archivePath: string | null;
  reloadRequired: boolean;
}

/** True when the host Agent binary supports MCP hot-reload without restart. */
function supportsHotReload(client: AgentClient): boolean {
  // Codex and Claude Code reload MCP servers on config change; OpenCode needs
  // a restart after JSON mutation. This is conservative and testable.
  return client === 'codex' || client === 'claude';
}

/**
 * Run preflight for a given client under an isolated home.
 *
 * This is deliberately read-only. Archiving and clean-state activation happen
 * only after the user confirms the plan.
 */
export async function preflight(client: ClientType, home: string): Promise<PreflightResult> {
  const analysis = await analyzeConfig(client as AgentClient, home);

  return {
    configHash: analysis.hash,
    oldEntries: analysis.oldEntries,
    hasConflict: analysis.hasConflict,
    archivePath: null,
    reloadRequired: !supportsHotReload(client as AgentClient),
  };
}
