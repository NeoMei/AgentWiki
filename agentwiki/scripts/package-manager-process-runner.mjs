#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFileSync, writeSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FORCE_KILL_GRACE_MS = 100;
const TASKKILL_TIMEOUT_MS = 2_000;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function createProcessTreeTerminationPlan(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Process-tree root PID must be a positive safe integer');
  if (platform === 'win32') {
    return {
      executable: 'taskkill.exe',
      args: ['/PID', String(pid), '/T', '/F'],
    };
  }
  return {
    processGroup: -pid,
    gracefulSignal: 'SIGTERM',
    forceSignal: 'SIGKILL',
  };
}

function ignoreMissingProcess(error) {
  if (error?.code !== 'ESRCH') throw error;
}

export async function terminateProcessTree(pid, {
  platform = process.platform,
  kill = process.kill,
  spawnProcess = spawn,
} = {}) {
  const plan = createProcessTreeTerminationPlan(pid, platform);
  if (platform === 'win32') {
    await new Promise((resolve) => {
      const killer = spawnProcess(plan.executable, plan.args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        killer.kill('SIGKILL');
        finish();
      }, TASKKILL_TIMEOUT_MS);
      killer.once('error', finish);
      killer.once('close', finish);
    });
    return;
  }

  try {
    kill(plan.processGroup, plan.gracefulSignal);
  } catch (error) {
    ignoreMissingProcess(error);
  }
  await delay(FORCE_KILL_GRACE_MS);
  try {
    kill(plan.processGroup, plan.forceSignal);
  } catch (error) {
    ignoreMissingProcess(error);
  }
}

function writeMetadata(record) {
  writeSync(3, `${JSON.stringify(record)}\n`);
}

function serializeError(error) {
  if (!error) return null;
  return Object.fromEntries([
    'name',
    'message',
    'code',
    'errno',
    'syscall',
    'path',
    'spawnargs',
  ].flatMap((key) => (error[key] === undefined ? [] : [[key, error[key]]])));
}

async function run() {
  const config = JSON.parse(readFileSync(0, 'utf8'));
  const child = spawn(config.executable, config.args, {
    cwd: process.cwd(),
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: config.windowsHide,
    windowsVerbatimArguments: config.windowsVerbatimArguments,
  });
  writeMetadata({ type: 'started', pid: child.pid });

  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  if (config.inputBase64 === null) child.stdin.end();
  else child.stdin.end(Buffer.from(config.inputBase64, 'base64'));

  const completed = new Promise((resolve) => {
    let spawnError = null;
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (status, signal) => resolve({ status, signal, error: spawnError }));
  });
  let timeoutHandle;
  const timedOut = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ type: 'timeout' }), config.timeout);
  });
  const outcome = await Promise.race([
    completed.then((result) => ({ type: 'result', ...result })),
    timedOut,
  ]);
  clearTimeout(timeoutHandle);

  if (outcome.type === 'timeout') {
    await terminateProcessTree(child.pid);
    writeMetadata({ type: 'timeout', pid: child.pid });
    return;
  }

  writeMetadata({
    type: 'result',
    pid: child.pid,
    status: outcome.status,
    signal: outcome.signal,
    error: serializeError(outcome.error),
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await run();
}
