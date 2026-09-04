import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

const WINDOWS_ENTRYPOINTS = {
  npm: ['node_modules/npm/bin/npm-cli.js'],
  npx: ['node_modules/npm/bin/npx-cli.js'],
  pnpm: ['node_modules/pnpm/bin/pnpm.mjs', 'node_modules/pnpm/bin/pnpm.cjs'],
};
const MAX_MIGRATION_TIMEOUT_MS = 90_000;

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
  return (dependencies.spawnSync ?? spawnSync)(invocation.executable, invocation.args, options);
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
