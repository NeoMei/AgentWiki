import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const nodeGlobals = Object.fromEntries([
  'process', 'console', 'Buffer', 'URL', 'URLSearchParams', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'AbortController', 'AbortSignal', 'fetch', 'Response', 'Request', 'Headers',
  'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone', 'performance', 'global',
  '__dirname', '__filename', 'module', 'require', 'exports',
].map((name) => [name, 'readonly']));

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts', '**/*.config.js', '**/*.config.mjs', '**/*.config.cjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', '**/*.spec.{ts,mts,mjs}'],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
  {
    files: ['apps/{server,client}/src/**/*.{ts,tsx}'],
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['apps/client/src/**/*.{jsx,tsx}'],
    ignores: ['apps/client/src/components/NativeSelect.tsx', '**/*.{spec,test}.{jsx,tsx}', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': ['error', {
        selector: 'JSXOpeningElement[name.type="JSXIdentifier"][name.name="select"]',
        message: 'Use NativeSelect from components/NativeSelect so every dropdown follows the shared visual style.',
      }],
    },
  },
);
