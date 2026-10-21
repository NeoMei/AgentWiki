import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  preflightStagedOpencodeRuntime,
  runOpencodeVersion,
  SpawnVersion,
} from './opencode-deployment-preflight';

function stagedFixture(root: string) {
  const stagedRoot = join(root, 'staged');
  mkdirSync(join(stagedRoot, 'apps', 'server'), { recursive: true });
  writeFileSync(join(stagedRoot, 'apps', 'server', 'package.json'), JSON.stringify({
    dependencies: {},
  }));
  writeFileSync(join(stagedRoot, '.env'), 'DATABASE_URL=postgresql://preserved\n');
  writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'ASSIST_MODELS=model-a,model-b\n');
  return { stagedRoot };
}

function fakeProbe(version = '2.9.4', major: 1 | 2 = 2): jest.MockedFunction<SpawnVersion> {
  return jest.fn((_command, args, _options) => {
    const last = args[args.length - 1];
    if (last === '--version') return { status: 0, stdout: 'opencode v' + version + '\n', stderr: '' };
    if (last === '--help' && args.includes('run')) {
      return {
        status: 0,
        stdout: major === 2 ? 'run [--standalone] [--format json]' : 'run [--pure]',
        stderr: '',
      };
    }
    if (last === '--help' && args.includes('models')) {
      return {
        status: 0,
        stdout: major === 2 ? 'models [--standalone]' : 'models [--verbose]',
        stderr: '',
      };
    }
    return { status: 1, stdout: '', stderr: 'unexpected args' };
  });
}

describe('OpenCode deployment preflight', () => {
  it('probes an arbitrary host version and migrates only the known npm shim', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-preflight-'));
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const shim = join(liveRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'opencode');
    const { stagedRoot } = stagedFixture(fixture);
    const rootEnv = 'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false\nOPENCODE_BIN=' + shim + '\nOPENAI_API_KEY=preserve-root\n';
    const serverEnv = 'OPENCODE_BIN=' + shim + '\nASSIST_MODELS=model-a,model-b\nOPENROUTER_API_KEY=preserve-server\n';
    mkdirSync(join(shim, '..'), { recursive: true });
    writeFileSync(shim, '#!/bin/sh\nexit 23\n');
    chmodSync(shim, 0o755);
    writeFileSync(join(stagedRoot, '.env'), rootEnv);
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);
    try {
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
        spawnProbe: fakeProbe('2.9.4', 2),
      })).toEqual({ migratedKnownShim: true, version: '2.9.4', cliMajor: 2 });
      expect(readFileSync(join(stagedRoot, '.env'), 'utf8')).toBe(
        'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false\nOPENAI_API_KEY=preserve-root\n',
      );
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(
        'ASSIST_MODELS=model-a,model-b\nOPENROUTER_API_KEY=preserve-server\n',
      );
      expect(existsSync(shim)).toBe(true);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('supports an explicit executable inside the staged application tree', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-staged-override-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const liveOverride = join(liveRoot, 'vendor', 'opencode.js');
    const stagedOverride = join(stagedRoot, 'vendor', 'opencode.js');
    mkdirSync(join(liveOverride, '..'), { recursive: true });
    mkdirSync(join(stagedOverride, '..'), { recursive: true });
    writeFileSync(stagedOverride, 'process.stdout.write("unused");\n');
    const serverEnv = 'ASSIST_MODELS=model-a\nOPENCODE_BIN=' + liveOverride + '\n';
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);
    try {
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
        spawnProbe: fakeProbe('3.4.5', 2),
      })).toEqual({ migratedKnownShim: false, version: '3.4.5', cliMajor: 2 });
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an explicit path hidden by ProtectHome or outside runtime-visible roots', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-path-'));
    const { stagedRoot } = stagedFixture(fixture);
    const homeRoot = join(fixture, 'home');
    const liveRoot = join(homeRoot, 'agentwiki');
    const override = join(homeRoot, 'operator-tools', 'opencode.js');
    mkdirSync(join(override, '..'), { recursive: true });
    writeFileSync(override, 'process.stdout.write("unused");\n');
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'OPENCODE_BIN=' + override + '\n');
    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot,
        spawnProbe: fakeProbe(),
      })).toThrow(/hidden by ProtectHome/iu);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a staged symlink whose canonical target escapes the runtime tree', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-symlink-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const liveOverride = join(liveRoot, 'vendor', 'opencode.js');
    const stagedOverride = join(stagedRoot, 'vendor', 'opencode.js');
    const external = join(fixture, 'external', 'opencode.js');
    mkdirSync(join(liveOverride, '..'), { recursive: true });
    mkdirSync(join(stagedOverride, '..'), { recursive: true });
    mkdirSync(join(external, '..'), { recursive: true });
    writeFileSync(external, 'process.stdout.write("unused");\n');
    symlinkSync(external, stagedOverride);
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'OPENCODE_BIN=' + liveOverride + '\n');
    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
        spawnProbe: fakeProbe(),
      })).toThrow(/runtime-visible.*exact read-only bind/iu);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed when the external CLI does not expose a supported capability set', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-unsupported-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const unsupported = join(stagedRoot, 'operator-tools', 'opencode.js');
    mkdirSync(join(unsupported, '..'), { recursive: true });
    writeFileSync(unsupported, 'process.stdout.write("unused");\n');
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'OPENCODE_BIN=' + unsupported + '\n');
    const probe = jest.fn((_command, args) => {
      if (args[args.length - 1] === '--version') return { status: 0, stdout: 'opencode v9.0.0\n', stderr: '' };
      return { status: 0, stdout: 'future command', stderr: '' };
    });
    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
        spawnProbe: probe,
      })).toThrow(/Unsupported OpenCode CLI/iu);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('runs a shell-free version probe and accepts any semantic version', () => {
    const spawn = jest.fn(() => ({ status: 0, stdout: 'opencode v10.11.12\n', stderr: '' }));
    expect(runOpencodeVersion(
      { command: '/opt/opencode/bin/opencode', argsPrefix: [], cliMajor: 2, packageName: 'configured' },
      spawn as never,
    )).toBe('10.11.12');
    expect(spawn).toHaveBeenCalledWith(
      '/opt/opencode/bin/opencode',
      ['--version'],
      expect.objectContaining({ shell: false, timeout: 15_000 }),
    );
  });
});
