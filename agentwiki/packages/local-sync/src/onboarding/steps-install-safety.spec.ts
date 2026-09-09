import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { loadConfig, loadCredentials, saveConfig, saveCredentials } from '../config.js';
import { AgentWikiClient, type ExchangeResult } from '../agentwiki-client.js';
import { installGatewayEntry } from '../installer/client-config.js';
import { hashConfig } from '../installer/plan.js';
import { OnboardingClient } from './client.js';
import { runOnboardingSteps, type StepResult } from './steps.js';
import * as verifier from './verifier.js';

// Only the filesystem scheduling boundaries are intercepted; every file operation stays real.
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, chmod: vi.fn(actual.chmod), rename: vi.fn(actual.rename) };
});
const realFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const homes: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(fs.chmod).mockImplementation(realFs.chmod);
  vi.mocked(fs.rename).mockImplementation(realFs.rename);
  for (const home of homes.splice(0)) {
    await fs.chmod(join(home, '.agentwiki'), 0o700);
    for (const name of await fs.readdir(join(home, '.agentwiki-archive')).catch(() => []))
      await fs.chmod(join(home, '.agentwiki-archive', name), 0o700);
    await fs.rm(home, { recursive: true, force: true });
  }
});

const scopes = scopesForAgentAccessRole('reader');
const exchange: ExchangeResult = {
  apiKey: 'agk_new', agentId: 'new-agent', credentialId: 'new-key', spaceId: 'space-1',
  role: 'reader', scopes, serverUrl: 'https://wiki.test/api', pluginVersion: '0.10.0',
};

async function fixture(cachedExchange = true, archiveStarted = false, tokenExpiresIn = 600) {
  let now = Date.now();
  const home = await fs.mkdtemp(join(tmpdir(), 'aw-step-install-safety-'));
  homes.push(home);
  await saveConfig(home, { version: 1, defaultConnectionId: 'old', connections: {
    old: { id: 'old', serverUrl: 'https://wiki.test/api', agentId: 'old-agent', credentialId: 'old-key',
      pluginVersion: '0.9.1', client: 'claude', mcpName: 'agentwiki' },
  } });
  await saveCredentials(home, { version: 2, credentials: { 'old-key': { apiKey: 'agk_old' } } });
  await fs.writeFile(join(home, '.agentwiki', 'old-content'), 'existing data');
  const skillPath = join(home, '.agents', 'skills', 'agentwiki-local-sync', 'SKILL.md');
  await fs.mkdir(join(skillPath, '..'), { recursive: true });
  await fs.writeFile(skillPath, 'old skill');
  await installGatewayEntry('claude', 'old', hashConfig(''), home);
  const raw = await fs.readFile(join(home, '.claude.json'), 'utf8');
  const changed = JSON.stringify({ ...JSON.parse(raw), unrelatedPreference: 'changed' });
  const client = new OnboardingClient();
  vi.spyOn(client, 'start').mockResolvedValue({ deviceCode: 'awd_private', userCode: 'CODE',
    verificationUri: 'https://wiki.test/onboard', verificationUriComplete: 'https://wiki.test/onboard?userCode=CODE',
    expiresIn: 600, interval: 0 });
  vi.spyOn(client, 'poll').mockResolvedValue({ status: 'authorized', onboardingToken: 'awo_private', expiresIn: tokenExpiresIn });
  vi.spyOn(client, 'spaces').mockResolvedValue({ spaces: [{ id: 'space-1', name: 'Team' }] }.spaces);
  let bootstrapCalls = 0;
  vi.spyOn(client, 'bootstrap').mockImplementation(async () => {
    bootstrapCalls++;
    return { space: { id: 'space-1', name: 'Team' }, agent: { id: 'new-agent', name: 'Agent' },
      grant: { role: 'reader', scopes }, installation: { installationId: 'installation-1', code: 'once',
        expiresAt: new Date(now + 600_000).toISOString() } };
  });
  let exchangeCalls = 0;
  vi.spyOn(AgentWikiClient.prototype, 'exchange').mockImplementation(async () => { exchangeCalls++; return exchange; });
  vi.spyOn(AgentWikiClient.prototype, 'access').mockResolvedValue({ access: [{ id: 'new-agent', name: 'Agent', status: 'active',
    grants: [{ role: 'reader', space: { id: 'space-1', name: 'Team' } }], credentials: [{ id: 'new-key', active: true,
      authorization: { id: 'grant-1', role: 'reader', scopes, space: { id: 'space-1', name: 'Team' } } }] }] });
  vi.spyOn(verifier, 'verifyGateway').mockResolvedValue({ ok: true, toolNames: [], manifestHash: 'verified', errors: [] });
  vi.spyOn(AgentWikiClient.prototype, 'revokeCurrentCredential').mockImplementation(async () => {
    throw new Error('must retain the private receipt for retry');
  });
  const start = await runOnboardingSteps({ action: 'start', home, clientType: 'claude', serverBaseUrl: 'https://wiki.test/api' }, { client, now: () => now });
  const cont = (replyFile?: string) => runOnboardingSteps({ action: 'continue', home, sessionId: start.sessionId, replyFile }, { client, now: () => now });
  const reply = async (body: unknown) => {
    const path = join(home, `reply-${Math.random()}.json`);
    await fs.writeFile(path, JSON.stringify(body), { mode: 0o600 });
    return path;
  };
  const confirm = async (result: StepResult, yes = true) => cont(await reply({ requestId: result.requestId, confirmed: yes, planHash: result.planHash }));
  const input = await cont();
  const decision = await cont(await reply({ requestId: input.requestId,
    values: { spaceMode: 'existing', spaceId: 'space-1', agentName: 'Agent', role: 'reader' } }));
  await confirm(decision);
  expect((await cont()).stage).toBe('install');
  const statePath = join(home, '.agentwiki', 'onboarding', 'steps', `${start.sessionId}.json`);
  const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  if (cachedExchange) state.exchange = exchange;
  if (archiveStarted) state.archiveStarted = true;
  await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const assertOld = async () => {
    expect((await loadConfig(home)).connections.old?.credentialId).toBe('old-key');
    expect((await loadCredentials(home)).credentials['old-key']?.apiKey).toBe('agk_old');
    expect(await fs.readFile(join(home, '.agentwiki', 'old-content'), 'utf8')).toBe('existing data');
    expect(await fs.readFile(skillPath, 'utf8')).toBe('old skill');
    expect(await fs.readFile(join(home, '.claude.json'), 'utf8')).toBe(changed);
  };
  return { home, changed, cont, confirm, assertOld, statePath, sessionId: start.sessionId,
    advanceTime: (milliseconds: number) => { now += milliseconds; }, now: () => now,
    renew: vi.spyOn(client, 'renew').mockRejectedValue(new Error('valid receipt must not renew')),
    counts: () => ({ bootstrapCalls, exchangeCalls }) };
}

