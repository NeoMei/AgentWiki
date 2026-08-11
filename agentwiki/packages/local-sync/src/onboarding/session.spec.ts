import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertTransition,
  canTransition,
  createSessionStore,
  isTerminalState,
  onboardingDir,
  sessionFilePath,
  secretFilePath,
  type OnboardingCheckpoint,
  type OnboardingState,
} from './session.js';

let tempHome = '';
async function freshHome(): Promise<string> {
  tempHome = await mkdtemp(join(tmpdir(), 'aw-onboard-'));
  return tempHome;
}
afterEach(async () => {
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  tempHome = '';
});

function baseCheckpoint(sessionId: string): OnboardingCheckpoint {
  return {
    sessionId,
    state: 'collecting_input',
    protocolVersion: 1,
    serverUrl: 'https://example.test/api',
    clientType: 'codex',
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
}

describe('onboarding session state machine', () => {
  it('allows forward progress through the happy path', () => {
    expect(canTransition('collecting_input', 'waiting_for_web_auth')).toBe(true);
    expect(canTransition('waiting_for_web_auth', 'preflight')).toBe(true);
    expect(canTransition('preflight', 'waiting_for_confirmation')).toBe(true);
    expect(canTransition('waiting_for_confirmation', 'bootstrapping')).toBe(true);
    expect(canTransition('syncing', 'completed')).toBe(true);
  });

  it('rejects illegal skips', () => {
    expect(canTransition('collecting_input', 'completed')).toBe(false);
    expect(canTransition('collecting_input', 'syncing')).toBe(false);
  });

  it('allows self-loops for idempotent re-entry', () => {
    expect(canTransition('waiting_for_web_auth', 'waiting_for_web_auth')).toBe(true);
  });

  it('classifies terminal states', () => {
    expect(isTerminalState('completed')).toBe(true);
    expect(isTerminalState('failed_terminal')).toBe(true);
    expect(isTerminalState('cancelled')).toBe(true);
    expect(isTerminalState('scanning')).toBe(false);
  });

  it('throws on illegal transitions in assertTransition', () => {
    expect(() => assertTransition('collecting_input', 'completed')).toThrow();
  });

  it('allows transitioning to failed_recoverable from every non-terminal state', () => {
    const nonTerminal: OnboardingState[] = [
      'collecting_input', 'waiting_for_web_auth', 'preflight',
      'waiting_for_confirmation', 'bootstrapping', 'installing_gateway',
      'verifying_gateway', 'scanning', 'waiting_for_sync_confirmation', 'syncing',
    ];
    for (const state of nonTerminal) {
      expect(canTransition(state, 'failed_recoverable')).toBe(true);
      expect(canTransition(state, 'failed_terminal')).toBe(true);
    }
  });

});

describe('onboarding session persistence', () => {
  it('writes the checkpoint with 0600 permissions', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    const s = await stat(sessionFilePath('sess-1', home));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it('creates the directory with 0700 permissions', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    const s = await stat(onboardingDir(home));
    expect(s.mode & 0o777).toBe(0o700);
  });

  it('round-trips a checkpoint through save and load', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    const checkpoint = { ...baseCheckpoint('sess-1'), deviceCode: 'awd_test', userCode: 'ABCD' };
    await store.save(checkpoint);
    const loaded = await store.load();
    expect(loaded).toEqual(expect.objectContaining({ sessionId: 'sess-1', deviceCode: 'awd_test' }));
  });

  it('returns null when no checkpoint exists', async () => {
    const home = await freshHome();
    const store = createSessionStore('missing', home);
    expect(await store.load()).toBeNull();
  });

  it('persists and loads the secret token separately at 0600', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    await store.saveSecret('awo_secrettoken');
    const s = await stat(secretFilePath('sess-1', home));
    expect(s.mode & 0o777).toBe(0o600);
    expect(await store.loadSecret()).toBe('awo_secrettoken');
  });

  it('does not store the token inside the main checkpoint file', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    await store.saveSecret('awo_secrettoken');
    const raw = await readFile(sessionFilePath('sess-1', home), 'utf8');
    expect(raw).not.toContain('awo_secrettoken');
  });

  it('deletes the secret file after bootstrap', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    await store.saveSecret('awo_secrettoken');
    await store.deleteSecret();
    expect(await store.loadSecret()).toBeNull();
  });

  it('deleteSecret is idempotent', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.deleteSecret(); // never created
    await store.deleteSecret();
    expect(await store.loadSecret()).toBeNull();
  });

  it('delete removes both checkpoint and secret', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    await store.saveSecret('awo_secrettoken');
    await store.delete();
    expect(await store.load()).toBeNull();
    expect(await store.loadSecret()).toBeNull();
  });

  it('resume updates the updatedAt timestamp', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    const before = { ...baseCheckpoint('sess-1') };
    await store.save(before);
    await new Promise((r) => setTimeout(r, 10));
    await store.save({ ...before, state: 'waiting_for_web_auth' });
    const after = await store.load();
    expect(after!.updatedAt).not.toBe(before.updatedAt);
  });
});
