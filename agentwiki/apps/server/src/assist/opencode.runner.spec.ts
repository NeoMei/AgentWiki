import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough, Writable } from 'stream';
import { spawn } from 'child_process';
import { OpencodeCliRunner } from './opencode.runner';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
  spawnSync: jest.fn((_: string, args: readonly string[]) => ({
    status: 0,
    error: undefined,
    stderr: '',
    stdout: args[args.length - 1] === '--version' ? '1.18.12\n' : args.includes('run') ? '--pure\n' : '--verbose\n',
  })),
}));

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

  it('advertises bounded tools without advertising interactive permission or provider resume support', () => {
    expect(new OpencodeCliRunner(config).capabilities).toMatchObject({ tools: true, permissions: false, resume: false });
  });

  const directory = { folderId: 'folder-1', title: 'Research', recursive: true, documents: [
    { pageId: 'page-1', title: 'Report', content: 'PRIVATE_DIRECTORY_BODY', updatedAt: 'v1', folderId: 'folder-1' },
  ] };

  it('locks automatic source generation to the prior decision and retains only read tools', () => {
    const prompt = new OpencodeCliRunner(config).buildPrompt({ mode: 'auto', intent: 'Summarize', actions: { update: true, create: true },
      pageSnapshot: { content: 'source' }, context: { pageId: 'page', references: [], noteIds: [], directory } }, 'answer');
    expect(prompt).toContain('Locked action: answer');
    expect(prompt).toContain('must never upgrade');
    expect(prompt).toContain('Never write anywhere');
    expect(prompt).toContain('Do not claim that a document has been saved');
  });

  it('explains unavailable write capabilities when answering a read-only user write request', () => {
    const prompt = new OpencodeCliRunner(config).buildPrompt({ mode: 'auto', intent: '请修改并保存当前文档', actions: { update: false, create: false },
      pageSnapshot: { content: 'source' }, context: { pageId: 'page', references: [], noteIds: [], directory } }, 'answer');
    expect(prompt).toContain('Available server-authorized actions: {"update":false,"create":false}');
    expect(prompt).toContain('explicitly explain that you cannot save or modify');
    expect(prompt).toContain('chat-only draft');
    expect(prompt).toContain('Do not imply that an update is pending');
  });

  it('strictly parses automatic responses and never streams an action escalation', async () => {
    const child = childProcess();
    const answer = jest.fn();
    const run = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined,
      { mode: 'auto', action: 'answer', actions: { update: true, create: true }, onAnswerText: answer });
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"action":"update","summary":"Injected write","changes":"malicious"}' } }) + '\n');
    child.emit('close', 0);
    await expect(run).rejects.toMatchObject({ code: 'invalid_output' });
    expect(answer).not.toHaveBeenCalled();
  });

  it('reserves automatic response output for source content and carries create metadata', async () => {
    const child = childProcess();
    const answer = jest.fn();
    const run = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined,
      { mode: 'auto', action: 'create', actions: { update: false, create: true }, onAnswerText: answer });
    expect((spawn as jest.Mock).mock.calls[0][1]).not.toContain('--thinking');
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"action":"create","summary":"Prepared","title":"New","changes":"# New"}' } }) + '\n');
    child.emit('close', 0);
    await expect(run).resolves.toMatchObject({ action: 'create', title: 'New', changes: '# New', summary: 'Prepared' });
    expect(answer).not.toHaveBeenCalled();
  });

  it('streams an automatic chat answer only after the locked schema validates', async () => {
    const child = childProcess();
    const answer = jest.fn();
    const run = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined,
      { mode: 'auto', action: 'answer', actions: { update: true, create: true }, onAnswerText: answer });
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"action":"answer","summary":"Chat answer"}' } }) + '\n');
    child.emit('close', 0);
    await expect(run).resolves.toMatchObject({ action: 'answer', summary: 'Chat answer' });
    expect(answer).toHaveBeenCalledWith('Chat answer');
  });

  it('executes a source-free decision before the direct automatic generation call', async () => {
    const runner = new OpencodeCliRunner(config);
    const exec = jest.spyOn(runner as any, 'exec').mockResolvedValueOnce(JSON.stringify({ type: 'text', part: { text: '{"action":"answer"}' } }))
      .mockResolvedValueOnce(JSON.stringify({ type: 'text', part: { text: '{"action":"answer","summary":"Answer"}' } }));
    await expect(runner.run({ intent: 'Summarize', mode: 'auto', pageSnapshot: { content: 'PRIVATE_SOURCE' },
      context: { pageId: 'page', references: [], noteIds: [], directory }, actions: { update: true, create: true } })).resolves.toMatchObject({ action: 'answer', summary: 'Answer' });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][7]).not.toContain('PRIVATE_SOURCE');
    expect(exec.mock.calls[0][9]).toBeUndefined();
    expect(exec.mock.calls[1][7]).toContain('PRIVATE_SOURCE');
    expect(exec.mock.calls[1][7]).toContain('Locked action: answer');
  });

  it.each(['deadline', 'abort'] as const)('bounds a hanging direct-run active check by %s and preserves decision usage', async ending => {
    jest.useFakeTimers();
    const abort = new AbortController();
    const runner = new OpencodeCliRunner({ get: (key: string) => key === 'ASSIST_OPENCODE_TIMEOUT_MS' ? 1000 : undefined } as any);
    const exec = jest.spyOn(runner as any, 'exec').mockResolvedValue([
      JSON.stringify({ type: 'text', part: { text: '{"action":"answer"}' } }),
      JSON.stringify({ type: 'step_finish', part: { cost: 0.2, tokens: { total: 17, input: 12, output: 5 } } }),
    ].join('\n'));
    let entered!: () => void;
    const checking = new Promise<void>(resolve => { entered = resolve; });
    const run = runner.run({ intent: 'Summarize', mode: 'auto', pageSnapshot: null, signal: abort.signal,
      isActive: () => { entered(); return new Promise<boolean>(() => undefined); } });
    const expected = expect(run).rejects.toMatchObject({ code: ending === 'deadline' ? 'budget_exhausted' : 'cancelled', usage: { total: 17 }, cost: 0.2 });
    await checking;
    if (ending === 'deadline') await jest.advanceTimersByTimeAsync(1001); else abort.abort();
    await expected;
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('retries one malformed automatic JSON response without reclassifying or altering its body', async () => {
    const runner = new OpencodeCliRunner(config);
    const frame = (text: string) => [JSON.stringify({ type: 'text', part: { text } }),
      JSON.stringify({ type: 'step_finish', part: { cost: 0.1, tokens: { total: 3 } } })].join('\n');
    const malformed = '{"action":"create","title":"Title","changes":"# Body","summary":"标题为"Title""}';
    const exec = jest.spyOn(runner as any, 'exec').mockResolvedValueOnce(frame('{"action":"create"}'))
      .mockResolvedValueOnce(frame(malformed))
      .mockResolvedValueOnce(frame('{"action":"create","title":"Title","changes":"# Body with \\"literal quotes\\"","summary":"Prepared"}'));
    const result = await runner.run({ mode: 'auto', intent: 'Create a document', pageSnapshot: null, actions: { update: false, create: true },
      context: { pageId: null, references: [], noteIds: [], directory } });
    expect(result).toMatchObject({ action: 'create', title: 'Title', changes: '# Body with "literal quotes"', usage: { total: 9 } });
    expect(result.cost).toBeCloseTo(0.3);
    expect(exec).toHaveBeenCalledTimes(3);
    expect(exec.mock.calls[2][7]).toContain('Locked action: create');
    expect(exec.mock.calls[2][7]).not.toContain(malformed);
  });

  it('describes directory tools without copying directory bodies into the prompt', () => {
    const prompt = new OpencodeCliRunner(config).buildPrompt({ intent: 'Summarize all', pageSnapshot: null, mode: 'question',
      context: { pageId: null, references: [], noteIds: [], directory } } as any);
    expect(prompt).not.toContain('PRIVATE_DIRECTORY_BODY');
    expect(prompt).toContain('agentwiki_directory_list_documents');
    expect(prompt).toContain('agentwiki_directory_read_document');
    expect(prompt).toContain('"documentCount":1');
    expect(prompt).not.toContain('Do NOT call any tools');
  });

  it('distinguishes an unavailable directory snapshot from a genuinely empty directory', () => {
    const prompt = new OpencodeCliRunner(config).buildPrompt({ intent: 'Question', pageSnapshot: null, mode: 'question',
      context: { pageId: null, references: [], noteIds: [], directory: { ...directory, documents: [], unavailableReason: 'Directory exceeds the safe snapshot limit' } } } as any);
    expect(prompt).toContain('Directory exceeds the safe snapshot limit');
    expect(prompt).toContain('directory was not read');
    expect(prompt).toContain('do not describe it as empty');
  });

  it.each(['success', 'abort', 'timeout'] as const)('provides only the authorized directory in a private snapshot and cleans up on %s', async ending => {
    jest.useFakeTimers();
    const child = childProcess();
    const abort = new AbortController();
    const promise = new OpencodeCliRunner(config).run({ intent: 'Summarize', pageSnapshot: null, mode: 'question', signal: abort.signal,
      context: { pageId: null, references: [], noteIds: [], directory } } as any);
    const expectation = ending === 'success' ? expect(promise).resolves.toMatchObject({ summary: 'Answer' })
      : expect(promise).rejects.toMatchObject({ code: ending === 'abort' ? 'cancelled' : 'timeout' });
    const options = (spawn as jest.Mock).mock.calls[0][2];
    const isolated = JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);
    expect(isolated.permission).toEqual({ '*': 'deny', 'agentwiki_directory_*': 'allow' });
    const mcp = isolated.mcp.agentwiki_directory;
    expect(mcp).toMatchObject({ type: 'local', enabled: true });
    expect(mcp.command[0]).toBe(process.execPath);
    expect(mcp.command[1]).toMatch(/assist-directory-mcp\.js$/);
    const snapshotPath = mcp.command[2];
    expect(JSON.parse(readFileSync(snapshotPath, 'utf8'))).toEqual(directory);
    if (process.platform !== 'win32') expect(statSync(snapshotPath).mode & 0o777).toBe(0o600);
    expect(options.shell).toBe(false);
    if (ending === 'abort') abort.abort();
    if (ending === 'timeout') await jest.advanceTimersByTimeAsync(300_000);
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"summary":"Answer"}' } }));
    child.emit('close', ending === 'success' ? 0 : null);
    await expectation;
    expect(existsSync(snapshotPath)).toBe(false);
    expect(existsSync(options.cwd)).toBe(false);
  });

  it('accepts only directory list/read tool events when a directory scope is supplied', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined,
      { mode: 'question', directory } as any);
    for (const tool of ['agentwiki_directory_list_documents', 'agentwiki_directory_read_document']) {
      child.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool, state: { status: 'completed', output: 'source' } } }) + '\n');
    }
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"summary":"Answer"}' } }));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ summary: 'Answer' });
  });

  it('does not count repeated read-only tool bodies against the final output budget or retain them in captured output', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const parse = jest.spyOn(runner as any, 'parse');
    const promise = runner.runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'question', directory } as any);
    const expectation = expect(promise).resolves.toMatchObject({ summary: 'Complete' });
    const source = 'PRIVATE_TOOL_BODY'.repeat(2_000);
    for (let i = 0; i < 80; i += 1) {
      const line = JSON.stringify({ type: 'tool_use', part: { tool: 'agentwiki_directory_read_document', state: { status: 'completed', output: source } } }) + '\n';
      child.stdout.write(line.slice(0, 100));
      child.stdout.write(line.slice(100));
    }
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"summary":"Complete"}' } }));
    child.emit('close', 0);
    await expectation;
    expect(parse.mock.calls[0][0]).not.toContain('PRIVATE_TOOL_BODY');
  });

  it('retains usage and Unicode answers with directory event framing split across bytes', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'question', directory } as any);
    const output = Buffer.from([
      JSON.stringify({ type: 'tool_use', part: { tool: 'agentwiki_directory_read_document', state: { output: 'Private source' } } }),
      JSON.stringify({ type: 'step_finish', part: { cost: 0.25, tokens: { input: 10, output: 5, total: 15 } } }),
      JSON.stringify({ type: 'text', part: { text: '{"summary":"中文🙂"}' } }),
    ].join('\n'));
    for (const byte of output) child.stdout.write(Buffer.from([byte]));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ summary: '中文🙂', cost: 0.25, usage: { input: 10, output: 5, total: 15 } });
  });

  it('preserves provider error classification after completed directory tool calls', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'question', directory } as any);
    child.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool: 'agentwiki_directory_list_documents' } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'error', error: { data: { statusCode: 429 } } }));
    child.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'rate_limited', scope: 'model' });
  });

  it.each([false, true])('bounds each directory transport frame even when it is an allowed tool (newline=%s)', async newline => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'question', directory } as any);
    const expectation = expect(promise).rejects.toMatchObject({ code: 'output_limit' });
    child.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool: 'agentwiki_directory_read_document', state: { output: 'x'.repeat(2_000_001) } } }) + (newline ? '\n' : ''));
    child.emit('close', 1);
    await expectation;
  });

  it('still bounds cumulative answer output in directory mode', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'question', directory } as any);
    const expectation = expect(promise).rejects.toMatchObject({ code: 'output_limit' });
    const line = JSON.stringify({ type: 'text', part: { text: 'x'.repeat(1_000_000) } }) + '\n';
    child.stdout.write(line); child.stdout.write(line);
    child.emit('close', 1);
    await expectation;
  });

  it.each(['bash', 'read', 'webfetch', 'agentwiki_directory_delete', undefined])('rejects %s even while the directory tools are allowed', async tool => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000, undefined,
      { mode: 'question', directory } as any);
    child.stdout.write(JSON.stringify({ type: 'tool_use', part: { tool } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"summary":"Answer"}' } }));
    child.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ code: 'process_error' });
  });

  it('reports real execution phases before an answer and excludes provider payloads', async () => {
    const child = childProcess();
    const phases: unknown[] = [];
    const answer = jest.fn();
    const promise = new OpencodeCliRunner(config).run({ intent: 'why', pageSnapshot: null, mode: 'question',
      onAnswerText: answer, onProgress: progress => phases.push(progress) });
    const waiting = [...phases];
    child.stdout.write(JSON.stringify({ type: 'reasoning', part: { text: 'SECRET reasoning' } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'provider_event', secret: 'SECRET provider' }) + '\n');
    const beforeStart = [...phases];
    child.stdout.write(JSON.stringify({ type: 'step_start', part: { secret: 'SECRET metadata' } }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'step_start' }) + '\n');
    const generating = [...phases];
    const answerBeforeOutput = answer.mock.calls.length;
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '{"summary":"Public answer"}' } }) + '\n');
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ summary: 'Public answer' });
    expect(waiting).toEqual([{ phase: 'waiting' }]);
    expect(beforeStart).toEqual(waiting);
    expect(generating).toEqual([{ phase: 'waiting' }, { phase: 'generating' }]);
    expect(answerBeforeOutput).toBe(0);
    expect(answer.mock.calls).toEqual([['Public answer']]);
    expect(phases).toEqual([{ phase: 'waiting' }, { phase: 'generating' }, { phase: 'finalizing' }]);
    expect(JSON.stringify(phases)).not.toContain('SECRET');
  });

  it('stops phase feedback immediately on cancellation without finalizing a late close', async () => {
    const child = childProcess();
    const abort = new AbortController();
    const phases: unknown[] = [];
    const promise = new OpencodeCliRunner(config).run({ intent: 'why', pageSnapshot: null, mode: 'question', signal: abort.signal,
      onProgress: progress => phases.push(progress) });
    abort.abort();
    child.stdout.write(JSON.stringify({ type: 'step_start' }) + '\n');
    child.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(phases).toEqual([{ phase: 'waiting' }]);
  });

  it('reports generation without requiring an answer or raw-stream subscriber and never finalizes a failure', async () => {
    const child = childProcess();
    const phases: unknown[] = [];
    const promise = new OpencodeCliRunner(config).runModel('why', 'fixture/model', 10_000, undefined,
      { mode: 'question', onProgress: progress => phases.push(progress) });
    child.stdout.write(JSON.stringify({ type: 'step_start' }) + '\n');
    child.stdout.write(JSON.stringify({ type: 'error', error: { data: { statusCode: 429, message: 'SECRET provider' } } }));
    child.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'rate_limited' });
    expect(phases).toEqual([{ phase: 'waiting' }, { phase: 'generating' }]);
  });

  it('answers a read-only question without generating changes', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const promise = runner.run({ intent: 'Why?', pageSnapshot: { content: 'source' }, mode: 'question' } as any);
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'Because.' }) } }));
    child.emit('close', 0);
    const answer = await promise;
    expect(answer.summary).toBe('Because.');
    expect(answer.changes).toBeUndefined();
  });

  it('rejects a question response that smuggles document changes', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).run({ intent: 'Why?', pageSnapshot: null, mode: 'question' } as any);
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'Answer', changes: 'replacement' }) } }));
    child.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('terminates the active process immediately on cancellation', async () => {
    const child = childProcess();
    const abort = new AbortController();
    const promise = new OpencodeCliRunner(config).run({ intent: 'Why?', pageSnapshot: null, signal: abort.signal } as any);
    abort.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled', scope: 'global' });
  });

  it('exposes only validated answer summaries as session progress', async () => {
    const child = childProcess();
    const answer = jest.fn();
    const promise = new OpencodeCliRunner(config).run({ intent: 'why', pageSnapshot: null, mode: 'question', onAnswerText: answer });
    for (const event of [
      { type: 'reasoning', part: { text: 'private chain of thought' } },
      { type: 'step_finish', part: { tokens: { total: 42 }, cost: 7 } },
      { type: 'text', part: { text: '{"summary":"Public ' } },
    ]) child.stdout.write(JSON.stringify(event) + '\n');
    expect(answer).not.toHaveBeenCalled();
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: 'answer"}' } }) + '\n');
    expect(answer.mock.calls).toEqual([['Public answer']]);
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ summary: 'Public answer' });
  });

  it('terminates a real blocked fixture CLI on AbortSignal', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentwiki-abort-test-'));
    const script = join(directory, 'blocked.cjs');
    writeFileSync(script, "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);");
    let child: ReturnType<typeof spawn> | undefined;
    const actualSpawn = jest.requireActual<typeof import('child_process')>('child_process').spawn;
    (spawn as jest.Mock).mockImplementationOnce((...args: Parameters<typeof spawn>) => { child = actualSpawn(...args); return child; });
    const abort = new AbortController();
    try {
      const promise = new OpencodeCliRunner({ get: (key: string) => key === 'OPENCODE_BIN' ? script : undefined } as any).run({ intent: 'fixture', pageSnapshot: null, signal: abort.signal });
      const rejected = expect(promise).rejects.toMatchObject({ code: 'cancelled' });
      await new Promise<void>((resolve, reject) => { child!.stdout!.once('data', () => resolve()); child!.once('error', reject); });
      const closed = new Promise<void>(resolve => child!.once('close', () => resolve()));
      abort.abort();
      await rejected;
      await closed;
      expect(child!.signalCode).toBe('SIGTERM');
      expect(() => process.kill(child!.pid!, 0)).toThrow();
    } finally {
      child?.kill('SIGKILL');
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized public answer without truncating it', () => {
    const runner = new OpencodeCliRunner(config);
    const output = JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: 'a'.repeat(50_001) }) } });
    expect(() => (runner as any).parse(output, 'question')).toThrow(expect.objectContaining({ code: 'output_limit' }));
  });

  it('passes a large Chinese prompt to a real fixture CLI through stdin, never argv', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agentwiki-stdin-test-'));
    const script = join(directory, 'capture.cjs');
    const captured = join(directory, 'received.json');
    writeFileSync(script, `const fs = require('fs'); let input = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => input += chunk);
      process.stdin.on('end', () => {
        fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify({ input, argv: process.argv.slice(2) }));
        process.stdout.write(JSON.stringify({ type: 'text', part: { text: JSON.stringify({ summary: String(Buffer.byteLength(input)), changes: 'fixture result' }) } }));
      });`);
    let child: ReturnType<typeof spawn> | undefined;
    const actualSpawn = jest.requireActual<typeof import('child_process')>('child_process').spawn;
    (spawn as jest.Mock).mockImplementationOnce((...args: Parameters<typeof spawn>) => { child = actualSpawn(...args); return child; });
    const prompt = '中'.repeat(90_000);
    try {
      const runner = new OpencodeCliRunner({ get: (key: string) => key === 'OPENCODE_BIN' ? script : undefined } as any);
      const result = await runner.runModel(prompt, 'fixture/model', 10_000);
      expect(result.summary).toBe('270000');
      const received = JSON.parse(readFileSync(captured, 'utf8'));
      expect(received.input).toBe(prompt);
      expect(received.argv).toEqual(['--pure', 'run', '--model', 'fixture/model', '--thinking', '--format', 'json']);
    } finally { child?.kill('SIGKILL'); rmSync(directory, { recursive: true, force: true }); }
  });

  it('reserves the provider output budget for full proposal JSON', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = runner.runModel('prompt', 'fixture/model', 10_000, undefined, { mode: 'proposal' });

    expect(spawn).toHaveBeenCalledWith('opencode', [
      '--pure', 'run', '--model', 'fixture/model', '--format', 'json',
    ], expect.objectContaining({ env: expect.any(Object) }));
    child.stdout.write(JSON.stringify({
      type: 'text',
      part: { text: JSON.stringify({ summary: 'ok', changes: '# Result' }) },
    }));
    child.emit('close', 0);
    await expect(execution).resolves.toMatchObject({ summary: 'ok', changes: '# Result' });
  });

  it('cancels while prompt input is backpressured and safely absorbs a late EPIPE', async () => {
    const child = childProcess();
    child.stdin = new Writable({ write(_chunk, _encoding, _callback) { /* fixture never consumes */ } });
    const abort = new AbortController();
    const promise = new OpencodeCliRunner(config).runModel('中'.repeat(90_000), 'fixture/model', 10_000, undefined, { signal: abort.signal });
    const pendingBytes = child.stdin.writableLength;
    abort.abort();
    child.emit('close', null);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled', scope: 'global' });
    expect(pendingBytes).toBeGreaterThan(0);
    expect(child.stdin.destroyed).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(() => child.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }))).not.toThrow();
  });

  it('turns an input EPIPE into a global failure and terminates the child', async () => {
    const child = childProcess();
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000);
    let unhandled: unknown;
    try { child.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })); }
    catch (error) { unhandled = error; }
    child.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'process_error', scope: 'global' });
    expect(unhandled).toBeUndefined();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('terminates the already-spawned child when writing stdin throws synchronously', async () => {
    const child = childProcess();
    jest.spyOn(child.stdin, 'end').mockImplementation(() => { throw new Error('input failed'); });
    const promise = new OpencodeCliRunner(config).runModel('prompt', 'fixture/model', 10_000);
    child.emit('close', 1);
    await expect(promise).rejects.toMatchObject({ code: 'process_error', scope: 'global' });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('tells the model the exact editable range while requesting a compact replacement', () => {
    const prompt = new OpencodeCliRunner(config).buildPrompt({ intent: 'rewrite', pageSnapshot: {
      content: 'pre OLD post', updatedAt: '2026-01-01T00:00:00.000Z', assistTarget: {
        kind: 'selection', from: 4, to: 7, quote: 'OLD', prefix: 'pre ', suffix: ' post', baseUpdatedAt: '2026-01-01T00:00:00.000Z',
      },
    } });
    expect(prompt).toContain('UTF-16 range [4, 7)');
    expect(prompt).toContain('outside this range must remain exactly unchanged');
    expect(prompt).toContain('only the replacement markdown');
  });

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

  it.each([
    [403, 'FreeTierError', 'auth_failed'],
    [401, 'Invalid credential', 'auth_failed'],
    [429, 'Quota exceeded', 'rate_limited'],
    [404, 'Unknown model', 'model_unavailable'],
    [503, 'Service unavailable', 'model_unavailable'],
  ])('allows fallback after a stdout JSON provider error with status %s', async (statusCode, message, code) => {
    const child = childProcess();
    const execution = new OpencodeCliRunner(config).runModel('prompt', 'opencode/big-pickle', 10_000);
    child.stdout.write(JSON.stringify({ type: 'error', error: { name: 'APIError', data: { statusCode, message } } }));
    child.emit('close', 1);
    await expect(execution).rejects.toMatchObject({ code, scope: 'model' });
  });

  it('keeps an unrecognized CLI crash global even when stdout contains auth words in generated text', async () => {
    const child = childProcess();
    const execution = new OpencodeCliRunner(config).runModel('prompt', 'opencode/big-pickle', 10_000);
    child.stdout.write(JSON.stringify({ type: 'text', part: { text: '403 forbidden authentication' } }));
    child.stderr.write('Segmentation fault');
    child.emit('close', 1);
    await expect(execution).rejects.toMatchObject({ code: 'process_error', scope: 'global' });
  });

  it('injects only the dedicated Coding Plan credential into the isolated provider config', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner({ get: (key: string) => ({
      OPENCODE_BIN: 'opencode',
      ASSIST_ALIYUN_CODING_PLAN_API_KEY: 'test-coding-plan-key',
    })[key] } as any);
    const execution = runner.listModels(10_000);
    const env = (spawn as jest.Mock).mock.calls[0][2].env;
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({
      permission: { '*': 'deny' },
      provider: { 'bailian-coding-plan': {
        npm: '@ai-sdk/anthropic',
        options: { baseURL: 'https://coding.dashscope.aliyuncs.com/apps/anthropic/v1', apiKey: 'test-coding-plan-key' },
        models: { 'qwen3.7-plus': expect.any(Object) },
      } },
    });
    expect(env).not.toHaveProperty('DATABASE_URL');
    child.stdout.write('catalog');
    child.emit('close', 0);
    await expect(execution).resolves.toBe('catalog');
  });

  it('runs one explicit model and excludes host secrets from the child environment', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner(config);
    const execution = runner.runModel('prompt', 'opencode/big-pickle', 10_000);

    expect(spawn).toHaveBeenCalledWith('opencode', [
      '--pure', 'run', '--model', 'opencode/big-pickle', '--thinking', '--format', 'json',
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

  it('uses the administrator-provided external PATH binary when OPENCODE_BIN is unset', async () => {
    const child = childProcess();
    const runner = new OpencodeCliRunner({ get: jest.fn(() => undefined) } as any);
    const execution = (runner as any).exec([], 10_000, 'catalog');
    child.stdout.write('ok');
    child.emit('close', 0);

    await expect(execution).resolves.toBe('ok');
    expect(spawn).toHaveBeenCalledWith(
      'opencode',
      ['--pure'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('rejects a relative OPENCODE_BIN path with a directory component', () => {
    const runner = new OpencodeCliRunner({ get: jest.fn((key: string) => key === 'OPENCODE_BIN' ? './tmp/opencode' : undefined) } as any);
    expect(() => (runner as any).resolveLaunch()).toThrow(expect.objectContaining({ code: 'process_error' }));
  });

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
