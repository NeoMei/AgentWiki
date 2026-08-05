import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { join } from 'path';
import {
  AssistInput,
  AssistRunResult,
  EMPTY_USAGE,
  FailureCode,
  ModelUsage,
  OpencodeAttemptResult,
  OpencodeExecutionError,
  OpencodeRunner,
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

  async runModel(prompt: string, model: string, timeoutMs: number): Promise<OpencodeAttemptResult> {
    const output = await this.exec(
      ['run', '--model', model, '--format', 'json', prompt],
      timeoutMs,
      'model',
    );
    return this.parse(output);
  }

  private exec(args: string[], timeoutMs: number, invocation: 'catalog' | 'model'): Promise<string> {
    const bin = this.config.get<string>('OPENCODE_BIN')
      || join(process.cwd(), 'node_modules', '.bin', 'opencode');
    return new Promise((resolve, reject) => {
      // Pass only what opencode needs (config dir + LLM creds), not the whole
      // host environment (which may hold DB passwords and other secrets).
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        ...this.llmEnv(),
      };
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(bin, args, { env });
        child.stdin.end();
      } catch (error) {
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
        stopReading();
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
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
      const appendOutput = (destination: 'stdout' | 'stderr', data: Buffer | string) => {
        const chunk = data.toString();
        const chunkBytes = Buffer.byteLength(chunk);
        if (outputBytes + chunkBytes > MAX_OUTPUT_BYTES) {
          terminate(this.executionError('output_limit', 'global', out));
          return;
        }
        outputBytes += chunkBytes;
        if (destination === 'stdout') out += chunk;
        else err += chunk;
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
