#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnPnpmSync } from './package-manager-process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2];
const phases = [
  {
    id: 'build-test-dependencies',
    command: 'pnpm',
    args: [
      '--filter', 'shared', 'build',
      '&&', '--filter', '@neomei/agentwiki-sync-protocol', 'build',
      '&&', '--filter', '@agentwiki/server', 'build',
    ],
  },
  { id: 'runtime-tests', command: 'node', args: ['scripts/runtime-test-harness.mjs', 'run'] },
  { id: 'server-tests', command: 'node', args: ['scripts/server-test-harness.mjs', 'run'] },
  { id: 'client-tests', command: 'pnpm', args: ['--filter', '@agentwiki/client', 'test'] },
  { id: 'sync-protocol-tests', command: 'pnpm', args: ['--filter', '@neomei/agentwiki-sync-protocol', 'test'] },
  { id: 'local-sync-tests', command: 'pnpm', args: ['--filter', '@neomei/agentwiki-local-sync', 'test'] },
];

function splitSteps(args) {
  const steps = [[]];
  for (const arg of args) {
    if (arg === '&&') steps.push([]);
    else steps.at(-1).push(arg);
  }
  return steps;
}

function runCommand(commandName, args) {
  const options = {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  };
  const result = commandName === 'pnpm'
    ? spawnPnpmSync(args, options)
    : spawnSync(process.execPath, args, options);
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (command === 'plan') {
  process.stdout.write(`${JSON.stringify({ phases })}\n`);
} else if (command === 'run') {
  let testExit = 0;
  for (const phase of phases) {
    const steps = phase.command === 'pnpm' ? splitSteps(phase.args) : [phase.args];
    for (const args of steps) {
      testExit = runCommand(phase.command, args);
      if (testExit !== 0) break;
    }
    if (testExit !== 0) break;
  }
  process.exitCode = testExit;
} else {
  throw new Error('Usage: node scripts/repository-test-harness.mjs <plan|run>');
}
