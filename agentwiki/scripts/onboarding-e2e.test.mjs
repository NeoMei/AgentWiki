import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runOnboardingHarness } from './onboarding-e2e.mjs';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdin = { write() {} };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  return child;
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

describe('onboarding E2E harness protocol', () => {
  test('drives NDJSON and asserts completion criteria', async () => {
    const child = makeFakeChild();
    const spawnImpl = () => {
      // Simulate the CLI emitting events then completing.
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'input_required', requestId: 'r1', seq: 1,
          protocolVersion: 1, sessionId: 'sess-test', timestamp: new Date().toISOString(),
          fields: [],
        }) + '\n'));
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'completed', seq: 2,
            protocolVersion: 1, sessionId: 'sess-test', timestamp: new Date().toISOString(),
            report: { space: { id: 's1', name: 'test' }, agent: { id: 'a1', name: 'test' }, agentReload: false },
          }) + '\n'));
        }, 50);
      }, 50);
      return child;
    };

    const result = await runOnboardingHarness({
      target: 'http://localhost:3000/api',
      env: { AGENTWIKI_E2E: '1' },
      spawnImpl,
    });

    assert.equal(result.sessionId, 'sess-test');
    assert.equal(result.report.space.id, 's1');
    assert.equal(result.report.agent.id, 'a1');
  });

  test('rejects a failed event', async () => {
    const child = makeFakeChild();
    const spawnImpl = () => {
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'failed', seq: 1, code: 'AUTH_DENIED', message: 'denied', retryable: false,
          protocolVersion: 1, sessionId: 'sess-fail', timestamp: new Date().toISOString(),
        }) + '\n'));
      }, 50);
      return child;
    };

    await assert.rejects(
      runOnboardingHarness({
        target: 'http://localhost:3000/api',
        env: { AGENTWIKI_E2E: '1' },
        spawnImpl,
      }),
      /AUTH_DENIED/,
    );
  });

  test('rejects a report missing resource IDs', async () => {
    const child = makeFakeChild();
    const spawnImpl = () => {
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'completed', seq: 1,
          protocolVersion: 1, sessionId: 'sess-x', timestamp: new Date().toISOString(),
          report: { space: {}, agent: {} },
        }) + '\n'));
      }, 50);
      return child;
    };

    await assert.rejects(
      runOnboardingHarness({
        target: 'http://localhost:3000/api',
        env: { AGENTWIKI_E2E: '1' },
        spawnImpl,
      }),
      /missing space ID/,
    );
  });
});
