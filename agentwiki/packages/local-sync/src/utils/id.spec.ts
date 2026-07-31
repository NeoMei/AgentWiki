import { describe, expect, it } from 'vitest';
import { artifactId, memoryId, pageId, relationId, stableId } from './id.js';

describe('stable id', () => {
  it('is stable for same input', () => {
    const a = stableId('ns', 'key');
    const b = stableId('ns', 'key');
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it('differs for different namespaces', () => {
    const a = stableId('ns1', 'key');
    const b = stableId('ns2', 'key');
    expect(a).not.toBe(b);
  });

  it('differs for different keys', () => {
    const a = stableId('ns', 'key1');
    const b = stableId('ns', 'key2');
    expect(a).not.toBe(b);
  });

  it('produces stable artifact, page, memory, and relation ids', () => {
    const a = artifactId('markitdown', 'space-1', 'docs/readme.md');
    const b = artifactId('markitdown', 'space-1', 'docs/readme.md');
    expect(a).toBe(b);

    const p = pageId('space-1', 'getting-started');
    expect(p).toBe(pageId('space-1', 'getting-started'));
    expect(p).not.toBe(pageId('space-1', 'other'));

    const m = memoryId('space-1', 'team-color');
    expect(m).toBe(memoryId('space-1', 'team-color'));

    const r = relationId('space-1', p, m, 'references');
    expect(r).toBe(relationId('space-1', p, m, 'references'));
    expect(r).not.toBe(relationId('space-1', p, m, 'depends-on'));
  });
});
