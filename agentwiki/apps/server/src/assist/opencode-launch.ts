import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'fs';
import { spawnSync, SpawnSyncReturns } from 'child_process';
import { tmpdir } from 'os';
import { extname, join } from 'path';

export interface OpencodeLaunch {
  command: string;
  argsPrefix: string[];
  cliMajor: 1 | 2;
  packageName: 'configured';
  version?: string;
}

type SpawnProbe = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawnSync>[2],
) => Pick<SpawnSyncReturns<string>, 'error' | 'status' | 'stdout' | 'stderr'>;

const runProbe = (launch: OpencodeLaunch, args: readonly string[], spawnProbe: SpawnProbe): string => {
  const sandbox = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-probe-'));
  try {
    const result = spawnProbe(launch.command, [...launch.argsPrefix, ...args], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: sandbox,
        XDG_CONFIG_HOME: join(sandbox, '.config'),
        XDG_DATA_HOME: join(sandbox, '.local', 'share'),
        XDG_CACHE_HOME: join(sandbox, '.cache'),
        XDG_STATE_HOME: join(sandbox, '.local', 'state'),
        OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
        OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
        OPENCODE_DISABLE_CLAUDE_CODE: 'true',
      },
      cwd: sandbox,
      shell: false,
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0 || result.stderr !== '') {
      throw new Error(`OpenCode probe failed for ${args.join(' ')}`);
    }
    return result.stdout;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
};

export function probeOpencodeLaunch(
  launch: OpencodeLaunch,
  spawnProbe: SpawnProbe = spawnSync,
): OpencodeLaunch {
  const versionOutput = runProbe(launch, ['--version'], spawnProbe);
  const version = versionOutput.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/u)?.[1];
  if (!version) throw new Error('OpenCode --version did not return a semantic version');
  const runHelp = runProbe(launch, ['run', '--help'], spawnProbe);
  const modelsHelp = runProbe(launch, ['models', '--help'], spawnProbe);
  const supportsV2 = runHelp.includes('--standalone') && modelsHelp.includes('--standalone');
  const supportsV1 = runHelp.includes('--pure') && modelsHelp.includes('--verbose');
  if (!supportsV2 && !supportsV1) {
    throw new Error('Unsupported OpenCode CLI: expected v1 --pure or v2 --standalone commands');
  }
  return { ...launch, cliMajor: supportsV2 ? 2 : 1, version };
}

export function buildOpencodeInvocationArgs(
  launch: Pick<OpencodeLaunch, 'cliMajor'>,
  args: readonly string[],
): string[] {
  if (launch.cliMajor === 1) return ['--pure', ...args];
  if (args[0] === 'run') return ['run', '--standalone', ...args.slice(1)];
  if (args[0] === 'models') return ['models', '--standalone'];
  return [...args];
}

export function resolveOpencodeLaunchFile(
  target: string,
  platform: NodeJS.Platform,
): OpencodeLaunch | undefined {
  try {
    if (!statSync(target).isFile()) return undefined;
    const realTarget = realpathSync(target);
    const extension = extname(realTarget).toLowerCase();
    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      return { command: process.execPath, argsPrefix: [realTarget], cliMajor: 1, packageName: 'configured' };
    }
    const header = readFileSync(realTarget).subarray(0, 128);
    if (/^#!.*\bnode\b/u.test(header.toString('utf8'))) {
      return { command: process.execPath, argsPrefix: [realTarget], cliMajor: 1, packageName: 'configured' };
    }
    const native = platform === 'win32'
      ? header[0] === 0x4d && header[1] === 0x5a
      : platform === 'linux'
        ? header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF'
        : platform === 'darwin' && [
          'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe',
        ].includes(header.subarray(0, 4).toString('hex'));
    return native ? { command: realTarget, argsPrefix: [], cliMajor: 1, packageName: 'configured' } : undefined;
  } catch {
    return undefined;
  }
}
