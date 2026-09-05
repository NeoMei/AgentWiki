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
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import {
  OpencodeLaunch,
  resolveBundledOpencodeLaunch,
  resolveOpencodeLaunchFile,
} from './opencode-launch';

export const EXPECTED_OPENCODE_VERSION = '1.18.12';

type SpawnVersion = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout' | 'stderr'>;

interface PreflightOptions {
  stagedRoot: string;
  liveRoot: string;
  homeRoot: string;
}

interface EnvironmentAssignment {
  file: string;
  value: string;
}

function opencodeAssignments(file: string): EnvironmentAssignment[] {
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
}

function removeOpencodeAssignments(file: string): void {
  const source = readFileSync(file, 'utf8');
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

export function runOpencodeVersion(
  launch: OpencodeLaunch,
  expectedVersion = EXPECTED_OPENCODE_VERSION,
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
          PATH: process.env.PATH ?? '/usr/bin:/bin',
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
    if (result.error || result.status !== 0 || result.stderr !== ''
      || result.stdout.trim() !== expectedVersion) {
      throw new Error(`Expected OpenCode version ${expectedVersion} from a direct shell-free launch`);
    }
    return expectedVersion;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function expectedVersion(stagedRoot: string): string {
  const serverManifest = JSON.parse(readFileSync(
    join(stagedRoot, 'apps', 'server', 'package.json'),
    'utf8',
  )) as { dependencies?: Record<string, string> };
  if (serverManifest.dependencies?.['opencode-ai'] !== EXPECTED_OPENCODE_VERSION) {
    throw new Error(`Staged server must pin opencode-ai ${EXPECTED_OPENCODE_VERSION}`);
  }
  const packageManifestPath = realpathSync(createRequire(
    join(stagedRoot, 'apps', 'server', 'package.json'),
  ).resolve('opencode-ai/package.json'));
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as {
    name?: string;
    version?: string;
  };
  if (packageManifest.name !== 'opencode-ai'
    || packageManifest.version !== EXPECTED_OPENCODE_VERSION) {
    throw new Error(`Staged OpenCode package must be version ${EXPECTED_OPENCODE_VERSION}`);
  }
  return EXPECTED_OPENCODE_VERSION;
}

export function preflightStagedOpencodeRuntime({
  stagedRoot,
  liveRoot,
  homeRoot,
}: PreflightOptions): { migratedKnownShim: boolean; version: string } {
  const rootEnv = join(stagedRoot, '.env');
  const serverEnv = join(stagedRoot, 'apps', 'server', '.env');
  const version = expectedVersion(stagedRoot);
  const bundled = resolveBundledOpencodeLaunch(
    join(stagedRoot, 'apps', 'server'),
    process.platform,
    process.arch,
  );
  if (!bundled) throw new Error('Staged bundled OpenCode runtime is unavailable');
  runOpencodeVersion(bundled, version);

  const assignments = [
    ...opencodeAssignments(rootEnv),
    ...opencodeAssignments(serverEnv),
  ];
  const effective = assignments[assignments.length - 1];
  if (!effective || effective.value === '') {
    return { migratedKnownShim: false, version };
  }

  if (isKnownLegacyShim(effective.value, liveRoot)) {
    removeOpencodeAssignments(rootEnv);
    removeOpencodeAssignments(serverEnv);
    return { migratedKnownShim: true, version };
  }

  if (!isAbsolute(effective.value)) {
    throw new Error('Explicit OPENCODE_BIN must be an absolute path');
  }
  const applicationTreeOverride = pathIsLexicallyWithin(effective.value, liveRoot);
  if (!applicationTreeOverride && pathIsLexicallyWithin(effective.value, homeRoot)) {
    throw new Error('Explicit OPENCODE_BIN is hidden by ProtectHome and needs an approved exact bind');
  }
  const validationTarget = applicationTreeOverride
    ? join(stagedRoot, relative(resolve(liveRoot), resolve(effective.value)))
    : effective.value;
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
  const override = resolveOpencodeLaunchFile(realOverride, process.platform);
  if (!override) throw new Error('Unsupported explicit OPENCODE_BIN launch file');
  runOpencodeVersion(override, version);
  return { migratedKnownShim: false, version };
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
  const migration = result.migratedKnownShim ? '; removed known staged OPENCODE_BIN shim' : '';
  process.stdout.write(`OpenCode runtime preflight passed (${result.version})${migration}\n`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
