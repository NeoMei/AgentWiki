import { describe, expect, it, vi } from 'vitest';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { randomUUID } from 'node:crypto';
import { OnboardingCoordinator, type CoordinatorDeps } from './coordinator.js';
import { ProtocolEncoder, type ProtocolSink, type ProtocolSource } from './protocol.js';
import { OnboardingClient } from './client.js';
import { createSessionStore, sessionFilePath, type OnboardingInputs, type SessionStore } from './session.js';
import { readFile, writeFile } from 'node:fs/promises';
import type { LocalScanPlan } from '../codegraph/contracts.js';
import { hashServerPlan } from './plan-hash.js';
import { hashOnboardingPlan } from './local-plan-hash.js';

const CONFIG_HASH = 'c'.repeat(64);

function capturingSink(): ProtocolSink & { lines: string[] } {
  const lines: string[] = [];
  return { lines, write: (l: string) => void lines.push(l) };
}

/** A scripted stdin source that returns lines one by one. */
function scriptedSource(replies: string[]): ProtocolSource {
  let i = 0;
  return { read: async () => replies[i++] ?? null };
}

function successfulSource(sink: { lines: string[] }, values: Record<string, unknown>): ProtocolSource {
  let call = 0;
  return {
    read: async () => {
      call += 1;
      if (call === 1) return JSON.stringify({ requestId: 'input', values });
      const confirmation = [...sink.lines].reverse().map((line) => JSON.parse(line)).find((event) => event.type === 'confirmation_required');
      return JSON.stringify({ requestId: confirmation.requestId, confirmed: true, planHash: confirmation.planHash });
    },
  };
}

function mockClient(): OnboardingClient {
  return {
    start: vi.fn(async () => ({
      deviceCode: 'awd_test',
      userCode: 'ABCD',
      verificationUri: 'https://test/onboard/device',
      verificationUriComplete: 'https://test/onboard/device?user_code=ABCD',
      expiresIn: 600,
      interval: 5,
    })),
    pollUntilSettled: vi.fn(async () => ({ status: 'authorized', onboardingToken: 'awo_tok', expiresIn: 600 })),
    bootstrap: vi.fn(async () => ({
      space: { id: 'space-1', name: 'R&D' },
      agent: { id: 'agent-1', name: 'Codex' },
      grant: { role: 'editor', scopes: ['pages:read'] },
      installation: { code: 'code-1', installationId: 'inst-1', expiresAt: '2026-01-01T00:00:00Z' },
    })),
  } as unknown as OnboardingClient;
}

function localPlan(hash = 'a'.repeat(64)): LocalScanPlan {
  return {
    schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: '/private/bin/codegraph', detectedVersion: '1.2.3', analysisMode: 'standard', localScanPlanHash: hash,
    capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
    sources: [{ sourceKey: 'b'.repeat(64), displayPath: 'source', canonicalSourcePath: '/private/source', indexPath: '/private/source/.codegraph', action: 'sync', indexState: 'stale', estimatedFiles: 2 }], limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
  };
}

function localPlanPreview(hash = 'a'.repeat(64)): Record<string, unknown> {
  const plan = localPlan(hash);
  return {
    schemaVersion: plan.schemaVersion, provider: plan.provider, detectedVersion: plan.detectedVersion,
    capabilities: plan.capabilities, analysisMode: plan.analysisMode, limits: plan.limits, localScanPlanHash: plan.localScanPlanHash,
    sources: plan.sources.map(({ sourceKey, displayPath, action, indexState, estimatedFiles }) => ({ sourceKey, displayPath, action, indexState, estimatedFiles })),
  };
}

function unsafeLocalPlan(hash: string, displayPath: string): LocalScanPlan {
  const plan = localPlan(hash);
  return { ...plan, sources: [{ ...plan.sources[0], displayPath }] };
}

