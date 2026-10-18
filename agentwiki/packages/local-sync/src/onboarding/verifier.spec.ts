import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyGateway } from './verifier.js';
import { staticToolNames, manifestHash } from '../gateway/manifest.js';

describe('verifyGateway', () => {
  it('passes when all static tools are present', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => staticToolNames(),
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(true);
    expect(result.toolNames).toContain('onboard_status');
    expect(result.manifestHash).toBe(manifestHash());
    expect(result.errors).toEqual([]);
  });

  it('fails when required tools are missing', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => ['onboard_status', 'local_scan_sources'],
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('missing tools');
  });

  it('fails when the gateway exposes a legacy or unprefixed unexpected tool', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => [...staticToolNames(), 'start_knowledge_job', 'list_pages'],
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('unexpected tools');
  });

  it('reports a timeout error', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => {
        await new Promise((r) => setTimeout(r, 5_000));
        return [];
      },
      deadlineMs: 200,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('timed out');
  }, 5_000);

  it('reports a spawn error', async () => {
    const result = await verifyGateway({
      command: ['echo'],
      listToolsImpl: async () => {
        throw new Error('spawn ENOENT');
      },
      deadlineMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('ENOENT');
  });
});

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function withUnrelatedProcess(run: () => Promise<void>): Promise<void> {
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  await once(unrelated, 'spawn');
  try {
    await run();
    expect(processExists(unrelated.pid!)).toBe(true);
  } finally {
    const exited = once(unrelated, 'exit');
    unrelated.kill('SIGKILL');
    await exited;
  }
}

it.each(['timeout', 'success'] as const)('cleans up only its own wrapper and inner gateway after %s', async (outcome) => {
  await withUnrelatedProcess(async () => {
    const home = await mkdtemp(join(tmpdir(), 'aw-verifier-tree-'));
    const wrapperPidFile = join(home, 'wrapper-pid');
    const innerPidFile = join(home, 'inner-pid');
    const inner = `
      require('node:fs').writeFileSync(${JSON.stringify(innerPidFile)}, String(process.pid));
      process.send('ready');
      setInterval(() => {}, 1000);
    `;
    const response = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: staticToolNames().map((name) => ({ name })) } });
    const wrapper = `
      require('node:fs').writeFileSync(${JSON.stringify(wrapperPidFile)}, String(process.pid));
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(inner)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      child.on('message', () => { if (${outcome === 'success'}) process.stdout.write(${JSON.stringify(response + '\n')}); });
    `;
    try {
      const result = await verifyGateway({ command: [process.execPath, '-e', wrapper], deadlineMs: 1_000 });
      expect(result.ok).toBe(outcome === 'success');
      if (outcome === 'timeout') expect(result.errors.join(' ')).toContain('timed out');
      const wrapperPid = Number(await readFile(wrapperPidFile, 'utf8'));
      const innerPid = Number(await readFile(innerPidFile, 'utf8'));
      await expect.poll(() => processExists(wrapperPid), { timeout: 2_000 }).toBe(false);
      await expect.poll(() => processExists(innerPid), { timeout: 2_000 }).toBe(false);
    } finally {
      // On a regression, remove only the exact fixture processes we created.
      for (const file of [innerPidFile, wrapperPidFile]) {
        const pid = await readFile(file, 'utf8').then(Number).catch(() => undefined);
        if (pid && processExists(pid)) process.kill(pid, 'SIGKILL');
      }
      await rm(home, { recursive: true, force: true });
    }
  });
}, 10_000);

it('reports a real spawn failure without terminating an unrelated process', async () => {
  await withUnrelatedProcess(async () => {
    const home = await mkdtemp(join(tmpdir(), 'aw-verifier-no-command-'));
    try {
      const result = await verifyGateway({ command: [join(home, 'missing-gateway')], deadlineMs: 1_000 });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('ENOENT');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

it('terminates a real unresponsive gateway child at its deadline', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home=await mkdtemp(join(tmpdir(),'aw-verifier-timeout-'));
  const pidFile=join(home,'pid');let pid:number|undefined;
  try {
    const result=await verifyGateway({command:[process.execPath,'-e',`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`],deadlineMs:500});
    expect(result.ok).toBe(false);pid=Number(await readFile(pidFile,'utf8'));
    await new Promise(r=>setTimeout(r,50));
    expect(()=>process.kill(pid!,0)).toThrow();
  } finally {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Successful verification has already terminated the child.
      }
    }
    await rm(home, { recursive: true, force: true });
  }
});
