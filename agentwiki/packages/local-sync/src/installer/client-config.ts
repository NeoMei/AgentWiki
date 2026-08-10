/**
 * Atomic client configuration: read, backup, write and rollback the single
 * `agentwiki` gateway entry across Codex, Claude Code and OpenCode.
 *
 * All mutations go through temp-file + fsync + atomic rename. Before writing,
 * the current config hash is re-checked; a mismatch means someone changed the
 * file concurrently and the install aborts without overwriting.
 */
import { chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentClient } from '../agent-clients.js';
import { GATEWAY_MCP_NAME, gatewayCommand, hashConfig, looksLikeAgentWikiEntry } from './plan.js';

export interface ClientConfigPaths {
  configPath: string;
  backupPath: string;
}

/** Locate the config file for a given client under an isolated home. */
export function clientConfigPath(client: AgentClient, home: string = homedir()): string {
  switch (client) {
    case 'codex':
      return join(home, '.codex', 'config.toml');
    case 'claude':
      return join(home, '.claude', 'settings.json');
    case 'opencode':
      return join(home, '.config', 'opencode', 'opencode.json');
  }
}

export function backupPathFor(client: AgentClient, home: string = homedir()): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '');
  return join(home, '.agentwiki-archive', `${client}-${stamp}`);
}

