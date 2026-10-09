import { describe, expect, it } from 'vitest';
import { diffLines } from './lineDiff';

describe('bounded Markdown line diff', () => {
  it('shows unchanged, removed and added literal source including final newlines', () => {
    expect(diffLines('# 中文\nold\n', '# 中文\nnew\n')).toEqual({ truncated: false, lines: [
      { kind: 'unchanged', text: '# 中文' }, { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' }, { kind: 'unchanged', text: '' },
    ] });
  });
  it('distinguishes an empty document from adding a line', () => {
    expect(diffLines('', 'line').lines).toEqual([{ kind: 'added', text: 'line' }]);
    expect(diffLines('line', '').lines).toEqual([{ kind: 'removed', text: 'line' }]);
  });
  it('bounds large input processing and honestly reports the incomplete preview', () => {
    const result = diffLines('a\n'.repeat(100_000), 'b\n'.repeat(100_000));
    expect(result.truncated).toBe(true);
    expect(result.lines.length).toBeLessThanOrEqual(600);
  });
  it('does not truncate normal long lines or execute Markdown/HTML', () => {
    const line = '<script>literal</script>' + 'x'.repeat(10_000);
    expect(diffLines('before', line).lines.slice(-1)[0]).toEqual({ kind: 'added', text: line });
  });
});
