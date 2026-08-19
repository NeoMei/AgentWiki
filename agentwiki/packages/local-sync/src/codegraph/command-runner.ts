import { execFile } from 'node:child_process';

export interface CodeGraphCommandRunner {
  run(command: string, args: string[], options: {
    cwd?: string;
    timeoutMs: number;
    maxBufferBytes: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export class ExecFileCodeGraphCommandRunner implements CodeGraphCommandRunner {
  run(command: string, args: string[], options: {
    cwd?: string;
    timeoutMs: number;
    maxBufferBytes: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      execFile(command, args, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: options.maxBufferBytes,
        shell: false,
        timeout: options.timeoutMs,
      }, (error, stdout, stderr) => {
        const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ stdout, stderr, exitCode });
      });
    });
  }
}