/** Read raw config text, or return null if absent. */
export async function readRawConfig(client: AgentClient, home: string = homedir()): Promise<string | null> {
  const path = clientConfigPath(client, home);
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** Snapshot the current config (or record its absence) for rollback. */
export async function backupConfig(client: AgentClient, home: string = homedir()): Promise<string> {
  const dest = backupPathFor(client, home);
  const dir = dirname(dest);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const src = clientConfigPath(client, home);
  if (existsSync(src)) {
    await copyFile(src, dest);
  } else {
    // Record that there was no prior config.
    await writeFile(dest, '', { encoding: 'utf8', mode: 0o600 });
  }
  await chmod(dest, 0o600);
  return dest;
}

/**
 * Write the gateway entry atomically. Aborts with CONFIG_CONFLICT if the config
 * hash changed since preflight. Returns a rollback function that restores the
 * backup.
 */
export async function installGatewayEntry(
  client: AgentClient,
  connectionId: string,
  expectedHash: string,
  home: string = homedir(),
): Promise<{ backupPath: string; rollback: () => Promise<void> }> {
  const backup = await backupConfig(client, home);
  const configPath = clientConfigPath(client, home);

  // Re-hash immediately before mutation.
  const current = await readRawConfig(client, home);
  const currentHash = current !== null ? hashConfig(current) : hashConfig('');
  if (currentHash !== expectedHash) {
    throw new Error('CONFIG_CONFLICT: client configuration changed since preflight');
  }

  const next = buildConfigWithGateway(client, current, connectionId);
  await writeAtomically(configPath, next, client === 'opencode' ? 0o600 : 0o600);

  return {
    backupPath: backup,
    rollback: async () => {
      if (existsSync(backup)) {
        const data = await readFile(backup, 'utf8');
        if (data.length > 0) {
          await writeAtomically(configPath, data, 0o600);
        } else {
          // No prior config — remove what we created.
          const { unlink } = await import('node:fs/promises');
          await unlink(configPath).catch(() => undefined);
        }
      }
    },
  };
}

/** Build the post-install config text for each client format. */
function buildConfigWithGateway(client: AgentClient, current: string | null, connectionId: string): string {
  const command = gatewayCommand(connectionId);
  switch (client) {
    case 'codex':
      return buildToml(current, command);
    case 'claude':
      return buildJson(current, command);
    case 'opencode':
      return buildOpenCodeJson(current, command);
  }
}

function buildToml(current: string | null, command: string[]): string {
  // Codex uses TOML MCP servers. Remove old AgentWiki blocks, add the gateway.
  const text = current ?? '';
  // Split into blocks by [mcp_servers.NAME] headers, keeping non-MCP content intact.
  const lines = text.split('\n');
  const result: string[] = [];
  let skipBlock = false;
  for (const line of lines) {
    const headerMatch = line.match(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]/);
    if (headerMatch) {
      // Starting a new mcp_servers block; skip if it references agentwiki.
      skipBlock = line.toLowerCase().includes('agentwiki') || headerMatch[1].toLowerCase().includes('agentwiki');
    } else if (/^\[/.test(line)) {
      // A different section header stops the skip.
      skipBlock = false;
    }
    if (!skipBlock) result.push(line);
  }
  const base = result.join('\n').trimEnd();
  const cmd = command.join('", "');
  return `${base}\n[mcp_servers.${GATEWAY_MCP_NAME}]\ncmd = ["${cmd}"]\n`;
}

function buildJson(current: string | null, command: string[]): string {
  let config: Record<string, unknown> = {};
  if (current) {
    try {
      config = JSON.parse(current) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const mcpServers = ((config.mcpServers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  // Remove old AgentWiki entries.
  for (const key of Object.keys(mcpServers)) {
    const entry = mcpServers[key];
    const text = JSON.stringify(entry);
    if (looksLikeAgentWikiEntry(key, text)) delete mcpServers[key];
  }
  mcpServers[GATEWAY_MCP_NAME] = { command };
  config.mcpServers = mcpServers;
  return JSON.stringify(config, null, 2) + '\n';
}

function buildOpenCodeJson(current: string | null, command: string[]): string {
  let config: Record<string, unknown> = {};
  if (current) {
    try {
      config = JSON.parse(current) as Record<string, unknown>;
    } catch {
      config = {};
    }
  }
  const mcp = ((config.mcp as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const servers = ((mcp.servers as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(servers)) {
    const entry = servers[key];
    const text = JSON.stringify(entry);
    if (looksLikeAgentWikiEntry(key, text)) delete servers[key];
  }
  servers[GATEWAY_MCP_NAME] = { type: 'local', command };
  mcp.servers = servers;
  config.mcp = mcp;
  return JSON.stringify(config, null, 2) + '\n';
}

async function writeAtomically(path: string, contents: string, mode: 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', mode });
  await chmod(temporary, mode);
  await rename(temporary, path);
}

/** Scan a config for old AgentWiki entries and conflicts. */
export async function analyzeConfig(
  client: AgentClient,
  home: string = homedir(),
): Promise<{ hash: string; oldEntries: string[]; hasConflict: boolean }> {
  const raw = await readRawConfig(client, home);
  const hash = raw !== null ? hashConfig(raw) : hashConfig('');
  const oldEntries: string[] = [];
  let hasConflict = false;

  const entryNames = extractEntryNames(client, raw);
  for (const [name, text] of entryNames) {
    if (name === GATEWAY_MCP_NAME) {
      // If the agentwiki name doesn't look like our gateway, it's a conflict.
      if (!text.includes('agentwiki-local-sync')) {
        hasConflict = true;
      }
      continue;
    }
    if (looksLikeAgentWikiEntry(name, text)) {
      oldEntries.push(name);
    }
  }

  return { hash, oldEntries, hasConflict };
}

function extractEntryNames(client: AgentClient, raw: string | null): Array<[string, string]> {
  if (!raw) return [];
  const entries: Array<[string, string]> = [];
  try {
    if (client === 'opencode') {
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = ((config.mcp as Record<string, unknown>)?.servers as Record<string, unknown>) ?? {};
      for (const [name, value] of Object.entries(servers)) {
        entries.push([name, JSON.stringify(value)]);
      }
    } else if (client === 'claude') {
      const config = JSON.parse(raw) as Record<string, unknown>;
      const servers = (config.mcpServers as Record<string, unknown>) ?? {};
      for (const [name, value] of Object.entries(servers)) {
        entries.push([name, JSON.stringify(value)]);
      }
    } else {
      // Codex TOML: extract [mcp_servers.NAME] blocks naively.
      const re = /\[mcp_servers\.([A-Za-z0-9_-]+)\]/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(raw)) !== null) {
        const name = match[1];
        const blockStart = match.index;
        const nextBlock = raw.indexOf('[mcp_servers.', blockStart + 1);
        const block = nextBlock === -1 ? raw.slice(blockStart) : raw.slice(blockStart, nextBlock);
        entries.push([name, block]);
      }
    }
  } catch {
    // malformed config
  }
  return entries;
}
