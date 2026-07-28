#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  detectClient,
  installSkill,
  packagedSkillSource,
  registerMcp,
  removeMcp,
  type AgentClient,
} from './agent-clients.js';
import { AgentWikiClient, redactSecrets } from './agentwiki-client.js';
import {
  claimPreview,
  completePreview,
  loadConfig,
  loadCredentials,
  releasePreview,
  saveConfig,
  saveCredentials,
  savePreview,
  type LocalSyncConnection,
} from './config.js';
import { inspectLocalSource, prepareKnowledgeSync } from './local-knowledge.js';
import {
  createLocalSyncCommands,
  serveLocalSyncMcp,
  type CommandDependencies,
  type LocalSyncCommands,
} from './mcp.js';

export { createLocalSyncCommands, type CommandDependencies, type LocalSyncCommands } from './mcp.js';

const PACKAGE_VERSION = '0.1.0';

export function formatOutput(value: unknown): string {
  return redactSecrets(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function runner(command: string, args: string[]) {
  return spawnSync(command, args, { stdio: 'pipe' });
}

async function connectionDependencies(home: string, connectionId?: string): Promise<CommandDependencies> {
  const config = await loadConfig(home);
  const id = connectionId ?? config.defaultConnectionId;
  if (!id || !config.connections[id]) throw new Error('No local sync connection is configured');
  const connection = config.connections[id];
  return {
    home,
    connection,
    readApiKey: async () => {
      const credentials = await loadCredentials(home);
      const credential = credentials.credentials[connection.credentialId];
      if (!credential) throw new Error(`Credential for connection ${connection.id} is unavailable`);
      return credential.apiKey;
    },
    client: new AgentWikiClient(),
    inspectLocalSource,
    prepareKnowledgeSync,
    savePreview,
    claimPreview,
    releasePreview,
    completePreview,
    now: () => new Date(),
  };
}

function required(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`);
  return value;
}

function clientOption(value: string | undefined): AgentClient | 'auto' {
  if (value === undefined) return 'auto';
  if (value === 'auto' || value === 'codex' || value === 'claude' || value === 'opencode') return value;
  throw new Error('--agent must be auto, codex, claude, or opencode');
}

async function connect(home: string, values: Record<string, string | boolean | undefined>): Promise<unknown> {
  const serverUrl = required(values, 'server');
  const code = required(values, 'code');
  const clientKind = detectClient(clientOption(typeof values.agent === 'string' ? values.agent : undefined), runner);
  const client = new AgentWikiClient();
  const connectionId = crypto.randomUUID();
  const mcpName = `agentwiki-local-${connectionId.slice(0, 8)}`;
  await installSkill(home, packagedSkillSource, clientKind);
  await registerMcp(clientKind, mcpName, connectionId, PACKAGE_VERSION, runner, home);
  let exchanged = false;
  try {
    const exchange = await client.exchange(serverUrl, code);
    exchanged = true;
    const connection: LocalSyncConnection = {
      id: connectionId,
      serverUrl: exchange.serverUrl,
      agentId: exchange.agentId,
      credentialId: exchange.credentialId,
      pluginVersion: exchange.pluginVersion,
      client: clientKind,
      mcpName,
    };
    const config = await loadConfig(home);
    config.connections[connectionId] = connection;
    config.defaultConnectionId = connectionId;
    const credentials = await loadCredentials(home);
    credentials.credentials[exchange.credentialId] = { apiKey: exchange.apiKey };
    await saveCredentials(home, credentials);
    await saveConfig(home, config);
    return { connected: connectionId, doctor: await createLocalSyncCommands(await connectionDependencies(home, connectionId)).status() };
  } catch (error) {
    if (!exchanged) await removeMcp(clientKind, mcpName, runner, home).catch(() => undefined);
    throw error;
  }
}

async function uninstall(home: string, values: Record<string, string | boolean | undefined>): Promise<unknown> {
  const config = await loadConfig(home);
  const requested = clientOption(typeof values.agent === 'string' ? values.agent : undefined);
  const connections = Object.values(config.connections).filter((connection) => requested === 'auto' || connection.client === requested);
  for (const connection of connections) {
    await removeMcp(connection.client, connection.mcpName, runner, home);
    delete config.connections[connection.id];
  }
  config.defaultConnectionId = Object.keys(config.connections)[0];
  await saveConfig(home, config);
  if (values['delete-credential'] === true) {
    const credentials = await loadCredentials(home);
    for (const connection of connections) delete credentials.credentials[connection.credentialId];
    await saveCredentials(home, credentials);
  }
  if (values['delete-sync-state'] === true) await rm(join(home, '.agentwiki', 'sync-state.json'), { force: true });
  return { removed: connections.map((connection) => connection.id), reminder: 'Server-side credential revocation remains authoritative.' };
}

async function renderPreview(home: string, id: string): Promise<unknown> {
  const path = join(home, '.agentwiki', 'previews', `${id}.json`);
  const preview = JSON.parse(await readFile(path, 'utf8')) as { expiresAt: string };
  if (Date.parse(preview.expiresAt) <= Date.now()) throw new Error(`Preview ${id} was not found or expired`);
  return preview;
}

export async function runCli(argv = process.argv.slice(2), home = homedir()): Promise<unknown> {
  const [command, ...args] = argv;
  const { values } = parseArgs({
    args,
    options: {
      server: { type: 'string' }, code: { type: 'string' }, agent: { type: 'string' }, connection: { type: 'string' },
      path: { type: 'string' }, space: { type: 'string' }, 'allow-remote-model': { type: 'boolean', default: false },
      id: { type: 'string' }, preview: { type: 'string' }, confirm: { type: 'boolean', default: false },
      'delete-credential': { type: 'boolean', default: false }, 'delete-sync-state': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (command === 'connect') return connect(home, values);
  if (command === 'uninstall') return uninstall(home, values);
  if (command === 'preview') return renderPreview(home, required(values, 'id'));

  const commands = createLocalSyncCommands(await connectionDependencies(home, typeof values.connection === 'string' ? values.connection : undefined));
  if (command === 'doctor') return { node: process.version, connection: await commands.status() };
  if (command === 'inspect') return commands.inspect({ path: required(values, 'path') });
  if (command === 'scan') return commands.prepare({
    path: required(values, 'path'), spaceId: required(values, 'space'),
    allowRemoteModel: values['allow-remote-model'] === true,
  });
  if (command === 'sync') {
    if (values.confirm !== true) throw new Error('Explicit user confirmation is required');
    return commands.sync({ previewId: required(values, 'preview'), confirmed: true });
  }
  if (command === 'upgrade') return { upgraded: false, message: 'Re-run connect with the target exact package version to upgrade this connection.' };
  if (command === 'mcp') {
    await serveLocalSyncMcp(commands);
    return undefined;
  }
  throw new Error('Usage: agentwiki-local-sync <connect|doctor|inspect|scan|preview|sync|upgrade|uninstall|mcp>');
}

async function main(): Promise<void> {
  try {
    const result = await runCli();
    if (result !== undefined) process.stdout.write(`${formatOutput(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${formatOutput(message)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
