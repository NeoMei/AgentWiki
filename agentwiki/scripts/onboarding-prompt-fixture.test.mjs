import { spawn } from 'node:child_process';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureFile = resolve(repositoryRoot, 'scripts/onboarding-prompt-fixture.mjs');

function runFixture({
  invalidConfirmation = false,
  prematurePlanConfirmation = false,
  startupDelayMs,
  authorizationDelayMs,
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [fixtureFile];
    if (startupDelayMs !== undefined) args.push('--startup-delay-ms', String(startupDelayMs));
    if (authorizationDelayMs !== undefined) args.push('--authorization-delay-ms', String(authorizationDelayMs));
    const startedAt = Date.now();
    let firstEventDelayMs;
    let authorizationReceivedAt;
    let firstPostAuthorizationEventDelayMs;
    const child = spawn(process.execPath, args, {
      cwd: repositoryRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const events = [];
    let stdout = '';
    let stderr = '';

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        firstEventDelayMs ??= Date.now() - startedAt;
        if (event.type === 'authorization_required') {
          authorizationReceivedAt = Date.now();
          if (prematurePlanConfirmation) {
            child.stdin.write(`${JSON.stringify({
              requestId: 'plan-1',
              confirmed: true,
              planHash: 'plan-hash-1',
            })}\n`);
          }
        }
        else if (authorizationReceivedAt !== undefined && firstPostAuthorizationEventDelayMs === undefined) {
          firstPostAuthorizationEventDelayMs = Date.now() - authorizationReceivedAt;
        }
        events.push(event);
        if (event.type === 'input_required') {
          child.stdin.write(`${JSON.stringify({
            requestId: event.requestId,
            values: {
              sourcePaths: ['/tmp/prompt-fixture-source'],
              role: 'editor',
            },
          })}\n`);
        } else if (event.type === 'confirmation_required') {
          const reply = invalidConfirmation
            ? { requestId: event.requestId, approved: true }
            : { requestId: event.requestId, confirmed: true, planHash: event.planHash };
          child.stdin.write(`${JSON.stringify(reply)}\n`);
        }
      }
    });
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error('onboarding prompt fixture timed out after 10000ms'));
    }, 10_000);
    child.once('error', (error) => {
      clearTimeout(watchdog);
      rejectPromise(error);
    });
    child.once('close', (code) => {
      clearTimeout(watchdog);
      if (stderr) rejectPromise(new Error(stderr));
      else resolvePromise({ code, events, firstEventDelayMs, firstPostAuthorizationEventDelayMs });
    });
  });
}

describe('onboarding prompt consumer fixture', () => {
  test('reaches completed only with the documented input and confirmation shapes', async () => {
    const result = await runFixture({ startupDelayMs: 0, authorizationDelayMs: 0 });
    assert.equal(result.code, 0);
    assert.deepEqual(result.events.map((event) => event.type), [
      'input_required',
      'authorization_required',
      'heartbeat',
      'preview',
      'confirmation_required',
      'preview',
      'confirmation_required',
      'completed',
    ]);
    assert.equal(result.events.at(-1)?.report?.connectionId, 'prompt-fixture-connection');
  });

  test('rejects an Agent-invented approved confirmation field', async () => {
    const result = await runFixture({ invalidConfirmation: true, startupDelayMs: 0, authorizationDelayMs: 0 });
    assert.equal(result.code, 1);
    assert.equal(result.events.at(-1)?.type, 'failed');
    assert.equal(result.events.at(-1)?.code, 'BAD_DRIVER_REPLY');
  });

  test('rejects plan confirmation before the confirmation request is emitted', async () => {
    const result = await runFixture({
      prematurePlanConfirmation: true,
      startupDelayMs: 0,
      authorizationDelayMs: 1_000,
    });
    assert.equal(result.code, 1);
    assert.equal(result.events.at(-1)?.type, 'failed');
    assert.equal(result.events.at(-1)?.code, 'BAD_DRIVER_REPLY');
  });

  test('delays startup and browser authorization so an Agent must keep polling one process session', async () => {
    const result = await runFixture();
    assert.ok(result.firstEventDelayMs >= 1_000, `first event arrived after only ${result.firstEventDelayMs}ms`);
    assert.ok(
      result.firstPostAuthorizationEventDelayMs >= 1_000,
      `post-authorization event arrived after only ${result.firstPostAuthorizationEventDelayMs}ms`,
    );
    assert.equal(result.events.at(-1)?.type, 'completed');
  });
});
