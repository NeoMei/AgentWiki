import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, extname, join, resolve } from 'path';
import {
  AssistInput,
  AssistRunResult,
  EMPTY_USAGE,
  FailureCode,
  ModelUsage,
  OpencodeAttemptResult,
  OpencodeExecutionError,
  OpencodeRunner,
  StreamChunkCallback,
} from './opencode.types';

const MAX_OUTPUT_BYTES = 2_000_000;
const TERMINATION_GRACE_MS = 5_000;

// Runs one-shot OpenCode CLI invocations with a minimal child environment.
// The prompt asks for proposed Markdown only; publishing remains outside the
// model process and continues through AgentWiki's human-review flow.
@Injectable()
export class OpencodeCliRunner implements OpencodeRunner {
  constructor(private readonly config: ConfigService) {}

  async run(task: AssistInput): Promise<AssistRunResult> {
    const prompt = this.buildPrompt(task);
    const timeoutMs = Number(this.config.get('ASSIST_OPENCODE_TIMEOUT_MS') || 180_000);
    const output = await this.exec(['run', '--format', 'json', prompt], timeoutMs, 'model');
    return this.parse(output);
  }

  buildPrompt(task: AssistInput): string {
    const snapshot = task.pageSnapshot ? JSON.stringify(task.pageSnapshot, null, 2) : '(no page snapshot)';
    return [
      'You are an editing assistant for AgentWiki. Help rewrite a page based on the user intent.',
      '',
      '## Page snapshot',
      snapshot,
      '',
      '## User intent',
      task.intent,
      '',
      '## Instructions',
      '- Produce the improved page content as markdown.',
      '- Do NOT call any tools or write anywhere; just return the improved content and a one-line summary.',
      '- Respond as JSON: {"summary": "...", "changes": "<full markdown>"}',
    ].join('\n');
  }

  listModels(timeoutMs: number): Promise<string> {
    return this.exec(['models', '--verbose'], timeoutMs, 'catalog');
  }

  async runModel(prompt: string, model: string, timeoutMs: number, onStreamChunk?: StreamChunkCallback): Promise<OpencodeAttemptResult> {
    const output = await this.exec(
      ['run', '--model', model, '--thinking', '--format', 'json', prompt],
      timeoutMs,
      'model',
      onStreamChunk,
    );
    return this.parse(output);
  }

  /**
   * Resolve the opencode CLI binary. Checks OPENCODE_BIN, then the usual
   * node_modules/.bin locations including the pnpm .pnpm virtual store where
   * pnpm places bins when the top-level .bin is not linked.
   */
  private resolveLaunch(): { command: string; argsPrefix: string[] } {
    const configured = this.config.get<string>('OPENCODE_BIN');
    if (configured) {
      if (!existsSync(configured)) return { command: configured, argsPrefix: [] };
      const launch = this.launchFile(configured, process.platform);
      if (launch) return launch;
      throw this.executionError('binary_unavailable', 'global');
    }

    const cwd = process.cwd();
    const bundled = this.resolveBundledLaunch(cwd, process.platform, process.arch);
    if (bundled) return bundled;

    // A bare executable name lets Windows resolve opencode.exe from PATH while
    // never selecting pnpm/npm's POSIX .bin shim or invoking a command shell.
    return { command: process.platform === 'win32' ? 'opencode.exe' : 'opencode', argsPrefix: [] };
  }

