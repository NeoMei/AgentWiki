import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight } from './preflight.js';
import { clientConfigPath } from '../installer/client-config.js';

let tempHome = '';
async function freshHome(): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), 'aw-pf-'));
  return tempHome;
}
afterEach(async () => {
  if (tempHome) {
    await rm(tempHome, { recursive: true, force: true }).catch(() => undefined);
  }
  tempHome = '';
});

describe('preflight', () => {
  it('returns a config hash and no conflicts for a clean home', async () => {
    const home = await freshHome();
    const result = await preflight('claude', home);
    expect(result.configHash).toHaveLength(64);
    expect(result.hasConflict).toBe(false);
    expect(result.oldEntries).toEqual([]);
    expect(result.reloadRequired).toBe(false);
  });

  it('marks opencode as requiring reload', async () => {
    const home = await freshHome();
    const result = await preflight('opencode', home);
    expect(result.reloadRequired).toBe(true);
  });

  it('detects legacy agentwiki entries', async () => {
    const home = await freshHome();
    const path = clientConfigPath('claude', home);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ mcpServers: { 'agentwiki-local': { command: ['x'] } } }));
    const result = await preflight('claude', home);
    expect(result.oldEntries).toContain('agentwiki-local');
  });

  it('flags an unknown agentwiki conflict', async () => {
    const home = await freshHome();
    const path = clientConfigPath('claude', home);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ mcpServers: { agentwiki: { command: ['other'] } } }));
    const result = await preflight('claude', home);
    expect(result.hasConflict).toBe(true);
  });

  it('initializes a clean ~/.agentwiki layout', async () => {
    const home = await freshHome();
    await preflight('codex', home);
    const { stat } = await import('node:fs/promises');
    const s = await stat(join(home, '.agentwiki'));
    expect(s.isDirectory()).toBe(true);
  });
});
