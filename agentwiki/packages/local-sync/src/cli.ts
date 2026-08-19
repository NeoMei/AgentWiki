#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

import {
  type AgentClient,
  type CommandResult,
  type CommandRunner,
} from './agent-clients.js';
import { AgentWikiClient, redactSecrets } from './agentwiki-client.js';
import {
  loadConfig,
  loadCredentials,
  saveConfig,
  saveCredentials,
  type LocalSyncConnection,
} from './config.js';
import { removeGatewayEntry } from './installer/client-config.js';
import { runGateway } from './gateway/entry.js';
import type { AttachCliInput } from './onboarding/attach.js';
import { createCodeGraphProvider, safeCodeGraphVersion, type CodeGraphProvider } from './codegraph/provider.js';

export const CLI_USAGE = 'Usage: agentwiki-local-sync <onboard|gateway|doctor|uninstall> [--server URL] [--code CODE] [--protocol ndjson|human] [--connection ID] [--source-path PATH]';
const DEFAULT_SERVER_BASE_URL = 'https://agentwiki.quukk.com/api';
const PUBLIC_COMMANDS = new Set(['onboard', 'gateway', 'doctor', 'uninstall']);
const COMMAND_OPTIONS: Record<string, ReadonlySet<string>> = {
  onboard: new Set(['server', 'protocol', 'agent', 'code', 'id']),
  gateway: new Set(['connection']),
  doctor: new Set(['connection', 'source-path']),
  uninstall: new Set(['agent', 'delete-credential', 'delete-sync-state']),
};

export interface OnboardCliInput {
  home: string;
  protocol: 'ndjson' | 'human';
  serverBaseUrl: string;
  sessionId?: string;
}

export interface CliRuntime {
  onboard(input: OnboardCliInput): Promise<unknown>;
  attach(input: AttachCliInput): Promise<unknown>;
  gateway(input: { home: string; connectionId: string }): Promise<void>;
}

async function defaultOnboard(input: OnboardCliInput): Promise<unknown> {
  const { runOnboarding } = await import('./onboarding/runtime.js');
  return runOnboarding(input);
}

async function defaultAttach(input: AttachCliInput): Promise<unknown> {
  const { runAttachment } = await import('./onboarding/attach.js');
  return runAttachment(input);
}

const PACKAGE_VERSION = (() => {
  try {
    const require = createRequire(import.meta.url);
    return (require('../package.json') as { version: string }).version;
  } catch {
    return '0.2.9';
  }
})();

