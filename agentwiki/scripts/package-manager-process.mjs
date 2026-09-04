import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProcessTreeTerminationPlan } from './package-manager-process-runner.mjs';

const WINDOWS_ENTRYPOINTS = {
  npm: ['node_modules/npm/bin/npm-cli.js'],
  npx: ['node_modules/npm/bin/npx-cli.js'],
  pnpm: ['node_modules/pnpm/bin/pnpm.mjs', 'node_modules/pnpm/bin/pnpm.cjs'],
};
const MAX_MIGRATION_TIMEOUT_MS = 90_000;
const PROCESS_TREE_CLEANUP_GRACE_MS = 3_000;
const PROCESS_TREE_RUNNER = fileURLToPath(new URL('./package-manager-process-runner.mjs', import.meta.url));

function isJavaScriptEntrypoint(value) {
  return /\.(?:cjs|mjs|js)$/iu.test(value);
}

export function resolvePackageManagerInvocation(manager, args, {
  env = process.env,
  executable = process.execPath,
  fileExists = existsSync,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') return { executable: manager, args };
  const configured = env.npm_execpath;
  const candidates = [
    ...(configured
      && win32.basename(configured).toLowerCase().startsWith(manager)
      && isJavaScriptEntrypoint(configured)
      ? [configured]
      : []),
    ...WINDOWS_ENTRYPOINTS[manager].map((relativePath) => win32.resolve(win32.dirname(executable), relativePath)),
    ...(env.APPDATA ? WINDOWS_ENTRYPOINTS[manager].map((relativePath) => win32.resolve(env.APPDATA, 'npm', relativePath)) : []),
  ];
  const entrypoint = candidates.find((candidate) => fileExists(candidate));
  if (!entrypoint) throw new Error(`Unable to locate the ${manager} JavaScript entry point on Windows`);
  return { executable, args: [entrypoint, ...args] };
}

export function spawnPackageManagerSync(manager, args, options, dependencies = {}) {
  const invocation = resolvePackageManagerInvocation(manager, args, dependencies);
  const spawnProcessSync = dependencies.spawnSync ?? spawnSync;
  if (dependencies.spawnSync || !Number.isSafeInteger(options?.timeout) || options.timeout <= 0) {
    return spawnProcessSync(invocation.executable, invocation.args, options);
  }

  const input = options.input === undefined
    ? null
    : Buffer.from(options.input).toString('base64');
  const runnerResult = spawnProcessSync(process.execPath, [PROCESS_TREE_RUNNER], {
    cwd: options.cwd,
    env: options.env,
    encoding: options.encoding,
    input: JSON.stringify({
      executable: invocation.executable,
      args: invocation.args,
      inputBase64: input,
      timeout: options.timeout,
      windowsHide: options.windowsHide,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
    }),
    killSignal: 'SIGKILL',
    maxBuffer: options.maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    timeout: options.timeout + PROCESS_TREE_CLEANUP_GRACE_MS,
    windowsHide: true,
  });
  return packageManagerResultFromRunner(runnerResult, invocation, dependencies);
}

function parseRunnerMetadata(output) {
  if (output === null || output === undefined) return [];
  return String(output)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function restoreError(serialized, invocation) {
  if (!serialized) return undefined;
  const error = new Error(serialized.message);
  Object.assign(error, serialized);
  error.syscall = `spawnSync ${invocation.executable}`;
  error.path = invocation.executable;
  error.spawnargs = invocation.args;
  return error;
}

function timedOutError(invocation) {
  const error = new Error(`spawnSync ${invocation.executable} ETIMEDOUT`);
  error.code = 'ETIMEDOUT';
  error.syscall = `spawnSync ${invocation.executable}`;
  error.path = invocation.executable;
  error.spawnargs = invocation.args;
  return error;
}

function terminateAfterRunnerFailure(pid, dependencies) {
  if (!pid) return;
  const platform = dependencies.platform ?? process.platform;
  const plan = createProcessTreeTerminationPlan(pid, platform);
  if (platform === 'win32') {
    (dependencies.spawnSync ?? spawnSync)(plan.executable, plan.args, {
      stdio: 'ignore',
      timeout: 2_000,
      windowsHide: true,
    });
    return;
  }
  try {
    (dependencies.kill ?? process.kill)(plan.processGroup, plan.forceSignal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function packageManagerResultFromRunner(runnerResult, invocation, dependencies) {
  let metadata;
  try {
    metadata = parseRunnerMetadata(runnerResult.output?.[3]);
  } catch {
    metadata = [];
  }
  const started = metadata.find((record) => record.type === 'started');
  const final = metadata.findLast((record) => record.type === 'result' || record.type === 'timeout');

  if (runnerResult.error) terminateAfterRunnerFailure(started?.pid, dependencies);
  const childError = restoreError(final?.error, invocation);
  const error = final?.type === 'timeout'
    ? timedOutError(invocation)
    : childError ?? runnerResult.error;
  if (childError) {
    return {
      pid: 0,
      output: null,
      stdout: undefined,
      stderr: undefined,
      status: null,
      signal: null,
      error,
    };
  }
  return {
    pid: started?.pid ?? runnerResult.pid,
    output: runnerResult.output?.slice(0, 3),
    stdout: runnerResult.stdout,
    stderr: runnerResult.stderr,
    status: final?.type === 'result' ? final.status : null,
    signal: final?.type === 'result' ? final.signal : runnerResult.signal,
    error,
  };
}

export function spawnPackageManager(manager, args, options, dependencies = {}) {
  const invocation = resolvePackageManagerInvocation(manager, args, dependencies);
  return (dependencies.spawn ?? spawn)(invocation.executable, invocation.args, options);
}

export const spawnPnpmSync = (args, options, dependencies) => spawnPackageManagerSync('pnpm', args, options, dependencies);

export function boundedMigrationOptions(options = {}) {
  const configured = options.timeout;
  if (
    configured !== undefined
    && (!Number.isSafeInteger(configured) || configured <= 0)
  ) {
    throw new Error('Migration timeout must be a positive safe integer');
  }
  return {
    ...options,
    timeout: Math.min(configured ?? MAX_MIGRATION_TIMEOUT_MS, MAX_MIGRATION_TIMEOUT_MS),
  };
}
