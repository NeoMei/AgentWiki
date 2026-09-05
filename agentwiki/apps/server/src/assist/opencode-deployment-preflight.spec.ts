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
} from './opencode-deployment-preflight';

const expectedVersion = '1.18.12';

function stagedFixture(root: string, version = expectedVersion) {
  const stagedRoot = join(root, 'staged');
  const packageRoot = join(stagedRoot, 'apps', 'server', 'node_modules', 'opencode-ai');
  const target = join(packageRoot, 'bin', 'opencode.js');
  mkdirSync(join(stagedRoot, 'apps', 'server'), { recursive: true });
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  writeFileSync(join(stagedRoot, 'apps', 'server', 'package.json'), JSON.stringify({
    dependencies: { 'opencode-ai': expectedVersion },
  }));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'opencode-ai', version: expectedVersion, bin: { opencode: './bin/opencode.js' },
  }));
  writeFileSync(target, `process.stdout.write(${JSON.stringify(`${version}\n`)});\n`);
  writeFileSync(join(stagedRoot, '.env'), 'DATABASE_URL=postgresql://preserved\n');
  writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'ASSIST_MODELS=model-a,model-b\n');
  return { stagedRoot, target };
}

describe('OpenCode deployment preflight', () => {
  it('validates bundled native before removing only the known staged shim assignments', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-preflight-'));
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const shim = join(liveRoot, 'node_modules', '.pnpm', 'node_modules', '.bin', 'opencode');
    const sentinel = join(fixture, 'shim-ran');
    const { stagedRoot, target } = stagedFixture(fixture, '1.18.11');
    const rootEnv = `ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false\nOPENCODE_BIN=${shim}\nOPENAI_API_KEY=preserve-root\n`;
    const serverEnv = `OPENCODE_BIN=${shim}\nASSIST_MODELS=model-a,model-b\nOPENROUTER_API_KEY=preserve-server\n`;
    mkdirSync(join(shim, '..'), { recursive: true });
    writeFileSync(shim, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`);
    chmodSync(shim, 0o755);
    writeFileSync(join(stagedRoot, '.env'), rootEnv);
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toThrow(/expected OpenCode version 1\.18\.12/iu);
      expect(readFileSync(join(stagedRoot, '.env'), 'utf8')).toBe(rootEnv);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);

      writeFileSync(target, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toEqual({ migratedKnownShim: true, version: expectedVersion });
      expect(readFileSync(join(stagedRoot, '.env'), 'utf8')).toBe(
        'ASSIST_OPENCODE_ALLOW_PAID_FALLBACK=false\nOPENAI_API_KEY=preserve-root\n',
      );
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(
        'ASSIST_MODELS=model-a,model-b\nOPENROUTER_API_KEY=preserve-server\n',
      );
      expect(existsSync(sentinel)).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('uses systemd file order and preserves a valid explicit override byte-for-byte', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-override-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const override = join(stagedRoot, 'operator-tools', 'opencode.js');
    mkdirSync(join(override, '..'), { recursive: true });
    writeFileSync(override, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
    const rootEnv = 'OPENCODE_BIN=/missing/first\nASSIST_OPENCODE_ALLOW_PAID_FALLBACK=true\n';
    const serverEnv = `ASSIST_MODELS=model-a\nOPENCODE_BIN=${override}\nANTHROPIC_API_KEY=preserved\n`;
    writeFileSync(join(stagedRoot, '.env'), rootEnv);
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toEqual({ migratedKnownShim: false, version: expectedVersion });
      expect(readFileSync(join(stagedRoot, '.env'), 'utf8')).toBe(rootEnv);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a direct explicit override from the external temporary tree', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-external-tmp-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const override = join(fixture, 'external', 'opencode.js');
    mkdirSync(join(override, '..'), { recursive: true });
    writeFileSync(override, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
    const serverEnv = `OPENCODE_BIN=${override}\nASSIST_MODELS=model-a\n`;
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toThrow(/runtime-visible.*exact read-only bind/iu);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects an application-tree symlink whose canonical target escapes to temporary storage', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-staged-symlink-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const relativeOverride = join('vendor', 'opencode.js');
    const liveOverride = join(liveRoot, relativeOverride);
    const stagedOverride = join(stagedRoot, relativeOverride);
    const externalTarget = join(fixture, 'external', 'opencode.js');
    mkdirSync(join(liveOverride, '..'), { recursive: true });
    mkdirSync(join(stagedOverride, '..'), { recursive: true });
    mkdirSync(join(externalTarget, '..'), { recursive: true });
    writeFileSync(liveOverride, `process.stdout.write(${JSON.stringify('0.0.0\n')});\n`);
    writeFileSync(externalTarget, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
    symlinkSync(externalTarget, stagedOverride);
    const serverEnv = `OPENCODE_BIN=${liveOverride}\nASSIST_MODELS=model-a\n`;
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toThrow(/runtime-visible.*exact read-only bind/iu);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('validates an application-tree override from the staged replacement tree', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-staged-override-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const relativeOverride = join('vendor', 'opencode.js');
    const liveOverride = join(liveRoot, relativeOverride);
    const stagedOverride = join(stagedRoot, relativeOverride);
    mkdirSync(join(liveOverride, '..'), { recursive: true });
    mkdirSync(join(stagedOverride, '..'), { recursive: true });
    writeFileSync(liveOverride, `process.stdout.write(${JSON.stringify('0.0.0\n')});\n`);
    writeFileSync(stagedOverride, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
    const serverEnv = `OPENCODE_BIN=${liveOverride}\nASSIST_MODELS=model-a\n`;
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toEqual({ migratedKnownShim: false, version: expectedVersion });
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('treats a later empty assignment as an intentional bundled-runtime selection', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-empty-override-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const rootEnv = 'OPENCODE_BIN=/missing/earlier\nASSIST_MODELS=model-a\n';
    const serverEnv = 'OPENCODE_BIN=\nOPENAI_API_KEY=preserved\n';
    writeFileSync(join(stagedRoot, '.env'), rootEnv);
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toEqual({ migratedKnownShim: false, version: expectedVersion });
      expect(readFileSync(join(stagedRoot, '.env'), 'utf8')).toBe(rootEnv);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed without changing staged files for an unsupported explicit shim', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-invalid-'));
    const { stagedRoot } = stagedFixture(fixture);
    const liveRoot = join(fixture, 'home', 'agentwiki');
    const override = join(stagedRoot, 'operator-tools', 'opencode');
    mkdirSync(join(override, '..'), { recursive: true });
    writeFileSync(override, '#!/bin/sh\nexit 0\n');
    chmodSync(override, 0o755);
    const serverEnv = `OPENCODE_BIN=${override}\nASSIST_MODELS=model-a\n`;
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(() => preflightStagedOpencodeRuntime({
        stagedRoot,
        liveRoot,
        homeRoot: join(fixture, 'home'),
      })).toThrow(/unsupported explicit OPENCODE_BIN/iu);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('fails closed for a valid override hidden elsewhere beneath home', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-hidden-home-'));
    const { stagedRoot } = stagedFixture(fixture);
    const homeRoot = join(fixture, 'home');
    const liveRoot = join(homeRoot, 'agentwiki');
    const override = join(homeRoot, 'operator-tools', 'opencode.js');
    mkdirSync(join(override, '..'), { recursive: true });
    writeFileSync(override, `process.stdout.write(${JSON.stringify(`${expectedVersion}\n`)});\n`);
    const serverEnv = `OPENCODE_BIN=${override}\nASSIST_MODELS=model-a\n`;
    writeFileSync(join(stagedRoot, 'apps', 'server', '.env'), serverEnv);

    try {
      expect(() => preflightStagedOpencodeRuntime({ stagedRoot, liveRoot, homeRoot }))
        .toThrow(/hidden by ProtectHome/iu);
      expect(readFileSync(join(stagedRoot, 'apps', 'server', '.env'), 'utf8')).toBe(serverEnv);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('launches the exact native target without a shell and with no argument prefix', () => {
    const spawn = jest.fn(() => ({ status: 0, stdout: `${expectedVersion}\n`, stderr: '' }));
    expect(runOpencodeVersion(
      { command: '/opt/opencode/bin/opencode', argsPrefix: [] },
      expectedVersion,
      spawn as never,
    )).toBe(expectedVersion);
    expect(spawn).toHaveBeenCalledWith(
      '/opt/opencode/bin/opencode',
      ['--version'],
      expect.objectContaining({ shell: false, timeout: 15_000 }),
    );
  });
});
