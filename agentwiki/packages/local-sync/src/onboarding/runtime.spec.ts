import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProtocolSink, ProtocolSource } from './protocol.js';
import { runOnboarding } from './runtime.js';

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('runOnboarding', () => {
  it('assembles and executes the production state machine instead of returning CLI metadata', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aw-onboarding-runtime-'));
    homes.push(home);
    const lines: string[] = [];
    const sink: ProtocolSink = { write: (line) => { lines.push(line); } };
    let readCount = 0;
    const source: ProtocolSource = {
      read: async () => {
        readCount += 1;
        if (readCount === 1) {
          return JSON.stringify({
            requestId: 'input',
            values: {
              spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', permissionPreset: 'editor',
              approvalMode: 'always-review', clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'auto',
            },
          });
        }
        const event = [...lines].reverse().map((line) => JSON.parse(line)).find((candidate) => candidate.type === 'confirmation_required');
        return JSON.stringify({ requestId: event.requestId, confirmed: true, planHash: event.planHash });
      },
    };
    const bootstrapInstall = vi.fn(async () => ({
      bootstrap: {
        space: { id: 'space-1', name: 'Space' }, agent: { id: 'agent-1', name: 'Agent' },
        grant: { role: 'editor', scopes: ['pages:read'] },
        installation: { code: 'code-1', installationId: 'installation-1', expiresAt: '2026-08-11T01:00:00.000Z' },
      },
      reloadRequired: false,
      configBackupPath: '/tmp/backup',
      manifestHash: 'manifest-hash',
      connectionId: 'connection-1',
    }));

    const result = await runOnboarding(
      { home, protocol: 'ndjson', serverBaseUrl: 'https://wiki.test/api' },
      {
        sessionId: () => 'session-1',
        sink,
        source,
        client: {
          start: vi.fn(async () => ({
            deviceCode: 'awd_test', userCode: 'ABCD-EFGH', verificationUri: 'https://wiki.test/onboard/device',
            verificationUriComplete: 'https://wiki.test/onboard/device?user_code=ABCD-EFGH', expiresIn: 600, interval: 5,
          })),
          pollUntilSettled: vi.fn(async () => ({ status: 'authorized', onboardingToken: 'awo_test', expiresIn: 600 })),
        } as never,
        preflight: vi.fn(async () => ({ configHash: 'config-hash', oldEntries: [], hasConflict: false, archivePath: null, reloadRequired: false })),
        bootstrapInstall,
        knowledge: {
          pull: vi.fn(async () => ({ revisionId: '0' })),
          prepare: vi.fn(async () => ({ jobId: 'job-1', previewHash: 'preview-hash', summary: { filesProcessed: 2 } })),
          confirmAndSync: vi.fn(async () => ({ revisionId: 'rev-1', status: 'published', submissionId: 'sub-1' })),
        },
        sleep: vi.fn(async () => undefined),
      },
    );

    expect(result.report).toMatchObject({ sessionId: 'session-1', revisionId: 'rev-1' });
    expect(bootstrapInstall).toHaveBeenCalledTimes(1);
    expect(lines.map((line) => JSON.parse(line).type)).toContain('completed');
  });
});
