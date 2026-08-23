/**
 * Onboarding HTTP client: device-flow start/poll and idempotent bootstrap.
 *
 * All requests carry bounded deadlines. Polling honours server-issued
 * intervals, slow_down back-off, and a maximum attempt ceiling. Every error
 * is normalised through the redactor so no raw token or secret surfaces.
 */
import { redactSecrets } from '../utils/redact.js';
import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import { OnboardingError, isRetryableHttpStatus } from './errors.js';
import type { OnboardingFailureCode } from './errors.js';

export const DEFAULT_START_DEADLINE_MS = 10_000;
export const DEFAULT_BOOTSTRAP_DEADLINE_MS = 30_000;
const DEFAULT_POLL_DEADLINE_MS = 10_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 240; // ~20 min at 5s intervals
const MIN_POLL_INTERVAL_MS = 2_000;

export type ClientType = 'codex' | 'claude' | 'opencode';

export interface StartParams {
  serverBaseUrl: string;
  packageVersion: '0.5.1';
  clientType: ClientType;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

export interface StartResult {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { status: 'authorization_pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'authorization_consumed' }
  | { status: 'authorized'; onboardingToken: string; expiresIn: number };

export interface ServerPlanSpace {
  mode: 'create';
  name: string;
}
export interface ServerPlanExistingSpace {
  mode: 'existing';
  id: string;
}

export interface ServerPlan {
  space: ServerPlanSpace | ServerPlanExistingSpace;
  agentName: string;
  role: AgentAccessRole;
  packageVersion: '0.5.1';
}

export interface BootstrapParams {
  serverBaseUrl: string;
  onboardingToken: string;
  idempotencyKey: string;
  serverPlan: ServerPlan;
  serverPlanHash: string;
  fetchImpl?: typeof fetch;
  deadlineMs?: number;
}

export interface BootstrapResult {
  space: { id: string; name: string };
  agent: { id: string; name: string };
  grant: { role: AgentAccessRole; scopes: string[] };
  installation: { code: string; installationId: string; expiresAt: string };
}

export interface OnboardingClientOptions {
  fetchImpl?: typeof fetch;
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

function redacted(message: string): string {
  return redactSecrets(message).text;
}

function failure(
  code: OnboardingFailureCode,
  message: string,
  retryable: boolean,
  resumeSessionId?: string,
): OnboardingError {
  return new OnboardingError({
    code,
    message: redacted(message),
    retryable,
    ...(resumeSessionId !== undefined ? { resumeSessionId } : {}),
  });
}

export class OnboardingClient {
  constructor(private readonly options: OnboardingClientOptions = {}) {}

  async start(params: StartParams): Promise<StartResult> {
    const fetchImpl = params.fetchImpl ?? this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.deadlineMs ?? DEFAULT_START_DEADLINE_MS);
    try {
      const response = await fetchImpl(joinUrl(params.serverBaseUrl, '/onboard/device/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packageVersion: params.packageVersion,
          clientType: params.clientType,
          purpose: 'full-onboarding',
        }),
        signal: controller.signal,
      });
      return (await this.parseJson(response, 'start')) as StartResult;
    } catch (error) {
      throw this.normalize(error, 'start', 'REMOTE_UNAVAILABLE', true);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Poll once; the caller decides when to retry based on the returned status. */
  async poll(
    serverBaseUrl: string,
    deviceCode: string,
    fetchImpl?: typeof fetch,
    deadlineMs: number = DEFAULT_POLL_DEADLINE_MS,
  ): Promise<PollResult> {
    const impl = fetchImpl ?? this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      const response = await impl(joinUrl(serverBaseUrl, '/onboard/device/poll'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
        signal: controller.signal,
      });
      return (await this.parseJson(response, 'poll')) as PollResult;
    } catch (error) {
      if (error instanceof OnboardingError) throw error;
      throw this.normalize(error, 'poll', 'REMOTE_UNAVAILABLE', true);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Poll until the device session reaches a terminal state (authorized, denied,
   * expired) or the attempt ceiling is hit. Honours slow_down intervals.
   */
  async pollUntilSettled(
    serverBaseUrl: string,
    deviceCode: string,
    onPending?: (intervalMs: number) => void,
    options?: { fetchImpl?: typeof fetch; intervalMs?: number; maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
  ): Promise<Extract<PollResult, { status: 'authorized' | 'denied' | 'expired' }>> {
    const fetchImpl = options?.fetchImpl ?? this.options.fetchImpl ?? fetch;
    const sleepFn = options?.sleepFn ?? sleep;
    const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    let intervalMs = options?.intervalMs ?? DEFAULT_START_DEADLINE_MS;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.poll(serverBaseUrl, deviceCode, fetchImpl);
      if (result.status === 'authorized' || result.status === 'denied' || result.status === 'expired') {
        return result;
      }
      if (result.status === 'authorization_consumed') {
        // Token already issued in a previous poll — treat as expired for a fresh session.
        throw failure('AUTH_EXPIRED', 'onboarding token already consumed', false);
      }
      if (result.status === 'slow_down') {
        intervalMs = Math.max(result.interval * 1_000, MIN_POLL_INTERVAL_MS);
      }
      onPending?.(intervalMs);
      await sleepFn(intervalMs);
    }
    throw failure('AUTH_EXPIRED', 'device authorization polling timed out', false);
  }

  async bootstrap(params: BootstrapParams): Promise<BootstrapResult> {
    const fetchImpl = params.fetchImpl ?? this.options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.deadlineMs ?? DEFAULT_BOOTSTRAP_DEADLINE_MS);
    try {
      const response = await fetchImpl(joinUrl(params.serverBaseUrl, '/onboard/bootstrap'), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${params.onboardingToken}`,
          'idempotency-key': params.idempotencyKey,
        },
        body: JSON.stringify({
          serverPlan: params.serverPlan,
          serverPlanHash: params.serverPlanHash,
        }),
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        throw failure('AUTH_EXPIRED', `bootstrap rejected (${response.status})`, false);
      }
      return (await this.parseJson(response, 'bootstrap')) as BootstrapResult;
    } catch (error) {
      if (error instanceof OnboardingError) throw error;
      throw this.normalize(error, 'bootstrap', 'REMOTE_UNAVAILABLE', true);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseJson(response: Response, phase: string): Promise<unknown> {
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (isRetryableHttpStatus(response.status)) {
        throw failure('REMOTE_UNAVAILABLE', `${phase} failed: HTTP ${response.status}`, true);
      }
      throw failure('REMOTE_UNAVAILABLE', `${phase} failed: HTTP ${response.status} ${body}`, false);
    }
    return response.json();
  }

  private normalize(error: unknown, phase: string, code: OnboardingFailureCode, retryable: boolean): OnboardingError {
    if (error instanceof Error && error.name === 'AbortError') {
      return failure(code, `${phase} timed out`, retryable);
    }
    const message = error instanceof Error ? error.message : String(error);
    return failure(code, message, retryable);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
