import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { OnboardingError, type OnboardingFailureCode } from '../onboarding/errors.js';
import { type CodeGraphCapabilities, type CodeGraphSourcePlan, type LocalScanPlan } from './contracts.js';
import { ExecFileCodeGraphCommandRunner, type CodeGraphCommandRunner } from './command-runner.js';
import { discoverCodeSources } from './source-discovery.js';
import { hashLocalScanPlan } from './scan-plan.js';

const PLANNING_TIMEOUT_MS = 30_000;
const PLANNING_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PLAN_LIMITS = { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 } as const;

export interface PlanCodeScanInput {
  sourcePaths: string[];
  sourceType: 'auto' | 'code' | 'documents';
  analysisMode: 'standard' | 'deep';
}

/** Task 2 deliberately exposes only the read-only plan boundary; Task 3 adds execution. */
export interface CodeGraphProvider {
  plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
}

export interface CodeGraphProviderOptions {
  runner?: CodeGraphCommandRunner;
  environment?: NodeJS.ProcessEnv;
}

interface ExecutableDetails {
  path: string;
  identity: string;
}

interface NormalizedStatus {
  initialized: boolean;
  fileCount: number;
  state: string;
  pendingRefs: number;
  pendingChanges: number;
}

function planningError(code: OnboardingFailureCode, message: string, diagnostic: string): OnboardingError {
  const error = new OnboardingError({ code, message, retryable: false });
  Object.assign(error, { diagnostic });
  return error;
}

async function executableAt(candidate: string): Promise<ExecutableDetails | null> {
  try {
    await access(candidate, constants.X_OK);
    const metadata = await stat(candidate);
    if (!metadata.isFile()) return null;
    const path = await realpath(candidate);
    return { path, identity: `${path}:${metadata.size}:${Math.trunc(metadata.mtimeMs)}:${metadata.mode}` };
  } catch {
    return null;
  }
}

async function discoverExecutable(environment: NodeJS.ProcessEnv): Promise<ExecutableDetails> {
  const configured = environment.AGENTWIKI_CODEGRAPH_BIN;
  if (configured) {
    const executable = await executableAt(resolve(configured));
    if (executable) return executable;
    throw planningError('CODEGRAPH_NOT_FOUND', 'CodeGraph executable is unavailable', `Configured executable is unavailable: ${configured}`);
  }

  for (const segment of (environment.PATH ?? '').split(delimiter)) {
    if (!segment) continue;
    const executable = await executableAt(join(segment, 'codegraph'));
    if (executable) return executable;
  }
  throw planningError('CODEGRAPH_NOT_FOUND', 'CodeGraph executable is unavailable', 'No codegraph executable was found on PATH');
}

function hasSuccessfulResult(result: { exitCode: number }, probe: string): void {
  if (result.exitCode !== 0) {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph capability probe failed', `${probe} exited with ${result.exitCode}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizedField(first: unknown, second: unknown): number | null {
  const firstValue = integer(first);
  const secondValue = integer(second);
  if (first !== undefined && firstValue === null) return null;
  if (second !== undefined && secondValue === null) return null;
  if (firstValue !== null && secondValue !== null && firstValue !== secondValue) return null;
  return firstValue ?? secondValue;
}

function normalizedStringField(first: unknown, second: unknown): string | null {
  const firstValue = typeof first === 'string' && first.length > 0 ? first : null;
  const secondValue = typeof second === 'string' && second.length > 0 ? second : null;
  if (first !== undefined && firstValue === null) return null;
  if (second !== undefined && secondValue === null) return null;
  if (firstValue !== null && secondValue !== null && firstValue !== secondValue) return null;
  return firstValue ?? secondValue;
}

function normalizePendingChanges(value: unknown): number | null {
  if (value === undefined) return 0;
  const changes = asRecord(value);
  if (!changes) return null;
  const counts = [changes.added, changes.modified, changes.removed];
  if (counts.some((count) => integer(count) === null)) return null;
  return counts.reduce<number>((total, count) => total + integer(count)!, 0);
}

function normalizeStatus(stdout: string, diagnostic: string): NormalizedStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph status response is unsupported', `${diagnostic}: invalid JSON`);
  }
  const result = asRecord(parsed);
  if (!result || typeof result.initialized !== 'boolean') {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph status response is unsupported', `${diagnostic}: missing initialized`);
  }
  if (!result.initialized) return { initialized: false, fileCount: 0, state: 'missing', pendingRefs: 0, pendingChanges: 0 };

  const index = result.index === undefined ? undefined : asRecord(result.index);
  if (result.index !== undefined && !index) {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph status response is unsupported', `${diagnostic}: invalid index`);
  }
  if (index && (typeof index.state !== 'string' || index.state.length === 0 || integer(index.pendingRefs) === null)) {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph status response is unsupported', `${diagnostic}: incomplete index shape`);
  }
  const fileCount = normalizedField(result.fileCount, result.files);
  const pendingRefs = normalizedField(index?.pendingRefs, result.pendingRefs);
  const state = normalizedStringField(index?.state, result.indexState);
  const pendingChanges = normalizePendingChanges(result.pendingChanges);

  if (fileCount === null || pendingRefs === null || state === null || pendingChanges === null) {
    throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph status response is unsupported', `${diagnostic}: missing or invalid core status field`);
  }
  return {
    initialized: true,
    fileCount,
    state,
    pendingRefs,
    pendingChanges,
  };
}

