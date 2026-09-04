import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOnboardingHarness } from './onboarding-e2e.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function pnpmInvocation(args) {
  const candidates = [
    process.env.npm_execpath,
    process.env.APPDATA && resolve(process.env.APPDATA, 'npm/node_modules/pnpm/bin/pnpm.mjs'),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (cli) return { file: process.execPath, args: [cli, ...args] };
  return { file: 'pnpm', args };
}

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function controlledLifecycle({ terminal = 'completed', cleanupStatus = 204 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.writes = [];
  child.terminated = false;
  child.kill = () => { child.terminated = true; };
  child.start = () => {
    queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'input_required', requestId: 'input', sessionId: 'wrapper-session' })}\n`)));
  };
  child.stdin = {
    write(value) {
      const reply = JSON.parse(value);
      child.writes.push(reply);
      if (reply.values) {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'authorization_required', userCode: 'WRAPPER-CODE', sessionId: 'wrapper-session' })}\n`)));
      } else if (reply.confirmed) {
        const event = terminal === 'completed'
          ? { type: 'completed', sessionId: 'wrapper-session', report: { space: { id: 'space-wrapper' }, agent: { id: 'agent-wrapper' }, revisionId: 'revision-wrapper', connectionId: 'connection-wrapper', manifestHash: 'manifest-wrapper' } }
          : { type: 'failed', sessionId: 'wrapper-session', code: 'SYNC_FAILED', message: 'primary wrapper failure' };
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`)));
      }
      return true;
    },
  };
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/auth/register')) return response(201, { access_token: 'awo_wrapper_controlled_token', user: { id: 'user-wrapper' } });
    if (String(url).endsWith('/onboard/device/decision')) {
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'confirmation_required', requestId: 'sync', planHash: 'wrapper-plan-hash', sessionId: 'wrapper-session' })}\n`)));
      return response(200);
    }
    if (options.method === 'DELETE') return response(cleanupStatus);
    throw new Error(`unexpected controlled request: ${url}`);
  };
  return { child, fetchImpl, requests };
}

describe('onboarding E2E harness safety', () => {
  test('requires AGENTWIKI_E2E=1', async () => {
    await assert.rejects(
      runOnboardingHarness({ target: 'http://localhost:3000/api', env: {} }),
      /requires AGENTWIKI_E2E=1/,
    );
  });

  test('requires --target', async () => {
    await assert.rejects(
      runOnboardingHarness({ target: undefined, env: { AGENTWIKI_E2E: '1' } }),
      /--target/,
    );
  });

  test('rejects remote without ALLOW_REMOTE', async () => {
    await assert.rejects(
      runOnboardingHarness({ target: 'https://example.test/api', env: { AGENTWIKI_E2E: '1' } }),
      /ALLOW_REMOTE/,
    );
  });

  test('rejects non-HTTPS remote', async () => {
    await assert.rejects(
      runOnboardingHarness({
        target: 'http://example.test/api',
        env: { AGENTWIKI_E2E: '1', AGENTWIKI_E2E_ALLOW_REMOTE: '1', AGENTWIKI_E2E_CONFIRM_HOST: 'example.test' },
      }),
      /HTTPS/,
    );
  });
});

describe('onboarding E2E runtime', () => {
  test('runs the wrapper success lifecycle in an isolated home and cleans every controlled resource', async () => {
    const lifecycle = controlledLifecycle();
    let spawnContext;
    const result = await runOnboardingHarness({
      target: 'http://localhost:3000/api',
      clientType: 'opencode',
      env: { AGENTWIKI_E2E: '1' },
      spawnImpl: (context) => { spawnContext = context; lifecycle.child.start(); return lifecycle.child; },
      fetchImpl: lifecycle.fetchImpl,
    });

    assert.equal(result.sessionId, 'wrapper-session');
    assert.equal(spawnContext.clientType, 'opencode');
    assert.equal(spawnContext.home, result.home);
    assert.equal(lifecycle.child.writes[0].values.clientType, 'opencode');
    assert.equal(lifecycle.child.writes[0].values.analysisMode, 'standard');
    assert.equal(lifecycle.child.writes[0].values.sourceType, 'documents');
    assert.deepEqual(lifecycle.child.writes[1], { requestId: 'sync', confirmed: true, planHash: 'wrapper-plan-hash' });
    assert.equal(lifecycle.child.terminated, true);
    assert.deepEqual(lifecycle.requests.filter((item) => item.options.method === 'DELETE').map((item) => item.url.split('/').slice(-2).join('/')), [
      'agents/agent-wrapper', 'spaces/space-wrapper', 'users/user-wrapper',
    ]);
    await assert.rejects(access(result.home));
  });

  test('preserves a primary protocol failure when controlled cleanup also fails', async () => {
    const lifecycle = controlledLifecycle({ terminal: 'failed', cleanupStatus: 500 });
    await assert.rejects(runOnboardingHarness({
      target: 'http://localhost:3000/api', clientType: 'claude', env: { AGENTWIKI_E2E: '1' },
      spawnImpl: () => { lifecycle.child.start(); return lifecycle.child; }, fetchImpl: lifecycle.fetchImpl,
    }), /primary wrapper failure/);
    assert.equal(lifecycle.child.terminated, true);
  });

  test('propagates controlled cleanup failure after an otherwise successful lifecycle', async () => {
    const lifecycle = controlledLifecycle({ cleanupStatus: 500 });
    await assert.rejects(runOnboardingHarness({
      target: 'http://localhost:3000/api', clientType: 'codex', env: { AGENTWIKI_E2E: '1' },
      spawnImpl: () => { lifecycle.child.start(); return lifecycle.child; }, fetchImpl: lifecycle.fetchImpl,
    }), /Cleanup failed for agent, space, user/);
    assert.equal(lifecycle.child.terminated, true);
  });

  test('runs the real coordinator state-machine cases for isolated Codex, Claude Code, and OpenCode homes', { timeout: 30_000 }, () => {
    const command = pnpmInvocation([
      '--filter', '@neomei/agentwiki-local-sync', 'exec', 'vitest', 'run', 'src/onboarding/onboarding-e2e-driver.spec.ts',
    ]);
    const result = spawnSync(command.file, command.args, { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
