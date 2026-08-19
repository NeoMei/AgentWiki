import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { OnboardingError, type OnboardingFailureCode } from '../onboarding/errors.js';
import { LocalScanPlanSchema, type CodeGraphCapabilities, type CodeGraphSourcePlan, type LocalScanPlan } from './contracts.js';
import { ExecFileCodeGraphCommandRunner, type CodeGraphCommandRunner } from './command-runner.js';
import { normalizeCodeGraphFiles } from './normalizer.js';
import { discoverCodeSources } from './source-discovery.js';
import { hashLocalScanPlan } from './scan-plan.js';
import { CodeSnapshotStore, type StoredCodeSnapshot } from './snapshot-store.js';
import type { SourceLockLease } from './source-lock.js';

const PLANNING_TIMEOUT_MS = 30_000;
const PLANNING_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const EXECUTION_TIMEOUT_MS = 10 * 60_000;
const EXECUTION_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const PLAN_LIMITS = { maxFiles: 10_000, maxGeneratedBytes: 1_000_000 } as const;
const SAFE_VERSION = /^(?:codegraph(?:\s+version)?\s+)?(v?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|(?:[0-9]*[a-z][a-z0-9-]*))(?:\.(?:(?:0|[1-9]\d*)|(?:[0-9]*[a-z][a-z0-9-]*)))*)?(?:\+(?:[0-9a-z-]*[0-9a-z][0-9a-z-]*)(?:\.(?:[0-9a-z-]*[0-9a-z][0-9a-z-]*))*)?)$/iu;

export interface PlanCodeScanInput {
  sourcePaths: string[];
  sourceType: 'auto' | 'code' | 'documents';
  analysisMode: 'standard' | 'deep';
}

export interface CodeGraphProvider {
  plan(input: PlanCodeScanInput): Promise<LocalScanPlan | null>;
  diagnose(input?: CodeGraphDiagnosisInput): Promise<CodeGraphDiagnosis>;
  withConfirmedSnapshots<T>(plan: LocalScanPlan, consume: (snapshots: readonly ConfirmedCodeSnapshot[]) => Promise<T>): Promise<T>;
}

export interface CodeGraphDiagnosisInput {
  /** An optional source root whose existing index may be inspected read-only. */
  sourcePath?: string;
}

export interface CodeGraphDiagnosis {
  available: boolean;
  code?: OnboardingFailureCode;
  detectedVersion?: string;
  capabilities?: CodeGraphCapabilities;
  source?: { indexState: 'missing' | 'ready' | 'stale' | 'incomplete' | 'unavailable'; estimatedFiles?: number };
}

export type ConfirmedCodeSnapshot = Readonly<{
  sourceKey: string;
  snapshotHash: string;
  files: number;
  snapshot: Readonly<StoredCodeSnapshot>;
}>;

export interface CodeGraphProviderOptions {
  runner?: CodeGraphCommandRunner;
  environment?: NodeJS.ProcessEnv;
  home?: string;
  snapshotStore?: CodeSnapshotStore;
  now?: () => Date;
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

/** Returns a bounded display identifier, never scanner output or diagnostics. */
export function safeCodeGraphVersion(value: string): string | null {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 120 || /[\r\n]/u.test(normalized)) return null;
  const match = normalized.match(SAFE_VERSION);
  return match ? `codegraph ${match[1]}` : null;
}

