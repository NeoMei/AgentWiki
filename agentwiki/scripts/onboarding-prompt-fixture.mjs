#!/usr/bin/env node
/** Offline NDJSON fixture for pressure-testing the copied Agent onboarding prompt. */
import readline from 'node:readline';

const sessionId = `prompt-fixture-${process.pid}`;
let sequence = 0;
let state = 'input';
const delayFlagIndex = process.argv.indexOf('--startup-delay-ms');
const startupDelayMs = delayFlagIndex >= 0 ? Number(process.argv[delayFlagIndex + 1]) : 1_500;
const authorizationDelayFlagIndex = process.argv.indexOf('--authorization-delay-ms');
const authorizationDelayMs = authorizationDelayFlagIndex >= 0
  ? Number(process.argv[authorizationDelayFlagIndex + 1])
  : 1_500;
if (
  !Number.isInteger(startupDelayMs)
  || startupDelayMs < 0
  || startupDelayMs > 300_000
  || !Number.isInteger(authorizationDelayMs)
  || authorizationDelayMs < 0
  || authorizationDelayMs > 300_000
) {
  throw new Error('startup and authorization delays must be integers from 0 to 300000');
}

const emit = (event, onFlushed) => process.stdout.write(`${JSON.stringify({
  ...event,
  protocolVersion: 1,
  sessionId,
  timestamp: new Date().toISOString(),
  seq: ++sequence,
})}\n`, onFlushed);

const fail = (message) => {
  emit({
    type: 'failed',
    code: 'BAD_DRIVER_REPLY',
    message,
    retryable: false,
    resumeSessionId: sessionId,
    nextAction: 'Restart the offline fixture and preserve every event field named by the prompt.',
  }, () => process.exit(1));
  input.close();
};

const hasExactKeys = (value, keys) => value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

setTimeout(() => emit({
  type: 'input_required',
  requestId: 'input-1',
  fields: [
    {
      name: 'sourcePaths',
      label: 'Source paths',
      type: 'paths',
      required: true,
      help: 'Use a string array even when there is only one path.',
    },
    {
      name: 'role',
      label: 'Access role',
      type: 'choice',
      required: true,
      choices: ['reader', 'editor', 'publisher'],
      defaultValue: 'editor',
    },
  ],
}), startupDelayMs);

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  let reply;
  try {
    reply = JSON.parse(line);
  } catch {
    fail('stdin must contain exactly one JSON object per line');
    return;
  }

  if (state === 'input') {
    const validValues = hasExactKeys(reply, ['requestId', 'values'])
      && reply.requestId === 'input-1'
      && hasExactKeys(reply.values, ['sourcePaths', 'role'])
      && Array.isArray(reply.values.sourcePaths)
      && reply.values.sourcePaths.length > 0
      && reply.values.sourcePaths.every((path) => typeof path === 'string' && path.length > 0)
      && ['reader', 'editor', 'publisher'].includes(reply.values.role);
    if (!validValues) {
      fail('input reply must preserve requestId, field names, declared field types, and no extra keys');
      return;
    }
    state = 'authorization';
    emit({
      type: 'authorization_required',
      requestId: 'authorization-1',
      url: 'https://example.test/onboard/device?user_code=TEST-CODE',
      userCode: 'TEST-CODE',
      expiresInSeconds: 600,
    });
    // Keep a small cushion above the one-second behavioral contract. Node timers
    // and millisecond timestamp rounding may otherwise make a nominal 1000ms
    // delay observable as 998-999ms across the child-process boundary.
    const heartbeatDelayMs = Math.min(1_100, authorizationDelayMs);
    setTimeout(() => emit({ type: 'heartbeat', step: 'authorization' }), heartbeatDelayMs);
    setTimeout(() => {
      state = 'plan';
      emit({
        type: 'preview',
        plan: {
          sourcePaths: reply.values.sourcePaths,
          role: reply.values.role,
        },
      });
      emit({ type: 'confirmation_required', requestId: 'plan-1', planHash: 'plan-hash-1' });
    }, authorizationDelayMs);
    return;
  }

  if (state === 'authorization') {
    fail('the fixture received stdin before the plan confirmation request was emitted');
    return;
  }

  if (state === 'plan') {
    const validConfirmation = hasExactKeys(reply, ['requestId', 'confirmed', 'planHash'])
      && reply.requestId === 'plan-1'
      && reply.confirmed === true
      && reply.planHash === 'plan-hash-1';
    if (!validConfirmation) {
      fail('plan confirmation must preserve requestId, confirmed, planHash, and no extra keys');
      return;
    }
    state = 'sync';
    emit({ type: 'preview', plan: { filesProcessed: 1, added: 1, modified: 0, deleted: 0 } });
    emit({ type: 'confirmation_required', requestId: 'sync-1', planHash: 'sync-hash-1' });
    return;
  }

  if (state === 'sync') {
    const validConfirmation = hasExactKeys(reply, ['requestId', 'confirmed', 'planHash'])
      && reply.requestId === 'sync-1'
      && reply.confirmed === true
      && reply.planHash === 'sync-hash-1';
    if (!validConfirmation) {
      fail('sync confirmation must preserve requestId, confirmed, planHash, and no extra keys');
      return;
    }
    state = 'done';
    emit({
      type: 'completed',
      report: {
        space: { id: 'prompt-fixture-space', name: 'Prompt fixture Space' },
        agent: { id: 'prompt-fixture-agent', name: 'Prompt fixture Agent' },
        role: 'editor',
        connectionId: 'prompt-fixture-connection',
        manifestHash: 'prompt-fixture-manifest',
      },
    }, () => process.exit(0));
    input.close();
    return;
  }

  fail('the fixture received stdin after a terminal event');
});