function mockDeps(overrides?: Partial<CoordinatorDeps> & { source?: ProtocolSource }): { deps: CoordinatorDeps; sink: ProtocolSink & { lines: string[] }; store: SessionStore } {
  const sink = capturingSink();
  const encoder = new ProtocolEncoder('sess-test', sink);
  const tmpHome = `/tmp/aw-coord-test-${randomUUID()}`;
  const store = createSessionStore('sess-test', tmpHome);
  const deps: CoordinatorDeps = {
    client: mockClient(),
    store,
    encoder,
    source: overrides?.source ?? scriptedSource([]),
    serverBaseUrl: 'https://test/api',
    packageVersion: '0.6.1',
    home: tmpHome,
    preflight: vi.fn(async () => ({ configHash: CONFIG_HASH, oldEntries: [], hasConflict: false, archivePath: null, reloadRequired: false })),
    bootstrapInstall: vi.fn(async (input) => ({
      bootstrap: {
        space: { id: 'space-1', name: 'R&D' },
        agent: { id: 'agent-1', name: 'Codex' },
        grant: {
          role: input.serverPlan.role,
          scopes: scopesForAgentAccessRole(input.serverPlan.role),
        },
        installation: { code: 'code-1', installationId: 'inst-1', expiresAt: '2026-01-01T00:00:00Z' },
      },
      reloadRequired: false,
    })),
    knowledge: {
      pull: vi.fn(async () => ({ revisionId: 'pull-revision' })),
      planLocalScan: vi.fn(async () => localPlan()),
      prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'hash-1', summary: { files: 3 } })),
      confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1' })),
    },
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, sink, store };
}

