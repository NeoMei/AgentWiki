/**
 * In-memory transport for exercising the production onboarding runtime.  It
 * never fabricates protocol events: the real coordinator emits every event and
 * this driver only returns the matching structured reply that a client would
 * send over NDJSON.
 */
import { runOnboarding } from './runtime.js';
import { createSessionStore, type OnboardingCheckpoint } from './session.js';
import type { OnboardingEvent, ProtocolSink, ProtocolSource } from './protocol.js';
import type { LocalScanPlan } from '../codegraph/contracts.js';
import { installGatewayEntry } from '../installer/client-config.js';
import { hashConfig } from '../installer/plan.js';

type E2EInput = {
  spaceMode: 'create' | 'existing';
  spaceName?: string;
  spaceId?: string;
  agentName: string;
  permissionPreset: 'editor' | 'full';
  approvalMode: 'always-review' | 'scoped-auto-publish';
  clientType: 'codex' | 'claude' | 'opencode';
  sourcePaths: string[];
  sourceType: 'auto' | 'code' | 'documents';
  analysisMode: 'standard' | 'deep';
};

export interface OnboardingStateMachineHarnessOptions {
  home: string;
  input: E2EInput;
  /** Values returned by each real planLocalScan call, in state-machine order. */
  localPlans: Array<LocalScanPlan | null>;
}

export interface OnboardingStateMachineHarnessResult {
  events: OnboardingEvent[];
  replies: Array<Record<string, unknown>>;
  calls: {
    plan: Array<Record<string, unknown>>;
    bootstrap: Array<Record<string, unknown>>;
    init: Array<Record<string, unknown>>;
    prepare: Array<Record<string, unknown>>;
    sync: Array<Record<string, unknown>>;
  };
  checkpoint: OnboardingCheckpoint | null;
  error?: unknown;
}

export async function runOnboardingStateMachineHarness(
  options: OnboardingStateMachineHarnessOptions,
): Promise<OnboardingStateMachineHarnessResult> {
  const events: OnboardingEvent[] = [];
  const replies: Array<Record<string, unknown>> = [];
  const calls: OnboardingStateMachineHarnessResult['calls'] = {
    plan: [], bootstrap: [], init: [], prepare: [], sync: [],
  };
  let inputSent = false;
  let confirmationIndex = 0;
  let planIndex = 0;
  const sink: ProtocolSink = {
    write(line) {
      events.push(JSON.parse(line) as OnboardingEvent);
    },
  };
  const source: ProtocolSource = {
    async read() {
      if (!inputSent) {
        inputSent = true;
        const reply = { requestId: 'input', values: options.input };
        replies.push(reply);
        return JSON.stringify(reply);
      }
      const confirmation = events.filter((event) => event.type === 'confirmation_required')[confirmationIndex++];
      if (!confirmation || confirmation.type !== 'confirmation_required') throw new Error('runtime requested a reply without a confirmation event');
      const reply = { requestId: confirmation.requestId, confirmed: true, planHash: confirmation.planHash };
      replies.push(reply);
      return JSON.stringify(reply);
    },
  };

  let error: unknown;
  try {
    await runOnboarding(
      { home: options.home, protocol: 'ndjson', serverBaseUrl: 'https://wiki.test/api' },
      {
        sessionId: () => 'state-machine-e2e',
        sink,
        source,
        client: {
          start: async () => ({
            deviceCode: 'awd_test', userCode: 'E2E-CODE', verificationUri: 'https://wiki.test/onboard/device',
            verificationUriComplete: 'https://wiki.test/onboard/device?user_code=E2E-CODE', expiresIn: 600, interval: 5,
          }),
          pollUntilSettled: async () => ({ status: 'authorized', onboardingToken: 'awo_test', expiresIn: 600 }),
        } as never,
        preflight: async () => ({ configHash: 'e'.repeat(64), oldEntries: [], hasConflict: false, archivePath: null, reloadRequired: false }),
        bootstrapInstall: async (input) => {
          calls.bootstrap.push(input);
          // The coordinator and protocol are real; the remote bootstrap is
          // deliberately controlled. Its local installation boundary is not:
          // write the production single-gateway config into this test's own
          // disposable client home so all three client formats are exercised.
          await installGatewayEntry(
            options.input.clientType,
            '00000000-0000-4000-8000-000000000001',
            hashConfig(''),
            options.home,
            'https://wiki.test/api',
            options.input.clientType === 'opencode' ? 1 : undefined,
          );
          return {
            bootstrap: {
              space: { id: 'space-1', name: 'E2E Space' }, agent: { id: 'agent-1', name: 'E2E Agent' },
              grant: { role: 'editor', scopes: ['pages:read'] },
              installation: { code: 'code-1', installationId: 'installation-1', expiresAt: '2026-08-11T01:00:00.000Z' },
            },
            reloadRequired: false, manifestHash: 'f'.repeat(64), connectionId: '00000000-0000-4000-8000-000000000001',
          };
        },
        knowledge: {
          planLocalScan: async (input) => {
            calls.plan.push(input as unknown as Record<string, unknown>);
            const plan = options.localPlans[planIndex++];
            if (plan === undefined) throw new Error('unexpected local plan request');
            return plan;
          },
          pull: async () => ({ revisionId: '0' }),
          prepare: async (input) => {
            calls.prepare.push(input);
            if (input.confirmedLocalScan) calls.init.push(input);
            return { jobId: 'job-1', previewHash: 'preview-hash', summary: { filesProcessed: 1 } };
          },
          confirmAndSync: async (input) => {
            calls.sync.push(input);
            return { revisionId: 'revision-1', status: 'published', submissionId: 'submission-1' };
          },
        },
        sleep: async () => undefined,
      },
    );
  } catch (caught) {
    error = caught;
  }

  return {
    events,
    replies,
    calls,
    checkpoint: await createSessionStore('state-machine-e2e', options.home).load(),
    ...(error === undefined ? {} : { error }),
  };
}
