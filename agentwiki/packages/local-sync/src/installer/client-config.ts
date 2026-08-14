/**
 * Atomic client configuration: read, backup, write and rollback the single
 * `agentwiki` gateway entry across Codex, Claude Code and OpenCode.
 *
 * All mutations go through temp-file + fsync + atomic rename. Before writing,
 * the current config hash is re-checked; a mismatch means someone changed the
 * file concurrently and the install aborts without overwriting.
 */
import { chmod, copyFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
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
      // Claude Code reads MCP servers from ~/.claude.json (user scope), not
      // from ~/.claude/settings.json. Writing the gateway there makes it
      // visible to `claude mcp get` and to running sessions.
      return join(home, '.claude.json');
    case 'opencode':
      return join(home, '.config', 'opencode', 'opencode.json');
  }
}

/** Legacy installs wrote the Claude gateway into ~/.claude/settings.json. */
function legacyClaudeSettingsPath(home: string): string {
  return join(home, '.claude', 'settings.json');
}

/** Best-effort removal of a legacy Claude gateway entry from settings.json. */
async function cleanupLegacyClaudeSettings(home: string): Promise<void> {
  let current: string;
  try {
    current = await readFile(legacyClaudeSettingsPath(home), 'utf8');
  } catch {
    return;
  }
  const next = removeJsonGateway(current, ['mcpServers']);
  if (next !== null) await writeAtomically(legacyClaudeSettingsPath(home), next, 0o600);
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
  serverBaseUrl?: string,
): Promise<{ backupPath: string; rollback: () => Promise<void> }> {
  const configPath = clientConfigPath(client, home);

  // Re-hash immediately before mutation.
  const current = await readRawConfig(client, home);
  const currentHash = current !== null ? hashConfig(current) : hashConfig('');
  if (currentHash !== expectedHash) {
    if (current !== null && hasExactGatewayEntry(client, current, connectionId)) {
      const originalBackup = await findOriginalBackup(client, home);
      if (originalBackup) {
        return { backupPath: originalBackup, rollback: rollbackFromBackup(configPath, originalBackup) };
      }
    }
    throw new Error('CONFIG_CONFLICT: client configuration changed since preflight');
  }

  const backup = await backupConfig(client, home);
  const next = buildConfigWithGateway(client, current, connectionId, serverBaseUrl);
  await writeAtomically(configPath, next, client === 'opencode' ? 0o600 : 0o600);
  if (client === 'claude') await cleanupLegacyClaudeSettings(home).catch(() => undefined);

  return {
    backupPath: backup,
    rollback: rollbackFromBackup(configPath, backup),
  };
}

/**
 * Remove only the `agentwiki` gateway entry from the client config, preserving
 * every other key or TOML block byte-for-byte. Returns { removed: false } when
 * the file is absent or contains no gateway entry. This is the symmetric
 * inverse of {@link installGatewayEntry} and is used by `uninstall`.
 */
export async function removeGatewayEntry(
  client: AgentClient,
  home: string = homedir(),
): Promise<{ removed: boolean }> {
  const configPath = clientConfigPath(client, home);
  const current = await readRawConfig(client, home);
  if (current === null) return { removed: false };
  const next = removeGatewayFromConfig(client, current);
  if (next === null) return { removed: false };
  await writeAtomically(configPath, next, 0o600);
  if (client === 'claude') await cleanupLegacyClaudeSettings(home).catch(() => undefined);
  return { removed: true };
}

function removeGatewayFromConfig(client: AgentClient, current: string): string | null {
  switch (client) {
    case 'codex':
      return removeTomlGateway(current);
    case 'claude':
      return removeJsonGateway(current, ['mcpServers']);
    case 'opencode':
      return removeJsonGateway(current, ['mcp', 'servers']);
  }
}

function removeTomlGateway(current: string): string | null {
  return filterTomlMcpBlocks(current, (name, block) => (
    name === GATEWAY_MCP_NAME && block.toLowerCase().includes('agentwiki-local-sync')
  ));
}

