import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createWorkBuddyGatewayLaunch, mergeWorkBuddyEnvironment, validateWorkBuddyGatewayLaunch } from './workbuddy-runtime.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function runtimeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'aw runtime with spaces-'));
  cleanup.push(root);
  const bin = join(root, 'bin');
  const npm = process.platform === 'win32' ? join(bin, 'node_modules', 'npm') : join(root, 'lib', 'node_modules', 'npm');
  await mkdir(bin, { recursive: true });
  await mkdir(join(npm, 'bin'), { recursive: true });
  const nodePath = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
  if (process.platform === 'win32') await copyFile(process.execPath, nodePath);
  else await symlink(process.execPath, nodePath);
  const cli = join(npm, 'bin', 'npx-cli.js');
  await writeFile(join(npm, 'package.json'), JSON.stringify({ name: 'npm', bin: { npx: 'bin/npx-cli.js' } }));
  await writeFile(cli, `
    if (process.argv[2] === '--version') { console.log('11.6.0'); process.exit(0); }
    require('node:fs').writeFileSync(${JSON.stringify(join(root, 'npm-started'))}, 'yes');
    console.log('npm started');
  `);
  if (process.platform !== 'win32') await symlink(cli, join(bin, 'npx'));
  return { root, bin, cli, npm, nodePath };
}

function cacheOf(launch: { args: string[] }) { return launch.args[launch.args.indexOf('--cache') + 1]; }

