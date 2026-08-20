import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom does not implement these Range layout APIs, while CodeMirror calls
// them during editor measurement. A stable empty geometry is sufficient for
// component tests and keeps expected editor renders from polluting stderr.
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [] as unknown as DOMRectList,
  });
}

if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
}

afterEach(() => {
  cleanup();
});
