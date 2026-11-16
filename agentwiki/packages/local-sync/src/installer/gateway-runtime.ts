/**
 * Local gateway runtime: install the pinned Local Sync package once during
 * onboarding, then launch it from the host configuration with an absolute
 * Node executable and CLI path.
 *
 * Hosts must never run npx while starting MCP. A registry lookup at every
 * Agent launch turns MCP startup into a network dependency and times out on
 * machines that cannot reach the registry, even though the package is already
 * installed locally.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertSupportedNodeRuntime } from '../node-runtime.js';
import { GATEWAY_PACKAGE_NAME, GATEWAY_PACKAGE_VERSION } from './package-release.js';

const run = promisify(execFile);
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const RUNTIME_MANIFEST = 'runtime.json';
const RUNTIME_DIR_PREFIX = 'local-sync-';
const PACKAGE_SEGMENTS = ['node_modules', '@neomei', 'agentwiki-local-sync'];

/** Absolute Node + CLI pair written into every host configuration. */
export interface InstalledGatewayRuntime {
  nodePath: string;
  cliPath: string;
  version: string;
}

export interface GatewayRuntimeOptions {
  home: string;
  version?: string;
  /** Node used for installation and recorded in the launch command. */
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  /** Injection seam: tests provide a staged runtime instead of npm. */
  install?: (target: string, version: string, nodePath: string) => Promise<void>;
}

export function gatewayRuntimeRoot(home: string): string {
  return join(home, '.agentwiki', 'runtime');
}

export function gatewayRuntimeDir(home: string, version: string = GATEWAY_PACKAGE_VERSION): string {
  assertExactVersion(version);
  return join(gatewayRuntimeRoot(home), `${RUNTIME_DIR_PREFIX}${version}`);
}

export function gatewayRuntimeCliPath(home: string, version: string = GATEWAY_PACKAGE_VERSION): string {
  return join(gatewayRuntimeDir(home, version), ...PACKAGE_SEGMENTS, 'dist', 'cli.js');
}

/** Launch shape shared by every host; never npx. */
export function localGatewayCommand(
  runtime: Pick<InstalledGatewayRuntime, 'nodePath' | 'cliPath'>,
  connectionId: string,
): string[] {
  return [runtime.nodePath, runtime.cliPath, 'gateway', '--connection', connectionId];
}

/** True when an existing entry already launches this installed runtime. */
export function isLocalGatewayCli(value: string): boolean {
  const normalized = value.split('\\').join('/');
  return normalized.endsWith('/node_modules/@neomei/agentwiki-local-sync/dist/cli.js')
    || normalized === '@neomei/agentwiki-local-sync/dist/cli.js';
}

export function assertExactVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Gateway runtime version must be an exact version');
  }
}

/**
 * Read an installed runtime, or null when the directory is absent or does not
 * contain the pinned package. Read-only: never installs, repairs, or executes.
 */
