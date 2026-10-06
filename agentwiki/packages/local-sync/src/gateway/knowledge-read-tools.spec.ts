import { describe, expect, it } from 'vitest';
import { knowledgeReadToolDefinition } from './knowledge-read-tools.js';

describe('knowledge read normalization', () => {
  it('merges split named and legacy read fields without changing the caller input', () => {
    const input = { spaceId: 'space-a', limit: 5, __args: { query: '保存', spaceId: 'space-a' } };
    const before = structuredClone(input);
    expect(knowledgeReadToolDefinition('search_pages')!.normalize(input))
      .toEqual({ spaceId: 'space-a', query: '保存', limit: 5 });
    expect(input).toEqual(before);
  });

  it('requires the merged query and page ID, including legacy-only callers', () => {
    for (const name of ['search_pages', 'get_page']) {
      const definition = knowledgeReadToolDefinition(name)!;
      expect(() => definition.normalize({ spaceId: 'space-a' })).toThrow();
      expect(() => definition.normalize({ __args: { spaceId: 'space-a' } })).toThrow();
    }
  });

  it.each([null, [], 'input', { __args: null }, { __args: [] }])('rejects malformed input %j', (input) => {
    expect(() => knowledgeReadToolDefinition('list_pages')!.normalize(input)).toThrow();
  });

  it('leaves default pagination and implicit Space policy to the existing bridge and upstream', () => {
    expect(knowledgeReadToolDefinition('list_spaces')!.normalize({})).toEqual({});
    expect(knowledgeReadToolDefinition('list_pages')!.normalize({ spaceId: 'space-a' })).toEqual({ spaceId: 'space-a' });
    expect(knowledgeReadToolDefinition('get_page')!.normalize({ __args: { pageId: 'page-1' } })).toEqual({ pageId: 'page-1' });
    expect(knowledgeReadToolDefinition('search_pages')!.normalize({ query: ' alias ' })).toEqual({ query: ' alias ' });
  });

  it.each(['propose_page', 'collaboration_get_run', 'toString', '__proto__', 'wiki_get_page'])('does not replace the %s contract', (name) => {
    expect(knowledgeReadToolDefinition(name)).toBeUndefined();
  });
});
