import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EditorView } from '@codemirror/view';
import { EditorSelection, StateEffect } from '@codemirror/state';
import { undo, undoDepth } from '@codemirror/commands';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../Markdown';
import { MarkdownWorkspace, type MarkdownWorkspaceHandle } from '../MarkdownWorkspace';
import { LanguageProvider } from '../../context/LanguageContext';
import { captureReadingSelection } from '../../features/agent-session/readingSelection';

const source = 'Before **bold** and [link](https://example.test) after\n\n- repeated\n- repeated';
const marks = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.personal-note-highlight[data-note-ids]')];
const read = (text: string, props: Record<string, unknown>) => render(
  <MemoryRouter><LanguageProvider><Markdown selectionSourceVersion="2026-10-14T00:00:00Z" {...props}>{text}</Markdown></LanguageProvider></MemoryRouter>,
);
const edit = (text: string, props: Record<string, unknown>, mode: 'edit' | 'preview' = 'edit') => render(
  <MemoryRouter><LanguageProvider><MarkdownWorkspace value={text} mode={mode} onChange={() => {}} {...props} /></LanguageProvider></MemoryRouter>,
);
const editor = (root: HTMLElement) => EditorView.findFromDOM(root.querySelector('.cm-editor')!)!;
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });

describe('personal note source highlights', () => {
  it('highlights only the proven source range across bold and a link, keeping selection offsets', () => {
    const { container } = read(source, { noteHighlights: [{ id: 'n1', from: 9, to: 25 }] });
    expect(marks(container).map((node) => node.textContent)).toEqual(['bold', ' and ', 'link']);
    const root = container.querySelector<HTMLElement>('[data-markdown-selection-root]')!;
    const selected = document.createRange();
    selected.setStart(marks(container)[0].firstChild!, 0);
    selected.setEnd(marks(container)[2].firstChild!, 4);
    expect(captureReadingSelection(root, selected, source, '2026-10-14T00:00:00Z', '2026-10-14T00:00:00Z')).toMatchObject({ from: 9, to: 25, quote: 'bold** and [link' });
    for (const mark of marks(container)) expect(mark.childNodes).toHaveLength(1);
  });

  it('marks the anchored repeated list text, never an earlier identical occurrence', () => {
    const { container } = read('- repeated\n- repeated', { noteHighlights: [{ id: 'n2', from: 13, to: 21 }] });
    expect(marks(container)).toHaveLength(1);
    expect(marks(container)[0].closest('li')).toBe(container.querySelectorAll('li')[1]);
  });

  it('does not guess a transformed entity offset or accept invalid source ranges', () => {
    const { container } = read('A &amp; B', { noteHighlights: [
      { id: 'entity', from: 2, to: 7 }, { id: 'negative', from: -1, to: 1 },
      { id: 'outside', from: 0, to: 100 }, { id: 'empty', from: 0, to: 0 },
    ] });
    expect(marks(container)).toHaveLength(0);
  });

  it('activates overlapping notes in turn and announces their count', () => {
    const activate = vi.fn();
    const { container } = read('abcdef', { noteHighlights: [{ id: 'first', from: 1, to: 5 }, { id: 'second', from: 2, to: 4 }], onNoteActivate: activate });
    const overlap = marks(container).find((node) => node.textContent === 'cd')!;
    expect(overlap).toBeTruthy();
    expect(overlap.getAttribute('title')).toMatch(/2/);
    fireEvent.click(overlap); fireEvent.click(overlap);
    expect(activate.mock.calls).toEqual([['first'], ['second']]);
    overlap.focus(); fireEvent.keyDown(overlap, { key: 'Enter' });
    expect(activate).toHaveBeenLastCalledWith('first');
  });

  it('opens a note on task text without also toggling the task', () => {
    const toggle = vi.fn(), activate = vi.fn();
    const { container } = read('- [ ] task', { mode: 'page', canEdit: true, onTaskToggle: toggle, noteHighlights: [{ id: 'task-note', from: 6, to: 10 }], onNoteActivate: activate });
    expect(marks(container)).toHaveLength(1);
    fireEvent.click(marks(container)[0]);
    expect(activate).toHaveBeenCalledWith('task-note'); expect(toggle).not.toHaveBeenCalled();
  });

  it('does not toggle a task when a note click follows text selection or a modifier click', () => {
    const toggle = vi.fn(), activate = vi.fn();
    const { container } = read('- [ ] task', { mode: 'page', canEdit: true, onTaskToggle: toggle, noteHighlights: [{ id: 'task-note', from: 6, to: 10 }], onNoteActivate: activate });
    const mark = marks(container)[0], range = document.createRange();
    range.setStart(mark.firstChild!, 0); range.setEnd(mark.firstChild!, 2); window.getSelection()?.addRange(range);
    fireEvent.click(mark);
    expect(window.getSelection()?.toString()).toBe('ta');
    expect(toggle).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.click(mark, { shiftKey: true });
    expect(toggle).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  });

  it('keeps a drag-selected reading passage selected without opening the note', () => {
    const activate = vi.fn();
    const { container } = read('noted text', { noteHighlights: [{ id: 'n', from: 0, to: 10 }], onNoteActivate: activate });
    expect(marks(container)).toHaveLength(1);
    const mark = marks(container)[0], range = document.createRange();
    range.setStart(mark.firstChild!, 0); range.setEnd(mark.firstChild!, 5); window.getSelection()?.addRange(range);
    fireEvent.click(mark);
    expect(window.getSelection()?.toString()).toBe('noted'); expect(activate).not.toHaveBeenCalled();
  });

  it('shows an active edit mark, opens it without changing source or undo, and preserves drag selection', () => {
    const activate = vi.fn();
    const { container } = edit('noted text', { noteHighlights: [{ id: 'n', from: 0, to: 5 }], activeNoteId: 'n', onNoteActivate: activate });
    expect(marks(container).map((node) => node.textContent)).toEqual(['noted']);
    expect(marks(container)[0].classList.contains('personal-note-highlight-active')).toBe(true);
    const view = editor(container), depth = undoDepth(view.state);
    fireEvent.click(marks(container)[0]); expect(activate).toHaveBeenCalledWith('n');
    expect(view.state.doc.toString()).toBe('noted text'); expect(undoDepth(view.state)).toBe(depth);
    activate.mockClear(); act(() => view.dispatch({ selection: EditorSelection.range(0, 5) }));
    fireEvent.click(marks(container)[0]);
    expect(activate).not.toHaveBeenCalled(); expect(view.state.selection.main.to).toBe(5);
    act(() => view.dispatch({ changes: { from: 0, insert: 'x' } }));
    act(() => { undo(view); }); expect(view.state.doc.toString()).toBe('noted text');
  });

  it('requests scrolling only for explicit note navigation, preserving ordinary selection restoration', () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const text = 'intro\n'.repeat(150) + 'far-away note';
    const { container } = edit(text, { ref: workspaceRef });
    const view = editor(container), scrolling: boolean[] = [];
    act(() => view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions) if (transaction.selection) scrolling.push(transaction.scrollIntoView);
    })) }));
    const selection = { from: 900, to: 913, text: 'far-away note' };
    act(() => { workspaceRef.current!.restoreSelection(selection); });
    act(() => { workspaceRef.current!.restoreSelection(selection, { scrollIntoView: true }); });
    expect(scrolling).toEqual([false, true]);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('far-away note');
  });

  it.each([{ from: 2, to: 3, insert: 'Z' }, { from: 4, to: 4, insert: 'X' }])('removes every fragment and bubble of a note whose source is edited, while retaining untouched overlaps: %j', (changes) => {
    const { container } = edit('abcdefghi', { noteHighlights: [{ id: 'whole', from: 1, to: 8 }, { id: 'middle', from: 4, to: 6 }] });
    const view = editor(container);
    act(() => view.dispatch({ changes }));
    expect(marks(container).map((mark) => JSON.parse(mark.dataset.noteIds!))).toEqual([['middle']]);
    const bubbles = container.querySelectorAll<HTMLButtonElement>('[data-note-marker]');
    expect(bubbles).toHaveLength(1);
    expect(JSON.parse(bubbles[0].dataset.noteIds!)).toEqual(['middle']);
  });

  it('forwards highlight behavior to the editor preview', () => {
    const activate = vi.fn(); const { container } = edit('noted text', { noteHighlights: [{ id: 'n', from: 0, to: 5 }], onNoteActivate: activate }, 'preview');
    expect(marks(container).map((node) => node.textContent)).toEqual(['noted']);
    fireEvent.click(marks(container)[0]); expect(activate).toHaveBeenCalledWith('n');
  });

  it('renders one yellow note marker per anchored note, not one per formatting fragment', () => {
    // Provide real visible-line geometry at the layout boundary; JSDOM otherwise returns no rects.
    const original = HTMLElement.prototype.getClientRects;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('personal-note-highlight')) return original.call(this);
      const rects = [new DOMRect(10, 120, 80, 18)];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null }) as unknown as DOMRectList;
    });
    const activate = vi.fn();
    const { container } = read(source, { noteHighlights: [{ id: 'n', from: 9, to: 25 }], onNoteActivate: activate });
    const bubbles = container.querySelectorAll<HTMLButtonElement>('[data-note-marker]');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].querySelector('svg')).toBeTruthy();
    expect(bubbles[0].textContent).toBe('');
    const selected = document.createRange(); selected.selectNodeContents(marks(container)[0]); window.getSelection()?.addRange(selected);
    fireEvent.click(bubbles[0]); expect(activate).toHaveBeenCalledWith('n');
  });

  it('groups editor note markers on one source line and activates either note without changing the document', () => {
    const activate = vi.fn();
    const { container } = edit('first second', { noteHighlights: [{ id: 'first', from: 0, to: 5 }, { id: 'second', from: 6, to: 12 }], onNoteActivate: activate });
    const bubbles = container.querySelectorAll<HTMLButtonElement>('[data-note-marker]');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].getAttribute('aria-label')).toMatch(/2/);
    const view = editor(container);
    act(() => view.dispatch({ selection: EditorSelection.range(0, 5) }));
    fireEvent.click(bubbles[0]); fireEvent.click(bubbles[0]);
    expect(activate.mock.calls).toEqual([['first'], ['second']]);
    expect(view.state.doc.toString()).toBe('first second'); expect(undoDepth(view.state)).toBe(0);
  });

  it('removes marks when the supplied personal notes are removed', () => {
    const { container, rerender } = read('noted text', { noteHighlights: [{ id: 'n', from: 0, to: 5 }] });
    expect(marks(container)).toHaveLength(1);
    rerender(<MemoryRouter><LanguageProvider><Markdown noteHighlights={[]}>{'noted text'}</Markdown></LanguageProvider></MemoryRouter>);
    expect(marks(container)).toHaveLength(0);
    expect(container.querySelector('[data-note-marker]')).toBeNull();
  });
});
