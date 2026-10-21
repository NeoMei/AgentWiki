import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root });

async function lint(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath: resolve(root, filePath) });
  return result;
}

test('product JSX cannot introduce an unstyled native select', async () => {
  const result = await lint(
    'export const Filter = () => <select aria-label="Status"><option>Open</option></select>;',
    'apps/client/src/features/select-lint-fixture/Filter.tsx',
  );
  assert.equal(result.errorCount, 1);
  assert.equal(result.messages[0].ruleId, 'no-restricted-syntax');
  assert.match(result.messages[0].message, /NativeSelect/u);
});

test('product JSX can consume the shared NativeSelect', async () => {
  const result = await lint(
    'import { NativeSelect } from "../../components/NativeSelect"; export const Filter = () => <NativeSelect aria-label="Status"><option>Open</option></NativeSelect>;',
    'apps/client/src/features/select-lint-fixture/Filter.tsx',
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});

for (const filePath of [
  'apps/client/src/components/NativeSelect.tsx',
  'apps/client/src/features/select-lint-fixture/Filter.spec.tsx',
  'apps/client/src/features/select-lint-fixture/Filter.test.tsx',
]) {
  test(`native select is allowed in the shared implementation and test fixtures: ${filePath}`, async () => {
    const result = await lint('export const Fixture = () => <select><option>Open</option></select>;', filePath);
    assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
  });
}
