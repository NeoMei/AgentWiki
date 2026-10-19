#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { lstat, readFile, rm, stat } from 'node:fs/promises';
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
import { clientConfigPath, removeGatewayEntry } from './installer/client-config.js';
import { runGateway } from './gateway/entry.js';
import { runOnboardingSteps } from './onboarding/steps.js';
import type { AttachCliInput } from './onboarding/attach.js';
import { createCodeGraphProvider, safeCodeGraphVersion, type CodeGraphProvider } from './codegraph/provider.js';
import { isSupportedNodeVersion } from './node-runtime.js';
export { isSupportedNodeVersion } from './node-runtime.js';

export const CLI_USAGE = `Usage: agentwiki-local-sync <onboard|gateway|doctor|uninstall> [options]

Commands:
  onboard start --server URL --protocol json [--client generic|codex|claude|opencode|workbuddy]
  onboard status --session UUID --protocol json
  onboard continue --session UUID --protocol json [--reply-file PATH]
  gateway [--connection ID]                    Start the stdio MCP server
  doctor [--connection ID] [--all-clients] [--source-path PATH]
  uninstall [--agent auto|generic|codex|claude|opencode|workbuddy]

Options: --help, -h; --version, -v
Use <command> --help for required options and examples.`;
const ONBOARD_START_HELP = `Usage: agentwiki-local-sync onboard start --server URL --protocol json [--client CLIENT]
Required: --server URL (HTTPS or loopback HTTP), --protocol json.
CLIENT defaults to generic, which exports standard MCP settings for any compatible host.
Native presets: codex, claude, opencode, workbuddy. Use generic for other hosts.
Example: agentwiki-local-sync onboard start --server https://agentwiki.quukk.com/api --client workbuddy --protocol json`;
const ONBOARD_STATUS_HELP = `Usage: agentwiki-local-sync onboard status --session UUID --protocol json
Required: --session UUID from start, --protocol json. Reads the local checkpoint without advancing it; does not contact the server.
After browser approval, wait retryAfterMs and run onboard continue without --reply-file to retrieve approval; repeatedly running status cannot observe it.
Example: agentwiki-local-sync onboard status --session <session-id> --protocol json`;
const ONBOARD_CONTINUE_HELP = `Usage: agentwiki-local-sync onboard continue --session UUID --protocol json [--reply-file PATH]
Required: --session UUID from start, --protocol json.
Omit --reply-file to retrieve browser approval from the server or advance one pending step.
For authorization_required, wait retryAfterMs before continuing; status only reads the local checkpoint.
--reply-file must be an absolute path to a private, owned regular JSON file (0600 on POSIX, at most 64 KiB).
Copy requestId and planHash from the latest result; stale replies are rejected.
Input reply, new Space:
  {"requestId":"<request-id>","values":{"spaceMode":"create","spaceName":"My Space","agentName":"My Agent","role":"editor"}}
Input reply, existing Space:
  {"requestId":"<request-id>","values":{"spaceMode":"existing","spaceId":"<eligible-space-id>","agentName":"My Agent","role":"reader"}}
Confirmation reply:
  {"requestId":"<request-id>","confirmed":true,"planHash":"<latest-plan-hash>"}
Roles: reader, editor, publisher. Set confirmed to false to cancel. Do not add extra keys.
Example: agentwiki-local-sync onboard continue --session <session-id> --protocol json --reply-file /absolute/path/reply.json`;
const COMMAND_HELP: Record<string, string> = {
  onboard: `Usage: agentwiki-local-sync onboard <start|status|continue> [options]
${ONBOARD_START_HELP}\n\n${ONBOARD_STATUS_HELP}\n\n${ONBOARD_CONTINUE_HELP}

Legacy streaming flow: onboard [--server URL] [--protocol ndjson|human]
Existing Agent: onboard --code CODE [--server URL] [--agent auto|generic|codex|claude|opencode|workbuddy]
Resume legacy flow: onboard resume --id SESSION_ID [--server URL] [--protocol ndjson|human]
Example: agentwiki-local-sync onboard --code <installation-code> --agent workbuddy`,
  gateway: `Usage: agentwiki-local-sync gateway [--connection ID]
--connection ID is required unless a default local connection is configured.
Uses MCP over stdio; --protocol is not supported. Configure this command in the host's MCP settings.
Example: agentwiki-local-sync gateway --connection <connection-id>`,
  doctor: `Usage: agentwiki-local-sync doctor [--connection ID] [--all-clients] [--source-path PATH]
Requires a saved connection. --connection ID overrides the default connection.
--all-clients inspects Codex, Claude Code, OpenCode and WorkBuddy configuration under the current home.
Absent optional clients are unverified; existing configurations missing the MCP entry fail.
Configuration registration does not verify a live host tool call. Generic hosts need manual MCP import and a tool call.
--source-path PATH additionally inspects the CodeGraph index for that source.
Example: agentwiki-local-sync doctor --all-clients
Example: agentwiki-local-sync doctor --connection <connection-id> --source-path /path/to/repo`,
  uninstall: `Usage: agentwiki-local-sync uninstall [--agent auto|generic|codex|claude|opencode|workbuddy] [--delete-credential] [--delete-sync-state]
--agent defaults to auto (all locally configured clients). Removes AgentWiki MCP entries and local connection records.
--delete-credential also removes their saved local credentials; --delete-sync-state removes local sync state.
Server-side credential revocation is separate. Reload or restart the client after removal.
Example: agentwiki-local-sync uninstall --agent workbuddy`,
};
const DEFAULT_SERVER_BASE_URL = 'https://agentwiki.quukk.com/api';
const PUBLIC_COMMANDS = new Set(['onboard', 'gateway', 'doctor', 'uninstall']);
const COMMAND_OPTIONS: Record<string, ReadonlySet<string>> = {
  onboard: new Set(['server', 'protocol', 'agent', 'code', 'id', 'client', 'session', 'reply-file']),
  gateway: new Set(['connection']),
  doctor: new Set(['connection', 'source-path', 'all-clients']),
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
  if (value === 'auto' || value === 'codex' || value === 'claude' || value === 'opencode' || value === 'workbuddy' || value === 'generic') return value;
  throw new Error('--agent must be auto, generic, codex, claude, opencode, or workbuddy');
}