describe('WorkBuddy npm launch', () => {
  it('pins the verified Node and npm CLI while using a private disposable cache and preserving environment', async () => {
    const fixture = await runtimeFixture();
    const env = { PATH: '/host/managed node/bin:/other/bin', NODE_OPTIONS: '--no-warnings', CUSTOM_SETTING: 'keep me' };
    const launch = await createWorkBuddyGatewayLaunch('connection with spaces', { nodePath: fixture.nodePath, env });
    const cache = cacheOf(launch);
    cleanup.push(cache);
    expect(launch.command).toBe(fixture.nodePath);
    expect(launch.args).toEqual(['-e', expect.any(String), await realpath(fixture.cli), '--cache', cache, '--yes', '@neomei/agentwiki-local-sync@0.13.5', 'gateway', '--connection', 'connection with spaces']);
    expect(launch.env).toEqual({ ...env, PATH: `${fixture.bin}${delimiter}${env.PATH}` });
    expect(dirname(cache)).toBe(await realpath(tmpdir()));
    expect((await lstat(cache)).isSymbolicLink()).toBe(false);
    if (process.platform !== 'win32') expect((await lstat(cache)).mode & 0o777).toBe(0o700);
    const second = await createWorkBuddyGatewayLaunch('another', { nodePath: fixture.nodePath, env });
    cleanup.push(cacheOf(second));
    expect(cacheOf(second)).not.toBe(cache);
  });

  it.each(['custom', 'empty'] as const)('uses the same %s temporary environment for installation and every real npm startup', async (kind) => {
    const fixture = await runtimeFixture();
    const temp = kind === 'custom' ? fixture.root : '';
    const env = { TMPDIR: temp, TMP: temp, TEMP: temp };
    const launch = await createWorkBuddyGatewayLaunch('conn', { env });
    const cache = cacheOf(launch);
    cleanup.push(cache);
    if (kind === 'custom') expect(dirname(cache)).toBe(await realpath(fixture.root));
    expect(launch.env).toMatchObject(env);
    await expect(validateWorkBuddyGatewayLaunch(launch, 'conn')).resolves.toBe(true);
    await rm(cache, { recursive: true });
    const result = await promisify(execFile)(launch.command, [...launch.args.slice(0, 5), '--version'], {
      env: mergeWorkBuddyEnvironment(process.env, launch.env),
    });
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect((await lstat(cache)).isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect((await lstat(cache)).mode & 0o777).toBe(0o700);
  });

  it('does not persist inherited credentials or NODE_OPTIONS in client configuration', async () => {
    const fixture = await runtimeFixture();
    const launch = await createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath });
    cleanup.push(cacheOf(launch));
    expect(Object.keys(launch.env)).toEqual(['PATH']);
  });

  it.skipIf(process.platform === 'win32')('rejects an unsupported selected Node before creating a launch', async () => {
    const fixture = await runtimeFixture();
    await rm(fixture.nodePath);
    await writeFile(fixture.nodePath, '#!/bin/sh\necho v22.22.2\n', { mode: 0o755 });
    await expect(createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath })).rejects.toThrow('NODE_UNSUPPORTED');
  });

  it('fails instead of using another npx from PATH when the selected Node has no matching npm', async () => {
    const fixture = await runtimeFixture();
    await rm(process.platform === 'win32' ? fixture.cli : join(fixture.bin, 'npx'));
    await expect(createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath })).rejects.toThrow(/npm|npx/i);
  });

  it('rejects a directory or unrelated npx executable', async () => {
    const fixture = await runtimeFixture();
    await rm(process.platform === 'win32' ? fixture.cli : join(fixture.bin, 'npx'));
    await mkdir(process.platform === 'win32' ? fixture.cli : join(fixture.bin, 'npx'));
    await expect(createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath })).rejects.toThrow(/npm|npx/i);
  });

  it('rejects an unusable npm CLI even if its metadata identifies npm', async () => {
    const fixture = await runtimeFixture();
    await writeFile(fixture.cli, 'process.exit(19);\n');
    await expect(createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath })).rejects.toThrow(/npm|npx/i);
  });

  it('rejects cache symlinks and public cache directories on retry', async () => {
    const fixture = await runtimeFixture();
    const launch = await createWorkBuddyGatewayLaunch('conn');
    const cache = cacheOf(launch);
    cleanup.push(cache);
    await rm(cache, { recursive: true });
    await symlink(fixture.root, cache, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(validateWorkBuddyGatewayLaunch(launch, 'conn')).resolves.toBe(false);
    await rm(cache);
    await mkdir(cache, { mode: 0o755 });
    if (process.platform !== 'win32') {
      await chmod(cache, 0o755);
      await expect(validateWorkBuddyGatewayLaunch(launch, 'conn')).resolves.toBe(false);
    }
    expect(await readFile(join(fixture.npm, 'package.json'), 'utf8')).toContain('npm');
  });

  it('recreates a cleared cache privately at every MCP startup before npm runs', async () => {
    const fixture = await runtimeFixture();
    const launch = await createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath });
    const cache = cacheOf(launch);
    cleanup.push(cache);
    await rm(cache, { recursive: true });
    const result = await promisify(execFile)(launch.command, launch.args, { env: { ...process.env, ...launch.env } });
    expect(result.stdout).toBe('npm started\n');
    expect((await lstat(cache)).isDirectory()).toBe(true);
    if (process.platform !== 'win32') expect((await lstat(cache)).mode & 0o777).toBe(0o700);
  });

  it.each(['symlink', 'public', 'foreign-owner'] as const)('rejects a %s cache at MCP startup before npm runs', async (replacement) => {
    if (process.platform === 'win32' && replacement !== 'symlink') return;
    const fixture = await runtimeFixture();
    const launch = await createWorkBuddyGatewayLaunch('conn', { nodePath: fixture.nodePath });
    const cache = cacheOf(launch);
    cleanup.push(cache);
    const env = { ...process.env, ...launch.env };
    if (replacement === 'symlink') {
      await rm(cache, { recursive: true });
      await symlink(fixture.root, cache, process.platform === 'win32' ? 'junction' : 'dir');
    } else if (replacement === 'public') {
      await chmod(cache, 0o755);
    } else {
      // A non-root test cannot chown a directory. Replace only the owner reported at the fs boundary.
      const preload = join(fixture.root, 'foreign-owner.cjs');
      await writeFile(preload, `const fs = require('node:fs'); const original = fs.lstatSync; fs.lstatSync = function(path, ...args) { const info = original.call(this, path, ...args); if (path === ${JSON.stringify(cache)}) info.uid += 1; return info; };`);
      env.NODE_OPTIONS = `--require ${JSON.stringify(preload)}`;
    }
    await expect(promisify(execFile)(launch.command, launch.args, { env })).rejects.toThrow(/WorkBuddy npm cache/);
    await expect(readFile(join(fixture.root, 'npm-started'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recognizes its command with a missing cache without side effects during retry inspection', async () => {
    const launch = await createWorkBuddyGatewayLaunch('conn');
    const cache = cacheOf(launch);
    cleanup.push(cache);
    await rm(cache, { recursive: true });
    await expect(validateWorkBuddyGatewayLaunch(launch, 'conn')).resolves.toBe(true);
    await expect(lstat(cache)).rejects.toMatchObject({ code: 'ENOENT' });
  });

});


it('selects the configured Windows Path over inherited PATH without duplicate spawn environment keys', () => {
  const env = mergeWorkBuddyEnvironment(
    { PATH: 'C:\\host\\node22;C:\\Windows', NODE_OPTIONS: '--no-warnings', KEEP: 'host' },
    { Path: 'C:\\selected node24;C:\\custom', CUSTOM_SETTING: 'configured' },
    'win32',
  );
  expect(env).toEqual({ PATH: 'C:\\selected node24;C:\\custom', NODE_OPTIONS: '--no-warnings', KEEP: 'host', CUSTOM_SETTING: 'configured' });
  expect(Object.keys(env).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['PATH']);
});
