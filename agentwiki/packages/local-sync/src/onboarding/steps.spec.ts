import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../cli.js';
import { OnboardingClient } from './client.js';
import { runOnboardingSteps } from './steps.js';

const homes: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'aw-steps-'));
  homes.push(home);
  const client = new OnboardingClient({
    fetchImpl: vi.fn(async (url) => {
      if (String(url).endsWith('/start'))
        return Response.json({
          deviceCode: 'awd_private',
          userCode: 'CODE',
          verificationUri: 'https://wiki.test/onboard',
          verificationUriComplete: 'https://wiki.test/onboard?userCode=CODE',
          expiresIn: 600,
          interval: 0,
        });
      if (String(url).endsWith('/poll'))
        return Response.json({ status: 'authorized', onboardingToken: 'awo_private', expiresIn: 600 });
      if (String(url).endsWith('/spaces')) return Response.json({ spaces: [{ id: 's1', name: 'Team' }] });
      throw new Error('Unexpected network / scan / upload');
    }) as typeof fetch,
  });
  const deps = { client, openBrowser: vi.fn(async () => true) };
  const start = await runOnboardingSteps(
    { action: 'start', home, clientType: 'claude', serverBaseUrl: 'https://wiki.test/api' },
    deps,
  );
  const cont = (replyFile?: string) =>
    runOnboardingSteps({ action: 'continue', home, sessionId: start.sessionId, replyFile }, deps);
  const reply = async (data: unknown) => {
    const file = join(home, `${Date.now()}-${Math.random()}.json`);
    await writeFile(file, JSON.stringify(data), { mode: 0o600 });
    return file;
  };
  return { home, start, cont, reply, deps };
}
it('returns authorization then read-only status from persisted private state', async () => {
  const f = await fixture();
  expect(f.start.status).toBe('authorization_required');
  const poll = vi.spyOn(OnboardingClient.prototype, 'poll');
  const dir = join(f.home, '.agentwiki', 'onboarding', 'steps');
  const before = await Promise.all(
    (await readdir(dir)).map(async (name) => [name, await readFile(join(dir, name), 'utf8')]),
  );
  const status = await runCli(
    ['onboard', 'status', '--session', f.start.sessionId, '--protocol', 'json'],
    f.home,
  );
  expect(status).toMatchObject({
    sessionId: f.start.sessionId,
    status: 'authorization_required',
    knowledgeImport: 'not_started',
  });
  expect(JSON.stringify(status)).not.toMatch(/awd_|awo_|deviceCode|onboardingToken/);
  expect(status).toHaveProperty('nextAction', expect.stringMatching(/continue.*retrieve browser approval/));
  expect(status).toHaveProperty('nextAction', expect.stringContaining('local checkpoint'));
  const repeated = await runOnboardingSteps({ action: 'status', home: f.home, sessionId: f.start.sessionId }, f.deps);
  expect(repeated.status).toBe('authorization_required');
  expect(poll).not.toHaveBeenCalled();
  expect(
    await Promise.all(
      (await readdir(dir)).map(async (name) => [name, await readFile(join(dir, name), 'utf8')]),
    ),
  ).toEqual(before);
  expect((await f.cont()).status).toBe('input_required');
  expect(poll).toHaveBeenCalledExactlyOnceWith('https://wiki.test/api', 'awd_private');
});
it('persists the exact package version before the first authorization checkpoint', async () => {
  const f = await fixture();
  const path = join(f.home, '.agentwiki', 'onboarding', 'steps', `${f.start.sessionId}.json`);
  expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({
    stage: 'authorization', packageVersion: '0.13.5',
  });
});

