import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { PersonalNotesPanel } from './PersonalNotesPanel';
import { captureAssistTarget } from './assistTargets';
import { addPersonalNote } from './reviewComments';
import type { ComponentProps } from 'react';
const scope = { userId: 'u', spaceId: 's', pageId: 'p' };
const target = captureAssistTarget('quote', 'selection', 0, 5, '2026-10-06T00:00:00Z')!;
afterEach(cleanup);
const note = (body: string, id: string, status: 'pending' | 'dispatched' | 'awaiting-review' | 'resolved' = 'pending') => ({ ...addPersonalNote(scope, target, body, id), canEdit: true, status, ...(status === 'pending' ? {} : { taskId: 'task' }) });
function queue(props: Partial<ComponentProps<typeof PersonalNotesPanel>> = {}) {
  const defaults = { source: 'quote', notes: [], onDispatch: vi.fn(), onResolve: vi.fn(), onReopen: vi.fn(), ...props };
  const view = render(<LanguageProvider><PersonalNotesPanel {...defaults} /></LanguageProvider>);
  return { ...view, props: defaults, update: (next: Partial<ComponentProps<typeof PersonalNotesPanel>>) => view.rerender(<LanguageProvider><PersonalNotesPanel {...defaults} {...next} /></LanguageProvider>) };
}
describe('personal notes UI', () => {
  it('reveals and scrolls an activated resolved note without reopening or selecting it for Agent', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const view = queue({ notes: [note('Open note', 'open'), note('Resolved note', 'done', 'resolved')] });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Open note' }));
      view.update({ activeNoteId: 'done' });
      const active = screen.getByRole('checkbox', { name: 'Resolved note' }).closest('li');
      expect(active).toHaveAttribute('data-active-note', 'true');
      expect(scroll.mock.instances).toContain(active);
      expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
      expect(view.props.onReopen).not.toHaveBeenCalled();
      expect(view.props.onDispatch).not.toHaveBeenCalled();
    } finally { Element.prototype.scrollIntoView = original; }
  });
  it('locates only an exact anchored note and leaves lifecycle and dispatch unchanged', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const onLocate = vi.fn();
    const view = queue({ notes: [note('定位这条', 'a')], onLocate });
    fireEvent.click(screen.getByRole('button', { name: '定位原文' }));
    expect(onLocate).toHaveBeenCalledExactlyOnceWith('a');
    expect(view.props.onDispatch).not.toHaveBeenCalled();
    expect(view.props.onReopen).not.toHaveBeenCalled();
    view.update({ source: 'changed' });
    expect(screen.getByRole('button', { name: '定位原文' })).toBeDisabled();
  });
  it('explains when an anchored passage has no exact visible reading span instead of silently doing nothing', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const onLocate = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const view = queue({ notes: [note('Encoded passage', 'encoded')], onLocate });
    fireEvent.click(screen.getByRole('button', { name: 'Locate passage' }));
    expect(screen.getByText('This passage cannot be located in this view. Check the original Markdown.')).toBeVisible();
    expect(view.props.onDispatch).not.toHaveBeenCalled(); expect(view.props.onReopen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Locate passage' }));
    expect(screen.queryByText('This passage cannot be located in this view. Check the original Markdown.')).not.toBeInTheDocument();
  });
  it('labels server visibility and only sends chosen pending notes', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const onDispatch = vi.fn(); const note = addPersonalNote(scope, target, 'Explain it', 'id');
    render(<LanguageProvider><PersonalNotesPanel source="quote" notes={[note]} onDispatch={onDispatch} onResolve={() => {}} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText(/Users and Agents with page access/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Explain it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' })); expect(onDispatch).toHaveBeenCalledWith(['id']);
  });
  it('shows the server recipient summaries for each @ mention', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const mentioned = { ...addPersonalNote(scope, target, 'Explain it', 'mentioned'), recipients: [
      { userId: 'u2', name: 'Bob', email: 'bob@example.test' },
      { userId: 'u', name: 'Alice', email: 'alice@example.test' },
    ] };
    render(<LanguageProvider><PersonalNotesPanel source="quote" notes={[mentioned]} onDispatch={() => {}} onResolve={() => {}} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByLabelText('Note recipients')).toHaveTextContent('Mentioned: @Bob @Alice');
  });
  it('keeps orphan quote visible and disables its dispatch, with Chinese labels', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><PersonalNotesPanel source="changed" notes={[addPersonalNote(scope, target, 'Explain', 'id')]} onDispatch={() => {}} onResolve={() => {}} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText('quote')).toBeInTheDocument(); expect(screen.getByText('原文已变动或定位不唯一')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Explain' })).toBeDisabled();
  });
  it('defaults to Open and filters the queue with accurate counts and empty feedback', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ notes: [note('A', 'a'), note('B', 'b', 'dispatched'), note('C', 'c', 'awaiting-review'), note('D', 'd', 'resolved')] });
    expect(screen.getByRole('button', { name: /^Open \(\d+\)$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Open \(\d+\)$/ })).toHaveTextContent('Open (3)');
    expect(screen.getByRole('button', { name: /^All \(\d+\)$/ })).toHaveTextContent('All (4)');
    expect(screen.getByRole('button', { name: 'Resolved (1)' })).toHaveAccessibleName('Resolved (1)');
    expect(screen.queryByRole('checkbox', { name: 'D' })).not.toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Resolved \(\d+\)$/ }));
    expect(screen.getByRole('checkbox', { name: 'D' })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: 'A' })).not.toBeInTheDocument();
    view.update({ notes: [] });
    expect(screen.getByText('No resolved notes yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All \(\d+\)$/ }));
    expect(screen.getByText('No page notes yet. Select a passage to add one.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Open \(\d+\)$/ }));
    expect(screen.getByText('No open notes. Resolved notes are available in the Resolved filter.')).toBeInTheDocument();
  });
  it('drops dispatched selection so the next explicit batch can send B alone', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ notes: [note('A', 'a'), note('B', 'b')] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' }));
    expect(view.props.onDispatch).toHaveBeenNthCalledWith(1, ['a']);
    view.update({ notes: [note('A', 'a', 'dispatched'), note('B', 'b')] });
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    expect(screen.getByText('1 eligible note selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' }));
    expect(view.props.onDispatch).toHaveBeenNthCalledWith(2, ['b']);
    view.update({ notes: [note('A', 'a'), note('B', 'b')] });
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
  });
  it.each(['removed', 'unanchored', 'resolved'] as const)('does not resurrect selection after a note is %s and returns', (change) => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ notes: [note('A', 'a')] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    view.update(change === 'removed' ? { notes: [] } : change === 'unanchored' ? { source: 'changed' } : { notes: [note('A', 'a', 'resolved')] });
    view.update({ source: 'quote', notes: [note('A', 'a')] });
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
  it('clears selection on filter changes so hidden notes cannot be sent', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ notes: [note('A', 'a'), note('D', 'd', 'resolved')] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('button', { name: /^Resolved \(\d+\)$/ }));
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^All \(\d+\)$/ }));
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' }));
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
  it('selects only visible eligible notes, supports clear, and never automatically dispatches', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const orphan = { ...note('Stale', 'stale'), target: captureAssistTarget('missing', 'selection', 0, 7, '2026-10-06T00:00:00Z')! };
    const view = queue({ notes: [note('A', 'a'), note('B', 'b'), orphan, note('Sent', 'sent', 'dispatched'), note('Review', 'review', 'awaiting-review'), note('Done', 'done', 'resolved')] });
    fireEvent.click(screen.getByRole('button', { name: /^All \(\d+\)$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all eligible' }));
    for (const name of ['A', 'B']) expect(screen.getByRole('checkbox', { name })).toBeChecked();
    for (const name of ['Stale', 'Sent', 'Review', 'Done']) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name })).toBeDisabled();
    }
    expect(screen.getByText('2 eligible notes selected')).toBeInTheDocument();
    expect(view.props.onDispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    expect(view.props.onDispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all eligible' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' }));
    expect(view.props.onDispatch).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
  });
  it('keeps permission-disabled batch and reopen controls disabled', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ disabled: true, notes: [note('A', 'a'), note('Sent', 'sent', 'dispatched')] });
    for (const name of ['Select all eligible', 'Clear selection', 'Send selected to Agent', 'Reopen']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Mark resolved' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all eligible' }));
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
  it('lets the note author mark an open note resolved and leaves Agent dispatch explicit', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const onResolve = vi.fn();
    const view = queue({ notes: [note('Close this note', 'close')], onResolve });
    fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith('close');
    expect(view.props.onDispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  });
  it('shows Chinese selection feedback, storage warning, and explicit reopen action', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const view = queue({ storageUnavailable: true, notes: [note('待办', 'a'), note('复查', 'b', 'awaiting-review')] });
    expect(screen.getByRole('button', { name: '未解决 (2)' })).toHaveTextContent('未解决 (2)');
    expect(screen.getByRole('button', { name: '全部 (2)' })).toHaveAccessibleName('全部 (2)');
    expect(screen.getByRole('button', { name: '已解决 (0)' })).toHaveAccessibleName('已解决 (0)');
    expect(screen.getByText('等待审阅')).toBeInTheDocument();
    expect(screen.getByText('部分笔记尚未同步到服务器，草稿已保留。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全选可发送笔记' }));
    expect(screen.getByText('已选 1 条可发送笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.getByText('已选 0 条可发送笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    expect(view.props.onReopen).toHaveBeenCalledExactlyOnceWith('b');
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
});

