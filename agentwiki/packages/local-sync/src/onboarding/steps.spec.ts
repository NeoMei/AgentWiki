import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  const deps = { client };
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
  expect(
    await Promise.all(
      (await readdir(dir)).map(async (name) => [name, await readFile(join(dir, name), 'utf8')]),
    ),
  ).toEqual(before);
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
