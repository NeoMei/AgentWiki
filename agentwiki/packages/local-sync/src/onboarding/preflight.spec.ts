import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
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

  it('uses the current server URL to identify a direct remote entry', async () => {
    const home = await freshHome();
    const path = clientConfigPath('claude', home);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({
      mcpServers: { remote: { url: 'https://wiki.test/api/mcp' } },
    }));

    const result = await preflight('claude', home, 'https://wiki.test/api');

    expect(result.oldEntries).toEqual(['remote']);
  });

  it('flags an unknown agentwiki conflict', async () => {
    const home = await freshHome();
    const path = clientConfigPath('claude', home);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ mcpServers: { agentwiki: { command: ['other'] } } }));
    const result = await preflight('claude', home);
    expect(result.hasConflict).toBe(true);
  });

  it('does not archive or initialize local state before plan confirmation', async () => {
    const home = await freshHome();
    const legacy = join(home, '.agentwiki', 'local-sync.json');
    await mkdir(join(home, '.agentwiki'), { recursive: true });
    await writeFile(legacy, '{"legacy":true}\n');

    await preflight('codex', home);

    await expect(readFile(legacy, 'utf8')).resolves.toBe('{"legacy":true}\n');
    await expect(access(join(home, '.agentwiki-archive'))).rejects.toThrow();
  });
});