it.each([false, true])('does not archive or disconnect the old connection when config changes during the install pause (cached=%s)', async (cached) => {
  const f = await fixture(cached);
  await fs.writeFile(join(f.home, '.claude.json'), f.changed);
  const result = await f.cont();
  expect(result).toMatchObject({ status: 'confirmation_required', error: { code: 'CONFIG_CONFLICT' } });
  await f.assertOld();
  expect((await fs.readdir(join(f.home, '.agentwiki-archive'))).filter((name) => name.startsWith('state-'))).toEqual([]);
  await f.confirm(result, false);
  await f.assertOld();
});

it.each(['archive', 'config-commit', 'prior-session-archive'] as const)('restores old active files on a late config conflict (%s), then retries the same resources', async (boundary) => {
  const f = await fixture(true, boundary === 'prior-session-archive');
  let changed = false;
  if (boundary === 'config-commit') {
    const chmod = realFs.chmod;
    vi.mocked(fs.chmod).mockImplementation(async (...args) => {
      await chmod(...args);
      if (!changed && String(args[0]).startsWith(join(f.home, '.claude.json.')) && String(args[0]).endsWith('.tmp')) {
        changed = true;
        await fs.writeFile(join(f.home, '.claude.json'), f.changed);
      }
    });
  } else {
    const rename = realFs.rename;
    vi.mocked(fs.rename).mockImplementation(async (...args) => {
      await rename(...args);
      if (!changed && String(args[1]).includes('/.agentwiki-archive/state-')) {
        changed = true;
        await fs.writeFile(join(f.home, '.claude.json'), f.changed);
      }
    });
  }
  const result = await f.cont();
  expect(result).toMatchObject({ status: 'confirmation_required', error: { code: 'CONFIG_CONFLICT' } });
  await f.assertOld();
  expect(JSON.parse(await fs.readFile(f.statePath, 'utf8')).exchange.credentialId).toBe('new-key');
  await f.confirm(result);
  expect((await f.cont()).status).toBe('completed');
  expect((await loadConfig(f.home)).connections[f.sessionId]?.credentialId).toBe('new-key');
  expect((await loadCredentials(f.home)).credentials['new-key']?.apiKey).toBe('agk_new');
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
});

it('retains only the successfully configured new state after gateway verification fails and resumes without another exchange', async () => {
  const f = await fixture();
  vi.mocked(verifier.verifyGateway).mockResolvedValueOnce({ ok: false, toolNames: [], manifestHash: '', errors: ['fixture unavailable'] });
  const failed = await f.cont();
  expect(failed).toMatchObject({ connectionStatus: 'configured', error: { code: 'MCP_HANDSHAKE_FAILED' } });
  expect((await loadConfig(f.home)).connections[f.sessionId]?.credentialId).toBe('new-key');
  expect((await loadCredentials(f.home)).credentials['new-key']?.apiKey).toBe('agk_new');
  const client = JSON.parse(await fs.readFile(join(f.home, '.claude.json'), 'utf8'));
  expect(client.mcpServers.agentwiki.args).toContain(f.sessionId);
  expect((await f.cont()).status).toBe('completed');
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
});

