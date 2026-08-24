/**
 * Gateway verifier: launches the installed gateway as a child process and
 * confirms it completes the MCP initialize + tools/list handshake with the
 * exact 0.6.1 tool manifest.
 */
import { spawn, type ChildProcess } from 'node:child_process';
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
    const listTools = options.listToolsImpl ?? (() => defaultListTools(options));
    const names = await raceWithDeadline(listTools(), deadline);
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
      child.kill('SIGKILL');
      if (err) { reject(err); } else { resolve(result ?? []); }
    };

    child.on('error', (err) => done(err));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) done(new Error(`gateway exited with code ${code}`));
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
    const initReq = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agentwiki-verifier', version: '0.6.1' } } };
    const toolsReq = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    try {
      child.stdin?.write(JSON.stringify(initReq) + '\n');
      child.stdin?.write(JSON.stringify(toolsReq) + '\n');
    } catch {
      // stdin might be closed
    }
  });
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
