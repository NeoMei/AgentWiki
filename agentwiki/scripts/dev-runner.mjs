import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const DEV_COMMANDS = [
  {
    name: 'api',
    args: ['--filter', '@agentwiki/server', 'start:dev'],
  },
  {
    name: 'worker',
    args: ['--filter', '@agentwiki/server', 'start:worker:dev'],
  },
  {
    name: 'client',
    args: ['--filter', '@agentwiki/client', 'dev'],
  },
];

export function prepareEnvironment(source = process.env) {
  const env = { ...source };
  const secret = env.JWT_SECRET || env.APP_SECRET;

  if (!secret) {
    throw new Error('APP_SECRET or JWT_SECRET is required to start AgentWiki');
  }

  env.JWT_SECRET ||= secret;
  return env;
}

export function resolvePnpmInvocation(args, env = process.env) {
  if (process.platform !== 'win32') return { executable: 'pnpm', args };
  const candidates = [
    env.npm_execpath,
    env.APPDATA && resolve(env.APPDATA, 'npm/node_modules/pnpm/bin/pnpm.mjs'),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (!cli) throw new Error('Unable to locate the pnpm JavaScript entry point on Windows');
  return { executable: process.execPath, args: [cli, ...args] };
}

function spawnPnpm(_name, args, env) {
  const command = resolvePnpmInvocation(args, env);
  return spawn(command.executable, command.args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
}

export function createDevSupervisor({
  commands = DEV_COMMANDS,
  env,
  spawnChild = spawnPnpm,
} = {}) {
  const children = [];
  let completion;
  let resolveCompletion;
  let stopping = false;
  let exitedChildren = 0;

  function finish(code) {
    resolveCompletion?.(code);
  }

  function stopSiblings(origin, signal = 'SIGTERM') {
    for (const child of children) {
      if (child !== origin && child.exitCode === null) {
        child.kill(signal);
      }
    }
  }

  function onUnexpectedExit(child, code, signal) {
    if (stopping) {
      exitedChildren += 1;
      if (exitedChildren === children.length) finish(0);
      return;
    }

    stopping = true;
    const exitCode = Number.isInteger(code) && code !== 0 ? code : 1;
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
    console.error(`[dev] ${child.name} stopped unexpectedly (${detail})`);
    stopSiblings(child);
    finish(exitCode);
  }

  return {
    start() {
      if (completion) return completion;

      completion = new Promise((resolvePromise) => {
        resolveCompletion = resolvePromise;
      });

      for (const command of commands) {
        const child = spawnChild(command.name, command.args, env);
        child.name = command.name;
        children.push(child);
        child.once('error', (error) => {
          console.error(`[dev] failed to start ${command.name}: ${error.message}`);
          onUnexpectedExit(child, 1, null);
        });
        child.once('exit', (code, signal) => {
          onUnexpectedExit(child, code, signal);
        });
      }

      return completion;
    },

    forwardSignal(signal) {
      if (stopping) return;
      stopping = true;
      for (const child of children) {
        if (child.exitCode === null) child.kill(signal);
      }
      if (children.length === 0) finish(0);
    },
  };
}

export async function run() {
  loadEnvFile(resolve(root, '.env'));
  const env = prepareEnvironment(process.env);
  const supervisor = createDevSupervisor({ env });

  const onSigint = () => supervisor.forwardSignal('SIGINT');
  const onSigterm = () => supervisor.forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  try {
    return await supervisor.start();
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    process.exitCode = await run();
  } catch (error) {
    console.error(`[dev] ${error.message}`);
    process.exitCode = 1;
  }
}
