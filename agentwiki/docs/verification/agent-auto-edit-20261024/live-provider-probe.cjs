#!/usr/bin/env node
// Calls the configured provider with synthetic sources only. Candidate modules
// are loaded into this diagnostic process in memory; no deployment or DB writes.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const candidate = process.argv.includes('--candidate');
const decisionOnly = process.argv.includes('--decision-only');
const modules = candidate ? ['assist-auto-response', 'opencode-directory-readiness', 'opencode.runner'].map(name => ({
  name, source: fs.readFileSync(path.join(root, 'apps/server/dist/assist', name + '.js'), 'utf8'),
})) : [];
const program = `
require('reflect-metadata');
const Module = require('node:module');
const path = require('node:path');
const candidates = ${JSON.stringify(modules)};
const filenames = new Set(candidates.map(item => path.resolve('dist/assist', item.name + '.js')));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  const candidate = request.startsWith('.') && parent?.filename ? path.resolve(path.dirname(parent.filename), request + '.js') : undefined;
  return filenames.has(candidate) ? candidate : originalResolve.call(this, request, parent, ...args);
};
for (const item of candidates) {
  const filename = path.resolve('dist/assist', item.name + '.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  require.cache[filename] = loaded;
  loaded._compile(item.source, filename);
  loaded.loaded = true;
}
const { ConfigService } = require('@nestjs/config');
const { OpencodeCliRunner } = require('./dist/assist/opencode.runner');
const runner = new OpencodeCliRunner(new ConfigService());
const traces = [];
const parse = runner.parse.bind(runner);
runner.parse = (output, mode, directory, contract) => {
  const events = output.split('\\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  traces.push({ stage: contract?.stage || 'generation', events: events.map(event => ({
    type: event.type, tool: event.part?.tool,
    text: event.type === 'text' ? event.part?.text?.slice(0, 12000) : undefined,
    finish: event.type === 'step_finish' ? event.part?.reason : undefined,
  })) });
  return parse(output, mode, directory, contract);
};
const model = 'bailian-coding-plan/qwen3.7-plus';
const task = { mode: 'auto', intent: '根据本目录 所有测试报告，更新 bug 状态汇总表', actions: { update: true, create: true },
  pageSnapshot: { title: 'Bug 状态汇总表', content: '# Bug 状态汇总表\\n\\n暂无记录。', updatedAt: '2026-10-24T00:00:00.000Z' },
  context: { pageId: 'summary', references: [], noteIds: [], directory: { folderId: 'fixture', title: '测试报告', recursive: true,
    documents: Array.from({ length: 9 }, (_, index) => ({ pageId: 'report-' + index, title: '测试报告 ' + (index + 1),
      content: '# 测试报告\\n\\nAW-FIXTURE-' + String(index + 1).padStart(2, '0') + '：注册提示问题；已修复，人工回归通过。',
      folderId: 'fixture', updatedAt: '2026-10-24T00:00:00.000Z' })) } } };
const result = { candidate: ${candidate}, syntheticOnly: true, writesApplicationData: false, checks: [] };
async function decide(label, input, expected) {
  const value = await runner.runModel(runner.buildDecisionPrompt(input), model, 60000, undefined,
    { mode: 'auto', stage: 'decision', actions: input.actions });
  result.checks.push({ label, action: value.action, expected, passed: value.action === expected });
  if (value.action !== expected) throw new Error('unexpected_action');
  return value.action;
}
(async () => {
  const action = await decide('named current page, directory as source', task, 'update');
  if (!${decisionOnly}) {
    const value = await runner.runModel(runner.buildPrompt(task, action), model, 180000, undefined,
      { mode: 'auto', action, actions: task.actions, directory: task.context.directory });
    const seen = Array.from({ length: 9 }, (_, index) => 'AW-FIXTURE-' + String(index + 1).padStart(2, '0'))
      .filter(key => value.changes?.includes(key));
    result.checks.push({ label: 'nine reports in replacement markdown', action: value.action, sourceMarkers: seen.length,
      changesLength: value.changes?.length, passed: value.action === 'update' && seen.length === 9 });
    if (value.action !== 'update' || seen.length !== 9) throw new Error('incomplete_update');
  }
  await decide('different bound page', { ...task, pageSnapshot: { ...task.pageSnapshot, title: '其他文档' } }, 'answer');
  await decide('viewer cannot write', { ...task, actions: { update: false, create: false } }, 'answer');
  await decide('explicit chat-only output', { ...task, intent: '根据本目录所有测试报告分析 Bug 状态汇总表，只在聊天里给建议，不要修改或保存文档' }, 'answer');
  result.status = 'passed';
})().catch(error => { result.status = 'failed'; result.failure = error.code || error.message || error.name; process.exitCode = 1; })
  .finally(() => { result.traces = traces; console.log(JSON.stringify(result)); });
`;
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'root@113.249.120.24',
  'cd /root/agentwiki/apps/server && node --env-file=../../.env --env-file-if-exists=.env'],
{ input: program, encoding: 'utf8', timeout: 420000, maxBuffer: 2 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.status !== 0) process.stderr.write('Provider probe failed; see the bounded synthetic receipt.\n');
process.exitCode = result.status === 0 ? 0 : 1;
