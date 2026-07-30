import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { SpawnSyncOptions } from 'node:child_process';

export type AgentClient = 'codex' | 'claude' | 'opencode';

export interface CommandResult {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: SpawnSyncOptions,
) => CommandResult;

type JsonObject = Record<string, unknown>;

const CLIENTS: AgentClient[] = ['codex', 'claude', 'opencode'];
const COMMAND_OPTIONS: SpawnSyncOptions = { stdio: 'pipe' };
const SKILL_NAME = 'agentwiki-local-sync';

export const OPENCODE_MCP_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;

export const packagedSkillSource = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function commandOutput(value: string | Buffer | undefined): string {
  return typeof value === 'string' ? value : value?.toString('utf8') ?? '';
}

function assertCommandSucceeded(command: string, result: CommandResult): void {
  if (!result.error && result.status === 0) return;

  const details = commandOutput(result.stderr).trim();
  throw new Error(`Unable to run ${command}${details ? `: ${details}` : ''}`, { cause: result.error });
}

function run(runner: CommandRunner, command: string, args: string[]): CommandResult {
  const result = runner(command, args, COMMAND_OPTIONS);
  assertCommandSucceeded(command, result);
  return result;
}

function mcpCommand(version: string, connectionId: string): string[] {
  assertExactVersion(version);
  return ['npx', '-y', `@neomei/agentwiki-local-sync@${version}`, 'mcp', '--connection', connectionId];
}

function assertExactVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Local sync package version must be an exact version');
  }
}

function opencodePath(home: string): string {
  return join(home, '.config', 'opencode', 'opencode.json');
}

async function readOpenCodeConfig(path: string): Promise<{ exists: boolean; config: JsonObject }> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!isJsonObject(parsed)) throw new Error('OpenCode configuration must be a JSON object');
    return { exists: true, config: parsed };
  } catch (error: unknown) {
    if (isNotFound(error)) return { exists: false, config: {} };
    throw error;
  }
}

async function writeJsonAtomically(path: string, value: JsonObject): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function opencodeMajorVersion(runner: CommandRunner): 1 | 2 {
  const result = run(runner, 'opencode', ['--version']);
  const match = commandOutput(result.stdout).match(/(?:^|\s)v?(\d+)\./);
  const major = match ? Number(match[1]) : NaN;

  if (major === 1 || major === 2) return major;
  throw new Error('Unsupported or unrecognized OpenCode version');
}

function desiredOpenCodeEntry(version: string, connectionId: string, major: 1 | 2): JsonObject {
  return {
    type: 'local',
    command: mcpCommand(version, connectionId),
    ...(major === 1
      ? { enabled: true, timeout: OPENCODE_MCP_EXECUTION_TIMEOUT_MS }
      : { disabled: false, timeout: { execution: OPENCODE_MCP_EXECUTION_TIMEOUT_MS } }),
  };
}

function mcpContainer(config: JsonObject, major: 1 | 2): JsonObject {
  const mcp = config.mcp;
  if (mcp === undefined) return {};
  if (!isJsonObject(mcp)) throw new Error('OpenCode mcp configuration must be an object');

  if (major === 2 && mcp.servers !== undefined && !isJsonObject(mcp.servers)) {
    throw new Error('OpenCode mcp.servers configuration must be an object');
  }
  return mcp;
}

function mcpEntries(mcp: JsonObject, major: 1 | 2): JsonObject {
  if (major === 1) return mcp;
  const servers = mcp.servers;
  return servers === undefined ? {} : servers as JsonObject;
}

function withOpenCodeEntry(config: JsonObject, name: string, entry: JsonObject, major: 1 | 2): JsonObject {
  const mcp = mcpContainer(config, major);
  const entries = mcpEntries(mcp, major);
  const nextEntries = { ...entries, [name]: entry };
  const nextMcp = major === 1 ? nextEntries : { ...mcp, servers: nextEntries };
  return { ...config, mcp: nextMcp };
}

function withoutOpenCodeEntry(config: JsonObject, name: string, major: 1 | 2): JsonObject | undefined {
  const mcp = mcpContainer(config, major);
  const entries = mcpEntries(mcp, major);
  if (!(name in entries)) return undefined;

  const remainingEntries = { ...entries };
  delete remainingEntries[name];
  const nextMcp = major === 1 ? remainingEntries : { ...mcp, servers: remainingEntries };
  return { ...config, mcp: nextMcp };
}

export function detectClient(requested: AgentClient | 'auto', runner: CommandRunner): AgentClient {
  if (requested !== 'auto') return requested;

  const installed = CLIENTS.filter((client) => {
    try {
      const result = runner(client, ['--version'], COMMAND_OPTIONS);
      return !result.error && result.status === 0;
    } catch {
      return false;
    }
  });

  if (installed.length === 1) return installed[0];
  if (installed.length === 0) throw new Error('No supported Agent client is installed');
  throw new Error(`More than one supported Agent client is installed. Choose one of: ${installed.join(', ')}`);
}

export async function installSkill(home: string, skillSource: string, client: AgentClient): Promise<string[]> {
  const contents = await readFile(skillSource);
  const destinations = [join(home, '.agents', 'skills', SKILL_NAME, 'SKILL.md')];
  if (client === 'claude') destinations.push(join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md'));

  await Promise.all(destinations.map(async (destination) => {
    const directory = dirname(destination);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, contents, { mode: 0o600 });
      await rename(temporaryPath, destination);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }));

  return destinations;
}

export async function registerMcp(
  client: AgentClient,
  name: string,
  connectionId: string,
  version: string,
  runner: CommandRunner,
  home: string,
): Promise<void> {
  const command = mcpCommand(version, connectionId);
  if (client === 'codex') {
    run(runner, 'codex', ['mcp', 'add', name, '--', ...command]);
    return;
  }
  if (client === 'claude') {
    run(runner, 'claude', ['mcp', 'add', '--scope', 'user', name, '--', ...command]);
    return;
  }

  const major = opencodeMajorVersion(runner);
  const path = opencodePath(home);
  const { config } = await readOpenCodeConfig(path);
  const entries = mcpEntries(mcpContainer(config, major), major);
  const desired = desiredOpenCodeEntry(version, connectionId, major);
  const existing = entries[name];
  if (existing !== undefined) {
    if (isDeepStrictEqual(existing, desired)) return;
    throw new Error(`OpenCode MCP entry ${name} already exists with a different configuration`);
  }

  await writeJsonAtomically(path, withOpenCodeEntry(config, name, desired, major));
}

export async function removeMcp(
  client: AgentClient,
  name: string,
  runner: CommandRunner,
  home: string,
): Promise<void> {
  if (client === 'codex') {
    run(runner, 'codex', ['mcp', 'remove', name]);
    return;
  }
  if (client === 'claude') {
    run(runner, 'claude', ['mcp', 'remove', '--scope', 'user', name]);
    return;
  }

  const path = opencodePath(home);
  const { exists, config } = await readOpenCodeConfig(path);
  if (!exists) return;

  const major = opencodeMajorVersion(runner);
  const next = withoutOpenCodeEntry(config, name, major);
  if (next !== undefined) await writeJsonAtomically(path, next);
}
