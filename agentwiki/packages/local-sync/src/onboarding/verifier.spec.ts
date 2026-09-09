import { describe, expect, it } from 'vitest';
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
  } finally {if(pid)try{process.kill(pid,'SIGKILL');}catch{}await rm(home,{recursive:true,force:true});}
});
