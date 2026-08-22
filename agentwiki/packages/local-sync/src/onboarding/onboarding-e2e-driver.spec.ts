import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashServerPlan } from './plan-hash.js';
import { hashOnboardingPlan } from './local-plan-hash.js';
import { runOnboardingStateMachineHarness } from './onboarding-e2e-driver.js';
import type { LocalScanPlan } from '../codegraph/contracts.js';
import { readRawConfig } from '../installer/client-config.js';
import type { AgentClient } from '../agent-clients.js';
import { scopesForAgentAccessRole } from '@neomei/agentwiki-sync-protocol';

const homes: string[] = [];
const PLAN_A_HASH = 'b'.repeat(64);
const PLAN_B_HASH = 'c'.repeat(64);

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function localPlan(localScanPlanHash: string): LocalScanPlan {
  return {
    schemaVersion: 'agentwiki-local-scan-plan@1', provider: 'codegraph', executableIdentity: '/private/bin/codegraph', detectedVersion: '1.2.3',
    analysisMode: 'standard', localScanPlanHash,
    capabilities: { required: { 'index.status': true, 'index.sync': true, 'files.list': true }, optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false } },
    sources: [{ sourceKey: 'd'.repeat(64), displayPath: 'repository', canonicalSourcePath: '/private/repository', indexPath: '/private/repository/.codegraph', action: 'init', indexState: 'missing', estimatedFiles: 1 }],
    limits: { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 },
  };
}

async function freshHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'aw-onboarding-e2e-'));
  homes.push(home);
  return home;
}

const codeInput = {
  spaceMode: 'create' as const, spaceName: 'E2E Space', agentName: 'E2E Agent', role: 'editor' as const,
  clientType: 'codex' as const, sourcePaths: ['/private/repository'],
  sourceType: 'code' as const, analysisMode: 'standard' as const,
};