it.each([
  ['authorization', undefined, 'continue'], ['input', undefined, 'continue'],
  ['authorization', '0.13.3', 'continue'], ['input', '0.13.3', 'continue'],
  ['authorization', '0.13.2', 'continue'], ['input', '0.13.2', 'continue'],
  ['authorization', undefined, 'status'], ['input', undefined, 'status'],
  ['authorization', '0.13.3', 'status'], ['input', '0.13.3', 'status'],
  ['authorization', '0.13.2', 'status'], ['input', '0.13.2', 'status'],
] as const)('refuses %s checkpoint version %s on %s without changing state or calling remote services', async (stage, packageVersion, action) => {
  const f = await fixture();
  const input = stage === 'input' ? await f.cont() : undefined;
  const directory = join(f.home, '.agentwiki', 'onboarding', 'steps');
  const path = join(directory, `${f.start.sessionId}.json`);
  const legacy = JSON.parse(await readFile(path, 'utf8'));
  delete legacy.packageVersion;
  if (packageVersion) legacy.packageVersion = packageVersion;
  expect(legacy.plan).toBeUndefined();
  expect(legacy.exchange).toBeUndefined();
  const before = JSON.stringify(legacy);
  await writeFile(path, before, { mode: 0o600 });
  const beforeStat = await stat(path);
  const beforeFiles = await readdir(directory);
  const network = vi.fn<typeof fetch>();
  const client = new OnboardingClient({ fetchImpl: network });
  const install = vi.fn();
  const openBrowser = vi.fn();
  const replyFile = input && action === 'continue' ? await f.reply({
    requestId: input.requestId,
    values: { spaceMode: 'existing', spaceId: 's1', agentName: 'Agent', role: 'reader' },
  }) : undefined;
  await expect(runOnboardingSteps(
    { action, home: f.home, sessionId: f.start.sessionId, replyFile },
    { client, install, openBrowser },
  )).rejects.toThrow(/SESSION_VERSION_MISMATCH:.*exact package version from the original onboard start command/);
  expect(network).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
  expect(openBrowser).not.toHaveBeenCalled();
  expect(await readFile(path, 'utf8')).toBe(before);
  expect((await stat(path)).mtimeMs).toBe(beforeStat.mtimeMs);
  expect(await readdir(directory)).toEqual(beforeFiles);
});

it('collects only connection fields and rejects stale/wrong confirmation before installation', async () => {
  const f = await fixture();
  const input = await f.cont();
  expect(input.status).toBe('input_required');
  expect(input.spaces).toEqual([{ id: 's1', name: 'Team' }]);
  const file = await f.reply({
    requestId: input.requestId,
    values: { spaceMode: 'existing', spaceId: 's1', agentName: 'Agent', role: 'reader' },
  });
  const confirm = await f.cont(file);
  expect(confirm.status).toBe('confirmation_required');
  expect(confirm.plan).toMatchObject({ space: { mode: 'existing', id: 's1' }, role: 'reader' });
  await expect(f.cont(file)).rejects.toThrow(/REPLY/);
  await expect(
    f.cont(await f.reply({ requestId: confirm.requestId, confirmed: true, planHash: 'bad' })),
  ).rejects.toThrow(/REPLY/);
  const cancelled = await f.cont(
    await f.reply({ requestId: confirm.requestId, confirmed: false, planHash: confirm.planHash }),
  );
  expect(cancelled.status).toBe('cancelled');
});

