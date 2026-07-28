import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import { OpencodeCliRunner } from './opencode.runner';

jest.mock('child_process', () => ({ spawn: jest.fn() }));

describe('OpencodeCliRunner process limits', () => {
  const config = { get: jest.fn((key: string) => key === 'OPENCODE_BIN' ? 'opencode' : undefined) } as any;

  const childProcess = () => {
    const child = new EventEmitter() as any;
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

  it('escalates a timed-out process to SIGKILL when it has not closed', async () => {
    jest.useFakeTimers();
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 100);
    const rejected = expect(execution).rejects.toThrow('opencode timed out');

    await jest.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await jest.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    await rejected;
  });

  it('terminates the process without retaining output beyond two megabytes', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000).catch(() => undefined);

    child.stdout.write(Buffer.alloc(2_000_001, 'x'));

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', 1);
    await execution;
  });

  it('removes process and stream listeners after the process closes', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = (runner as any).exec([], 10_000);

    child.stdout.write('ok');
    child.emit('close', 0);

    await expect(execution).resolves.toBe('ok');
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    expect(child.stdout.listenerCount('data')).toBe(0);
    expect(child.stderr.listenerCount('data')).toBe(0);
  });
});
