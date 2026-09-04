import { EventEmitter } from 'events';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { OpencodeCliRunner } from './opencode.runner';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

describe('OpencodeCliRunner', () => {
  const config = { get: jest.fn((key: string) => key === 'OPENCODE_BIN' ? 'opencode' : undefined) } as any;

  const childProcess = () => {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = jest.fn(() => {
      child.killed = true;
      return true;
    });
    (spawn as jest.Mock).mockReturnValue(child);
    return child;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => jest.useRealTimers());

  it('builds an editing prompt from the task input', () => {
    const runner = new OpencodeCliRunner(config);

    expect(runner.buildPrompt({
      intent: 'Make it concise',
      pageSnapshot: { title: 'Draft', content: 'Long text' },
    })).toContain([
      '## Page snapshot',
      '{',
      '  "title": "Draft",',
      '  "content": "Long text"',
      '}',
      '',
      '## User intent',
      'Make it concise',
    ].join('\n'));
  });

  it('runs one explicit model and excludes host secrets from the child environment', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = runner.runModel('prompt', 'opencode/big-pickle', 10_000);

    expect(spawn).toHaveBeenCalledWith('opencode', [
      '--pure', 'run', '--model', 'opencode/big-pickle', '--thinking', '--format', 'json', 'prompt',
    ], expect.objectContaining({ env: expect.any(Object), cwd: expect.stringContaining('agentwiki-assist-') }));
    const childEnv = (spawn as jest.Mock).mock.calls[0][2].env;
    expect(childEnv).not.toHaveProperty('DATABASE_URL');
    expect(childEnv).not.toHaveProperty('JWT_SECRET');
    expect(childEnv).not.toHaveProperty('REDIS_URL');
    expect(childEnv.HOME).toContain('agentwiki-assist-');
    expect(childEnv.HOME).not.toBe(process.env.HOME);
    expect(JSON.parse(childEnv.OPENCODE_CONFIG_CONTENT)).toMatchObject({
      permission: { '*': 'deny' },
    });
    expect(childEnv).toMatchObject({
      OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
    });

    child.stdout.write(JSON.stringify({
      type: 'text',
      part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) },
    }));
    child.emit('close', 0);

    await expect(execution).resolves.toMatchObject({ summary: 'ok', changes: '# Result' });
  });

  it('rejects model output containing any tool execution event', () => {
    const runner = new OpencodeCliRunner(config);
    const output = [
      JSON.stringify({ type: 'tool_use', part: { tool: 'bash', input: { command: 'id' } } }),
      JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) } }),
    ].join('\n');

    expect(() => (runner as any).parse(output)).toThrow('process_error');
  });

  it('forwards standard proxy settings required by model providers', async () => {
    const previous = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.test:8080';
    try {
      const child = childProcess();
      const runner = new OpencodeCliRunner(config);
      const execution = runner.runModel('prompt', 'opencode/big-pickle', 10_000);

      expect((spawn as jest.Mock).mock.calls[0][2].env).toMatchObject({
        HTTPS_PROXY: 'http://proxy.test:8080',
      });
      child.stdout.write(JSON.stringify({
        type: 'text',
        part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) },
      }));
      child.emit('close', 0);
      await expect(execution).resolves.toMatchObject({ changes: '# Result' });
    } finally {
      if (previous === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = previous;
    }
  });

  it('lists verbose models through the OpenCode catalog command', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = runner.listModels(10_000);

    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['--pure', 'models', '--verbose'],
      expect.objectContaining({ env: expect.any(Object) }),
    );
    child.stdout.write('model catalog');
    child.emit('close', 0);

    await expect(execution).resolves.toBe('model catalog');
  });

  it('closes child stdin so non-interactive OpenCode does not wait for input', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = runner.runModel('prompt', 'opencode/big-pickle', 10_000);

    expect(child.stdin.writableEnded).toBe(true);
    child.stdout.write(JSON.stringify({
      type: 'text',
      part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) },
    }));
    child.emit('close', 0);
    await expect(execution).resolves.toMatchObject({ changes: '# Result' });
  });

  it('escalates a timed-out process to SIGKILL when it has not closed', async () => {
    jest.useFakeTimers();
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 100, 'model');
    const rejected = expect(execution).rejects.toMatchObject({
      message: 'timeout',
      code: 'timeout',
      scope: 'model',
    });

    await jest.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await jest.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await rejected;
  });

  it('terminates the process without retaining output beyond two megabytes', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'model');
    const rejected = expect(execution).rejects.toMatchObject({
      message: 'output_limit',
      code: 'output_limit',
      scope: 'global',
    });

    child.stdout.write(Buffer.alloc(2_000_001, 'x'));

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
    await rejected;
  });

  it('removes process and stream listeners after the process closes', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'catalog');

    child.stdout.write('ok');
    child.emit('close', 0);

    await expect(execution).resolves.toBe('ok');
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
  });

  it.each([
    ['win32', 'windows', 'opencode.exe', Buffer.from([0x4d, 0x5a, 0x00, 0x00])],
    ['darwin', 'darwin', 'opencode', Buffer.from('cffaedfe', 'hex')],
    ['linux', 'linux', 'opencode', Buffer.from([0x7f, 0x45, 0x4c, 0x46])],
  ] as const)(
    'prefers the upstream-verified generic binary over the %s x64 platform package',
    (platform, packagePlatform, executableName, binaryHeader) => {
      const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-generic-'));
      const packageRoot = join(fixture, 'node_modules');
      const genericDir = join(packageRoot, 'opencode-ai');
      const generic = join(genericDir, 'bin', 'opencode.exe');
      const native = join(packageRoot, `opencode-${packagePlatform}-x64`, 'bin', executableName);
      mkdirSync(join(genericDir, 'bin'), { recursive: true });
      mkdirSync(join(packageRoot, `opencode-${packagePlatform}-x64`, 'bin'), { recursive: true });
      writeFileSync(join(genericDir, 'package.json'), JSON.stringify({
        name: 'opencode-ai', bin: { opencode: './bin/opencode.exe' },
      }));
      writeFileSync(generic, binaryHeader);
      writeFileSync(native, binaryHeader);

      try {
        const runner = new OpencodeCliRunner({ get: jest.fn(() => undefined) } as any);
        expect((runner as any).resolveBundledLaunch(fixture, platform, 'x64')).toEqual({
          command: realpathSync(generic),
          argsPrefix: [],
        });
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    },
  );

  it('uses the server-bundled OpenCode binary when OPENCODE_BIN is not configured', async () => {
    const child = childProcess();
    const bundledConfig = { get: jest.fn(() => undefined) } as any;
    const runner = new OpencodeCliRunner(bundledConfig);
    const execution = (runner as any).exec([], 10_000, 'catalog');

    child.stdout.write('ok');
    child.emit('close', 0);

    await expect(execution).resolves.toBe('ok');
    expect(spawn).toHaveBeenCalledWith(
      expect.stringContaining('opencode-ai/bin/opencode.exe'),
      ['--pure'],
      expect.any(Object),
    );
  });

  it('resolves a bundled Node CLI directly on Windows without invoking a command shim', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-win-'));
    const packageDir = join(fixture, 'node_modules', 'opencode-ai');
    const cli = join(packageDir, 'bin', 'opencode.js');
    mkdirSync(join(packageDir, 'bin'), { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
      name: 'opencode-ai',
      bin: { opencode: './bin/opencode.js' },
    }));
    writeFileSync(cli, '#!/usr/bin/env node\n');
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(fixture);
    const bundledConfig = { get: jest.fn(() => undefined) } as any;
    const child = childProcess();

    try {
      const runner = new OpencodeCliRunner(bundledConfig);
      const execution = (runner as any).exec([], 10_000, 'catalog');
      child.stdout.write('ok');
      child.emit('close', 0);

      await expect(execution).resolves.toBe('ok');
      expect(spawn).toHaveBeenCalledWith(
        process.execPath,
        [realpathSync(cli), '--pure'],
        expect.objectContaining({ shell: false }),
      );
    } finally {
      cwd.mockRestore();
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('resolves the native Windows package when the generic package bin is a POSIX placeholder', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'agentwiki-opencode-native-'));
    const packageRoot = join(fixture, 'node_modules');
    const genericDir = join(packageRoot, 'opencode-ai');
    const native = join(packageRoot, 'opencode-windows-x64', 'bin', 'opencode.exe');
    mkdirSync(join(genericDir, 'bin'), { recursive: true });
    mkdirSync(join(packageRoot, 'opencode-windows-x64', 'bin'), { recursive: true });
    writeFileSync(join(genericDir, 'package.json'), JSON.stringify({
      name: 'opencode-ai', bin: { opencode: './bin/opencode.exe' },
    }));
    writeFileSync(join(genericDir, 'bin', 'opencode.exe'), '#!/bin/sh\nexit 1\n');
    writeFileSync(native, Buffer.from([0x4d, 0x5a, 0x00, 0x00]));

    try {
      const runner = new OpencodeCliRunner({ get: jest.fn(() => undefined) } as any);
      expect((runner as any).resolveBundledLaunch(fixture, 'win32', 'x64')).toEqual({
        command: realpathSync(native),
        argsPrefix: [],
      });
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  (process.platform === 'win32' ? it : it.skip)(
    'starts the resolved bundled Windows executable without a shell',
    () => {
      const runner = new OpencodeCliRunner({ get: jest.fn(() => undefined) } as any);
      const launch = (runner as any).resolveLaunch();
      const { spawnSync } = jest.requireActual<typeof import('child_process')>('child_process');

      expect(launch.argsPrefix).toEqual([]);
      expect(launch.command.toLowerCase()).toMatch(/opencode\.exe$/u);
      const result = spawnSync(launch.command, ['--version'], {
        shell: false,
        windowsHide: true,
        timeout: 15_000,
        encoding: 'utf8',
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/u);
    },
  );

  it('classifies a missing OpenCode binary as a global failure', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'catalog');
    const rejected = expect(execution).rejects.toMatchObject({
      message: 'binary_unavailable',
      code: 'binary_unavailable',
      scope: 'global',
    });

    child.emit('error', Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' }));

    await rejected;
  });

  it.each([
    ['HTTP 429: too many requests', 'rate_limited'],
    ['Unauthorized: invalid API key', 'auth_failed'],
    ['model vendor/missing not found', 'model_unavailable'],
  ])('classifies provider failure %s without exposing raw stderr', async (providerText, errorCode) => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'model');
    const rejected = expect(execution).rejects.toMatchObject({
      message: errorCode,
      code: errorCode,
      scope: 'model',
    });

    child.stdout.write(JSON.stringify({
      type: 'step_finish',
      part: {
        tokens: { total: 9, input: 4, output: 2, reasoning: 1, cache: { read: 1, write: 1 } },
        cost: 0.001,
      },
    }));
    child.stderr.write(`${providerText} secret-provider-detail`);
    child.emit('close', 1);

    await rejected;
    await execution.catch((error: any) => {
      expect(error.usage).toEqual({
        total: 9, input: 4, output: 2, reasoning: 1, cacheRead: 1, cacheWrite: 1,
      });
      expect(error.cost).toBe(0.001);
      expect(error.message).not.toContain('secret-provider-detail');
    });
  });

  it('classifies an unknown nonzero exit as a sanitized global process failure', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'model');
    const rejected = expect(execution).rejects.toMatchObject({
      message: 'process_error',
      code: 'process_error',
      scope: 'global',
    });

    child.stderr.write('unexpected failure with secret-provider-detail');
    child.emit('close', 1);

    await rejected;
  });

  it('does not classify model stdout as a provider failure on nonzero exit', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000, 'model').catch((error: any) => error);

    child.stdout.write([
      JSON.stringify({
        type: 'text',
        part: { text: 'Unauthorized invalid API key stdout-secret' },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: {
          tokens: { total: 7, input: 3, output: 2, reasoning: 1, cache: { read: 1, write: 0 } },
          cost: 0.0007,
        },
      }),
    ].join('\n'));
    child.stderr.write('unexpected failure stderr-secret');
    child.emit('close', 1);

    const error = await execution;
    expect(error).toMatchObject({
      message: 'process_error',
      code: 'process_error',
      scope: 'global',
      usage: { total: 7, input: 3, output: 2, reasoning: 1, cacheRead: 1, cacheWrite: 0 },
      cost: 0.0007,
    });
    expect(error.message).not.toContain('stdout-secret');
    expect(error.message).not.toContain('stderr-secret');
  });

  it('parses OpenCode 1.18 text and usage events', () => {
    const runner = new OpencodeCliRunner(config);
    const output = [
      JSON.stringify({
        type: 'text',
        part: {
          type: 'text',
          text: JSON.stringify({ summary: 'Improved wording', changes: '# Improved\n\nClear text.' }),
        },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: {
          tokens: {
            total: 120,
            input: 70,
            output: 20,
            reasoning: 10,
            cache: { read: 15, write: 5 },
          },
          cost: 0.0025,
        },
      }),
    ].join('\n');

    expect((runner as any).parse(output)).toMatchObject({
      summary: 'Improved wording',
      changes: '# Improved\n\nClear text.',
      cost: 0.0025,
      usage: {
        total: 120,
        input: 70,
        output: 20,
        reasoning: 10,
        cacheRead: 15,
        cacheWrite: 5,
      },
    });
  });

  it('concatenates text fragments and sums every step usage event', () => {
    const runner = new OpencodeCliRunner(config);
    const output = [
      JSON.stringify({ type: 'text', part: { text: '{"summary":"ok",' } }),
      JSON.stringify({ type: 'step_finish', part: {
        tokens: { total: 10, input: 5, output: 2, reasoning: 1, cache: { read: 1, write: 1 } },
        cost: 0.001,
      } }),
      JSON.stringify({ type: 'text', part: { text: '"changes":"# Result"}' } }),
      JSON.stringify({ type: 'step_finish', part: {
        tokens: { total: 20, input: 9, output: 5, reasoning: 2, cache: { read: 3, write: 1 } },
        cost: 0.002,
      } }),
    ].join('\n');

    expect((runner as any).parse(output)).toMatchObject({
      changes: '# Result',
      cost: 0.003,
      usage: {
        total: 30,
        input: 14,
        output: 7,
        reasoning: 3,
        cacheRead: 4,
        cacheWrite: 2,
      },
    });
  });

  it('parses the final JSON object containing changes from assistant text', () => {
    const runner = new OpencodeCliRunner(config);
    const output = [
      JSON.stringify({ type: 'text', part: { text: 'Preparing the final response.\n```json\n' } }),
      JSON.stringify({ type: 'text', part: {
        text: JSON.stringify({ summary: 'final', changes: '# Final {result}' }),
      } }),
      JSON.stringify({ type: 'text', part: { text: '\n```' } }),
    ].join('\n');

    expect((runner as any).parse(output)).toMatchObject({
      summary: 'final',
      changes: '# Final {result}',
    });
  });

  it('rejects an OpenCode error terminal even after valid text was emitted', () => {
    const runner = new OpencodeCliRunner(config);
    const output = [
      JSON.stringify({
        type: 'text',
        part: { text: JSON.stringify({ summary: 'partial', changes: '# Incomplete' }) },
      }),
      JSON.stringify({
        type: 'step_finish',
        part: { tokens: { total: 4, input: 3, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 },
      }),
      JSON.stringify({ type: 'error', error: { name: 'UnknownError', data: { message: 'provider detail' } } }),
    ].join('\n');

    expect(() => (runner as any).parse(output)).toThrow(expect.objectContaining({
      code: 'invalid_output',
      scope: 'model',
      usage: expect.objectContaining({ total: 4 }),
    }));
  });

  it.each([
    JSON.stringify({ type: 'text', part: { text: 'plain text' } }),
    '{damaged-json',
    JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'empty', changes: '   ' }) } }),
  ])('rejects invalid OpenCode event output instead of treating it as page changes', (output) => {
    const runner = new OpencodeCliRunner(config);

    expect(() => (runner as any).parse(output)).toThrow(expect.objectContaining({
      message: 'invalid_output',
      code: 'invalid_output',
      scope: 'model',
    }));
  });
});