describe('OnboardingCoordinator happy path', () => {
  it('runs the full state machine to completed', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', role: 'editor',
      clientType: 'codex', sourcePaths: ['.'],
    });
    const { deps, sink } = fixture;
    const coordinator = new OnboardingCoordinator(deps);
    const result = await coordinator.run();

    expect(result.report).toMatchObject({ agentReload: false });
    expect(result.report.space).toEqual({ id: 'space-1', name: 'R&D' });

    // The completed event was emitted.
    const events = sink.lines.map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === 'completed')).toBe(true);
    expect(events.some((e) => e.type === 'authorization_required')).toBe(true);
    const inputRequest = events.find((event) => event.type === 'input_required');
    expect(inputRequest.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'role', choices: ['reader', 'editor', 'publisher'] }),
    ]));
    expect(inputRequest.fields.map((field: { name: string }) => field.name))
      .not.toEqual(expect.arrayContaining(['permissionPreset', 'approvalMode']));
    expect(deps.preflight).toHaveBeenCalledWith('codex', expect.any(String), 'https://test/api');

    // The single-use token was deleted after bootstrap.
    expect(await deps.store.loadSecret()).toBeNull();
  });

  it.each(['reader', 'publisher'] as const)('passes the canonical %s access package across the full bootstrap boundary', async (role) => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', role,
      clientType: 'codex', sourcePaths: ['.'], sourceType: 'documents',
    });

    await new OnboardingCoordinator(fixture.deps).run();

    expect(fixture.deps.bootstrapInstall).toHaveBeenCalledWith(expect.objectContaining({
      serverPlan: expect.objectContaining({ role }),
      serverPlanHash: hashServerPlan({
        space: { mode: 'create', name: 'R&D' }, agentName: 'Codex', role, packageVersion: '0.6.1',
      }),
    }));
    await expect(vi.mocked(fixture.deps.bootstrapInstall).mock.results[0]?.value).resolves.toMatchObject({
      bootstrap: { grant: { role, scopes: scopesForAgentAccessRole(role) } },
    });
  });

  it('completes Reader onboarding through pull without planning or invoking a write sync', async () => {
    const pull = vi.fn(async () => ({ revisionId: 'reader-revision' }));
    const fixture = mockDeps({
      knowledge: {
        pull,
        planLocalScan: vi.fn(async () => {
          throw new Error('Reader onboarding must not plan a local upload');
        }),
        prepare: vi.fn(async () => {
          throw new Error('Reader onboarding must not prepare a write sync');
        }),
        confirmAndSync: vi.fn(async () => {
          throw new Error('Reader onboarding must not confirm a write sync');
        }),
      },
    });
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'R&D', agentName: 'ReadBot', role: 'reader',
      clientType: 'codex', sourcePaths: ['.'], sourceType: 'code',
    });

    const result = await new OnboardingCoordinator(fixture.deps).run();

    expect(result.report).toMatchObject({ revisionId: 'reader-revision' });
    expect(pull).toHaveBeenCalledWith({ spaceId: 'space-1' });
    expect(fixture.deps.knowledge.planLocalScan).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.confirmAndSync).not.toHaveBeenCalled();
    expect(fixture.sink.lines.map((line) => JSON.parse(line).type)).toContain('completed');
  });

  it('fails closed when Reader onboarding has no pull capability', async () => {
    const fixture = mockDeps({
      knowledge: {
        planLocalScan: vi.fn(async () => {
          throw new Error('Reader onboarding must not plan a local upload');
        }),
        prepare: vi.fn(async () => {
          throw new Error('Reader onboarding must not prepare a write sync');
        }),
        confirmAndSync: vi.fn(async () => {
          throw new Error('Reader onboarding must not confirm a write sync');
        }),
      },
    });
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'R&D', agentName: 'ReadBot', role: 'reader',
      clientType: 'codex', sourcePaths: ['.'], sourceType: 'documents',
    });

    await expect(new OnboardingCoordinator(fixture.deps).run())
      .rejects.toMatchObject({ code: 'SYNC_FAILED', retryable: false });

    expect(fixture.sink.lines.map((line) => JSON.parse(line).type)).not.toContain('completed');
  });

  it('keeps the onboarding token until the post-install checkpoint is durable', async () => {
    const fixture = mockDeps();
    const persistedWithToken: string[] = [];
    const backingStore = fixture.store;
    fixture.deps.store = {
      ...backingStore,
      save: async (checkpoint) => {
        if (['installing_gateway', 'verifying_gateway', 'scanning'].includes(checkpoint.state)) {
          if (await backingStore.loadSecret()) persistedWithToken.push(checkpoint.state);
        }
        await backingStore.save(checkpoint);
      },
    };
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', role: 'editor',
      clientType: 'codex', sourcePaths: ['.'], sourceType: 'documents',
    });

    await new OnboardingCoordinator(fixture.deps).run();

    expect(persistedWithToken).toEqual(['installing_gateway', 'verifying_gateway', 'scanning']);
    expect(await backingStore.loadSecret()).toBeNull();
  });

  it('emits authorization_required and heartbeat during polling', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor',
      clientType: 'codex', sourcePaths: ['.'],
    });
    const { deps, sink } = fixture;
    await new OnboardingCoordinator(deps).run();
    const types = sink.lines.map((l) => JSON.parse(l).type);
    expect(types).toContain('authorization_required');
    expect(types).toContain('completed');
  });

  it('includes legacy entries in the plan preview and rejects incomplete conditional inputs', async () => {
    const incomplete = mockDeps({
      source: scriptedSource([
        JSON.stringify({ requestId: 'input', values: {
          spaceMode: 'existing', agentName: 'A', role: 'editor',
          clientType: 'codex', sourcePaths: ['.'],
        } }),
      ]),
    });
    await expect(new OnboardingCoordinator(incomplete.deps).run()).rejects.toMatchObject({ code: 'PROTOCOL_UNSUPPORTED' });
    expect(incomplete.deps.client.start).not.toHaveBeenCalled();

    const fixture = mockDeps({
      preflight: vi.fn(async () => ({
        configHash: CONFIG_HASH, oldEntries: ['agentwiki-local', 'agentwiki-remote'],
        hasConflict: false, archivePath: null, reloadRequired: true,
      })),
    });
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor',
      clientType: 'codex', sourcePaths: ['.'],
    });
    await new OnboardingCoordinator(fixture.deps).run();
    const preview = fixture.sink.lines.map((line) => JSON.parse(line))
      .find((event) => event.type === 'preview' && event.plan?.serverPlan);
    expect(preview.plan).toMatchObject({
      configHash: CONFIG_HASH, oldEntries: ['agentwiki-local', 'agentwiki-remote'], reloadRequired: true,
    });
  });

  it('resumes from the last persisted checkpoint without repeating authorization or bootstrap', async () => {
    const fixture = mockDeps();
    fixture.deps.sessionId = 'sess-test';
    await fixture.store.save({
      sessionId: 'sess-test',
      state: 'scanning',
      protocolVersion: 1,
      serverUrl: 'https://test/api',
      clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: {
        spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', role: 'editor',
        clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'documents', analysisMode: 'standard',
        configHash: CONFIG_HASH, oldEntries: [], reloadRequired: false,
      },
      serverPlan: { space: { mode: 'create', name: 'R&D' }, agentName: 'Codex', role: 'editor', packageVersion: '0.6.1' },
      serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'R&D' }, agentName: 'Codex', role: 'editor', packageVersion: '0.6.1' }),
      onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'R&D' }, agentName: 'Codex', role: 'editor', packageVersion: '0.6.1' }) }),
      bootstrapResult: {
        space: { id: 'space-1', name: 'R&D' },
        agent: { id: 'agent-1', name: 'Codex' },
      },
    });
    await fixture.store.saveSecret('awo_left_after_crash');
    fixture.deps.source = {
      read: async () => {
        const confirmation = [...fixture.sink.lines].reverse().map((line) => JSON.parse(line))
          .find((event) => event.type === 'confirmation_required');
        return JSON.stringify({ requestId: 'sync', confirmed: true, planHash: confirmation.planHash });
      },
    };

    const result = await new OnboardingCoordinator(fixture.deps).run();

    expect(result.report).toMatchObject({ sessionId: 'sess-test', revisionId: 'rev-1' });
    expect(fixture.deps.client.start).not.toHaveBeenCalled();
    expect(fixture.deps.preflight).not.toHaveBeenCalled();
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(await fixture.store.loadSecret()).toBeNull();
  });
});

