/**
 * Gateway verifier: launches the installed gateway as a child process and
 * confirms it completes the MCP initialize + tools/list handshake with the
 * exact 0.13.5 tool manifest.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { staticToolNames, manifestHash } from '../gateway/manifest.js';

export const VERIFY_DEADLINE_MS = 30_000;

export interface VerifyOptions {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  deadlineMs?: number;
  /** Injection seam for tests to avoid real subprocess hangs. */
  listToolsImpl?: () => Promise<string[]>;
}

export interface VerifyResult {
  ok: boolean;
  toolNames: string[];
  manifestHash: string;
  errors: string[];
}

/**
 * Verify the gateway by checking its tool manifest. In production this launches
 * the child process; in tests the listToolsImpl is injected to avoid hangs.
 */
export async function verifyGateway(options: VerifyOptions): Promise<VerifyResult> {
  const deadline = options.deadlineMs ?? VERIFY_DEADLINE_MS;
  const errors: string[] = [];

  try {
    // The real-process deadline also owns cleanup; do not return while its
    // process-tree termination is still running (notably taskkill on Windows).
    const names = options.listToolsImpl
      ? await raceWithDeadline(options.listToolsImpl(), deadline)
      : await defaultListTools(options);
    const required = staticToolNames();
    const missing = required.filter((name) => !names.includes(name));
    if (missing.length > 0) {
      errors.push(`missing tools: ${missing.join(', ')}`);
    }
    const allowed = new Set(required);
    const unexpected = names.filter((name) => !allowed.has(name) && !name.startsWith('wiki_'));
    if (unexpected.length > 0) {
      errors.push(`unexpected tools: ${unexpected.join(', ')}`);
    }
    return { ok: errors.length === 0, toolNames: names, manifestHash: manifestHash(), errors };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { ok: false, toolNames: [], manifestHash: manifestHash(), errors };
  }
}

/** Launch the gateway child and list its tools via a manual JSON-RPC handshake. */
async function defaultListTools(options: VerifyOptions): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    const [cmd, ...args] = options.command;
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        // On Unix this creates a new session/process group owned only by this
        // verification, including any npx wrapper and gateway descendants.
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let buffer = '';
    let settled = false;
    const done = (err: Error | null, result?: string[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(childTimer);
      void terminateOwnedProcessTree(child).then(() => {
        if (err) { reject(err); } else { resolve(result ?? []); }
      }, (cleanupError: unknown) => {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        reject(new Error(`${err ? `${err.message}; ` : ''}gateway cleanup failed: ${message}`));
      });
    };

    const childTimer = setTimeout(() => done(new Error(`verification timed out after ${options.deadlineMs ?? VERIFY_DEADLINE_MS}ms`)), options.deadlineMs ?? VERIFY_DEADLINE_MS);
    child.on('error', (err) => done(err));
    child.stdin?.on('error', (err) => done(err));
    child.on('exit', (code) => {
      done(new Error(`gateway exited before tools/list with code ${code}`));
    });

    child.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      // Parse line-delimited JSON-RPC responses.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.result?.tools) {
            done(null, (msg.result.tools as Array<{ name: string }>).map((t) => t.name));
          }
        } catch {
          // not a complete JSON-RPC line yet
        }
      }
    });

    // Send initialize + tools/list.
    const initReq = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentwiki-verifier', version: '0.13.5' } } };
    const toolsReq = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    try {
      child.stdin?.write(JSON.stringify(initReq) + '\n');
      child.stdin?.write(JSON.stringify(toolsReq) + '\n');
    } catch {
      // stdin might be closed
    }
  });
}

/** Terminate only the process/group created by the spawn above, never by name. */
async function terminateOwnedProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  // A failed spawn has no PID. In particular, never pass 0/undefined to kill.
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return;

  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let onClose: () => void = () => {};
  const closed = new Promise<boolean>((resolve) => {
    onClose = () => resolve(true);
    child.once('close', onClose);
    cleanupTimer = setTimeout(() => resolve(false), 5_000);
  });
  try {
    if (process.platform === 'win32') {
      // Do not target a PID after this ChildProcess has already exited and its
      // Windows PID could be reused. Timeout/success cleanup runs while alive.
      if (child.exitCode === null && child.signalCode === null) {
        const taskkill = join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32', 'taskkill.exe');
        await new Promise<void>((resolve, reject) => {
          execFile(taskkill, ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    } else {
      try {
        // detached:true made pid the new group leader; negative pid cannot
        // address the caller's group or unrelated pre-existing gateways.
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
    if (!await closed) throw new Error('verification process did not close after termination');
  } finally {
    clearTimeout(cleanupTimer);
    child.removeListener('close', onClose);
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
}

async function raceWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`verification timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
