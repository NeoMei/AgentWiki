import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { probeOpencodeLaunch, resolveOpencodeLaunchFile } from './opencode-launch';

describe('OpenCode launch resolution', () => {
  it('detects the external CLI family from capabilities instead of pinning a version', () => {
    const spawn = jest.fn((_: string, args: readonly string[]) => ({
      status: 0,
      error: undefined,
      stderr: '',
      stdout: args[args.length - 1] === '--version'
        ? 'opencode v9.9.9\n'
        : args.includes('run')
          ? 'run --standalone\n'
          : 'models --standalone\n',
    }));

    expect(probeOpencodeLaunch({
      command: 'opencode', argsPrefix: [], cliMajor: 1, packageName: 'configured',
    }, spawn as never)).toMatchObject({ cliMajor: 2, version: '9.9.9' });
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('accepts a shell-free external Node launch file without reading node_modules', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-external-'));
    const target = join(fixture, 'opencode.cjs');
    writeFileSync(target, '#!/usr/bin/env node\n');
    try {
      expect(resolveOpencodeLaunchFile(target, process.platform)).toMatchObject({
        command: process.execPath,
        argsPrefix: [realpathSync(target)],
        packageName: 'configured',
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