describe('onboarding runtime state-machine E2E', () => {
  it.each(['codex', 'claude', 'opencode'] as const)('completes the standard-only two-confirmation flow through one AgentWiki MCP for %s', async (clientType: AgentClient) => {
    const home = await freshHome();
    const harness = await runOnboardingStateMachineHarness({
      home,
      input: { ...codeInput, clientType },
      localPlans: [localPlan(PLAN_A_HASH), localPlan(PLAN_A_HASH)],
    });

    expect(harness.error).toBeUndefined();
    expect(harness.events.filter((event) => event.type === 'confirmation_required')).toHaveLength(2);
    expect(harness.calls.plan).toEqual([
      expect.objectContaining({ analysisMode: 'standard' }),
      expect.objectContaining({ analysisMode: 'standard' }),
    ]);
    expect(harness.calls.prepare).toEqual([expect.objectContaining({ analysisMode: 'standard', confirmedLocalScan: true, localScanPlanHash: PLAN_A_HASH })]);
    expect(harness.calls.sync).toEqual([{ jobId: 'job-1', previewHash: 'preview-hash', confirmed: true }]);

    const rawConfig = await readRawConfig(clientType, home);
    expect(rawConfig).not.toBeNull();
    expect(rawConfig?.toLowerCase()).not.toContain('codegraph');
    if (clientType === 'codex') {
      expect(rawConfig?.match(/\[mcp_servers\.agentwiki\]/gu)).toHaveLength(1);
    } else {
      const parsed = JSON.parse(rawConfig!);
      const entries = clientType === 'claude'
        ? parsed.mcpServers
        : (parsed.mcp.servers ?? parsed.mcp);
      expect(Object.keys(entries)).toEqual(['agentwiki']);
    }
  });

  it('completes a stable code flow using event-derived confirmation hashes', async () => {
    const harness = await runOnboardingStateMachineHarness({ home: await freshHome(), input: codeInput, localPlans: [localPlan(PLAN_A_HASH), localPlan(PLAN_A_HASH)] });

    expect(harness.error).toBeUndefined();
    expect(harness.events.map((event) => event.type)).toContain('completed');
    const planConfirmation = harness.events.find((event) => event.type === 'confirmation_required' && event.requestId === 'plan');
    expect(planConfirmation?.type).toBe('confirmation_required');
    if (!planConfirmation || planConfirmation.type !== 'confirmation_required') throw new Error('missing real plan confirmation');
    expect(planConfirmation).toMatchObject({ planHash: hashOnboardingPlan({ serverPlanHash: hashServerPlan({ space: { mode: 'create', name: 'E2E Space' }, agentName: 'E2E Agent', role: 'editor', packageVersion: '0.5.0' }), localScanPlanHash: PLAN_A_HASH }) });
    expect(harness.replies).toContainEqual({ requestId: 'plan', confirmed: true, planHash: planConfirmation.planHash });
    expect(harness.calls.bootstrap).toHaveLength(1);
    expect(harness.calls.bootstrap[0]).toMatchObject({ serverPlanHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(harness.calls.bootstrap[0]).not.toHaveProperty('localScanPlanHash');
    expect(harness.calls.prepare).toEqual([expect.objectContaining({ localScanPlanHash: PLAN_A_HASH, confirmedLocalScan: true, analysisMode: 'standard' })]);
    expect(harness.calls.init).toHaveLength(1);
    expect(harness.calls.sync).toHaveLength(1);
  });

  it.each(['reader', 'publisher'] as const)('preserves the %s role package through the full coordinator and installer boundary', async (role) => {
    const harness = await runOnboardingStateMachineHarness({
      home: await freshHome(),
      input: { ...codeInput, role, sourceType: 'documents' },
      localPlans: [],
    });

    expect(harness.error).toBeUndefined();
    expect(harness.calls.bootstrap).toHaveLength(1);
    expect(harness.calls.bootstrap[0]).toMatchObject({
      serverPlan: { role },
      serverPlanHash: hashServerPlan({
        space: { mode: 'create', name: 'E2E Space' },
        agentName: 'E2E Agent',
        role,
        packageVersion: '0.5.0',
      }),
    });
    expect(harness.calls.bootstrapResults).toEqual([{
      role,
      scopes: scopesForAgentAccessRole(role),
    }]);
  });

  it('moves a real drifted code flow to recoverable plan confirmation without local mutation', async () => {
    const harness = await runOnboardingStateMachineHarness({ home: await freshHome(), input: codeInput, localPlans: [localPlan(PLAN_A_HASH), localPlan(PLAN_B_HASH)] });

    expect(harness.error).toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED' });
    expect(harness.events.find((event) => event.type === 'failed')).toMatchObject({ code: 'CODEGRAPH_SCAN_PLAN_CHANGED', retryable: true });
    expect(harness.events.some((event) => event.type === 'completed')).toBe(false);
    expect(harness.calls.bootstrap).toHaveLength(1);
    expect(harness.calls.init).toHaveLength(0);
    expect(harness.calls.prepare).toHaveLength(0);
    expect(harness.calls.sync).toHaveLength(0);
    expect(harness.checkpoint).toMatchObject({ state: 'failed_recoverable', resumeState: 'waiting_for_confirmation', localScanPlanHash: PLAN_B_HASH });
  });

  it('completes a document-only flow without local planning or local confirmation fields', async () => {
    const harness = await runOnboardingStateMachineHarness({
      home: await freshHome(), input: { ...codeInput, sourceType: 'documents' }, localPlans: [],
    });

    expect(harness.error).toBeUndefined();
    expect(harness.events.map((event) => event.type)).toContain('completed');
    expect(harness.calls.plan).toHaveLength(0);
    expect(harness.calls.prepare).toEqual([expect.not.objectContaining({ localScanPlanHash: expect.anything(), confirmedLocalScan: expect.anything() })]);
    expect(harness.checkpoint?.localScanPlanHash).toBeUndefined();
  });
});
