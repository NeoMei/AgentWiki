#!/usr/bin/env node
'use strict';

// Explicitly invoked production smoke only. This uses the deployed Router/CLI
// with synthetic documents; it never instantiates the app, database or Redis.
// The CLI's existing sandbox owns its temporary provider configuration/files.
// Run after deployment: /usr/bin/node live-model-smoke.cjs --run
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { parseEnv } = require('node:util');
const { performance } = require('node:perf_hooks');

const ROOT = '/root/agentwiki';
const EXPECTED_VERSION = '0.12.62';
const MODES = ['question', 'proposal', 'auto'];
const FAILURE_CODES = new Set([
  'auth_failed', 'binary_unavailable', 'budget_exhausted', 'cancelled',
  'configuration_error', 'invalid_output', 'model_unavailable', 'no_models',
  'output_limit', 'process_error', 'rate_limited', 'timeout',
]);
const USAGE_KEYS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total'];
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const hash = (value) => typeof value === 'string'
  ? createHash('sha256').update(value, 'utf8').digest('hex') : null;
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const usage = (value) => Object.fromEntries(USAGE_KEYS.map((key) => [key, number(value?.[key])]));
const code = (value) => FAILURE_CODES.has(value) ? value : 'process_error';
const metadata = (value) => ({
  modelSha256: hash(value?.model),
  modelTier: ['free', 'paid'].includes(value?.modelTier) ? value.modelTier : null,
  attemptCount: number(value?.attemptCount),
  usage: usage(value?.usage),
  cost: number(value?.cost),
  attempts: Array.isArray(value?.attempts) ? value.attempts.slice(0, 4).map((attempt) => ({
    modelSha256: hash(attempt?.model),
    tier: ['free', 'paid'].includes(attempt?.tier) ? attempt.tier : null,
    status: ['succeeded', 'failed'].includes(attempt?.status) ? attempt.status : null,
    durationMs: number(attempt?.durationMs),
    ...(attempt?.errorCode === undefined ? {} : { errorCode: code(attempt.errorCode) }),
    usage: usage(attempt?.usage), cost: number(attempt?.cost),
  })) : [],
});