describe('OnboardingCoordinator failure handling', () => {
  it.each([
    ['C1 control', 'repository\u009bprivate'],
    ['POSIX absolute path', '/private/repository'],
    ['Windows path', 'C:/private/repository'],
    ['traversal', 'repository/../private'],
  ])('fails closed before initial confirmation when the live provider returns a %s display path', async (_label, poisonedPath) => {
    const planLocalScan = vi.fn(async () => unsafeLocalPlan('a'.repeat(64), poisonedPath));
    const fixture = mockDeps({
      source: scriptedSource([JSON.stringify({ requestId: 'input', values: {
        spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor', clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'code', analysisMode: 'standard',
      } })]),
      knowledge: {
        planLocalScan,
        pull: vi.fn(async () => ({ revisionId: '0' })),
        prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'hash-1', summary: {} })),
        confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1' })),
      },
    });

    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toMatchObject({ code: 'SCAN_FAILED', message: 'local CodeGraph scan plan is invalid' });
    expect(planLocalScan).toHaveBeenCalledTimes(1);
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.confirmAndSync).not.toHaveBeenCalled();
    const events = fixture.sink.lines.join('');
    expect(events).not.toContain(poisonedPath);
    expect(events).not.toContain('\u009b');
    expect(fixture.sink.lines.map((line) => JSON.parse(line)).filter((event) => event.type === 'confirmation_required')).toHaveLength(0);
    expect(events).toContain('local CodeGraph scan plan is invalid');
    expect(await readFile(sessionFilePath('sess-test', fixture.deps.home), 'utf8')).not.toContain(poisonedPath);
  });

  it('fails closed on a persisted C1-control display path without echoing the path or control character', async () => {
    const fixture = mockDeps();
    const path = sessionFilePath('sess-test', fixture.deps.home);
    const poisonedPath = 'repository\u009bprivate';
    const raw = JSON.stringify({
      sessionId: 'sess-test', state: 'collecting_input', protocolVersion: 1,
      serverUrl: 'https://test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      localScanPlanHash: 'a'.repeat(64),
      localScanPlan: localPlanPreview('a'.repeat(64)),
    }).replace('"source"', JSON.stringify(poisonedPath));
    await fixture.store.save({ sessionId: 'sess-test', state: 'collecting_input', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' });
    await writeFile(path, raw);

    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toThrow('stored onboarding state is invalid');
    expect(fixture.deps.knowledge.planLocalScan).not.toHaveBeenCalled();
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(fixture.sink.lines.join('')).not.toContain(poisonedPath);
    expect(fixture.sink.lines.join('')).not.toContain('\u009b');
    await expect(readFile(path, 'utf8')).resolves.toBe(raw);
  });

  it('rejects an invalid checkpoint before planning, bootstrap, or preparation', async () => {
    const fixture = mockDeps();
    await fixture.store.save({
      sessionId: 'sess-test', state: 'collecting_input', protocolVersion: 1,
      serverUrl: 'https://test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
    });
    await writeFile(sessionFilePath('sess-test', fixture.deps.home), JSON.stringify({
      sessionId: 'sess-test', state: 'collecting_input', protocolVersion: 1,
      serverUrl: 'https://test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: { apiKey: 'awo_should_not_be_accepted' },
    }));

    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toThrow('stored onboarding state is invalid');
    expect(fixture.deps.knowledge.planLocalScan).not.toHaveBeenCalled();
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
  });

  it('rejects and preserves a scanning checkpoint without composite confirmation evidence before any side effect', async () => {
    const fixture = mockDeps();
    const serverPlan = { space: { mode: 'create' as const, name: 'S' }, agentName: 'A', role: 'editor' as const, packageVersion: '0.6.1' as const };
    const raw = JSON.stringify({
      sessionId: 'sess-test', state: 'scanning', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: { spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor', clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'code', analysisMode: 'standard' },
      serverPlan, serverPlanHash: hashServerPlan(serverPlan), localScanPlanHash: 'a'.repeat(64), localScanPlan: localPlanPreview('a'.repeat(64)),
      bootstrapResult: { space: { id: 'space-1', name: 'S' }, agent: { id: 'agent-1', name: 'A' } },
    });
    await fixture.store.save({
      sessionId: 'sess-test', state: 'collecting_input', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
    });
    const path = sessionFilePath('sess-test', fixture.deps.home);
    await writeFile(path, raw);

    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toThrow('stored onboarding state is invalid');
    expect(fixture.deps.knowledge.planLocalScan).not.toHaveBeenCalled();
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.confirmAndSync).not.toHaveBeenCalled();
    await expect(readFile(path, 'utf8')).resolves.toBe(raw);
  });

  it('rejects a confirmation whose plan hash does not match the emitted plan', async () => {
    const bootstrapInstall = vi.fn();
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor', clientType: 'codex', sourcePaths: ['.'] } }),
      JSON.stringify({ requestId: 'plan', confirmed: true, planHash: 'wrong-hash' }),
    ];
    const { deps } = mockDeps({ source: scriptedSource(replies), bootstrapInstall });

    await expect(new OnboardingCoordinator(deps).run()).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    expect(bootstrapInstall).not.toHaveBeenCalled();
  });

  it('rejects removed permissionPreset and approvalMode input fields', async () => {
    const { deps } = mockDeps({
      source: scriptedSource([JSON.stringify({ requestId: 'input', values: {
        spaceMode: 'create', spaceName: 'S', agentName: 'A',
        permissionPreset: 'editor', approvalMode: 'always-review',
        clientType: 'codex', sourcePaths: ['.'],
      } })]),
    });

    await expect(new OnboardingCoordinator(deps).run())
      .rejects.toMatchObject({ code: 'PROTOCOL_UNSUPPORTED' });
    expect(deps.client.start).not.toHaveBeenCalled();
  });

  it('emits a failed event with a stable code when authorization is denied', async () => {
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor', clientType: 'codex', sourcePaths: ['.'] } }),
    ];
    const { deps, sink } = mockDeps({
      source: scriptedSource(replies),
      client: {
        ...mockClient(),
        pollUntilSettled: vi.fn(async () => ({ status: 'denied' })),
      } as unknown as OnboardingClient,
    });
    await expect(new OnboardingCoordinator(deps).run()).rejects.toMatchObject({ code: 'AUTH_DENIED' });
    const events = sink.lines.map((l) => JSON.parse(l));
    const failed = events.find((e) => e.type === 'failed');
    expect(failed).toBeDefined();
    expect(failed.code).toBe('AUTH_DENIED');
    expect(failed.retryable).toBe(false);
  });

  it('aborts when preflight detects a config conflict', async () => {
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor', clientType: 'codex', sourcePaths: ['.'] } }),
    ];
    const { deps } = mockDeps({
      source: scriptedSource(replies),
      preflight: vi.fn(async () => ({ configHash: CONFIG_HASH, oldEntries: [], hasConflict: true, archivePath: null, reloadRequired: false })),
    });
    await expect(new OnboardingCoordinator(deps).run()).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });
});

