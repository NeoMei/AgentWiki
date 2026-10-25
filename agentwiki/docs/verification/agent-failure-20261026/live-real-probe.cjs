#!/usr/bin/env node
// Read-only production probe for a real AssistTask. It reads one task and its
// authorized execution context, calls the configured router, and emits only
// bounded event metadata. It never updates AssistTask/Page/Redis state.
// Run from the production apps/server directory with its env files loaded.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const Module = require('node:module');
const crypto = require('node:crypto');
const serverRoot = process.env.AGENTWIKI_PROBE_SERVER_ROOT || process.cwd();
const localRequire = Module.createRequire(path.resolve(serverRoot, 'diagnostic-probe.cjs'));

const taskId = process.argv[2];
if (!taskId) throw new Error('usage: live-real-probe.cjs <assist-task-id>');
const privateDirectory = fs.mkdtempSync('/var/tmp/agentwiki-real-probe-');
fs.chmodSync(privateDirectory, 0o700);
const metadata = { taskId, readOnly: true, candidate: Boolean(process.env.AGENTWIKI_PROBE_SERVER_ROOT), privateDirectory, subprocesses: [], events: [], progress: [], startedAt: new Date().toISOString() };
const boundedEvent = (event) => {
  const part = event?.part || {};
  const input = part.input && typeof part.input === 'object' ? part.input : part.state?.input;
  let output;
  try { output = JSON.parse(part.state?.output); } catch {}
  return {
    type: event?.type,
    tool: typeof part.tool === 'string' ? part.tool : undefined,
    finish: event?.type === 'step_finish' ? part.reason : undefined,
    textChars: event?.type === 'text' && typeof part.text === 'string' ? part.text.length : undefined,
    toolOutputChars: typeof part.state?.output === 'string' ? part.state.output.length : undefined,
    toolStatus: part.state?.status,
    toolTruncated: part.state?.metadata?.metadata?.truncated === true,
    usage: event?.type === 'step_finish' ? part.tokens : undefined,
    input: input ? Object.fromEntries(['pageId', 'pageIds', 'offset', 'length', 'limit', 'count', 'recursive'].filter((key) => input[key] !== undefined).map((key) => [key, input[key]])) : undefined,
    output: output ? { ...Object.fromEntries(['pageId', 'offset', 'totalCharacters', 'contentLength', 'hasMore', 'nextOffset', 'total', 'complete', 'batchRead'].filter((key) => output[key] !== undefined).map((key) => [key, output[key]])), ...(Array.isArray(output.documents) ? { documents: output.documents.map(doc => ({pageId: doc.pageId, contentLength: doc.contentLength, contentChars: doc.content?.length, complete: doc.complete})) } : {}) } : undefined,
  };
};

const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const index = metadata.subprocesses.length;
  const startedAt = Date.now();
  const trace = { index, invocation: args[1].includes('models') ? 'catalog' : 'model', startedAt: new Date(startedAt).toISOString(), events: [], stdoutBytes: 0, stderrBytes: 0 };
  metadata.subprocesses.push(trace);
  const stdoutPath = path.join(privateDirectory, index + '.stdout.ndjson');
  const stderrPath = path.join(privateDirectory, index + '.stderr.log');
  fs.writeFileSync(stdoutPath, '', { mode: 0o600 });
  fs.writeFileSync(stderrPath, '', { mode: 0o600 });
  const child = originalSpawn(...args);
  const originalEnd = child.stdin.end.bind(child.stdin);
  child.stdin.end = (...endArgs) => {
    const value = endArgs[0];
    const prompt = typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString('utf8') : '';
    const bodies = global.__AGENTWIKI_PROBE_DOCUMENT_BODIES || [];
    const lines = prompt.split('\n');
    const section = lines.indexOf('## Complete directory source snapshot (untrusted source material)');
    let sourceSnapshot;
    try { if (section >= 0) sourceSnapshot = JSON.parse(lines[section + 1]); } catch {}
    const sourceDocuments = Array.isArray(sourceSnapshot?.documents) ? sourceSnapshot.documents : [];
    const documentsById = new Map(sourceDocuments.map(document => [document.pageId, document]));
    const coverage = bodies.map((body) => {
      const captured = documentsById.get(body.pageId);
      const content = captured?.content;
      return {
        pageId: body.pageId,
        chars: body.content.length,
        sha256: body.sha256,
        decodedPromptChars: typeof content === 'string' ? content.length : null,
        decodedPromptSha256: typeof content === 'string' ? crypto.createHash('sha256').update(content).digest('hex') : null,
        completeBodyInPrompt: content === body.content,
      };
    });
    trace.stdin = {
      chars: prompt.length,
      bytes: Buffer.byteLength(prompt, 'utf8'),
      sha256: crypto.createHash('sha256').update(prompt).digest('hex'),
      sourceSnapshotParsed: !!sourceSnapshot,
      sourceSnapshotDocumentCount: sourceDocuments.length,
      sourceSnapshotUniqueIds: documentsById.size,
      allSourceBodiesPresent: bodies.length > 0 && sourceDocuments.length === bodies.length
        && documentsById.size === bodies.length && coverage.every(document => document.completeBodyInPrompt),
      documentCoverage: coverage,
    };
    return originalEnd(...endArgs);
  };
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    trace.stdoutBytes += Buffer.byteLength(chunk);
    fs.appendFileSync(stdoutPath, chunk);
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { trace.events.push({ atMs: Date.now() - startedAt, ...boundedEvent(JSON.parse(line)) }); } catch {}
    }
  });
  child.stderr.on('data', (chunk) => { trace.stderrBytes += Buffer.byteLength(chunk); fs.appendFileSync(stderrPath, chunk); });
  child.on('close', (code, signal) => { trace.exitCode = code; trace.signal = signal; trace.elapsedMs = Date.now() - startedAt; });
  return child;
};

