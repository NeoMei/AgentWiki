import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { loadConfig, loadCredentials, saveConfig, saveCredentials } from '../config.js';
import { installExchangedGateway, productionDependencies } from './install.js';
const homes: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }); });

it.each([true, false])('preserves a legacy Space connection and its workspace when adding another Space (success=%s)', async (ok) => {
  const home = await mkdtemp(join(tmpdir(), 'aw-install-multi-')); homes.push(home);
  const common = { serverUrl: 'https://wiki.test/api', agentId: 'agent-1', pluginVersion: '0.11.0', client: 'codex' as const, mcpName: 'agentwiki' };
  await saveConfig(home, { version: 1, defaultConnectionId: 'a', connections: { a: { ...common, id: 'a', credentialId: 'cred-a' } } });
  await saveCredentials(home, { version: 2, credentials: { 'cred-a': { apiKey: 'key-a' } } });
  const original = join(home, '.agentwiki', 'spaces', 'space-a', 'wiki');
  await mkdir(original, { recursive: true }); await writeFile(join(original, 'page.md'), 'original knowledge');
  const deps = productionDependencies();
  const run = installExchangedGateway({ home, client: 'codex', connectionId: 'b', expectedConfigHash: 'hash',
    expectedAgentId: 'agent-1', expectedSpaceId: 'space-b', expectedRole: 'reader', expectedScopes: scopesForAgentAccessRole('reader'), expectedPluginVersion: '0.11.0',
    exchange: { ...common, apiKey: 'key-b', credentialId: 'cred-b', spaceId: 'space-b', role: 'reader', scopes: scopesForAgentAccessRole('reader'), pluginVersion: '0.11.0' },
  }, { ...deps, installSkill: async () => undefined, installClient: async () => ({ backupPath: '/backup', rollback: async () => undefined }), verify: async () => ({ ok, toolNames: [], manifestHash: 'hash', errors: ok ? [] : ['failed'] }), verifyAccess: async () => undefined, revokeCredential: async () => undefined });
  if (ok) await run; else await expect(run).rejects.toMatchObject({ code: 'MCP_HANDSHAKE_FAILED' });
  expect((await loadConfig(home)).connections.a?.credentialId).toBe('cred-a');
  expect((await loadCredentials(home)).credentials['cred-a']?.apiKey).toBe('key-a');
  expect(await readFile(join(original, 'page.md'), 'utf8')).toBe('original knowledge');
  expect(Boolean((await loadConfig(home)).connections.b)).toBe(ok);
});
