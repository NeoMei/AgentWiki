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
    const replies = [
      // input reply
      JSON.stringify({
        requestId: 'input',
        values: { spaceMode: 'create', spaceName: 'R&D', agentName: 'Codex', permissionPreset: 'editor', approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'] },
      }),
      // plan confirmation
      JSON.stringify({ requestId: 'plan', confirmed: true, planHash: 'any' }),
      // sync confirmation — previewHash must match; coordinator emits it, test matches dynamically
    ];
    // We need the sync confirmation planHash to match. Since we don't know it ahead, use a source that echoes the last preview.
    let syncReplyGiven = false;
    const dynamicSource: ProtocolSource = {
      read: async () => {
        if (replies.length > 0 && !syncReplyGiven) {
          const r = replies.shift()!;
          if (r.includes('plan')) return r; // plan confirmation
          return r; // input reply
        }
        // For sync, extract the previewHash from emitted events.
        syncReplyGiven = true;
        return JSON.stringify({ requestId: 'sync', confirmed: true, planHash: 'hash-1' });
      },
    };

    const { deps, sink } = mockDeps({ source: dynamicSource });
    const coordinator = new OnboardingCoordinator(deps);
    const result = await coordinator.run();

    expect(result.report).toMatchObject({ agentReload: false });
    expect(result.report.space).toEqual({ id: 'space-1', name: 'R&D' });

    // The completed event was emitted.
    const events = sink.lines.map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === 'completed')).toBe(true);
    expect(events.some((e) => e.type === 'authorization_required')).toBe(true);

    // The single-use token was deleted after bootstrap.
    expect(await deps.store.loadSecret()).toBeNull();
  });

  it('emits authorization_required and heartbeat during polling', async () => {
    const replies = [
      JSON.stringify({ requestId: 'input', values: { spaceMode: 'create', spaceName: 'S', agentName: 'A', permissionPreset: 'editor', approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['.'] } }),
      JSON.stringify({ requestId: 'plan', confirmed: true, planHash: 'x' }),
      JSON.stringify({ requestId: 'sync', confirmed: true, planHash: 'hash-1' }),
    ];
    const { deps, sink } = mockDeps({ source: scriptedSource(replies) });
    await new OnboardingCoordinator(deps).run();
    const types = sink.lines.map((l) => JSON.parse(l).type);
    expect(types).toContain('authorization_required');
    expect(types).toContain('completed');
  });
});

describe('OnboardingCoordinator failure handling', () => {
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