function memoryHealth(config) {
  const records = new Map(), probes = new Set();
  return {
    get: async (model) => records.get(model) ?? null,
    recordSuccess: async (model) => { records.delete(model); probes.delete(model); },
    recordFailure: async (model, failure, at = Date.now()) => {
      const previous = records.get(model);
      const failures = previous && at - previous.lastAt < config.circuitWindowMs ? previous.failures + 1 : 1;
      const opens = ['auth_failed', 'model_unavailable', 'rate_limited'].includes(failure)
        || failures >= config.circuitFailures;
      records.set(model, { failures, lastAt: at, openUntil: opens ? at + config.circuitOpenMs : null });
    },
    tryAcquireProbe: async (model) => {
      if (probes.has(model)) return false;
      probes.add(model); return true;
    },
  };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') throw new Error('execution_not_enabled');
  if (JSON.parse(fs.readFileSync(`${ROOT}/apps/server/package.json`, 'utf8')).version !== EXPECTED_VERSION) {
    throw new Error('unexpected_release');
  }
  const configured = {
    ...parseEnv(fs.readFileSync(`${ROOT}/.env`, 'utf8')),
    ...parseEnv(fs.readFileSync(`${ROOT}/apps/server/.env`, 'utf8')),
  };
  // Only provider/proxy variables required by the runner's own llmEnv cross
  // into process.env. Database/Redis URLs remain inert values in this process.
  for (const key of [
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'DEEPSEEK_API_KEY',
    'KIMI_API_KEY', 'GLM_API_KEY', 'QWEN_API_KEY', 'HTTP_PROXY', 'HTTPS_PROXY',
    'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  ]) if (Object.hasOwn(configured, key)) process.env[key] = configured[key];
  const config = { get: (key) => Object.hasOwn(configured, key) ? configured[key] : process.env[key] };
  const serverRequire = createRequire(`${ROOT}/apps/server/package.json`);
  serverRequire('reflect-metadata');
  serverRequire('@nestjs/common').Logger.overrideLogger(false);
  const { readRoutingConfig } = serverRequire('./dist/assist/opencode.config.js');
  const { OpencodeCliRunner } = serverRequire('./dist/assist/opencode.runner.js');
  const { OpencodeModelCatalog } = serverRequire('./dist/assist/opencode.catalog.js');
  const { OpencodeModelRouter } = serverRequire('./dist/assist/opencode.router.js');
  const routing = readRoutingConfig(config);
  const runner = new OpencodeCliRunner(config);
  const catalog = new OpencodeModelCatalog(runner, routing);
  const router = new OpencodeModelRouter(catalog, runner, memoryHealth(routing), config);
  router.onModuleInit();

  const started = performance.now();
  const totalBudgetMs = routing.totalTimeoutMs * MODES.length;
  const overallDeadline = started + totalBudgetMs;
  const receipts = [];
  let currentAbort, interrupted = false;
  const stop = () => { interrupted = true; currentAbort?.abort(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const overallTimer = setTimeout(stop, totalBudgetMs);
  try {
    for (const mode of MODES) {
      const began = performance.now();
      const budget = Math.min(routing.totalTimeoutMs, overallDeadline - began);
      // Router reserves 5 seconds from the supplied lease deadline. Keeping
      // that reserve also leaves time for the CLI's bounded termination grace.
      if (interrupted || budget <= 5_000) {
        const receipt = { mode, status: 'failed', code: interrupted ? 'cancelled' : 'budget_exhausted', durationMs: 0 };
        receipts.push(receipt); emit(receipt); continue;
      }
      const nonce = `校验-${randomUUID()}-😀`;
      const source = `# 发布验收\n\n校验词：${nonce}\n状态：待处理\n备注：保留这行中文与😀。\n`;
      const expected = source.replace('状态：待处理', '状态：已处理');
      const updatedAt = new Date().toISOString();
      const snapshot = { title: '发布验收', content: source, updatedAt,
        assistTarget: { kind: 'document', from: 0, to: source.length, quote: source, prefix: '', suffix: '', baseUpdatedAt: updatedAt } };
      const controller = new AbortController(); currentAbort = controller;
      const timer = setTimeout(() => controller.abort(), budget);
      try {
        const result = await router.run({
          mode, actions: { update: false, create: false }, pageSnapshot: snapshot,
          context: { pageId: randomUUID(), references: [], noteIds: [] }, history: [],
          intent: mode === 'proposal'
            ? '请把文档状态行的“待处理”替换成“已处理”，返回完整文档，其余内容逐字保留。summary 请只写文档中的完整校验词，不加解释或标点。'
            : '请只回答文档中的完整校验词，逐字返回，不加解释或标点；不要修改或保存文档。',
          signal: controller.signal,
          leaseExpiresAtMs: Date.now() + budget,
          isActive: async () => !interrupted && !controller.signal.aborted && performance.now() < overallDeadline,
        });
        const assertions = {
          summaryNonEmpty: typeof result.summary === 'string' && result.summary.trim().length > 0,
          noReplacementCharacter: !String(result.summary ?? '').includes('\uFFFD') && !String(result.changes ?? '').includes('\uFFFD'),
          ...(mode === 'proposal' ? {
            changesContainNonce: typeof result.changes === 'string' && result.changes.includes(nonce),
            expectedState: typeof result.changes === 'string' && result.changes.includes('状态：已处理') && !result.changes.includes('待处理'),
            // Ignore final newline presence only; all internal bytes must match.
            unchangedTextPreservedIgnoringFinalNewlines: typeof result.changes === 'string'
              && result.changes.replace(/(?:\r?\n)+$/u, '') === expected.replace(/(?:\r?\n)+$/u, ''),
          } : {
            summaryContainsNonce: typeof result.summary === 'string' && result.summary.includes(nonce),
            summaryContainsEmoji: typeof result.summary === 'string' && result.summary.includes('😀'),
            noChanges: result.changes === undefined,
            ...(mode === 'auto' ? { answerAction: result.action === 'answer', noTitle: result.title === undefined } : {}),
          }),
        };
        const passed = Object.values(assertions).every(Boolean);
        const receipt = { mode, status: passed ? 'passed' : 'failed',
          ...(passed ? {} : { code: 'acceptance_failed' }), durationMs: Math.round(performance.now() - began),
          sourceSha256: hash(source), summarySha256: hash(result.summary), changesSha256: hash(result.changes),
          assertions, ...metadata(result) };
        receipts.push(receipt); emit(receipt);
      } catch (error) {
        const finalAttempt = Array.isArray(error?.result?.attempts) ? error.result.attempts.at(-1) : undefined;
        const receipt = { mode, status: 'failed', code: code(error?.code ?? finalAttempt?.errorCode),
          durationMs: Math.round(performance.now() - began), sourceSha256: hash(source), ...metadata(error?.result ?? error) };
        receipts.push(receipt); emit(receipt);
      } finally { clearTimeout(timer); currentAbort = undefined; }
    }
  } finally {
    clearTimeout(overallTimer);
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
  const durationMs = Math.round(performance.now() - started);
  const passed = receipts.length === MODES.length && receipts.every((receipt) => receipt.status === 'passed') && durationMs <= totalBudgetMs;
  emit({ status: passed ? 'passed' : 'failed', durationMs, totalBudgetMs,
    assertions: { allModesPassed: receipts.every((receipt) => receipt.status === 'passed'), withinConfiguredBudget: durationMs <= totalBudgetMs } });
  process.exitCode = passed ? 0 : 1;
}

main().catch(() => {
  // Never emit Error.message, stack, provider output, env values or source text.
  emit({ status: 'failed', code: 'configuration_error' });
  process.exitCode = 1;
});