it.skipIf(process.platform === 'win32' || process.geteuid?.() === 0)('leaves every old active file in place when directory permissions prevent archival', async () => {
  const f = await fixture();
  const original = await fs.readFile(join(f.home, '.claude.json'), 'utf8');
  await fs.chmod(join(f.home, '.agentwiki'), 0o500);
  let installing = true;
  vi.mocked(fs.chmod).mockImplementation(async (...args) => {
    await realFs.chmod(...args);
    if (installing && String(args[0]) === join(f.home, '.agentwiki') && args[1] === 0o700)
      await fs.writeFile(join(f.home, '.claude.json'), f.changed);
  });
  const result = await f.cont();
  installing = false;
  expect(result).toMatchObject({ status: 'configuration_pending', error: { code: 'ARCHIVE_FAILED' } });
  expect((await fs.stat(join(f.home, '.agentwiki'))).mode & 0o777).toBe(0o500);
  expect((await loadConfig(f.home)).connections.old?.credentialId).toBe('old-key');
  expect((await loadCredentials(f.home)).credentials['old-key']?.apiKey).toBe('agk_old');
  expect(await fs.readFile(join(f.home, '.agentwiki', 'old-content'), 'utf8')).toBe('existing data');
  expect(await fs.readFile(join(f.home, '.claude.json'), 'utf8')).toBe(original);
  expect(await fs.readFile(join(f.home, '.agents', 'skills', 'agentwiki-local-sync', 'SKILL.md'), 'utf8')).toBe('old skill');
  await fs.chmod(join(f.home, '.agentwiki'), 0o700);
  expect((await f.cont()).status).toBe('completed');
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
});

it('restores only already moved children and leaves unmoved old files intact when archival fails partway', async () => {
  const f = await fixture();
  const original = await fs.readFile(join(f.home, '.claude.json'), 'utf8');
  let moves = 0;
  let rejectMove = true;
  vi.mocked(fs.rename).mockImplementation(async (...args) => {
    if (rejectMove && String(args[1]).includes('/.agentwiki-archive/state-')) {
      moves++;
      if (moves === 2) throw Object.assign(new Error('fixture denied'), { code: 'EACCES' });
    }
    await realFs.rename(...args);
  });
  const result = await f.cont();
  expect(result).toMatchObject({ status: 'configuration_pending', error: { code: 'ARCHIVE_FAILED' } });
  expect((await loadConfig(f.home)).connections.old?.credentialId).toBe('old-key');
  expect((await loadCredentials(f.home)).credentials['old-key']?.apiKey).toBe('agk_old');
  expect(await fs.readFile(join(f.home, '.agentwiki', 'old-content'), 'utf8')).toBe('existing data');
  expect(await fs.readFile(join(f.home, '.claude.json'), 'utf8')).toBe(original);
  rejectMove = false;
  expect((await f.cont()).status).toBe('completed');
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
});

it.each([true, false])('accepts a local config decision after token expiry while the unexchanged installation receipt remains valid (confirmed=%s)', async (confirmed) => {
  const f = await fixture(false, false, 10);
  f.advanceTime(11_000);
  await fs.writeFile(join(f.home, '.claude.json'), f.changed);
  const conflict = await f.cont();
  expect(conflict).toMatchObject({ status: 'confirmation_required', error: { code: 'CONFIG_CONFLICT' } });
  await f.assertOld();
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
  expect(JSON.parse(await fs.readFile(f.statePath, 'utf8')).exchange).toBeUndefined();
  expect(Date.parse(String(conflict.replyExpiresAt))).toBeGreaterThan(f.now());
  // A no-reply continue must keep this usable request instead of issuing expired IDs forever.
  const current = await f.cont();
  expect(current.requestId).toBe(conflict.requestId);
  const result = await f.confirm(current, confirmed);
  expect(result.status).toBe(confirmed ? 'configuration_pending' : 'cancelled');
  await f.assertOld();
  if (confirmed) {
    expect((await f.cont()).status).toBe('completed');
    expect((await loadConfig(f.home)).connections[f.sessionId]?.credentialId).toBe('new-key');
    expect((await loadCredentials(f.home)).credentials['new-key']?.apiKey).toBe('agk_new');
  } else await f.assertOld();
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: confirmed ? 1 : 0 });
  expect(f.renew).not.toHaveBeenCalled();
});

it('refreshes an already persisted expired confirmation using the still-valid bootstrap receipt', async () => {
  const f = await fixture(false, false, 10);
  f.advanceTime(11_000);
  await fs.writeFile(join(f.home, '.claude.json'), f.changed);
  const conflict = await f.cont();
  const state = JSON.parse(await fs.readFile(f.statePath, 'utf8'));
  // Resume a session saved by a version that capped this local decision at token expiry.
  state.request.expiresAt = state.tokenExpiresAt;
  await fs.writeFile(f.statePath, JSON.stringify(state), { mode: 0o600 });
  const refreshed = await f.cont();
  expect(refreshed.requestId).not.toBe(conflict.requestId);
  expect(Date.parse(String(refreshed.replyExpiresAt))).toBeGreaterThan(f.now());
  expect((await f.confirm(refreshed, false)).status).toBe('cancelled');
  await f.assertOld();
  expect(f.counts()).toEqual({ bootstrapCalls: 1, exchangeCalls: 0 });
  expect(f.renew).not.toHaveBeenCalled();
});