describe('OnboardingCoordinator local scan consent', () => {
  const codeInputs: OnboardingInputs = {
    spaceMode: 'create', spaceName: 'S', agentName: 'A', role: 'editor',
    clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'code', analysisMode: 'standard',
  };

  it('plans before plan confirmation, previews both plans, and passes the exact local hash after bootstrap', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, codeInputs);
    await new OnboardingCoordinator(fixture.deps).run();
    const events = fixture.sink.lines.map((line) => JSON.parse(line));
    const preview = events.find((event) => event.type === 'preview' && event.plan?.serverPlan);
    const confirmation = events.find((event) => event.type === 'confirmation_required' && event.requestId === 'plan');

    expect(fixture.deps.knowledge.planLocalScan).toHaveBeenCalled();
    expect(preview.plan).toMatchObject({ serverPlan: expect.any(Object), localScanPlan: { localScanPlanHash: 'a'.repeat(64) } });
    expect(confirmation.planHash).not.toBe('a'.repeat(64));
    expect(fixture.deps.bootstrapInstall).toHaveBeenCalledWith(expect.objectContaining({
      serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }),
    }));
    expect(fixture.deps.knowledge.prepare).toHaveBeenCalledWith(expect.objectContaining({ analysisMode: 'standard', localScanPlanHash: 'a'.repeat(64), confirmedLocalScan: true }));
  });

  it('does not plan or pass local fields for document-only onboarding', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, { ...codeInputs, sourceType: 'documents' });
    await new OnboardingCoordinator(fixture.deps).run();
    expect(fixture.deps.knowledge.planLocalScan).not.toHaveBeenCalled();
    expect(fixture.deps.bootstrapInstall).toHaveBeenCalledWith(expect.objectContaining({ serverPlanHash: expect.any(String) }));
    expect(fixture.deps.knowledge.prepare).toHaveBeenCalledWith(expect.not.objectContaining({ localScanPlanHash: expect.anything(), confirmedLocalScan: expect.anything() }));
  });

  it('persists only a bootstrap summary, never installation material', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, { ...codeInputs, sourceType: 'documents' });
    await new OnboardingCoordinator(fixture.deps).run();
    const stored = await fixture.store.load();
    expect(stored?.bootstrapResult).toEqual(expect.objectContaining({ space: { id: 'space-1', name: 'R&D' } }));
    expect(JSON.stringify(stored)).not.toContain('code-1');
    expect(JSON.stringify(stored)).not.toContain('installationId');
  });

  it('does not bootstrap or scan when the composite plan hash is invalid', async () => {
    const fixture = mockDeps({ source: scriptedSource([
      JSON.stringify({ requestId: 'input', values: codeInputs }),
      JSON.stringify({ requestId: 'plan', confirmed: true, planHash: 'wrong-hash' }),
    ]) });
    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
  });

  it('does not bootstrap or scan when the matching composite plan is declined', async () => {
    const fixture = mockDeps();
    fixture.deps.source = {
      read: async () => {
        const event = [...fixture.sink.lines].reverse().map((line) => JSON.parse(line)).find((candidate) => candidate.type === 'confirmation_required');
        return event
          ? JSON.stringify({ requestId: 'plan', confirmed: false, planHash: event.planHash })
          : JSON.stringify({ requestId: 'input', values: codeInputs });
      },
    };
    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toMatchObject({ code: 'AUTH_DENIED' });
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
  });

  it('replans before a resumed scan and returns to recoverable confirmation without a mutation on drift', async () => {
    const fixture = mockDeps({ knowledge: {
      planLocalScan: vi.fn(async () => localPlan('c'.repeat(64))),
      pull: vi.fn(async () => ({ revisionId: '0' })),
      prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'hash-1', summary: { files: 3 } })),
      confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1' })),
    } });
    await fixture.store.save({
      sessionId: 'sess-test', state: 'scanning', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: { ...codeInputs }, serverPlan: { space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }, serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }), localScanPlanHash: 'b'.repeat(64), onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }), localScanPlanHash: 'b'.repeat(64) }),
      localScanPlan: localPlanPreview('b'.repeat(64)), bootstrapResult: { space: { id: 'space-1', name: 'S' } },
    });
    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
    expect(fixture.deps.knowledge.pull).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(await fixture.store.load()).toEqual(expect.objectContaining({ state: 'failed_recoverable', resumeState: 'waiting_for_confirmation', localScanPlanHash: 'c'.repeat(64) }));
  });

  it('fails closed before a drift preview when a live replan has an unsafe display path', async () => {
    const poisonedPath = 'repository\u009bprivate';
    const planLocalScan = vi.fn(async () => unsafeLocalPlan('c'.repeat(64), poisonedPath));
    const fixture = mockDeps({ knowledge: {
      planLocalScan, pull: vi.fn(async () => ({ revisionId: '0' })),
      prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'hash-1', summary: { files: 3 } })),
      confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1' })),
    } });
    await fixture.store.save({
      sessionId: 'sess-test', state: 'scanning', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: { ...codeInputs }, serverPlan: { space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }, serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }), localScanPlanHash: 'b'.repeat(64), onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'S' }, agentName: 'A', role: 'editor', packageVersion: '0.6.1' }), localScanPlanHash: 'b'.repeat(64) }),
      localScanPlan: localPlanPreview('b'.repeat(64)), bootstrapResult: { space: { id: 'space-1', name: 'S' } },
    });

    await expect(new OnboardingCoordinator(fixture.deps).run()).rejects.toMatchObject({ code: 'SCAN_FAILED', message: 'local CodeGraph scan plan is invalid' });
    expect(planLocalScan).toHaveBeenCalledTimes(1);
    expect(fixture.deps.knowledge.pull).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.confirmAndSync).not.toHaveBeenCalled();
    const events = fixture.sink.lines.join('');
    expect(events).not.toContain(poisonedPath);
    expect(events).not.toContain('\u009b');
    expect(fixture.sink.lines.map((line) => JSON.parse(line)).filter((event) => event.type === 'confirmation_required')).toHaveLength(0);
    expect(events).toContain('local CodeGraph scan plan is invalid');
    expect(await readFile(sessionFilePath('sess-test', fixture.deps.home), 'utf8')).not.toContain(poisonedPath);
  });

  it('resumes a confirmed replacement local plan at scanning without repeating bootstrap', async () => {
    const fixture = mockDeps({ knowledge: {
      planLocalScan: vi.fn(async () => localPlan('c'.repeat(64))), pull: vi.fn(async () => ({ revisionId: '0' })),
      prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'hash-1', summary: { files: 3 } })),
      confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1' })),
    } });
    await fixture.store.save({
      sessionId: 'sess-test', state: 'failed_recoverable', resumeState: 'waiting_for_confirmation', protocolVersion: 1, serverUrl: 'https://test/api', clientType: 'codex', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: { ...codeInputs }, serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64), onboardingPlanHash: hashOnboardingPlan({ serverPlanHash: 'a'.repeat(64), localScanPlanHash: 'b'.repeat(64) }),
      localScanPlan: localPlanPreview('b'.repeat(64)), bootstrapResult: { space: { id: 'space-1', name: 'S' } },
    });
    fixture.deps.source = {
      read: async () => {
        const event = [...fixture.sink.lines].reverse().map((line) => JSON.parse(line)).find((candidate) => candidate.type === 'confirmation_required');
        return JSON.stringify({ requestId: event.requestId, confirmed: true, planHash: event.planHash });
      },
    };
    await new OnboardingCoordinator(fixture.deps).run();
    expect(fixture.deps.bootstrapInstall).not.toHaveBeenCalled();
    expect(fixture.deps.knowledge.prepare).toHaveBeenCalledWith(expect.objectContaining({ localScanPlanHash: 'c'.repeat(64), confirmedLocalScan: true }));
  });
});
