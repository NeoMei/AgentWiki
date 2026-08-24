import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionStore } from '../onboarding/session.js';
import { hashOnboardingPlan } from '../onboarding/local-plan-hash.js';
import { hashServerPlan } from '../onboarding/plan-hash.js';
import { readOnboardingStatus, readPreviewArtifactSummaries } from './status.js';

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe('readPreviewArtifactSummaries', () => {
  it('returns bounded metadata without exposing page bodies', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aw-artifact-status-'));
    homes.push(home);
    const root = join(home, '.agentwiki', 'runtime', 'previews');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '11111111-1111-4111-8111-111111111111.json'), JSON.stringify({
      hash: 'preview-hash',
      data: {
        schemaVersion: 'knowledge-bundle@1', recipeVersion: 'unified-knowledge@1', spaceId: 'space-1', baseRevision: '0',
        pages: [{ pageId: 'page-1', title: 'Overview', path: 'overview.md', contentHash: 'hash-1', body: 'private body' }],
        memories: [], relations: [], provenance: [], deletions: [],
      },
    }));

    const result = await readPreviewArtifactSummaries(home, '11111111-1111-4111-8111-111111111111');

    expect(result).toEqual([{ kind: 'page', id: 'page-1', title: 'Overview', path: 'overview.md', contentHash: 'hash-1' }]);
    expect(JSON.stringify(result)).not.toContain('private body');
  });
});

describe('readOnboardingStatus', () => {
  it('returns the persisted non-secret completion report for the requested session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aw-status-'));
    homes.push(home);
    const store = createSessionStore('session-1', home);
    const serverPlan = {
      space: { mode: 'create' as const, name: 'Space' }, agentName: 'Agent', role: 'editor' as const,
      packageVersion: '0.6.1' as const,
    };
    const serverPlanHash = hashServerPlan(serverPlan);
    await store.save({
      sessionId: 'session-1', state: 'completed', protocolVersion: 1, serverUrl: 'https://wiki.test/api', clientType: 'codex',
      createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z',
      inputs: {
        spaceMode: 'create', spaceName: 'Space', agentName: 'Agent', role: 'editor',
        clientType: 'codex', sourcePaths: ['/tmp/source'], sourceType: 'documents', analysisMode: 'standard',
        configHash: 'a'.repeat(64), oldEntries: [], reloadRequired: false,
        connectionId: '00000000-0000-4000-8000-000000000001', manifestHash: 'b'.repeat(64),
      },
      serverPlan,
      serverPlanHash,
      onboardingPlanHash: hashOnboardingPlan({ serverPlanHash }),
      bootstrapResult: {
        space: { id: 'space-1', name: 'Space' }, agent: { id: 'agent-1', name: 'Agent' },
        revisionId: 'rev-1', status: 'published', submissionId: 'sub-1',
      },
    });
    await store.saveSecret('awo_must_not_leak');

    const report = await readOnboardingStatus(home, 'session-1');

    expect(report).toMatchObject({ sessionId: 'session-1', state: 'completed', revisionId: 'rev-1', connectionId: '00000000-0000-4000-8000-000000000001' });
    expect(JSON.stringify(report)).not.toContain('awo_must_not_leak');
  });
});
