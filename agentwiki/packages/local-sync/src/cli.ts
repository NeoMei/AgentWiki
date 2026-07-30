#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  detectClient,
  installSkill,
  packagedSkillSource,
  registerMcp,
  removeMcp,
  type AgentClient,
  type CommandResult,
  type CommandRunner,
} from './agent-clients.js';
import { AgentWikiClient, redactSecrets } from './agentwiki-client.js';
import {
  assertPreviewId,
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
import { inspectLocalSource, inspectOpenWikiProvider, prepareKnowledgeSync } from './local-knowledge.js';
import {
  createLocalSyncCommands,
  serveLocalSyncMcp,
  type CommandDependencies,
} from './mcp.js';

export { createLocalSyncCommands, formatMcpOutput, type CommandDependencies, type LocalSyncCommands } from './mcp.js';

const PACKAGE_VERSION = '0.1.1';

export function formatOutput(value: unknown): string {
  return redactSecrets(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function runner(command: string, args: string[]): CommandResult {
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
    await saveConfig(home, config);
    await saveCredentials(home, credentials);
    return { connected: connectionId, doctor: await createLocalSyncCommands(await connectionDependencies(home, connectionId)).status() };
  } catch (error) {
    if (!exchanged) await removeMcp(clientKind, mcpName, runner, home).catch(() => undefined);
    if (exchanged) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${redactSecrets(message)}\nRecovery: agentwiki-local-sync doctor --connection ${connectionId}`,
        { cause: error },
      );
    }
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

function exactVersion(value: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error('--version must be an exact package version');
  }
  return value;
}

async function upgrade(home: string, values: Record<string, string | boolean | undefined>): Promise<unknown> {
  const version = exactVersion(required(values, 'version'));
  const config = await loadConfig(home);
  const connectionId = typeof values.connection === 'string' ? values.connection : config.defaultConnectionId;
  if (!connectionId || !config.connections[connectionId]) throw new Error('No local sync connection is configured');

  const connection = config.connections[connectionId];
  if (connection.pluginVersion === version) return { upgraded: false, connectionId, version, message: 'Connection already uses this exact version.' };

  await removeMcp(connection.client, connection.mcpName, runner, home);
  try {
    await registerMcp(connection.client, connection.mcpName, connection.id, version, runner, home);
  } catch (error) {
    await registerMcp(connection.client, connection.mcpName, connection.id, connection.pluginVersion, runner, home).catch(() => undefined);
    throw error;
  }
  connection.pluginVersion = version;
  await saveConfig(home, config);
  return { upgraded: true, connectionId, version };
}

async function renderPreview(home: string, id: string): Promise<unknown> {
  assertPreviewId(id);
  const path = join(home, '.agentwiki', 'previews', `${id}.json`);
  const preview = JSON.parse(await readFile(path, 'utf8')) as { expiresAt: string };
  if (Date.parse(preview.expiresAt) <= Date.now()) throw new Error(`Preview ${id} was not found or expired`);
  return preview;
}

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail';
  detail: string;
}

export interface DoctorReport {
  connection: Record<string, unknown>;
  checks: DoctorCheck[];
}

export interface DoctorDependencies {
  client: Pick<AgentWikiClient, 'access'>;
  readApiKey: () => Promise<string>;
  run: CommandRunner;
}

function check(name: string, passed: boolean, detail: string): DoctorCheck {
  return { name, status: passed ? 'pass' : 'fail', detail: redactSecrets(detail) };
}

function commandText(value: string | Buffer | undefined): string {
  return typeof value === 'string' ? value : value?.toString('utf8') ?? '';
}

function versionAtLeast(output: string, minimum: [number, number, number]): boolean {
  const match = output.match(/(?:^|\s|v)(\d+)\.(\d+)(?:\.(\d+))?/u);
  if (!match) return false;
  const actual: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  return actual[0] > minimum[0]
    || (actual[0] === minimum[0] && actual[1] > minimum[1])
    || (actual[0] === minimum[0] && actual[1] === minimum[1] && actual[2] >= minimum[2]);
}

function inspectCommand(
  name: string,
  command: string,
  args: string[],
  run: CommandRunner,
  minimum?: [number, number, number],
): DoctorCheck {
  try {
    const result = run(command, args, { stdio: 'pipe' });
    const output = commandText(result.stdout).trim();
    const available = !result.error && result.status === 0;
    const versionOk = minimum === undefined || versionAtLeast(output, minimum);
    const minimumText = minimum ? ` >= ${minimum.join('.')}` : '';
    return check(name, available && versionOk, available && versionOk
      ? `${command}${output ? ` ${output}` : ''}`
      : `${command}${minimumText} is unavailable or below the required version`);
  } catch {
    return check(name, false, `${command} is unavailable`);
  }
}

async function inspectMcpRegistration(connection: LocalSyncConnection, home: string, run: CommandRunner): Promise<DoctorCheck> {
  try {
    if (connection.client !== 'opencode') {
      const result = run(connection.client, ['mcp', 'get', connection.mcpName], { stdio: 'pipe' });
      return check('mcp-registration', !result.error && result.status === 0,
        !result.error && result.status === 0 ? `${connection.client} MCP entry is registered` : `${connection.client} MCP entry is missing`);
    }

    const parsed = JSON.parse(await readFile(join(home, '.config', 'opencode', 'opencode.json'), 'utf8')) as Record<string, unknown>;
    const mcp = parsed.mcp;
    const entries = typeof mcp === 'object' && mcp !== null
      ? ('servers' in mcp && typeof mcp.servers === 'object' && mcp.servers !== null ? mcp.servers : mcp)
      : undefined;
    const registered = typeof entries === 'object' && entries !== null && connection.mcpName in entries;
    return check('mcp-registration', registered, registered ? 'opencode MCP entry is registered' : 'opencode MCP entry is missing');
  } catch {
    return check('mcp-registration', false, `${connection.client} MCP entry is missing`);
  }
}

async function inspectFilePermissions(home: string): Promise<DoctorCheck> {
  const paths = [join(home, '.agentwiki', 'local-sync.json'), join(home, '.agentwiki', 'credentials.json')];
  try {
    const modes = await Promise.all(paths.map(async (path) => (await stat(path)).mode & 0o777));
    const secure = modes.every((mode) => (mode & 0o077) === 0);
    return check('file-permissions', secure, secure ? 'Local config and credentials are owner-only' : 'Local config or credentials are too broadly readable');
  } catch {
    return check('file-permissions', false, 'Local config or credentials are missing');
  }
}

async function inspectProviderBoundary(home: string): Promise<DoctorCheck> {
  const names = ['OPENWIKI_PROVIDER', 'OPENWIKI_MODEL_ID', 'OPENWIKI_BASE_URL', 'OPENAI_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'ANTHROPIC_BASE_URL', 'OLLAMA_HOST'];
  const environment: Record<string, string | undefined> = {};
  try {
    const contents = await readFile(join(home, '.openwiki', '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/u)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
      if (match && names.includes(match[1])) environment[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, '$2');
    }
  } catch {
    // The provider defaults are still meaningful when no local OpenWiki env file exists.
  }
  for (const name of names) environment[name] = process.env[name] ?? environment[name];
  const provider = inspectOpenWikiProvider(environment);
  return check('provider-boundary', provider.local,
    provider.local ? `OpenWiki provider ${provider.provider} is local` : `OpenWiki provider ${provider.provider} requires explicit remote-model consent`);
}

export async function runDoctor(
  home: string,
  connection: LocalSyncConnection,
  dependencies: DoctorDependencies,
): Promise<DoctorReport> {
  const checks = [
    check('node', versionAtLeast(process.version, [20, 0, 0]), `Node ${process.version}`),
    inspectCommand('openwiki', 'openwiki', ['--version'], dependencies.run, [0, 2, 0]),
    inspectCommand('markitdown', 'markitdown', ['--version'], dependencies.run, [0, 1, 0]),
    inspectCommand('git', 'git', ['--version'], dependencies.run),
    inspectCommand('codebase-memory', 'codebase-memory-mcp', ['--version'], dependencies.run),
    await inspectMcpRegistration(connection, home, dependencies.run),
    await inspectFilePermissions(home),
    await inspectProviderBoundary(home),
  ];

  try {
    const access = await dependencies.client.access(connection, await dependencies.readApiKey());
    const agent = access.access.find((candidate) => candidate.id === connection.agentId);
    checks.push(
      check('identity', agent?.status === 'active', agent?.status === 'active' ? 'Agent identity is active' : 'Configured AgentWiki identity is unavailable or inactive'),
      check('space-grants', (agent?.grants.length ?? 0) > 0, (agent?.grants.length ?? 0) > 0 ? 'Agent has Space grants' : 'Agent has no Space grants'),
      check('credential-scopes', Boolean(agent?.credentials.some((credential) => credential.id === connection.credentialId && credential.active && credential.scopes.length > 0)),
        agent?.credentials.some((credential) => credential.id === connection.credentialId && credential.active && credential.scopes.length > 0)
          ? 'Active credential has scopes'
          : 'Configured credential is inactive or has no scopes'),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push(
      check('identity', false, `Unable to verify AgentWiki identity: ${detail}`),
      check('space-grants', false, 'Unable to verify Space grants'),
      check('credential-scopes', false, 'Unable to verify credential scopes'),
    );
  }

  return {
    connection: {
      connectionId: connection.id,
      serverUrl: connection.serverUrl,
      agentId: connection.agentId,
      client: connection.client,
      pluginVersion: connection.pluginVersion,
      mcpName: connection.mcpName,
    },
    checks,
  };
}

export async function runCli(argv = process.argv.slice(2), home = homedir()): Promise<unknown> {
  const [command, ...args] = argv;
  const { values } = parseArgs({
    args,
    options: {
      server: { type: 'string' }, code: { type: 'string' }, agent: { type: 'string' }, connection: { type: 'string' },
      path: { type: 'string' }, space: { type: 'string' }, 'allow-remote-model': { type: 'boolean', default: false },
      id: { type: 'string' }, preview: { type: 'string' }, version: { type: 'string' }, confirm: { type: 'boolean', default: false },
      'delete-credential': { type: 'boolean', default: false }, 'delete-sync-state': { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (command === 'connect') return connect(home, values);
  if (command === 'uninstall') return uninstall(home, values);
  if (command === 'preview') return renderPreview(home, required(values, 'id'));

  const dependencies = await connectionDependencies(home, typeof values.connection === 'string' ? values.connection : undefined);
  const commands = createLocalSyncCommands(dependencies);
  if (command === 'doctor') return runDoctor(home, dependencies.connection, {
    client: dependencies.client,
    readApiKey: dependencies.readApiKey,
    run: runner,
  });
  if (command === 'inspect') return commands.inspect({ path: required(values, 'path') });
  if (command === 'scan') return commands.prepare({
    path: required(values, 'path'), spaceId: required(values, 'space'),
    allowRemoteModel: values['allow-remote-model'] === true,
  });
  if (command === 'sync') {
    if (values.confirm !== true) throw new Error('Explicit user confirmation is required');
    return commands.sync({ previewId: required(values, 'preview'), confirmed: true });
  }
  if (command === 'upgrade') return upgrade(home, values);
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) void main();
