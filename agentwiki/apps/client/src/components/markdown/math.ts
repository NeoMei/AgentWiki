import type { KatexOptions } from 'katex';

export const KATEX_OPTIONS: KatexOptions = Object.freeze({
  trust: false,
  strict: 'warn',
  throwOnError: false,
  maxSize: 20,
  maxExpand: 1000,
  output: 'htmlAndMathml',
  globalGroup: false,
});