it('renews the same authorization and invalidates old confirmation after token expiry', async () => {
  const f = await fixture();
  const input = await f.cont();
  const confirmed = await f.cont(
    await f.reply({
      requestId: input.requestId,
      values: { spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', role: 'editor' },
    }),
  );
  const renew = vi.spyOn(f.deps.client, 'renew').mockResolvedValue({
    deviceCode: 'awd_private',
    userCode: 'NEW',
    verificationUri: 'https://wiki.test/onboard',
    verificationUriComplete: 'https://wiki.test/onboard?userCode=NEW',
    expiresIn: 600,
    interval: 0,
  });
  const future = Date.now() + 700_000;
  const state = await runOnboardingSteps(
    { action: 'continue', home: f.home, sessionId: f.start.sessionId },
    { ...f.deps, now: () => future },
  );
  expect(state.status).toBe('authorization_required');
  expect(renew).toHaveBeenCalledWith('https://wiki.test/api', 'awd_private');
  expect(state.browserOpened).toBe(true);
  expect(f.deps.openBrowser).toHaveBeenLastCalledWith('https://wiki.test/onboard?userCode=NEW');
  expect(f.deps.openBrowser).toHaveBeenCalledTimes(2);
  await expect(
    f.cont(await f.reply({ requestId: confirmed.requestId, confirmed: true, planHash: confirmed.planHash })),
  ).rejects.toThrow(/REPLY_STALE/);
});

it('reconfirms a changed local config without creating remote resources', async () => {
  const f = await fixture();
  const input = await f.cont();
  const confirm = await f.cont(
    await f.reply({
      requestId: input.requestId,
      values: { spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', role: 'editor' },
    }),
  );
  await f.cont(await f.reply({ requestId: confirm.requestId, confirmed: true, planHash: confirm.planHash }));
  await writeFile(join(f.home, '.claude.json'), '{"newSetting":true}');
  const changed = await f.cont();
  expect(changed.status).toBe('confirmation_required');
  expect(changed.planHash).not.toBe(confirm.planHash);
  expect(await readFile(join(f.home, '.claude.json'), 'utf8')).toBe('{"newSetting":true}');
});

it('refreshes an expired installation receipt through the original bootstrap session and plan', async () => {
  const f = await fixture();
  const input = await f.cont();
  const confirm = await f.cont(
    await f.reply({
      requestId: input.requestId,
      values: { spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', role: 'reader' },
    }),
  );
  await f.cont(await f.reply({ requestId: confirm.requestId, confirmed: true, planHash: confirm.planHash }));
  vi.spyOn(f.deps.client, 'bootstrap').mockResolvedValue({
    space: { id: 's1', name: 'Space' },
    agent: { id: 'a1', name: 'Agent' },
    grant: { role: 'reader', scopes: [] },
    installation: {
      code: 'expired-code',
      installationId: 'i1',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    },
  });
  await f.cont();
  const install = vi.fn(async () => {
    throw new Error('must renew expired installation before exchange');
  });
  const next = await runOnboardingSteps(
    { action: 'continue', home: f.home, sessionId: f.start.sessionId },
    { ...f.deps, install },
  );
  expect(next.stage).toBe('bootstrap');
  expect(install).not.toHaveBeenCalled();
});

it('refreshes an expired decision request without altering the already confirmed server plan', async () => {
  const f = await fixture();
  const input = await f.cont();
  const file = join(f.home, '.agentwiki', 'onboarding', 'steps', `${f.start.sessionId}.json`);
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.request.expiresAt = Date.now() - 1;
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  const refreshed = await f.cont();
  expect(refreshed.status).toBe('input_required');
  expect(refreshed.requestId).not.toBe(input.requestId);
});

it('does not tell the caller to repeatedly retry an unsupported server endpoint', async () => {
  const f = await fixture();
  vi.spyOn(f.deps.client, 'spaces').mockRejectedValue(
    Object.assign(new Error('unsupported endpoint'), { code: 'REMOTE_UNAVAILABLE', retryable: false }),
  );
  const result = await f.cont();
  expect(result.error).toEqual({ code: 'REMOTE_UNAVAILABLE', retryable: false });
  expect(result.nextAction).toMatch(/Stop/);
});


it('opens fresh browser authorization once and keeps status read-only', async () => {
  const f = await fixture();
  expect(f.start.browserOpened).toBe(true);
  expect(f.deps.openBrowser).toHaveBeenCalledExactlyOnceWith('https://wiki.test/onboard?userCode=CODE');
  const status = await runOnboardingSteps({ action: 'status', home: f.home, sessionId: f.start.sessionId }, f.deps);
  expect(status.browserOpened).toBe(true);
  expect(f.deps.openBrowser).toHaveBeenCalledTimes(1);
});

it('preserves a usable authorization URL and session when opening the browser fails', async () => {
  const f = await fixture();
  const openBrowser = vi.fn(async () => { throw new Error('no desktop'); });
  const result = await runOnboardingSteps(
    { action: 'start', home: f.home, clientType: 'claude', serverBaseUrl: 'https://wiki.test/api' },
    { ...f.deps, openBrowser },
  );
  expect(result).toMatchObject({ status: 'authorization_required', browserOpened: false, authorizationUrl: 'https://wiki.test/onboard?userCode=CODE' });
  expect(result.nextAction).toMatch(/open.*authorizationUrl/i);
});

it('rejects unsupported Node before device authorization or local session creation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'aw-node-check-'));
  homes.push(home);
  const client = new OnboardingClient();
  const start = vi.spyOn(client, 'start');
  await expect(runOnboardingSteps(
    { action: 'start', home, clientType: 'claude', serverBaseUrl: 'https://wiki.test/api' },
    { client, nodeVersion: 'v22.22.2' },
  )).rejects.toThrow(/NODE_UNSUPPORTED.*24.*26.*node --version/);
  expect(start).not.toHaveBeenCalled();
  expect(await readdir(home)).toEqual([]);
});


it.each(['generic', 'workbuddy'] as const)('persists %s and exposes the actual config destination without claiming host verification', async (clientType) => {
  const f = await fixture();
  const started = await runOnboardingSteps(
    { action: 'start', home: f.home, clientType, serverBaseUrl: 'https://wiki.test/api' }, f.deps,
  );
  const status = await runOnboardingSteps({ action: 'status', home: f.home, sessionId: started.sessionId }, f.deps);
  expect(status).toMatchObject({
    configurationMode: clientType === 'generic' ? 'manual-import' : 'host-config',
    hostVerification: 'not_started', hostActivationRequired: true,
    configPath: join(f.home, clientType === 'generic' ? '.config/agentwiki/mcp.json' : '.workbuddy/mcp.json'),
  });
});


it('rejects an unrelated MCP entry before authorization without modifying its config', async () => {
  const f = await fixture();
  await mkdir(join(f.home, '.workbuddy'), { recursive: true });
  const config = join(f.home, '.workbuddy', 'mcp.json');
  const original = JSON.stringify({ mcpServers: { agentwiki: { command: 'unrelated-tool' } } });
  await writeFile(config, original);
  const start = vi.spyOn(f.deps.client, 'start');
  await expect(runOnboardingSteps({ action: 'start', home: f.home, clientType: 'workbuddy', serverBaseUrl: 'https://wiki.test/api' }, f.deps)).rejects.toThrow(/CONFIG_CONFLICT/);
  expect(start).not.toHaveBeenCalled();
  expect(await readFile(config, 'utf8')).toBe(original);
});


it('rejects a newly conflicting config before remote bootstrap after confirmation', async () => {
  const f = await fixture();
  const input = await f.cont();
  const confirmation = await f.cont(await f.reply({requestId: input.requestId, values: {spaceMode: 'existing', spaceId: 's1', agentName: 'Agent', role: 'reader'}}));
  await f.cont(await f.reply({requestId: confirmation.requestId, confirmed: true, planHash: confirmation.planHash}));
  const bootstrap = vi.spyOn(f.deps.client, 'bootstrap');
  const original = JSON.stringify({mcpServers: {agentwiki: {command: 'other-server'}}});
  await writeFile(join(f.home, '.claude.json'), original);
  const blocked = await f.cont();
  expect(blocked.error).toMatchObject({code: 'CONFIG_CONFLICT', retryable: false});
  expect(bootstrap).not.toHaveBeenCalled();
  expect(await readFile(join(f.home, '.claude.json'), 'utf8')).toBe(original);
  await writeFile(join(f.home, '.claude.json'), '{}');
  const recovered = await f.cont();
  expect(recovered.status).toBe('confirmation_required');
  expect(recovered.requestId).not.toBe(confirmation.requestId);
  expect(bootstrap).not.toHaveBeenCalled();
});