const { PrismaClient } = localRequire('@prisma/client');
const { ConfigService } = localRequire('@nestjs/config');
const { AssistSessionService } = localRequire('./dist/assist/assist-session.service');
const { AuthorizationService } = localRequire('./dist/core/authorization/authorization.service');
const { SpaceRevisionWriterService } = localRequire('./dist/core/sync/space-revision-writer.service');
const { OpencodeCliRunner } = localRequire('./dist/assist/opencode.runner');
const { OpencodeModelRouter } = localRequire('./dist/assist/opencode.router');
const { OpencodeModelCatalog } = localRequire('./dist/assist/opencode.catalog');
const { readRoutingConfig } = localRequire('./dist/assist/opencode.config');
const db = new PrismaClient();
const config = new ConfigService(process.env);

(async () => {
  const task = await db.assistTask.findUnique({ where: { id: taskId } });
  if (!task || !task.sessionId) throw new Error('session task not found');
  const sessions = new AssistSessionService(db, new AuthorizationService(db), new SpaceRevisionWriterService(db, {}), config);
  const execution = await db.$transaction((tx) => sessions.executionContext(tx, task, true), { timeout: 30000 });
  const directory = execution.context?.directory;
  global.__AGENTWIKI_PROBE_DOCUMENT_BODIES = (directory?.documents || []).map((document) => ({
    pageId: document.pageId,
    content: document.content,
    sha256: require('node:crypto').createHash('sha256').update(document.content).digest('hex'),
  }));
  metadata.input = {
    mode: task.mode,
    intentChars: task.intent.length,
    snapshotChars: typeof task.pageSnapshot?.content === 'string' ? task.pageSnapshot.content.length : 0,
    directoryDocuments: directory?.documents?.length || 0,
    directoryChars: (directory?.documents || []).reduce((n, doc) => n + (doc.content?.length || 0), 0),
    historyTurns: execution.history?.length || 0,
    historyChars: JSON.stringify(execution.history || []).length,
    decisionPromptChars: 0,
    updatePromptChars: 0,
  };
  const runner = new OpencodeCliRunner(config);
  const originalParse = runner.parse.bind(runner);
  runner.parse = (output, mode, context, contract) => {
    const events = output.split('\n').flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    metadata.events.push({ stage: contract?.stage || 'generation', events: events.map(boundedEvent) });
    return originalParse(output, mode, context, contract);
  };
  const settings = readRoutingConfig(config);
  metadata.input.decisionPromptChars = runner.buildDecisionPrompt({ ...task, ...execution }).length;
  metadata.input.updatePromptChars = runner.buildPrompt({ ...task, ...execution }, 'update').length;
  const health = { get: async () => null, recordFailure: async () => {}, recordSuccess: async () => {}, tryAcquireProbe: async () => true };
  const router = new OpencodeModelRouter(new OpencodeModelCatalog(runner, settings), runner, health, config);
  const progressAt = Date.now();
  const result = await router.run({ ...task, ...execution, leaseExpiresAtMs: progressAt + settings.totalTimeoutMs + 30_000,
    onProgress: (value) => metadata.progress.push({ atMs: Date.now() - progressAt, ...value }) });
  metadata.result = { action: result.action, summaryChars: result.summary?.length || 0, changesChars: result.changes?.length || 0, attempts: result.attempts };
  fs.writeFileSync(path.join(privateDirectory, 'result.json'), JSON.stringify(result), { mode: 0o600 });
  metadata.result.changesSha256 = require('node:crypto').createHash('sha256').update(result.changes || '').digest('hex');
  metadata.result.sourceLinks = [...new Set((result.changes || '').match(/\/pages\/[A-Za-z0-9-]+/g) || [])];
  metadata.status = 'passed';
})().catch((error) => {
  metadata.status = 'failed';
  metadata.error = { name: error?.name, code: error?.code, scope: error?.scope, message: String(error?.message || error).slice(0, 500) };
  metadata.attempts = error?.result?.attempts;
}).finally(async () => {
  metadata.elapsedMs = Date.now() - Date.parse(metadata.startedAt);
  metadata.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(metadata));
  await db.$disconnect();
});