function assertCommandOptions(command: string, values: Record<string, string | boolean | undefined>, allowed = COMMAND_OPTIONS[command]): void {
  if (!allowed) throw new Error(CLI_USAGE);
  for (const [name, value] of Object.entries(values)) {
    if (name === 'help' || allowed.has(name) || value === undefined || value === false) continue;
    throw new Error(`Unknown option '--${name}' for ${command}. Run '${command} --help' for supported options.\n${CLI_USAGE}`);
  }
}

function assertCommandPositionals(command: string, positionals: string[]): 'resume' | 'start' | 'status' | 'continue' | undefined {
  if (command === 'onboard') {
    if (positionals.length === 0) return undefined;
    if (positionals.length === 1 && ['resume', 'start', 'status', 'continue'].includes(positionals[0])) return positionals[0] as 'resume' | 'start' | 'status' | 'continue';
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
  status: 'pass' | 'fail' | 'unverified';
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
  if (connection.client === 'generic') return {
    name: 'mcp-registration', status: 'unverified',
    detail: 'Generic host registration is not verified. Import the generated MCP configuration, approve client tool permissions, reload or restart the client, then perform an actual host tool call.',
  };
  try {
    if (connection.client === 'codex' || connection.client === 'claude') {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
      delete env.CODEX_HOME;
      delete env.CLAUDE_CONFIG_DIR;
      const result = run(connection.client, ['mcp', 'get', connection.mcpName], {
        stdio: 'pipe',
        env,
      });
      return check('mcp-registration', !result.error && result.status === 0,
        !result.error && result.status === 0 ? `${connection.client} MCP entry is registered; live host tool call is not verified` : `${connection.client} MCP entry is missing`);
    }

    const parsed = JSON.parse(await readFile(clientConfigPath(connection.client, home), 'utf8')) as Record<string, unknown>;
    const mcp = connection.client === 'workbuddy' ? parsed.mcpServers : parsed.mcp;
    const entries = connection.client === 'opencode' && typeof mcp === 'object' && mcp !== null
      ? ('servers' in mcp && typeof mcp.servers === 'object' && mcp.servers !== null ? mcp.servers : mcp)
      : mcp;
    const registered = typeof entries === 'object' && entries !== null && connection.mcpName in entries;
    return check('mcp-registration', registered,
      registered ? `${connection.client} MCP entry is registered; live host tool call is not verified` : `${connection.client} MCP entry is missing`);
  } catch {
    return check('mcp-registration', false, `${connection.client} MCP entry is missing`);
  }
}

async function inspectAllMcpRegistrations(connection: LocalSyncConnection, home: string, run: CommandRunner): Promise<DoctorCheck[]> {
  const clients: AgentClient[] = ['codex', 'claude', 'opencode', 'workbuddy'];
  const checks = await Promise.all(clients.map(async (client): Promise<DoctorCheck> => {
    const name = `mcp-registration:${client}`;
    try {
      await stat(clientConfigPath(client, home));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && client !== connection.client) return {
        name, status: 'unverified', detail: `${client} configuration file is absent; this optional client may not be installed or configured`,
      };
      return check(name, false, `${client} configuration file is missing or unreadable`);
    }
    return { ...await inspectMcpRegistration({ ...connection, client }, home, run), name };
  }));
  if (connection.client === 'generic') checks.unshift(await inspectMcpRegistration(connection, home, run));
  return checks;
}

