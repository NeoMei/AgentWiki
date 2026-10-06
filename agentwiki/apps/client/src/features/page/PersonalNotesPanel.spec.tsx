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
const note = (body: string, id: string, status: 'pending' | 'dispatched' | 'awaiting-review' | 'resolved' = 'pending') => ({ ...addPersonalNote(scope, target, body, id), status, ...(status === 'pending' ? {} : { taskId: 'task' }) });
function queue(props: Partial<ComponentProps<typeof PersonalNotesPanel>> = {}) {
  const defaults = { source: 'quote', notes: [], onAdd: vi.fn(), onDispatch: vi.fn(), onReopen: vi.fn(), ...props };
  const view = render(<LanguageProvider><PersonalNotesPanel {...defaults} /></LanguageProvider>);
  return { ...view, props: defaults, update: (next: Partial<ComponentProps<typeof PersonalNotesPanel>>) => view.rerender(<LanguageProvider><PersonalNotesPanel {...defaults} {...next} /></LanguageProvider>) };
}
describe('personal notes UI', () => {
  it('labels local privacy, adds a selected passage note, and only sends chosen pending notes', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const onAdd = vi.fn(), onDispatch = vi.fn(); const note = addPersonalNote(scope, target, 'Explain it', 'id');
    render(<LanguageProvider><PersonalNotesPanel source="quote" target={target} notes={[note]} onAdd={onAdd} onDispatch={onDispatch} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText(/Private.*this browser/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'More context' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' })); expect(onAdd).toHaveBeenCalledWith(target, 'More context');
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Explain it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' })); expect(onDispatch).toHaveBeenCalledWith(['id']);
  });
  it('keeps orphan quote visible and disables its dispatch, with Chinese labels', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><PersonalNotesPanel source="changed" notes={[addPersonalNote(scope, target, 'Explain', 'id')]} onAdd={() => {}} onDispatch={() => {}} onReopen={() => {}} /></LanguageProvider>);
    expect(screen.getByText('quote')).toBeInTheDocument(); expect(screen.getByText('原文已变动或定位不唯一')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Explain' })).toBeDisabled();
  });
  it('defaults to Open and filters the queue with accurate counts and empty feedback', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue({ notes: [note('A', 'a'), note('B', 'b', 'dispatched'), note('C', 'c', 'awaiting-review'), note('D', 'd', 'resolved')] });
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveTextContent('Open (3)');
    expect(screen.getByRole('button', { name: 'All' })).toHaveTextContent('All (4)');
    expect(screen.queryByRole('checkbox', { name: 'D' })).not.toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
    expect(screen.getByText('Awaiting review')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByRole('checkbox', { name: 'D' })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: 'A' })).not.toBeInTheDocument();
    view.update({ notes: [] });
    expect(screen.getByText('No resolved notes yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('No personal notes yet. Select a passage to add one.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
    expect(screen.getByRole('button', { name: 'Send selected to Agent' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Send selected to Agent' }));
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
  it('selects only visible eligible notes, supports clear, and never automatically dispatches', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const orphan = { ...note('Stale', 'stale'), target: captureAssistTarget('missing', 'selection', 0, 7, '2026-10-06T00:00:00Z')! };
    const view = queue({ notes: [note('A', 'a'), note('B', 'b'), orphan, note('Sent', 'sent', 'dispatched'), note('Review', 'review', 'awaiting-review'), note('Done', 'done', 'resolved')] });
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Select all eligible' }));
    expect(screen.getByRole('checkbox', { name: 'A' })).not.toBeChecked();
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
  it('hides an empty composer without a target and retains an unfinished draft through selection changes', () => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    const view = queue();
    expect(screen.getByText('Select a passage to add a note.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note' })).not.toBeInTheDocument();
    view.update({ target });
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Keep this draft' } });
    view.update({ target: null });
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled();
    view.update({ target });
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Keep this draft');
  });
  it('shows Chinese selection feedback, storage warning, and explicit reopen action', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    const view = queue({ storageUnavailable: true, notes: [note('待办', 'a'), note('复查', 'b', 'awaiting-review')] });
    expect(screen.getByRole('button', { name: '未解决' })).toHaveTextContent('未解决 (2)');
    expect(screen.getByText('等待审阅')).toBeInTheDocument();
    expect(screen.getByText('无法保存个人笔记，请保留副本。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全选可发送笔记' }));
    expect(screen.getByText('已选 1 条可发送笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(screen.getByText('已选 0 条可发送笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }));
    expect(view.props.onReopen).toHaveBeenCalledExactlyOnceWith('b');
    expect(view.props.onDispatch).not.toHaveBeenCalled();
  });
});
