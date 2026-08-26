import { describe, expect, it } from 'vitest';
import { collectMarkdownTasks, rebaseMarkdownTask, toggleMarkdownTask } from './tasks';

describe('Markdown task source transforms', () => {
  it('collects nested and quoted tasks but ignores code', () => {
    const source = '- [ ] root\n  - [x] nested\n> - [ ] quoted\n\n```md\n- [ ] code\n```';
    expect(collectMarkdownTasks(source).map((task) => task.checked)).toEqual([false, true, false]);
  });

  it('changes only the selected marker byte', () => {
    const source = '- [ ] first\r\n- [X] second\r\n';
    const task = collectMarkdownTasks(source)[1];
    expect(toggleMarkdownTask(source, task, false)).toBe('- [ ] first\r\n- [ ] second\r\n');
  });

  it('refuses a stale source span and safely rebases a unique task', () => {
    const original = '- [ ] alpha\n- [ ] beta';
    const reference = collectMarkdownTasks(original)[1];
    const latest = '# inserted\n\n- [ ] alpha\n- [ ] beta';
    expect(toggleMarkdownTask(latest, reference, true)).toBeNull();
    const rebased = rebaseMarkdownTask(latest, reference);
    expect(rebased).not.toBeNull();
    expect(toggleMarkdownTask(latest, rebased!, true)).toContain('- [x] beta');
  });

  it('does not rebase an ambiguous duplicate task', () => {
    const reference = collectMarkdownTasks('- [ ] same')[0];
    expect(rebaseMarkdownTask('- [ ] same\n- [ ] same', reference)).toBeNull();
  });
});