function sourcePlan(source: Awaited<ReturnType<typeof discoverCodeSources>>[number], status: NormalizedStatus): CodeGraphSourcePlan {
  if (!status.initialized) {
    return { ...source, action: 'init', indexState: 'missing', estimatedFiles: 0 };
  }
  if (status.state !== 'complete' || status.pendingRefs !== 0) {
    throw planningError('CODEGRAPH_INDEX_INCOMPLETE', 'CodeGraph index is incomplete', `Index state: ${status.state}; pending refs: ${status.pendingRefs}`);
  }
  return {
    ...source,
    action: status.pendingChanges === 0 ? 'none' : 'sync',
    indexState: status.pendingChanges === 0 ? 'ready' : 'stale',
    estimatedFiles: status.fileCount,
  };
}

export function createCodeGraphProvider(options: CodeGraphProviderOptions = {}): CodeGraphProvider {
  const runner = options.runner ?? new ExecFileCodeGraphCommandRunner();
  const environment = options.environment ?? process.env;
  const run = (command: string, args: string[]) => runner.run(command, args, {
    timeoutMs: PLANNING_TIMEOUT_MS,
    maxBufferBytes: PLANNING_MAX_BUFFER_BYTES,
  });

  return {
    async plan(input) {
      const sources = await discoverCodeSources(input);
      if (sources.length === 0) return null;

      const executable = await discoverExecutable(environment);
      const version = await run(executable.path, ['--version']);
      if (version.exitCode !== 0 || !version.stdout.trim()) {
        throw planningError('CODEGRAPH_NOT_FOUND', 'CodeGraph executable is unavailable', `Version probe failed for ${executable.path}: ${version.exitCode}`);
      }

      for (const args of [['status', '--help'], ['sync', '--help'], ['files', '--help']]) {
        hasSuccessfulResult(await run(executable.path, args), args.join(' '));
      }
      const capabilities: CodeGraphCapabilities = {
        required: { 'index.status': true, 'index.sync': true, 'files.list': true },
        optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
      };
      const plannedSources: CodeGraphSourcePlan[] = [];
      for (const source of sources) {
        const response = await run(executable.path, ['status', '--json', source.canonicalSourcePath]);
        hasSuccessfulResult(response, 'status --json');
        plannedSources.push(sourcePlan(source, normalizeStatus(response.stdout, `Status for ${source.canonicalSourcePath}`)));
      }
      plannedSources.sort((left, right) => left.sourceKey < right.sourceKey ? -1 : left.sourceKey > right.sourceKey ? 1 : 0);

      const planWithoutHash: LocalScanPlan = {
        schemaVersion: 'agentwiki-local-scan-plan@1',
        provider: 'codegraph',
        executableIdentity: executable.identity,
        detectedVersion: version.stdout.trim(),
        capabilities,
        analysisMode: input.analysisMode,
        sources: plannedSources,
        limits: PLAN_LIMITS,
        localScanPlanHash: '0'.repeat(64),
      };
      return { ...planWithoutHash, localScanPlanHash: hashLocalScanPlan(planWithoutHash) };
    },
  };
}

export const CODEGRAPH_PLANNING_LIMITS = {
  timeoutMs: PLANNING_TIMEOUT_MS,
  maxBufferBytes: PLANNING_MAX_BUFFER_BYTES,
} as const;