  private resolveBundledLaunch(
    cwd: string,
    platform: NodeJS.Platform,
    arch: string,
  ): { command: string; argsPrefix: string[] } | undefined {
    for (const root of [cwd, join(cwd, '..'), join(cwd, '..', '..')]) {
      const packageJsonPath = join(root, 'node_modules', 'opencode-ai', 'package.json');
      try {
        if (!existsSync(packageJsonPath)) continue;
        const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
          bin?: string | Record<string, string>;
        };
        const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.opencode;
        if (!bin) continue;
        const realPackageJson = realpathSync(packageJsonPath);
        // opencode-ai's postinstall selects the CPU/libc-compatible package,
        // copies it here, and verifies that it starts. Trust that selection
        // before falling back to an optional platform package.
        const target = resolve(dirname(realPackageJson), bin);
        const genericLaunch = existsSync(target) ? this.launchFile(target, platform) : undefined;
        if (genericLaunch) return genericLaunch;

        const platformName = platform === 'win32' ? 'windows' : platform;
        const executableName = platform === 'win32' ? 'opencode.exe' : 'opencode';
        for (const suffix of ['', '-baseline']) {
          const nativeTarget = resolve(
            dirname(realPackageJson), '..', `opencode-${platformName}-${arch}${suffix}`,
            'bin', executableName,
          );
          const nativeLaunch = existsSync(nativeTarget)
            ? this.launchFile(nativeTarget, platform)
            : undefined;
          if (nativeLaunch) return nativeLaunch;
        }
      } catch {
        // Ignore an invalid or inaccessible package and try the next root.
      }
    }
    return undefined;
  }

  private launchFile(
    target: string,
    platform: NodeJS.Platform,
  ): { command: string; argsPrefix: string[] } | undefined {
    const extension = extname(target).toLowerCase();
    if (['.js', '.cjs', '.mjs'].includes(extension)) {
      return { command: process.execPath, argsPrefix: [target] };
    }
    const header = readFileSync(target).subarray(0, 128);
    if (/^#!.*\bnode\b/u.test(header.toString('utf8'))) {
      return { command: process.execPath, argsPrefix: [target] };
    }
    const native = platform === 'win32'
      ? header[0] === 0x4d && header[1] === 0x5a
      : platform === 'linux'
        ? header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF'
        : platform === 'darwin' && [
          'feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe',
        ].includes(header.subarray(0, 4).toString('hex'));
    return native ? { command: target, argsPrefix: [] } : undefined;
  }

  private exec(args: string[], timeoutMs: number, invocation: 'catalog' | 'model', onStreamChunk?: StreamChunkCallback): Promise<string> {
    const launch = this.resolveLaunch();
    const sandbox = mkdtempSync(join(tmpdir(), 'agentwiki-assist-'));
    return new Promise((resolve, reject) => {
      // Pass only what opencode needs (config dir + LLM creds), not the whole
      // host environment (which may hold DB passwords and other secrets).
      const isolatedConfigDir = join(sandbox, '.config', 'opencode');
      const env = {
        PATH: process.env.PATH,
        HOME: sandbox,
        XDG_CONFIG_HOME: join(sandbox, '.config'),
        XDG_DATA_HOME: join(sandbox, '.local', 'share'),
        XDG_CACHE_HOME: join(sandbox, '.cache'),
        XDG_STATE_HOME: join(sandbox, '.local', 'state'),
        OPENCODE_CONFIG_DIR: isolatedConfigDir,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: { '*': 'deny' } }),
        OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
        OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
        OPENCODE_DISABLE_CLAUDE_CODE: 'true',
        ...this.llmEnv(),
      };
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(launch.command, [...launch.argsPrefix, '--pure', ...args], {
          env,
          cwd: sandbox,
          shell: false,
        });
        child.stdin.end();
      } catch (error) {
        rmSync(sandbox, { recursive: true, force: true });
        const code = (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'binary_unavailable'
          : 'process_error';
        reject(this.executionError(code, 'global'));
        return;
      }
      let out = '';
      let err = '';
      let outputBytes = 0;
      let closed = false;
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let lineBuffer = '';
      // Progressive streaming: opencode emits the full text of a step at once
      // (--format json is step-scoped, not token-scoped). Chunk it and release
      // it gradually so the editor updates live instead of all at once.
      const STREAM_PIECE_CHARS = 120;
      const STREAM_PIECE_INTERVAL_MS = 40;
      let streamQueue: string[] = [];
      let streamTimer: NodeJS.Timeout | null = null;

      const pumpStreamQueue = () => {
        if (streamTimer) return;
        streamTimer = setInterval(() => {
          const piece = streamQueue.shift();
          if (piece === undefined) {
            if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
            return;
          }
          if (onStreamChunk) onStreamChunk(piece);
        }, STREAM_PIECE_INTERVAL_MS);
        streamTimer.unref?.();
      };

      const queueStreamChunk = (text: string) => {
        streamQueue.push(text);
        pumpStreamQueue();
      };

      const settle = (error?: Error, value?: string) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value || '');
      };
      const stopReading = () => {
        child.stdout.removeListener('data', onStdout);
        child.stderr.removeListener('data', onStderr);
      };
      const cleanup = () => {
        clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
        if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
        streamQueue = [];
        stopReading();
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        rmSync(sandbox, { recursive: true, force: true });
      };
      const terminate = (error: Error) => {
        clearTimeout(timer);
        stopReading();
        child.kill('SIGTERM');
        forceKillTimer = setTimeout(() => {
          if (!closed) child.kill('SIGKILL');
          cleanup();
        }, TERMINATION_GRACE_MS);
        forceKillTimer.unref();
        settle(error);
      };
      const emitStreamChunk = (data: Buffer | string) => {
        if (!onStreamChunk) return;
        const chunk = data.toString();
        lineBuffer += chunk;
        let newlineIndex: number;
        while ((newlineIndex = lineBuffer.indexOf('\n')) >= 0) {
          const line = lineBuffer.slice(0, newlineIndex).trim();
          lineBuffer = lineBuffer.slice(newlineIndex + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if ((event?.type === 'thinking' || event?.type === 'reasoning') && typeof event?.part?.text === 'string') {
              queueStreamChunk(`💭 思考: ${event.part.text}\n`);
            } else if (event?.type === 'tool_use' && event?.part?.tool) {
              const toolName = event.part.tool;
              const toolInput = event.part.input ? JSON.stringify(event.part.input, null, 2) : '';
              queueStreamChunk(`🔧 调用工具: ${toolName}\n${toolInput ? `   输入: ${toolInput}\n` : ''}`);
            } else if (event?.type === 'tool_result' && event?.part?.output) {
              const output = typeof event.part.output === 'string' 
                ? event.part.output.slice(0, 500) 
                : JSON.stringify(event.part.output).slice(0, 500);
              queueStreamChunk(`✅ 工具结果: ${output}\n`);
            } else if (event?.type === 'text' && typeof event?.part?.text === 'string') {
              const raw = event.part.text;
              if (raw.length <= STREAM_PIECE_CHARS) {
                queueStreamChunk(`📝 生成: ${raw}\n`);
              } else {
                for (let i = 0; i < raw.length; i += STREAM_PIECE_CHARS) {
                  queueStreamChunk(`📝 生成: ${raw.slice(i, i + STREAM_PIECE_CHARS)}\n`);
                }
              }
            } else if (event?.type === 'step_start') {
              queueStreamChunk(`🚀 开始执行步骤...\n`);
            } else if (event?.type === 'step_finish') {
              const tokens = event?.part?.tokens?.total || 0;
              const cost = event?.part?.cost || 0;
              queueStreamChunk(`✓ 步骤完成 (${tokens} tokens, $${cost.toFixed(4)})\n`);
            }
          } catch { /* not JSON or partial line, skip */ }
        }
      };
      const appendOutput = (destination: 'stdout' | 'stderr', data: Buffer | string) => {
        const chunk = data.toString();
        const chunkBytes = Buffer.byteLength(chunk);
        if (outputBytes + chunkBytes > MAX_OUTPUT_BYTES) {
          terminate(this.executionError('output_limit', 'global', out));
          return;
        }
        outputBytes += chunkBytes;
        if (destination === 'stdout') {
          out += chunk;
          emitStreamChunk(data);
        } else {
          err += chunk;
        }
      };
      function onStdout(data: Buffer | string) { appendOutput('stdout', data); }
      function onStderr(data: Buffer | string) { appendOutput('stderr', data); }
      const onError = (error: Error) => {
        closed = true;
        cleanup();
        const code = (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'binary_unavailable'
          : 'process_error';
        settle(this.executionError(code, 'global', out));
      };
      const onClose = (code: number | null) => {
        closed = true;
        cleanup();
        if (code === 0) settle(undefined, out);
        else {
          const failureCode = this.classifyFailure(err);
          const scope = failureCode === 'process_error' ? 'global' : 'model';
          settle(this.executionError(failureCode, scope, out));
        }
      };

      const timer = setTimeout(() => terminate(this.executionError(
        'timeout',
        invocation === 'model' ? 'model' : 'global',
        out,
      )), timeoutMs);
      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
    });
  }

  private llmEnv(): Record<string, string | undefined> {
    const keys = [
      'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY',
      'KIMI_API_KEY', 'GLM_API_KEY', 'QWEN_API_KEY',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    ];
    const out: Record<string, string | undefined> = {};
    for (const key of keys) if (process.env[key]) out[key] = process.env[key];
    return out;
  }

  private classifyFailure(text: string): FailureCode {
    if (/\b429\b|rate.?limit|too many requests/iu.test(text)) return 'rate_limited';
    if (/unauthori[sz]ed|forbidden|invalid api key|authentication/iu.test(text)) return 'auth_failed';
    if (/model .*not found|unknown model|model .*unavailable/iu.test(text)) return 'model_unavailable';
    return 'process_error';
  }

  private executionError(
    code: FailureCode,
    scope: 'model' | 'global',
    output = '',
  ): OpencodeExecutionError {
    const { usage, cost } = this.readUsage(output);
    return new OpencodeExecutionError(code, code, scope, usage, cost);
  }

  private readUsage(output: string): { usage: ModelUsage; cost: number } {
    const usage: ModelUsage = { ...EMPTY_USAGE };
    let cost = 0;
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed);
        if (event?.type !== 'step_finish') continue;
        const tokens = event?.part?.tokens;
        usage.total += this.nonNegativeNumber(tokens?.total);
        usage.input += this.nonNegativeNumber(tokens?.input);
        usage.output += this.nonNegativeNumber(tokens?.output);
        usage.reasoning += this.nonNegativeNumber(tokens?.reasoning);
        usage.cacheRead += this.nonNegativeNumber(tokens?.cache?.read);
        usage.cacheWrite += this.nonNegativeNumber(tokens?.cache?.write);
        cost += this.nonNegativeNumber(event?.part?.cost);
      } catch { /* Partial usage is best-effort for failed processes. */ }
    }
    return { usage, cost };
  }

  private nonNegativeNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }

  private finalResponse(text: string): Record<string, unknown> | undefined {
    let final: Record<string, unknown> | undefined;
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (start < 0) {
        if (character === '{') {
          start = index;
          depth = 1;
        }
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth += 1;
      else if (character === '}') {
        depth -= 1;
        if (depth !== 0) continue;
        try {
          const parsed = JSON.parse(text.slice(start, index + 1));
          if (parsed && typeof parsed === 'object' && 'changes' in parsed) final = parsed;
        } catch { /* Keep scanning for a later complete response object. */ }
        start = -1;
      }
    }
    return final;
  }

  private parse(output: string): OpencodeAttemptResult {
    const { usage, cost } = this.readUsage(output);
    for (const line of output.split('\n')) {
      try {
        const event = JSON.parse(line.trim());
        if (event?.type === 'tool_use' || event?.type === 'tool_result') {
          throw new OpencodeExecutionError('process_error', 'process_error', 'global', usage, cost);
        }
      } catch (error) {
        if (error instanceof OpencodeExecutionError) throw error;
      }
    }
    let text = '';
    try {
      for (const line of output.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed);
        if (event?.type === 'error') throw new Error('OpenCode error terminal');
        if (event?.type === 'text' && typeof event?.part?.text === 'string') {
          text += event.part.text;
        }
      }
      const parsed = this.finalResponse(text);
      if (typeof parsed?.changes !== 'string' || !parsed.changes.trim()) {
        throw new Error('schema-invalid output');
      }
      return {
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : 'done',
        changes: parsed.changes,
        raw: text,
        usage,
        cost,
      };
    } catch {
      throw new OpencodeExecutionError('invalid_output', 'invalid_output', 'model', usage, cost);
    }
  }
}
