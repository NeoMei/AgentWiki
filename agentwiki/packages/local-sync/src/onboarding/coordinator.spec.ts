import { describe, expect, it, vi } from 'vitest';
import { OnboardingCoordinator, type CoordinatorDeps } from './coordinator.js';
import { ProtocolEncoder, type ProtocolSink, type ProtocolSource } from './protocol.js';
import { OnboardingClient } from './client.js';
import { createSessionStore, type SessionStore } from './session.js';

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

function mockDeps(overrides?: Partial<CoordinatorDeps> & { source?: ProtocolSource }): { deps: CoordinatorDeps; sink: ProtocolSink & { lines: string[] }; store: SessionStore } {
  const sink = capturingSink();
  const encoder = new ProtocolEncoder('sess-test', sink);
  const tmpHome = `/tmp/aw-coord-test-${Date.now()}`;
  const store = createSessionStore('sess-test', tmpHome);
  const deps: CoordinatorDeps = {
    client: mockClient(),
    store,
    encoder,
    source: overrides?.source ?? scriptedSource([]),
    serverBaseUrl: 'https://test/api',
    packageVersion: '0.3.0',
    home: tmpHome,
    preflight: vi.fn(async () => ({ configHash: 'h1', oldEntries: [], hasConflict: false, archivePath: null, reloadRequired: false })),
    bootstrapInstall: vi.fn(async () => ({
      bootstrap: {
        space: { id: 'space-1', name: 'R&D' },
        agent: { id: 'agent-1', name: 'Codex' },
        grant: { role: 'editor', scopes: ['pages:read'] },
        installation: { code: 'code-1', installationId: 'inst-1', expiresAt: '2026-01-01T00:00:00Z' },
      },
      reloadRequired: false,
    })),
    knowledge: {
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
      spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', permissionPreset: 'editor',
      approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'],
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
    expect(deps.preflight).toHaveBeenCalledWith('codex', expect.any(String), 'https://test/api');

    // The single-use token was deleted after bootstrap.
    expect(await deps.store.loadSecret()).toBeNull();
  });

  it('emits authorization_required and heartbeat during polling', async () => {
    const fixture = mockDeps();
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor',
      approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'],
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
          spaceMode: 'existing', agentName: 'A', permissionPreset: 'editor',
          approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'],
        } }),
      ]),
    });
    await expect(new OnboardingCoordinator(incomplete.deps).run()).rejects.toMatchObject({ code: 'PROTOCOL_UNSUPPORTED' });
    expect(incomplete.deps.client.start).not.toHaveBeenCalled();

    const fixture = mockDeps({
      preflight: vi.fn(async () => ({
        configHash: 'h1', oldEntries: ['agentwiki-local', 'agentwiki-remote'],
        hasConflict: false, archivePath: null, reloadRequired: true,
      })),
    });
    fixture.deps.source = successfulSource(fixture.sink, {
      spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor',
      approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'],
    });
    await new OnboardingCoordinator(fixture.deps).run();
    const preview = fixture.sink.lines.map((line) => JSON.parse(line))
      .find((event) => event.type === 'preview' && event.plan?.serverPlan);
    expect(preview.plan).toMatchObject({
      configHash: 'h1', oldEntries: ['agentwiki-local', 'agentwiki-remote'], reloadRequired: true,
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
      inputs: { sourcePaths: ['.'], sourceType: 'auto', reloadRequired: false },
      bootstrapResult: {
        space: { id: 'space-1', name: 'R&D' },
        agent: { id: 'agent-1', name: 'Codex' },
      },
    });
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
  });
});

describe('OnboardingCoordinator failure handling', () => {
  it('rejects a confirmation whose plan hash does not match the emitted plan', async () => {
    const bootstrapInstall = vi.fn();
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor', approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'] } }),
      JSON.stringify({ requestId: 'plan', confirmed: true, planHash: 'wrong-hash' }),
    ];
    const { deps } = mockDeps({ source: scriptedSource(replies), bootstrapInstall });

    await expect(new OnboardingCoordinator(deps).run()).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    expect(bootstrapInstall).not.toHaveBeenCalled();
  });

  it('emits a failed event with a stable code when authorization is denied', async () => {
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor', approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'] } }),
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
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor', approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'] } }),
    ];
    const { deps } = mockDeps({
      source: scriptedSource(replies),
      preflight: vi.fn(async () => ({ configHash: 'h', oldEntries: [], hasConflict: true, archivePath: null, reloadRequired: false })),
    });
    await expect(new OnboardingCoordinator(deps).run()).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' });
  });
});
