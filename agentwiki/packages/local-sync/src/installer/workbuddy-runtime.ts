import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdtemp, readFile, realpath, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { assertSupportedNodeRuntime } from '../node-runtime.js';
import { gatewayCommand } from './plan.js';
import { WORKBUDDY_NPX_LAUNCHER } from './workbuddy-launcher.js';

const run = promisify(execFile);
const CACHE_PREFIX = 'agentwiki-workbuddy-npm-';

export interface GatewayLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Only config overrides are persisted. Inherited secrets and NODE_OPTIONS stay in the host environment. */
export async function createWorkBuddyGatewayLaunch(
  connectionId: string,
  options: { nodePath?: string; env?: Record<string, string> } = {},
): Promise<GatewayLaunch> {
  const command = options.nodePath ?? process.execPath;
  const env = mergeWorkBuddyEnvironment({}, options.env ?? {});
  const inheritedPath = mergeWorkBuddyEnvironment(process.env, env).PATH ?? '';
  env.PATH = [dirname(command), inheritedPath].filter(Boolean).join(delimiter);
  const npmCli = await resolveNpxCli(command, env);
  // npm's lock cleanup is allowed under the host's real system temporary directory.
  // This random directory holds disposable npm data only, never AgentWiki credentials.
  const cache = await mkdtemp(join(await temporaryRoot(env), CACHE_PREFIX));
  if (!await privateCache(cache, env)) throw new Error('CONFIG_NOT_WRITABLE: WorkBuddy npm cache is not private');
  return { command, args: ['-e', WORKBUDDY_NPX_LAUNCHER, npmCli, '--cache', cache, ...gatewayCommand(connectionId).slice(1)], env };
}

/** Retry only our complete launch contract; a same-connection bare npx entry is not equivalent. */
export async function validateWorkBuddyGatewayLaunch(value: unknown, connectionId: string): Promise<boolean> {
  if (!isLaunch(value) || value.command !== process.execPath) return false;
  const suffix = gatewayCommand(connectionId).slice(1);
  if (value.args.length !== suffix.length + 5 || value.args[0] !== '-e'
    || value.args[1] !== WORKBUDDY_NPX_LAUNCHER || value.args[3] !== '--cache'
    || !suffix.every((part, index) => value.args[index + 5] === part)) return false;
  if (value.env.PATH?.split(delimiter)[0] !== dirname(process.execPath)) return false;
  if (process.platform === 'win32' && Object.keys(value.env).some((key) => key !== 'PATH' && key.toUpperCase() === 'PATH')) return false;
  try {
    if (value.args[2] !== await resolveNpxPath(process.execPath)) return false;
    return await privateCache(value.args[4], value.env);
  } catch {
    return false;
  }
}

function isLaunch(value: unknown): value is GatewayLaunch {
  if (!value || typeof value !== 'object') return false;
  const launch = value as Partial<GatewayLaunch>;
  return typeof launch.command === 'string' && isAbsolute(launch.command)
    && Array.isArray(launch.args) && launch.args.every((arg) => typeof arg === 'string')
    && Boolean(launch.env) && typeof launch.env === 'object' && !Array.isArray(launch.env)
    && Object.values(launch.env!).every((value) => typeof value === 'string');
}

async function resolveNpxCli(nodePath: string, overrides: Record<string, string>): Promise<string> {
  if (!isAbsolute(nodePath) || !(await stat(nodePath)).isFile()) {
    throw new Error('CONFIG_NOT_WRITABLE: WorkBuddy requires an absolute Node executable');
  }
  await access(nodePath, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
  const env = mergeWorkBuddyEnvironment(process.env, overrides);
  const { stdout: nodeVersion } = await run(nodePath, ['--version'], { env, timeout: 10_000, windowsHide: true });
  assertSupportedNodeRuntime(nodeVersion.trim());
  try {
    const cli = await resolveNpxPath(nodePath);
    const { stdout } = await run(nodePath, [cli, '--version'], { env, timeout: 10_000, windowsHide: true });
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(stdout.trim())) throw new Error('npm did not return a version');
    return cli;
  } catch (cause) {
    throw new Error('CONFIG_NOT_WRITABLE: WorkBuddy requires working npm/npx installed alongside the selected Node; reinstall Node 24 or 26 with npm and retry', { cause });
  }
}

/** Resolve only trusted runtime metadata; replay inspection must not execute unconfirmed config. */
async function resolveNpxPath(nodePath: string): Promise<string> {
  const entry = process.platform === 'win32'
    ? join(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npx-cli.js')
    : join(dirname(nodePath), 'npx');
  if (!(await stat(entry)).isFile()) throw new Error('npx is not a file');
  const cli = await realpath(entry);
  if (basename(cli) !== 'npx-cli.js' || basename(dirname(cli)) !== 'bin') throw new Error('npx is not the npm CLI');
  const manifest = JSON.parse(await readFile(join(dirname(dirname(cli)), 'package.json'), 'utf8'));
  if (manifest.name !== 'npm' || manifest.bin?.npx !== 'bin/npx-cli.js') throw new Error('npx is not part of npm');
  await access(cli, constants.R_OK);
  return cli;
}

async function privateCache(cache: string, env: Record<string, string>): Promise<boolean> {
  if (!isAbsolute(cache) || dirname(cache) !== await temporaryRoot(env)
    || !/^agentwiki-workbuddy-npm-[A-Za-z0-9]{6}$/.test(basename(cache))) return false;
  try {
    const info = await lstat(cache);
    return info.isDirectory() && !info.isSymbolicLink()
      && (process.platform === 'win32' || ((info.mode & 0o077) === 0 && info.uid === process.getuid?.()));
  } catch (error) {
    // Pure inspection: the trusted inline launcher recreates a missing cache at actual startup.
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/** Match Node os.tmpdir precedence using the effective child env, without executing unconfirmed config. */
async function temporaryRoot(overrides: Record<string, string>): Promise<string> {
  const env = mergeWorkBuddyEnvironment(process.env, overrides);
  const directory = process.platform === 'win32'
    ? env.TEMP || env.TMP || join(env.SYSTEMROOT || env.WINDIR || '', 'temp')
    : env.TMPDIR || env.TMP || env.TEMP || '/tmp';
  if (!isAbsolute(directory)) {
    throw new Error('CONFIG_NOT_WRITABLE: WorkBuddy temporary directory must be an absolute path');
  }
  return realpath(directory);
}

/** Windows treats environment names case-insensitively; canonical keys prevent child_process dropping overrides. */
export function mergeWorkBuddyEnvironment(
  inherited: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of [inherited, overrides]) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') merged[platform === 'win32' ? key.toUpperCase() : key] = value;
    }
  }
  return merged;
}
