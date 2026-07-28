import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { AssistRunResult, OpencodeRunner } from './assist.queue';

const MAX_OUTPUT_BYTES = 2_000_000;
const TERMINATION_GRACE_MS = 5_000;

// Runs a one-shot opencode CLI invocation with the shared service LLM key.
// The prompt carries the edit intent, a page snapshot and the instruction to
// propose changes via propose_page so a human reviews before publishing.
@Injectable()
export class OpencodeCliRunner implements OpencodeRunner {
  private readonly logger = new Logger(OpencodeCliRunner.name);

  constructor(private readonly config: ConfigService) {}

  async run(task: { intent: string; pageSnapshot: unknown }): Promise<AssistRunResult> {
    const prompt = this.buildPrompt(task);
    const timeoutMs = Number(this.config.get('ASSIST_OPENCODE_TIMEOUT_MS') || 180_000);
    const output = await this.exec(['run', '--format', 'json', prompt], timeoutMs);
    return this.parse(output);
  }

  private buildPrompt(task: { intent: string; pageSnapshot: unknown }): string {
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

  private exec(args: string[], timeoutMs: number): Promise<string> {
    const bin = this.config.get<string>('OPENCODE_BIN') || 'opencode';
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
      const child = spawn(bin, args, { env });
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
          terminate(new Error('opencode output exceeded 2 MB'));
          return;
        }
        outputBytes += chunkBytes;
        if (destination === 'stdout') out += chunk;
        else err += chunk;
      };
      function onStdout(data: Buffer | string) { appendOutput('stdout', data); }
      function onStderr(data: Buffer | string) { appendOutput('stderr', data); }
      function onError(error: Error) {
        closed = true;
        cleanup();
        settle(new Error(`opencode failed to start: ${error.message}`));
      }
      function onClose(code: number | null) {
        closed = true;
        cleanup();
        if (code === 0) settle(undefined, out);
        else settle(new Error(`opencode exited ${code}: ${err.slice(0, 300)}`));
      }

      const timer = setTimeout(() => terminate(new Error('opencode timed out')), timeoutMs);
      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
    });
  }

  private llmEnv(): Record<string, string | undefined> {
    const keys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'GLM_API_KEY', 'QWEN_API_KEY'];
    const out: Record<string, string | undefined> = {};
    for (const key of keys) if (process.env[key]) out[key] = process.env[key];
    return out;
  }

  private parse(output: string): AssistRunResult {
    // opencode --format json emits JSON events; try to find the assistant text.
    for (const line of output.split('\n').reverse()) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const event = JSON.parse(trimmed);
        const text = event?.text || event?.content || event?.message;
        if (typeof text === 'string' && text.includes('"changes"')) {
          const match = text.match(/\{[\s\S]*"changes"[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]);
            return { summary: parsed.summary || 'done', changes: parsed.changes, raw: text };
          }
        }
        if (typeof text === 'string' && text.length > 0) {
          return { summary: 'opencode completed', changes: text, raw: text };
        }
      } catch { /* keep scanning */ }
    }
    return { summary: 'opencode completed', changes: output.slice(0, 4000), raw: output.slice(0, 4000) };
  }
}
