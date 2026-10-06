import { sourceGenerationInvalidation } from './source-generation';
describe('source generation invalidation', () => {
  const before = { content: 'body', format: 'markdown', sourceId: 's', sourceVersionId: 'v', sourcePath: 'p' };
  it('preserves same values and title/path placement edits', () => {
    expect(sourceGenerationInvalidation(before, { content: 'body', title: 'new', syncPath: 'new.md' })).toEqual({});
  });
  it.each([{ content: 'changed' }, { format: 'html' }, { sourceId: null }, { sourceVersionId: 'v2' }, { sourcePath: 'q' }])('clears only actual body/format/source association changes %p', change => {
    expect(sourceGenerationInvalidation(before, change)).toEqual({ sourceGeneration: null });
  });
});
