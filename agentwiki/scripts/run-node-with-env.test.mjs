import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnvironmentAssignment, runNodeWithEnv } from './run-node-with-env.mjs';

test('parses a portable environment assignment without truncating equals signs', () => {
  assert.deepEqual(parseEnvironmentAssignment('TOKEN=a=b'), { name: 'TOKEN', value: 'a=b' });
  assert.throws(() => parseEnvironmentAssignment('NOT-VALID=value'), /NAME=value/u);
});

test('launches Node directly with the requested environment on every platform', () => {
  let invocation;
  const status = runNodeWithEnv(['FEATURE=enabled', '--test', 'example.test.mjs'], (...args) => {
    invocation = args;
    return { status: 0 };
  });

  assert.equal(status, 0);
  assert.equal(invocation[0], process.execPath);
  assert.deepEqual(invocation[1], ['--test', 'example.test.mjs']);
  assert.equal(invocation[2].env.FEATURE, 'enabled');
  assert.equal(invocation[2].stdio, 'inherit');
  assert.equal(invocation[2].windowsHide, true);
});