export function formatOutput(value: unknown): string {
  return redactSecrets(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

export function runner(command: string, args: string[], options?: SpawnSyncOptions): CommandResult {
  return spawnSync(command, args, { stdio: 'pipe', ...options });
}

interface ConnectionDependencies {
  connection: LocalSyncConnection;
  readApiKey: () => Promise<string>;
  client: AgentWikiClient;
}

async function connectionDependencies(home: string, connectionId?: string): Promise<ConnectionDependencies> {
  const config = await loadConfig(home);
  const id = connectionId ?? config.defaultConnectionId;
  if (!id || !config.connections[id]) throw new Error('No local sync connection is configured');
  const connection = config.connections[id];
  return {
    connection,
    readApiKey: async () => {
      const credentials = await loadCredentials(home);
      const credential = credentials.credentials[connection.credentialId];
      if (!credential) throw new Error(`Credential for connection ${connection.id} is unavailable`);
      return credential.apiKey;
    },
    client: new AgentWikiClient(),
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

function assertCommandOptions(command: string, values: Record<string, string | boolean | undefined>): void {
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) throw new Error(CLI_USAGE);
  for (const [name, value] of Object.entries(values)) {
    if (allowed.has(name) || value === undefined || value === false) continue;
    throw new Error(CLI_USAGE);
  }
}

function assertCommandPositionals(command: string, positionals: string[]): 'resume' | undefined {
  if (command === 'onboard') {
    if (positionals.length === 0) return undefined;
    if (positionals.length === 1 && positionals[0] === 'resume') return 'resume';
    throw new Error(CLI_USAGE);
  }
  if (positionals.length !== 0) throw new Error(CLI_USAGE);
  return undefined;
}

async function uninstall(home: string, values: Record<string, string | boolean | undefined>): Promise<unknown> {
  const config = await loadConfig(home);
  const requested = clientOption(typeof values.agent === 'string' ? values.agent : undefined);
  const connections = Object.values(config.connections).filter((connection) => requested === 'auto' || connection.client === requested);
  for (const connection of connections) {
    await removeGatewayEntry(connection.client, home);
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
  codeGraph?: Pick<CodeGraphProvider, 'diagnose'>;
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

export function isSupportedNodeVersion(version: string): boolean {
  const match = version.match(/^v?(\d+)(?:\.\d+){1,2}$/u);
  return match?.[1] === '24' || match?.[1] === '26';
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
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.CODEX_HOME;
      delete env.CLAUDE_CONFIG_DIR;
      const result = run(connection.client, ['mcp', 'get', connection.mcpName], {
        stdio: 'pipe',
        env,
      });
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

export async function runDoctor(
  home: string,
  connection: LocalSyncConnection,
  dependencies: DoctorDependencies,
  sourcePath?: string,
): Promise<DoctorReport> {
 const codeGraph = dependencies.codeGraph ?? createCodeGraphProvider({ home });
 const codeGraphDiagnosis = await codeGraph.diagnose(sourcePath ? { sourcePath } : undefined);
 const checks = [
   check('node', isSupportedNodeVersion(process.version), `Node ${process.version}; supported lines are 24 and 26`),
    inspectCommand('markitdown', 'markitdown', ['--version'], dependencies.run, [0, 1, 0]),
    inspectCommand('git', 'git', ['--version'], dependencies.run),
    await inspectMcpRegistration(connection, home, dependencies.run),
    await inspectFilePermissions(home),
  ];
  if (!codeGraphDiagnosis.available || !codeGraphDiagnosis.capabilities) {
    checks.push(check('codegraph', false, 'CodeGraph is unavailable. Install or repair CodeGraph independently; AgentWiki does not install or upgrade it.'));
  } else {
    const missingRequired = Object.entries(codeGraphDiagnosis.capabilities.required)
      .filter(([, available]) => !available).map(([name]) => name);
    checks.push(check('codegraph', missingRequired.length === 0,
      missingRequired.length === 0
        ? `CodeGraph available: ${safeCodeGraphVersion(codeGraphDiagnosis.detectedVersion ?? '') ?? 'version unavailable'}`
        : `Required CodeGraph capabilities unavailable: ${missingRequired.join(', ')}. Repair CodeGraph independently; AgentWiki does not install or upgrade it.`));
    const missingOptional = Object.entries(codeGraphDiagnosis.capabilities.optional)
      .filter(([, available]) => !available).map(([name]) => name);
    checks.push(check('codegraph-optional-capabilities', true,
      missingOptional.length === 0 ? 'Optional CodeGraph capabilities available' : `Optional CodeGraph capabilities degraded: ${missingOptional.join(', ')}`));
    if (sourcePath) {
      checks.push(check('codegraph-index', Boolean(codeGraphDiagnosis.source), codeGraphDiagnosis.source
        ? `CodeGraph source index is ${codeGraphDiagnosis.source.indexState} (${codeGraphDiagnosis.source.estimatedFiles ?? 'unknown'} files)`
        : 'CodeGraph source index could not be inspected'));
    }
  }

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

export async function runCli(
  argv = process.argv.slice(2),
  home = homedir(),
  runtime: Partial<CliRuntime> = {},
): Promise<unknown> {
  const [command, ...args] = argv;
  if (command === '--help' || command === '-h') return CLI_USAGE;
  if (command === '--version' || command === '-v') return { version: PACKAGE_VERSION };
  if (!command || !PUBLIC_COMMANDS.has(command)) throw new Error(CLI_USAGE);

  const parsed = parseArgs({
    args,
    options: {
      server: { type: 'string' }, protocol: { type: 'string' }, agent: { type: 'string' }, connection: { type: 'string' },
      code: { type: 'string' }, 'source-path': { type: 'string' },
      id: { type: 'string' },
      'delete-credential': { type: 'boolean', default: false }, 'delete-sync-state': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  const { values } = parsed;
  assertCommandOptions(command, values);
  const positional = assertCommandPositionals(command, parsed.positionals as string[]);
  if (command === 'onboard') {
    if (positional === 'resume' && values.code !== undefined) throw new Error(CLI_USAGE);
    const protocol = values.protocol ?? 'ndjson';
    if (protocol !== 'ndjson' && protocol !== 'human') {
      throw new Error('--protocol must be ndjson or human');
    }
    const serverBaseUrl = typeof values.server === 'string' ? values.server : DEFAULT_SERVER_BASE_URL;
    if (typeof values.code === 'string') {
      if (!values.code) throw new Error('--code is required');
      return (runtime.attach ?? defaultAttach)({
        home,
        protocol,
        serverBaseUrl,
        code: values.code,
        requestedClient: clientOption(typeof values.agent === 'string' ? values.agent : undefined),
      });
    }
    return (runtime.onboard ?? defaultOnboard)({
      home,
      protocol,
      serverBaseUrl,
      ...(positional === 'resume' ? { sessionId: required(values, 'id') } : {}),
    });
  }
  if (command === 'gateway') {
    const cfg = await loadConfig(home);
    const connectionId = typeof values.connection === 'string' ? values.connection : cfg.defaultConnectionId;
    if (!connectionId) throw new Error('gateway requires --connection <id> or a default connection');
    await (runtime.gateway ?? runGateway)({ home, connectionId });
    return undefined;
  }
  if (command === 'uninstall') return uninstall(home, values);

  const dependencies = await connectionDependencies(home, typeof values.connection === 'string' ? values.connection : undefined);
  if (command === 'doctor') return runDoctor(home, dependencies.connection, {
    client: dependencies.client,
    readApiKey: dependencies.readApiKey,
    run: runner,
  }, typeof values['source-path'] === 'string' ? values['source-path'] : undefined);
  throw new Error(CLI_USAGE);
}

async function main(): Promise<void> {
  try {
    const result = await runCli();
    if (result !== undefined && process.argv[2] !== 'onboard') process.stdout.write(`${formatOutput(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${formatOutput(message)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) void main();