async function inspectFilePermissions(home: string): Promise<DoctorCheck> {
  const paths = [join(home, '.agentwiki', 'local-sync.json'), join(home, '.agentwiki', 'credentials.json')];
  try {
    if (process.platform === 'win32') {
      const entries = await Promise.all(paths.map((path) => lstat(path)));
      const regular = entries.every((entry) => entry.isFile() && !entry.isSymbolicLink());
      return check('file-permissions', false, regular
        ? 'Local config and credentials are regular files; Windows ACL protection was not verified'
        : 'Local config or credentials are not regular files');
    }
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
  options: { allClients?: boolean } = {},
): Promise<DoctorReport> {
 const codeGraph = dependencies.codeGraph ?? createCodeGraphProvider({ home });
 const codeGraphDiagnosis = await codeGraph.diagnose(sourcePath ? { sourcePath } : undefined);
 const checks = [
   check('node', isSupportedNodeVersion(process.version), `Node ${process.version}; supported lines are 24 and 26`),
    inspectCommand('markitdown', 'markitdown', ['--version'], dependencies.run, [0, 1, 0]),
    inspectCommand('git', 'git', ['--version'], dependencies.run),
    ...(options.allClients
      ? await inspectAllMcpRegistrations(connection, home, dependencies.run)
      : [await inspectMcpRegistration(connection, home, dependencies.run)]),
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
      check('connection-authorization', Boolean(agent?.credentials.some((credential) => credential.id === connection.credentialId && credential.active)),
        agent?.credentials.some((credential) => credential.id === connection.credentialId && credential.active)
          ? 'Agent connection is active; Space permissions are checked from live grants'
          : 'Configured Agent connection is inactive or unavailable'),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    checks.push(
      check('identity', false, `Unable to verify AgentWiki identity: ${detail}`),
      check('space-grants', false, 'Unable to verify Space grants'),
      check('connection-authorization', false, 'Unable to verify the Agent connection'),
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
      hostVerification: 'not_started',
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
      help: { type: 'boolean', short: 'h' }, 'all-clients': { type: 'boolean' },
      server: { type: 'string' }, protocol: { type: 'string' }, agent: { type: 'string' }, connection: { type: 'string' },
      code: { type: 'string' }, 'source-path': { type: 'string' },
      id: { type: 'string' }, client: { type: 'string' }, session: { type: 'string' }, 'reply-file': { type: 'string' },
      'delete-credential': { type: 'boolean', default: false }, 'delete-sync-state': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: true,
  });
  const { values } = parsed;
  assertCommandOptions(command, values);
  const positional = assertCommandPositionals(command, parsed.positionals as string[]);
  if (values.help) {
    if (command === 'onboard' && positional === 'start') return ONBOARD_START_HELP;
    if (command === 'onboard' && positional === 'status') return ONBOARD_STATUS_HELP;
    if (command === 'onboard' && positional === 'continue') return ONBOARD_CONTINUE_HELP;
    return COMMAND_HELP[command];
  }
  if (command === 'onboard') {
    if (positional === 'start' || positional === 'status' || positional === 'continue') {
      const allowed = new Set(positional === 'start'
        ? ['server', 'client', 'protocol']
        : positional === 'status' ? ['session', 'protocol'] : ['session', 'reply-file', 'protocol']);
      assertCommandOptions(`onboard ${positional}`, values, allowed);
      if (values.protocol !== 'json') throw new Error(`onboard ${positional} requires --protocol json.\n${CLI_USAGE}`);
      const client = values.client ?? 'generic';
      if (positional === 'start' && client !== 'codex' && client !== 'claude' && client !== 'opencode' && client !== 'workbuddy' && client !== 'generic') {
        throw new Error('--client must be generic, codex, claude, opencode, or workbuddy. Use generic for any other MCP-compatible host.');
      }
      return runOnboardingSteps({
        action: positional,
        home,
        ...(positional === 'start'
          ? { serverBaseUrl: required(values, 'server'), clientType: client as AgentClient }
          : { sessionId: required(values, 'session') }),
        ...(values['reply-file'] ? { replyFile: values['reply-file'] } : {}),
      });
    }
    if (values.client || values.session || values['reply-file']) throw new Error(CLI_USAGE);
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
  }, typeof values['source-path'] === 'string' ? values['source-path'] : undefined, { allClients: values['all-clients'] === true });
  throw new Error(CLI_USAGE);
}

async function main(): Promise<void> {
  const stepCommand = process.argv[2] === 'onboard'
    && ['start', 'status', 'continue'].includes(process.argv[3]);
  try {
    const result = await runCli();
    if (result !== undefined && (process.argv[2] !== 'onboard' || stepCommand || typeof result === 'string')) {
      process.stdout.write(`${formatOutput(result)}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (stepCommand) {
      const errorCode = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code) : /^([A-Z_]+):/.exec(message)?.[1];
      process.stdout.write(JSON.stringify({
        protocolVersion: 1,
        status: 'error',
        code: errorCode && /^[A-Z][A-Z0-9_]{0,79}$/.test(errorCode) ? errorCode : 'INVALID_COMMAND',
        message: redactSecrets(message).slice(0, 2000),
        knowledgeImport: 'not_started',
      }) + '\n');
    } else process.stderr.write(`${formatOutput(message)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) void main();
