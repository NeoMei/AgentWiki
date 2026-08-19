import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
import { hashOnboardingPlan } from './local-plan-hash.js';
import { hashServerPlan } from './plan-hash.js';

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

const postConfirmationStates = [
  'bootstrapping', 'installing_gateway', 'verifying_gateway', 'scanning',
  'waiting_for_sync_confirmation', 'syncing', 'completed',
] as const satisfies readonly OnboardingState[];
const bootstrapStates = new Set<OnboardingState>([
  'installing_gateway', 'verifying_gateway', 'scanning',
  'waiting_for_sync_confirmation', 'syncing', 'completed',
]);

function confirmedCheckpoint(
  state: typeof postConfirmationStates[number],
  sourceType: 'code' | 'documents' = 'code',
): OnboardingCheckpoint {
  const inputs = {
    spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', permissionPreset: 'editor', approvalMode: 'always-review',
    clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType, analysisMode: 'standard',
    configHash: 'c'.repeat(64), oldEntries: [], reloadRequired: false,
  } as const;
  const serverPlan = {
    space: { mode: 'create' as const, name: 'Space' }, agentName: 'Agent', permissionPreset: 'editor' as const,
    approvalMode: 'always-review' as const, packageVersion: '0.4.0',
  };
  const serverPlanHash = hashServerPlan(serverPlan);
  const localScanPlanHash = 'b'.repeat(64);
  const localScanPlan = {
    schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', detectedVersion: '1.2.3', analysisMode: 'standard', localScanPlanHash,
    capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
    limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
    sources: [{ sourceKey: 'd'.repeat(64), displayPath: 'project', action: 'sync', indexState: 'stale', estimatedFiles: 2 }],
  };
  return {
    ...baseCheckpoint('sess-1'), state, inputs, serverPlan, serverPlanHash,
    onboardingPlanHash: hashOnboardingPlan({ serverPlanHash, ...(sourceType === 'code' ? { localScanPlanHash } : {}) }),
    ...(sourceType === 'code' ? { localScanPlanHash, localScanPlan } : {}),
    ...(bootstrapStates.has(state) ? { bootstrapResult: { space: { id: 'space-1', name: 'Space' }, agent: { id: 'agent-1', name: 'Agent' } } } : {}),
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

  it.each(postConfirmationStates.flatMap((state) => [
    ...(['serverPlan', 'serverPlanHash', 'onboardingPlanHash', 'localScanPlan', 'localScanPlanHash'] as const).map((field) => [state, `missing ${field}`, field] as const),
    ...(bootstrapStates.has(state) ? [[state, 'missing bootstrapResult', 'bootstrapResult'] as const] : []),
    [state, 'mismatched serverPlanHash', 'mismatchedServerPlanHash'] as const,
    [state, 'mismatched onboardingPlanHash', 'mismatchedOnboardingPlanHash'] as const,
  ]))('rejects post-confirmation %s checkpoint with %s', async (state, _label, mutation) => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    const checkpoint = structuredClone(confirmedCheckpoint(state)) as unknown as Record<string, unknown>;
    if (mutation === 'mismatchedServerPlanHash') checkpoint.serverPlanHash = 'e'.repeat(64);
    else if (mutation === 'mismatchedOnboardingPlanHash') checkpoint.onboardingPlanHash = 'f'.repeat(64);
    else delete checkpoint[mutation];

    await expect(store.save(checkpoint as unknown as OnboardingCheckpoint)).rejects.toThrow();
  });

  it.each(postConfirmationStates)('rejects a document-only %s checkpoint that carries local consent fields', async (state) => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    const checkpoint = confirmedCheckpoint(state, 'documents') as unknown as Record<string, unknown>;
    const code = confirmedCheckpoint(state, 'code');
    checkpoint.localScanPlanHash = code.localScanPlanHash;
    checkpoint.localScanPlan = code.localScanPlan;
    checkpoint.onboardingPlanHash = hashOnboardingPlan({
      serverPlanHash: checkpoint.serverPlanHash as string,
      localScanPlanHash: code.localScanPlanHash!,
    });

    await expect(store.save(checkpoint as unknown as OnboardingCheckpoint)).rejects.toThrow();
  });

  it('round-trips separately bound scan consent without persisting CodeGraph raw paths', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save({
      ...baseCheckpoint('sess-1'), serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64), onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64) }),
      localScanPlan: {
        schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', detectedVersion: '1.2.3', analysisMode: 'standard', localScanPlanHash: 'b'.repeat(64),
        capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
        limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 }, sources: [{ sourceKey: 'd'.repeat(64), displayPath: 'project', action: 'sync', indexState: 'stale', estimatedFiles: 2 }],
      },
    });
    const raw = await readFile(sessionFilePath('sess-1', home), 'utf8');
    expect(await store.load()).toEqual(expect.objectContaining({ serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64), onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64) }) }));
    expect(raw).not.toContain('canonicalSourcePath');
    expect(raw).not.toContain('/private/');
  });

  it('rejects a checkpoint that attempts to persist raw CodeGraph paths', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await expect(store.save({
      ...baseCheckpoint('sess-1'), localScanPlanHash: 'b'.repeat(64),
      localScanPlan: {
        schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', detectedVersion: '1.2.3', analysisMode: 'standard', localScanPlanHash: 'b'.repeat(64),
        capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
        limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
        sources: [{ sourceKey: 'd'.repeat(64), displayPath: 'project', canonicalSourcePath: '/private/project', action: 'sync', indexState: 'stale', estimatedFiles: 2 }],
      },
    })).rejects.toThrow();
  });

  it.each([
    ['an unknown top-level field', { unexpected: true }],
    ['a credential-like input field', { inputs: { apiKey: 'secret' } }],
  ])('rejects and preserves a checkpoint with %s', async (_label, mutation) => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    const path = sessionFilePath('sess-1', home);
    const raw = JSON.stringify({ ...baseCheckpoint('sess-1'), ...mutation }, null, 2);
    await store.save(baseCheckpoint('sess-1'));
    await writeFile(path, raw);

    await expect(store.load()).rejects.toThrow('stored onboarding state is invalid');
    await expect(readFile(path, 'utf8')).resolves.toBe(raw);
  });

  it.each(['/private/repository', 'C:/private/repository', 'repo\\file', '../repository', './repository', 'repo/../file', 'repo//file', 'repo\u0000file', 'repo\u009bfile'])(
    'rejects and preserves an unsafe redacted display path: %j',
    async (displayPath) => {
      const home = await freshHome();
      const store = createSessionStore('sess-1', home);
      const path = sessionFilePath('sess-1', home);
      const checkpoint = {
        ...baseCheckpoint('sess-1'),
        serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64),
        onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64) }),
        localScanPlan: {
          schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', detectedVersion: '1.2.3', analysisMode: 'standard', localScanPlanHash: 'b'.repeat(64),
          capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
          limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
          sources: [{ sourceKey: 'd'.repeat(64), displayPath, action: 'sync', indexState: 'stale', estimatedFiles: 2 }],
        },
      };
      const raw = JSON.stringify(checkpoint, null, 2);
      await store.save(baseCheckpoint('sess-1'));
      await writeFile(path, raw);

      await expect(store.load()).rejects.toThrow('stored onboarding state is invalid');
      await expect(readFile(path, 'utf8')).resolves.toBe(raw);
    },
  );

  it('returns null when no checkpoint exists', async () => {
    const home = await freshHome();
    const store = createSessionStore('missing', home);
    expect(await store.load()).toBeNull();
  });

  it('does not treat malformed persisted state as an absent checkpoint', async () => {
    const home = await freshHome();
    const store = createSessionStore('sess-1', home);
    await store.save(baseCheckpoint('sess-1'));
    await writeFile(sessionFilePath('sess-1', home), '{not-json');
    await expect(store.load()).rejects.toThrow(/stored onboarding state is invalid/);
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