function removeJsonGateway(current: string, path: string[]): string | null {
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(current) as Record<string, unknown>;
  } catch {
    return null;
  }
  let container: Record<string, unknown> = config;
  for (let i = 0; i < path.length - 1; i++) {
    const next = container[path[i]] as Record<string, unknown> | undefined;
    if (!next || typeof next !== 'object') return null;
    container = next;
  }
  const servers = container[path[path.length - 1]] as Record<string, unknown> | undefined;
  if (!servers || typeof servers !== 'object') return null;
  let removed = false;
  for (const key of [...Object.keys(servers)]) {
    const text = JSON.stringify(servers[key]);
    const ownedGateway = key === GATEWAY_MCP_NAME && text.toLowerCase().includes('agentwiki-local-sync');
    if (ownedGateway || looksLikeAgentWikiEntry(key, text)) {
      delete servers[key];
      removed = true;
    }
  }
  if (!removed) return null;
  return JSON.stringify(config, null, 2) + '\n';
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function rollbackFromBackup(configPath: string, backup: string): () => Promise<void> {
  return async () => {
    if (!existsSync(backup)) return;
    const data = await readFile(backup, 'utf8');
    if (data.length > 0) {
      await writeAtomically(configPath, data, 0o600);
    } else {
      const { unlink } = await import('node:fs/promises');
      await unlink(configPath).catch(() => undefined);
    }
  };
}

async function findOriginalBackup(client: AgentClient, home: string): Promise<string | null> {
  const root = join(home, '.agentwiki-archive');
  const names = await readdir(root).catch(() => []);
  const name = names.filter((candidate) => candidate.startsWith(`${client}-`)).sort()[0];
  return name ? join(root, name) : null;
}

function hasExactGatewayEntry(client: AgentClient, current: string, connectionId: string): boolean {
  const entry = extractEntryNames(client, current).find(([name]) => name === GATEWAY_MCP_NAME)?.[1];
  if (!entry) return false;
  return gatewayCommand(connectionId).every((part) => entry.includes(part));
}

/** Build the post-install config text for each client format. */
function buildConfigWithGateway(
  client: AgentClient,
  current: string | null,
  connectionId: string,
  serverBaseUrl?: string,
): string {
  const command = gatewayCommand(connectionId);
  switch (client) {
    case 'codex':
      return buildToml(current, command, serverBaseUrl);
    case 'claude':
      return buildJson(current, command, serverBaseUrl);
    case 'opencode':
      return buildOpenCodeJson(current, command, serverBaseUrl);
  }
}

function buildToml(current: string | null, command: string[], serverBaseUrl?: string): string {
  // Codex uses TOML MCP servers. Remove old AgentWiki blocks, add the gateway.
  const text = current ?? '';
 // Split into blocks by [mcp_servers.NAME] headers, keeping non-MCP content intact.
 const filtered = filterTomlMcpBlocks(text, (name, block) => (
   name === GATEWAY_MCP_NAME || looksLikeAgentWikiEntry(name, block, serverBaseUrl)
 ));
 const base = (filtered ?? text).trimEnd();
  const [cmd, ...args] = command;
  const argsStr = args.map((a) => `"${escapeTomlString(a)}"`).join(', ');
  return `${base}\n[mcp_servers.${GATEWAY_MCP_NAME}]\ncmd = "${escapeTomlString(cmd)}"\nargs = [${argsStr}]\n`;
}

function buildJson(current: string | null, command: string[], serverBaseUrl?: string): string {
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
    if (looksLikeAgentWikiEntry(key, text, serverBaseUrl)) delete mcpServers[key];
  }
  const [cmd, ...args] = command;
  mcpServers[GATEWAY_MCP_NAME] = { command: cmd, args };
  config.mcpServers = mcpServers;
  return JSON.stringify(config, null, 2) + '\n';
}

function buildOpenCodeJson(current: string | null, command: string[], serverBaseUrl?: string): string {
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
    if (looksLikeAgentWikiEntry(key, text, serverBaseUrl)) delete servers[key];
  }
  const [cmd, ...args] = command;
  servers[GATEWAY_MCP_NAME] = { type: 'local', command: cmd, args };
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
  serverBaseUrl?: string,
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
    if (looksLikeAgentWikiEntry(name, text, serverBaseUrl)) {
      oldEntries.push(name);
    }
  }

  return { hash, oldEntries, hasConflict };
}

function filterTomlMcpBlocks(
  current: string,
  shouldRemove: (name: string, block: string) => boolean,
): string | null {
  const matches = [...current.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]/gm)];
  if (matches.length === 0) return null;
  let cursor = 0;
  let removed = false;
  const parts: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? current.length;
    parts.push(current.slice(cursor, start));
    const block = current.slice(start, end);
    if (shouldRemove(match[1], block)) {
      removed = true;
    } else {
      parts.push(block);
    }
    cursor = end;
  }
  parts.push(current.slice(cursor));
  if (!removed) return null;
  return parts.join('').replace(/\n{3,}/g, '\n\n').replace(/\n+$/g, '\n').trimEnd() + '\n';
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