export async function readGatewayRuntime(
  home: string,
  version: string = GATEWAY_PACKAGE_VERSION,
): Promise<InstalledGatewayRuntime | null> {
  const directory = gatewayRuntimeDir(home, version);
  const cliPath = join(directory, ...PACKAGE_SEGMENTS, 'dist', 'cli.js');
  const manifestPath = join(directory, ...PACKAGE_SEGMENTS, 'package.json');
  try {
    const directoryInfo = await lstat(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return null;
    if (process.platform !== 'win32' && (directoryInfo.mode & 0o077) !== 0) return null;
    const [cliInfo, manifest] = await Promise.all([
      stat(cliPath),
      readFile(manifestPath, 'utf8').then((text) => JSON.parse(text) as { name?: string; version?: string }),
    ]);
    if (!cliInfo.isFile()) return null;
    if (manifest.name !== GATEWAY_PACKAGE_NAME || manifest.version !== version) return null;
    return { nodePath: await readRecordedNodePath(directory), cliPath, version };
  } catch {
    return null;
  }
}

/**
 * Install the pinned package into `<home>/.agentwiki/runtime/local-sync-<version>`
 * exactly once. A verified existing runtime is reused without touching npm.
 */
export async function ensureGatewayRuntime(options: GatewayRuntimeOptions): Promise<InstalledGatewayRuntime> {
  const version = options.version ?? GATEWAY_PACKAGE_VERSION;
  assertExactVersion(version);
  const existing = await readGatewayRuntime(options.home, version);
  if (existing) return existing;

  const nodePath = await resolveSupportedNode(options.nodePath);
  const root = gatewayRuntimeRoot(options.home);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const staging = await mkdtemp(join(root, `.install-${version}-`));
  try {
    if (options.install) {
      await options.install(staging, version, nodePath);
    } else {
      await installPinnedPackage(staging, version, nodePath, options.home, options.env ?? process.env);
    }
    await assertInstalledPackage(staging, version);
    await writeRuntimeManifest(staging, { version, nodePath });
    const target = gatewayRuntimeDir(options.home, version);
    try {
      await rename(staging, target);
    } catch (error) {
      // Another onboarding run may have completed the same install first.
      const raced = await readGatewayRuntime(options.home, version);
      if (raced) return raced;
      throw error;
    }
    const installed = await readGatewayRuntime(options.home, version);
    if (!installed) throw new Error('Gateway runtime installation is incomplete');
    return installed;
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** Stage a disposable runtime for tests; the CLI only needs to exist and be readable. */
export async function stageGatewayRuntimeFixture(
  home: string,
  version: string = GATEWAY_PACKAGE_VERSION,
  nodePath: string = process.execPath,
): Promise<InstalledGatewayRuntime> {
  const directory = gatewayRuntimeDir(home, version);
  const packageDirectory = join(directory, ...PACKAGE_SEGMENTS);
  await mkdir(join(packageDirectory, 'dist'), { recursive: true, mode: 0o700 });
  await chmod(gatewayRuntimeRoot(home), 0o700);
  await chmod(directory, 0o700);
  await chmod(join(directory, 'node_modules'), 0o700);
  await chmod(join(directory, 'node_modules', '@neomei'), 0o700);
  await chmod(packageDirectory, 0o700);
  await chmod(join(packageDirectory, 'dist'), 0o700);
  const cliPath = join(packageDirectory, 'dist', 'cli.js');
  await writeFilePrivate(cliPath, '#!/usr/bin/env node\nprocess.exit(0);\n');
  await writeFilePrivate(join(packageDirectory, 'package.json'), JSON.stringify({ name: GATEWAY_PACKAGE_NAME, version }) + '\n');
  await writeRuntimeManifest(directory, { version, nodePath });
  return { nodePath, cliPath, version };
}

async function installPinnedPackage(
  target: string,
  version: string,
  nodePath: string,
  home: string,
  inheritedEnv: NodeJS.ProcessEnv,
): Promise<void> {
  const npmCli = await resolveNpmCli(nodePath, inheritedEnv);
  const cache = join(gatewayRuntimeRoot(home), '.npm-cache');
  await mkdir(cache, { recursive: true, mode: 0o700 }).catch(() => undefined);
  await writeFilePrivate(join(target, 'package.json'), `${JSON.stringify({
    private: true,
    dependencies: { [GATEWAY_PACKAGE_NAME]: version },
  }, null, 2)}\n`);
  const env: NodeJS.ProcessEnv = {
    ...inheritedEnv,
    npm_config_cache: cache,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  };
  try {
    await run(nodePath, [
      npmCli,
      'install',
      '--prefix', target,
      `${GATEWAY_PACKAGE_NAME}@${version}`,
      '--save-exact',
      '--omit=dev',
      // The gateway and its dependencies need no lifecycle scripts; skipping
      // them also avoids a host npm policy that rejects script approval here.
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ], {
      cwd: target,
      env,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`GATEWAY_RUNTIME_INSTALL_FAILED: could not install ${GATEWAY_PACKAGE_NAME}@${version}. ${installFailureDetail(error)}`, { cause: error });
  }
}

function installFailureDetail(error: unknown): string {
  const output = typeof error === 'object' && error !== null && 'stderr' in error
    ? String((error as { stderr?: unknown }).stderr ?? '')
    : '';
  const detail = output.trim().split('\n').slice(-6).join(' ').slice(0, 600);
  return `${detail ? `${detail} ` : ''}The gateway runtime is installed once during onboarding; check the npm registry connection and retry the same onboarding session. Hosts never run npx when starting MCP.`;
}

async function assertInstalledPackage(directory: string, version: string): Promise<void> {
  const packageDirectory = join(directory, ...PACKAGE_SEGMENTS);
  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as { name?: string; version?: string };
  if (manifest.name !== GATEWAY_PACKAGE_NAME) throw new Error('GATEWAY_RUNTIME_INSTALL_FAILED: unexpected package name');
  if (manifest.version !== version) throw new Error(`GATEWAY_RUNTIME_INSTALL_FAILED: installed ${manifest.version ?? 'unknown'}, expected ${version}`);
  const cli = await stat(join(packageDirectory, 'dist', 'cli.js'));
  if (!cli.isFile()) throw new Error('GATEWAY_RUNTIME_INSTALL_FAILED: gateway CLI is missing');
}

async function resolveSupportedNode(configured?: string): Promise<string> {
  const candidate = configured ?? process.execPath;
  if (!isAbsolute(candidate)) throw new Error('GATEWAY_RUNTIME_INSTALL_FAILED: Node must be an absolute path');
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved) throw new Error(`GATEWAY_RUNTIME_INSTALL_FAILED: Node executable not found at ${candidate}`);
  await access(resolved, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
  const { stdout } = await run(resolved, ['--version'], { timeout: 10_000, windowsHide: true });
  assertSupportedNodeRuntime(stdout.trim());
  return resolved;
}

/** Resolve the npm CLI that belongs to the selected Node; never another npx from PATH. */
async function resolveNpmCli(nodePath: string, env: NodeJS.ProcessEnv): Promise<string> {
  const candidates: string[] = [];
  const execPath = env.npm_execpath;
  if (execPath && isAbsolute(execPath)) {
    const sibling = execPath.replace(/(?:npx|npm)-cli\.js$/u, 'npm-cli.js');
    if (sibling !== execPath) candidates.push(sibling);
    else candidates.push(execPath);
  }
  const nodeDirectory = dirname(nodePath);
  candidates.push(
    process.platform === 'win32'
      ? join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : join(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  );
  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (!info.isFile()) continue;
      if (!candidate.endsWith('npm-cli.js')) continue;
      const { stdout } = await run(nodePath, [candidate, '--version'], { timeout: 15_000, windowsHide: true });
      if (/^\d+\.\d+\.\d+/u.test(stdout.trim())) return candidate;
    } catch {
      // Try the next trusted location.
    }
  }
  throw new Error('GATEWAY_RUNTIME_INSTALL_FAILED: npm is required next to the selected Node.js 24 or 26 installation to install the gateway runtime once');
}

async function readRecordedNodePath(directory: string): Promise<string> {
  try {
    const value = JSON.parse(await readFile(join(directory, RUNTIME_MANIFEST), 'utf8')) as { nodePath?: unknown };
    if (typeof value.nodePath === 'string' && isAbsolute(value.nodePath)) return value.nodePath;
  } catch {
    // Fall back to the current supported runtime for read-only inspection.
  }
  return process.execPath;
}

async function writeRuntimeManifest(directory: string, value: { version: string; nodePath: string }): Promise<void> {
  await writeFilePrivate(join(directory, RUNTIME_MANIFEST), `${JSON.stringify({
    version: value.version,
    nodePath: value.nodePath,
    installedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

async function writeFilePrivate(path: string, contents: string): Promise<void> {
  const file = await open(path, 'w', 0o600);
  try {
    await file.writeFile(contents, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(path, 0o600).catch(() => undefined);
}

/** Exported for the doctor check: the separator used by absolute runtime paths. */
export const GATEWAY_RUNTIME_PATH_SEPARATOR = sep;