function scanError(code: OnboardingFailureCode, message: string, diagnostic: string): OnboardingError {
  const error = new OnboardingError({ code, message, retryable: false });
  Object.assign(error, { diagnostic });
  return error;
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function freezeSnapshot(snapshot: StoredCodeSnapshot): Readonly<StoredCodeSnapshot> {
  const copy = structuredClone(snapshot) as StoredCodeSnapshot;
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
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

function capabilitiesFromProbe(results: readonly boolean[]): CodeGraphCapabilities {
  const [status, sync, files] = results;
  return {
    required: { 'index.status': status, 'index.sync': sync, 'files.list': files },
    // Stage 2 surfaces are deliberately not inferred from a version string. They remain optional.
    optional: { 'symbols.list': false, 'relations.read': false, 'semantic.explore': false, 'impact.read': false, 'routes.read': false },
  };
}

async function probeCapabilities(
  executable: ExecutableDetails,
  run: (command: string, args: string[]) => ReturnType<CodeGraphCommandRunner['run']>,
): Promise<{ detectedVersion: string; capabilities: CodeGraphCapabilities }> {
  const version = await run(executable.path, ['--version']);
  if (version.exitCode !== 0 || !version.stdout.trim()) {
    throw planningError('CODEGRAPH_NOT_FOUND', 'CodeGraph executable is unavailable', `Version probe failed for ${executable.path}: ${version.exitCode}`);
  }
  const detectedVersion = safeCodeGraphVersion(version.stdout);
  if (!detectedVersion) throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph version response is unsupported', 'CodeGraph version output was not a safe version identifier');
  const results = await Promise.all([
    run(executable.path, ['status', '--help']),
    run(executable.path, ['sync', '--help']),
    run(executable.path, ['files', '--help']),
  ]);
  return {
    detectedVersion,
    capabilities: capabilitiesFromProbe(results.map((result) => result.exitCode === 0)),
  };
}

function diagnosisSource(status: NormalizedStatus): CodeGraphDiagnosis['source'] {
  if (!status.initialized) return { indexState: 'missing', estimatedFiles: 0 };
  if (status.state !== 'complete' || status.pendingRefs !== 0) return { indexState: 'incomplete', estimatedFiles: status.fileCount };
  return { indexState: status.pendingChanges === 0 ? 'ready' : 'stale', estimatedFiles: status.fileCount };
}

export function createCodeGraphProvider(options: CodeGraphProviderOptions = {}): CodeGraphProvider {
  const runner = options.runner ?? new ExecFileCodeGraphCommandRunner();
  const environment = options.environment ?? process.env;
  const home = options.home ?? homedir();
  const snapshotStore = options.snapshotStore ?? new CodeSnapshotStore({ home });
  const now = options.now ?? (() => new Date());
  const run = (command: string, args: string[]) => runner.run(command, args, {
    timeoutMs: PLANNING_TIMEOUT_MS,
    maxBufferBytes: PLANNING_MAX_BUFFER_BYTES,
  });
  const runExecution = (command: string, args: string[]) => runner.run(command, args, {
    timeoutMs: EXECUTION_TIMEOUT_MS,
    maxBufferBytes: EXECUTION_MAX_BUFFER_BYTES,
  });

  const diagnose = async (input: CodeGraphDiagnosisInput = {}): Promise<CodeGraphDiagnosis> => {
    try {
      const executable = await discoverExecutable(environment);
      const { detectedVersion, capabilities } = await probeCapabilities(executable, run);
      let source: CodeGraphDiagnosis['source'];
      if (input.sourcePath) {
        try {
          const canonicalSourcePath = await realpath(input.sourcePath);
          const response = await run(executable.path, ['status', '--json', canonicalSourcePath]);
          hasSuccessfulResult(response, 'status --json');
          source = diagnosisSource(normalizeStatus(response.stdout, `Status for ${canonicalSourcePath}`));
        } catch {
          // A caller may opt into an index check without turning a healthy scanner into a missing scanner.
          source = { indexState: 'unavailable' };
        }
      }
      return { available: true, detectedVersion, capabilities, ...(source ? { source } : {}) };
    } catch (error) {
      const code = error instanceof OnboardingError ? error.code : 'CODEGRAPH_CAPABILITY_UNSUPPORTED';
      return { available: false, code };
    }
  };

  const plan = async (input: PlanCodeScanInput): Promise<LocalScanPlan | null> => {
    const sources = await discoverCodeSources(input);
    if (sources.length === 0) return null;

    const executable = await discoverExecutable(environment);
    const { detectedVersion, capabilities } = await probeCapabilities(executable, run);
    if (Object.values(capabilities.required).some((available) => !available)) {
      throw planningError('CODEGRAPH_CAPABILITY_UNSUPPORTED', 'CodeGraph capability probe failed', 'A required CodeGraph capability is unavailable');
    }
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
      detectedVersion,
      capabilities,
      analysisMode: input.analysisMode,
      sources: plannedSources,
      limits: PLAN_LIMITS,
      localScanPlanHash: '0'.repeat(64),
    };
    return { ...planWithoutHash, localScanPlanHash: hashLocalScanPlan(planWithoutHash) };
  };

  const runSourcesWithLocks = async <T>(sources: CodeGraphSourcePlan[], work: (leases: Map<string, SourceLockLease>) => Promise<T>, leases = new Map<string, SourceLockLease>()): Promise<T> => {
    const [source, ...rest] = sources;
    if (!source) return work(leases);
    return snapshotStore.withLock(source.sourceKey, async (lease) => {
      leases.set(source.sourceKey, lease);
      try { return await runSourcesWithLocks(rest, work, leases); } finally { leases.delete(source.sourceKey); }
    });
  };

  return {
    plan,
    diagnose,
    async withConfirmedSnapshots(confirmedPlan, consume) {
      let confirmed: LocalScanPlan;
      try { confirmed = LocalScanPlanSchema.parse(confirmedPlan); } catch (error) {
        throw scanError('CODEGRAPH_SCAN_PLAN_CHANGED', 'Confirmed CodeGraph scan plan is invalid', error instanceof Error ? error.message : 'Invalid scan plan');
      }
      if (hashLocalScanPlan(confirmed) !== confirmed.localScanPlanHash) {
        throw scanError('CODEGRAPH_SCAN_PLAN_CHANGED', 'Confirmed CodeGraph scan plan has changed', 'Confirmed plan hash did not match plan contents');
      }
      const orderedSources = [...confirmed.sources].sort((left, right) => codeUnitCompare(left.sourceKey, right.sourceKey));
      return runSourcesWithLocks(orderedSources, async (leases) => {
        // Re-plan while source locks are held, immediately before any scanner mutation.
        const replanned = await plan({ sourcePaths: confirmed.sources.map((source) => source.canonicalSourcePath), sourceType: 'code', analysisMode: confirmed.analysisMode });
        if (!replanned || replanned.localScanPlanHash !== confirmed.localScanPlanHash) {
          throw scanError('CODEGRAPH_SCAN_PLAN_CHANGED', 'Confirmed CodeGraph scan plan has changed', 'A fresh local scan plan did not match the confirmed hash');
        }
        const executable = await discoverExecutable(environment);
        if (executable.identity !== replanned.executableIdentity) {
          throw scanError('CODEGRAPH_SCAN_PLAN_CHANGED', 'Confirmed CodeGraph scan plan has changed', 'CodeGraph executable identity changed after plan revalidation');
        }
        const snapshots: ConfirmedCodeSnapshot[] = [];
        for (const source of confirmed.sources) {
          if (source.action === 'rebuild') {
            throw scanError('CODEGRAPH_SCAN_FAILED', 'Confirmed CodeGraph rebuild action is unsupported', 'No rebuild command is inferred or executed by the standard provider');
          }
          if (source.action === 'init' || source.action === 'sync') {
            const response = await runExecution(executable.path, [source.action, source.canonicalSourcePath]);
            if (response.exitCode !== 0) {
              throw scanError('CODEGRAPH_SCAN_FAILED', 'CodeGraph index update failed', `${source.action} exited with ${response.exitCode}`);
            }
          }
          const statusResponse = await runExecution(executable.path, ['status', '--json', source.canonicalSourcePath]);
          if (statusResponse.exitCode !== 0) throw scanError('CODEGRAPH_SCAN_FAILED', 'CodeGraph status check failed', `status exited with ${statusResponse.exitCode}`);
          let status: NormalizedStatus;
          try { status = normalizeStatus(statusResponse.stdout, `Post-scan status for ${source.canonicalSourcePath}`); } catch (error) {
            throw scanError('CODEGRAPH_INDEX_INCOMPLETE', 'CodeGraph index is incomplete', error instanceof Error ? error.message : 'Malformed post-scan status');
          }
          if (!status.initialized || status.state !== 'complete' || status.pendingRefs !== 0 || status.pendingChanges !== 0) {
            throw scanError('CODEGRAPH_INDEX_INCOMPLETE', 'CodeGraph index is incomplete', `Post-scan index state: ${status.state}; pending refs: ${status.pendingRefs}; pending changes: ${status.pendingChanges}`);
          }
          const filesResponse = await runExecution(executable.path, ['files', '--path', source.canonicalSourcePath, '--format', 'flat', '--json']);
          if (filesResponse.exitCode !== 0) throw scanError('CODEGRAPH_SCAN_FAILED', 'CodeGraph files query failed', `files exited with ${filesResponse.exitCode}`);
          if (Buffer.byteLength(filesResponse.stdout, 'utf8') > confirmed.limits.maxGeneratedBytes) {
            throw scanError('CODE_SNAPSHOT_INVALID', 'Code snapshot is invalid: files response exceeds the confirmed limit', 'Raw CodeGraph files output exceeded maxGeneratedBytes before JSON parsing');
          }
          let output: unknown;
          try { output = JSON.parse(filesResponse.stdout); } catch {
            throw scanError('CODE_SNAPSHOT_INVALID', 'Code snapshot is invalid: files response was not JSON', 'CodeGraph files output could not be parsed as JSON');
          }
          const normalized = normalizeCodeGraphFiles(output, {
            sourceKey: source.sourceKey,
            sourceRoot: source.canonicalSourcePath,
            scanner: { provider: 'codegraph', detectedVersion: confirmed.detectedVersion, capabilities: confirmed.capabilities },
            indexedAt: now().toISOString(),
            maxFiles: confirmed.limits.maxFiles,
            maxGeneratedBytes: confirmed.limits.maxGeneratedBytes,
          });
          const lease = leases.get(source.sourceKey);
          if (!lease) throw scanError('CODE_SNAPSHOT_INVALID', 'Code snapshot lease was unavailable', 'Source lock callback did not provide the expected lease');
          const manifest = await snapshotStore.writeWithLease(normalized, lease);
          const stored = await snapshotStore.readWithLease(source.sourceKey, lease);
          if (stored === null || stored.manifest.snapshotHash !== manifest.snapshotHash) {
            throw scanError('CODE_SNAPSHOT_INVALID', 'CodeGraph scan did not produce the confirmed local snapshot', 'Lease-bound snapshot read did not match the manifest just written');
          }
          snapshots.push(Object.freeze({ sourceKey: source.sourceKey, snapshotHash: manifest.snapshotHash, files: manifest.counts.files, snapshot: freezeSnapshot(stored) }));
        }
        return consume(Object.freeze(snapshots.sort((left, right) => codeUnitCompare(left.sourceKey, right.sourceKey))));
      });
    },
  };
}

export const CODEGRAPH_PLANNING_LIMITS = {
  timeoutMs: PLANNING_TIMEOUT_MS,
  maxBufferBytes: PLANNING_MAX_BUFFER_BYTES,
} as const;
