import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createDevSupervisor,
  prepareEnvironment,
} from './dev-runner.mjs';

class FakeChild extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this.exitCode = null;
    this.killedWith = [];
  }

  kill(signal) {
    this.killedWith.push(signal);
    return true;
  }
}

test('prepareEnvironment maps APP_SECRET to JWT_SECRET', () => {
  const env = prepareEnvironment({ APP_SECRET: 'local-secret' });

  assert.equal(env.APP_SECRET, 'local-secret');
  assert.equal(env.JWT_SECRET, 'local-secret');
});

test('prepareEnvironment preserves an explicit JWT_SECRET', () => {
  const env = prepareEnvironment({
    APP_SECRET: 'app-secret',
    JWT_SECRET: 'jwt-secret',
  });

  assert.equal(env.JWT_SECRET, 'jwt-secret');
});

test('prepareEnvironment rejects a missing application secret', () => {
  assert.throws(
    () => prepareEnvironment({}),
    /APP_SECRET or JWT_SECRET is required/,
  );
});

test('an unexpected child exit stops its siblings and preserves the failure', async () => {
  const children = [];
  const supervisor = createDevSupervisor({
    commands: [
      { name: 'api', args: ['--filter', '@agentwiki/server', 'dev:api'] },
      { name: 'worker', args: ['--filter', '@agentwiki/server', 'dev:worker'] },
      { name: 'client', args: ['--filter', '@agentwiki/client', 'dev'] },
    ],
    env: { JWT_SECRET: 'secret' },
    spawnChild(name) {
      const child = new FakeChild(name);
      children.push(child);
      return child;
    },
  });

  const completion = supervisor.start();
  children[0].emit('exit', 7, null);

  assert.equal(await completion, 7);
  assert.deepEqual(children[1].killedWith, ['SIGTERM']);
  assert.deepEqual(children[2].killedWith, ['SIGTERM']);
});

test('forwardSignal sends the received signal to every running child', async () => {
  const children = [];
  const supervisor = createDevSupervisor({
    commands: [
      { name: 'api', args: ['dev:api'] },
      { name: 'worker', args: ['dev:worker'] },
    ],
    env: { JWT_SECRET: 'secret' },
    spawnChild(name) {
      const child = new FakeChild(name);
      children.push(child);
      return child;
    },
  });

  const completion = supervisor.start();
  supervisor.forwardSignal('SIGINT');
  children.forEach((child) => child.emit('exit', 0, 'SIGINT'));

  assert.equal(await completion, 0);
  assert.deepEqual(children[0].killedWith, ['SIGINT']);
  assert.deepEqual(children[1].killedWith, ['SIGINT']);
});