it('keeps all authors visible, blocks unsynced dispatch and hides another author reopen action', () => {
  localStorage.setItem('agentwiki.language.v1', 'en');
  const retry = vi.fn();
  queue({ storageUnavailable: true, onRetrySync: retry, notes: [
    { ...note('Other author', 'other', 'resolved'), canEdit: false, author: { type: 'user', id: 'other', name: 'Bob' } },
    { ...note('Migration pending', 'legacy'), syncState: 'unsynced' },
  ] });
  expect(screen.getByRole('checkbox', { name: 'Migration pending' })).toBeDisabled();
  expect(screen.getByText('Not synced')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'All (2)' }));
  expect(screen.getByLabelText('Note author: Bob')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry sync' })); expect(retry).toHaveBeenCalledOnce();
});

it('stages existing notes for Agent only after explicit selection', () => {
  localStorage.setItem('agentwiki.language.v1', 'en');
  const view = queue({ stageForSession: true, notes: [note('Discuss this', 'discuss')] });
  expect(screen.getByRole('button', { name: 'Stage selected for Agent' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Discuss this' }));
  fireEvent.click(screen.getByRole('button', { name: 'Stage selected for Agent' }));
  expect(view.props.onDispatch).toHaveBeenCalledWith(['discuss']);
});
