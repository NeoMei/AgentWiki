import { spawnSync, SpawnSyncReturns } from 'child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import {
  OpencodeLaunch,
  probeOpencodeLaunch,
  resolveOpencodeLaunchFile,
} from './opencode-launch';

export type SpawnVersion = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout' | 'stderr'>;

export interface PreflightOptions {
  stagedRoot: string;
  liveRoot: string;
  homeRoot: string;
  /** Test seam; production uses spawnSync directly. */
  spawnProbe?: SpawnVersion;
}

interface EnvironmentAssignment {
  file: string;
  value: string;
}

function opencodeAssignments(file: string): EnvironmentAssignment[] {
  try {
    return readFileSync(file, 'utf8').split(/(?<=\n)/u).flatMap((line) => {
      const match = line.replace(/\r?\n$/u, '').match(/^\s*OPENCODE_BIN\s*=\s*(.*?)\s*$/u);
      if (!match) return [];
      let value = match[1];
      if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [{ file, value }];
    });
  } catch {
    return [];
  }
}

function removeOpencodeAssignments(file: string): void {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  const retained = source.split(/(?<=\n)/u).filter((line) => (
    !/^\s*OPENCODE_BIN\s*=/u.test(line)
  )).join('');
  if (retained === source) return;
  const temporary = `${file}.opencode-preflight-${process.pid}`;
  try {
    writeFileSync(temporary, retained, { mode: statSync(file).mode });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function pathIsWithin(path: string, root: string): boolean {
  const canonicalRoot = (() => {
    try {
      return realpathSync(root);
    } catch {
      return resolve(root);
    }
  })();
  const relation = relative(canonicalRoot, resolve(path));
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function pathIsLexicallyWithin(path: string, root: string): boolean {
  const relation = relative(resolve(root), resolve(path));
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

function isKnownLegacyShim(value: string, liveRoot: string): boolean {
  const target = resolve(value);
  return [
    join(liveRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'opencode'),
    join(liveRoot, 'node_modules', '.bin', 'opencode'),
  ].some((candidate) => target === resolve(candidate));
}

function launchForExternalPath(target: string): OpencodeLaunch {
  const launch = resolveOpencodeLaunchFile(target, process.platform);
  if (!launch) throw new Error('Unsupported explicit OPENCODE_BIN launch file');
  return launch;
}

function launchForPath(
  value: string | undefined,
  stagedRoot: string,
  liveRoot: string,
  homeRoot: string,
): OpencodeLaunch {
  if (!value) {
    // PATH is intentionally resolved by the child process without a shell.
    // The deploy host supplies /usr/local/bin/opencode through systemd PATH.
    return {
      command: process.platform === 'win32' ? 'opencode.exe' : 'opencode',
      argsPrefix: [],
      cliMajor: 1,
      packageName: 'configured',
    };
  }
  if (!isAbsolute(value)) {
    throw new Error('Explicit OPENCODE_BIN must be an absolute path');
  }
  const applicationTreeOverride = pathIsLexicallyWithin(value, liveRoot);
  if (!applicationTreeOverride && pathIsLexicallyWithin(value, homeRoot)) {
    throw new Error('Explicit OPENCODE_BIN is hidden by ProtectHome and needs an approved exact bind');
  }
  const validationTarget = applicationTreeOverride
    ? join(stagedRoot, relative(resolve(liveRoot), resolve(value)))
    : value;
  let realOverride: string;
  try {
    realOverride = realpathSync(validationTarget);
  } catch {
    throw new Error('Explicit OPENCODE_BIN must reference an existing regular launch file');
  }
  const allowedStagedTarget = pathIsWithin(realOverride, stagedRoot);
  if (!allowedStagedTarget && pathIsWithin(realOverride, homeRoot)) {
    throw new Error('Explicit OPENCODE_BIN is hidden by ProtectHome and needs an approved exact bind');
  }
  const allowedSystemTarget = ['/usr', '/opt'].some((root) => pathIsWithin(realOverride, root));
  if (!allowedStagedTarget && !allowedSystemTarget) {
    throw new Error(
      'Explicit OPENCODE_BIN canonical target is not runtime-visible; '
      + 'place it in the application tree, /usr, or /opt, or add an approved exact read-only bind',
    );
  }
  return launchForExternalPath(realOverride);
}

export function runOpencodeVersion(
  launch: OpencodeLaunch,
  spawnVersion: SpawnVersion = spawnSync,
): string {
  const sandbox = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-preflight-'));
  try {
    const result = spawnVersion(
      launch.command,
      [...launch.argsPrefix, '--version'],
      {
        cwd: sandbox,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: sandbox,
          XDG_CONFIG_HOME: join(sandbox, '.config'),
          XDG_DATA_HOME: join(sandbox, '.local', 'share'),
          XDG_CACHE_HOME: join(sandbox, '.cache'),
          XDG_STATE_HOME: join(sandbox, '.local', 'state'),
        },
        maxBuffer: 1024 * 1024,
        shell: false,
        timeout: 15_000,
      },
    );
    const reportedVersion = result.stdout.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/u)?.[1];
    if (result.error || result.status !== 0 || result.stderr !== '' || !reportedVersion) {
      throw new Error('OpenCode version probe failed from a direct shell-free launch');
    }
    return reportedVersion;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

export function preflightStagedOpencodeRuntime({
  stagedRoot,
  liveRoot,
  homeRoot,
  spawnProbe = spawnSync,
}: PreflightOptions): { migratedKnownShim: boolean; version: string; cliMajor: 1 | 2 } {
  const rootEnv = join(stagedRoot, '.env');
  const serverEnv = join(stagedRoot, 'apps', 'server', '.env');
  const assignments = [
    ...opencodeAssignments(rootEnv),
    ...opencodeAssignments(serverEnv),
  ];
  const effective = assignments[assignments.length - 1];
  const knownShim = Boolean(effective && isKnownLegacyShim(effective.value, liveRoot));
  // A known npm shim is migrated to the host runtime. It is never executed.
  const launch = launchForPath(
    !effective || effective.value === '' || knownShim ? undefined : effective.value,
    stagedRoot,
    liveRoot,
    homeRoot,
  );
  let probed: OpencodeLaunch;
  try {
    probed = probeOpencodeLaunch(launch, spawnProbe);
  } catch (error) {
    throw Object.assign(
      new Error(`OpenCode external runtime preflight failed: ${error instanceof Error ? error.message : String(error)}`),
      { cause: error },
    );
  }
  if (knownShim) {
    removeOpencodeAssignments(rootEnv);
    removeOpencodeAssignments(serverEnv);
  }
  return {
    migratedKnownShim: knownShim,
    version: probed.version ?? runOpencodeVersion(launch, spawnProbe),
    cliMajor: probed.cliMajor,
  };
}

function main(argv: string[]): void {
  if (argv.length !== 2 || !argv.every(isAbsolute)) {
    throw new Error('Usage: opencode-deployment-preflight <absolute-staged-root> <absolute-live-root>');
  }
  const result = preflightStagedOpencodeRuntime({
    stagedRoot: argv[0],
    liveRoot: argv[1],
    homeRoot: dirname(argv[1]),
  });
  process.stdout.write(`OpenCode external runtime preflight passed (${result.version}, cli v${result.cliMajor})\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
