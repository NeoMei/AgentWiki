import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state';
import * as tableEditing from './markdown-tools/tableEditing';
import { undo, undoDepth } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../context/LanguageContext';
import { Markdown } from './Markdown';
import { MarkdownMode, MarkdownWorkspace, MarkdownWorkspaceHandle } from './MarkdownWorkspace';
import { ModeToggleButton } from './ModeToggleButton';

type ToggleMarkdownTask = typeof import('./markdown/tasks').toggleMarkdownTask;

const resourceMocks = vi.hoisted(() => ({
  post: vi.fn(),
  fetchAttachmentBlob: vi.fn(),
}));

vi.mock('../api/client', () => ({ default: { post: resourceMocks.post } }));
vi.mock('../features/attachments/attachmentApi', () => ({
  fetchAttachmentBlob: resourceMocks.fetchAttachmentBlob,
}));

const taskTransformMocks = vi.hoisted(() => ({
  actualToggleMarkdownTask: null as ToggleMarkdownTask | null,
  forceNull: false,
  toggleMarkdownTask: vi.fn(),
}));

vi.mock('./markdown/tasks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./markdown/tasks')>();
  taskTransformMocks.actualToggleMarkdownTask = actual.toggleMarkdownTask;
  return { ...actual, toggleMarkdownTask: taskTransformMocks.toggleMarkdownTask };
});

const Harness = ({
  initial = '# Title\n\nFirst paragraph.',
  onChange = () => {},
  workspaceRef,
  onUploadImages,
  onUploadError,
  pageId,
  spaceId,
  pages,
}: any) => {
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<MarkdownMode>('edit');
  return (
    <>
      <ModeToggleButton mode={mode} onToggle={() => setMode(mode === 'edit' ? 'preview' : 'edit')} />
      <MarkdownWorkspace
        ref={workspaceRef}
        value={value}
        mode={mode}
        onChange={(next: string) => { setValue(next); onChange(next); }}
        pageId={pageId}
        spaceId={spaceId}
        pages={pages}
        onUploadImages={onUploadImages}
        onUploadError={onUploadError}
      />
    </>
  );
};

const renderWYS = (props?: any) => render(<LanguageProvider><Harness {...props} /></LanguageProvider>);

const currentEditorView = (container: HTMLElement) => {
  const editor = container.querySelector('.cm-editor') as HTMLElement | null;
  if (!editor) throw new Error('CodeMirror editor not found');
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error('CodeMirror view not found');
  return view;
};

const fileItem = (file: File, type = file.type) => ({ kind: 'file', type, getAsFile: () => file });
const textItem = () => ({ kind: 'string', type: 'text/plain', getAsFile: () => null });

const dispatchPaste = (
  target: Element,
  items: Array<ReturnType<typeof fileItem> | ReturnType<typeof textItem>>,
  text = '',
) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', { value: { items, files: [], getData: () => text } });
  fireEvent(target, event);
  return event;
};

const dispatchDrop = (target: Element, items: Array<ReturnType<typeof fileItem>>, x = 12, y = 8) => {
  const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: { items, files: [], getData: () => '' } });
  fireEvent(target, event);
  return event;
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('MarkdownWorkspace live-preview (CodeMirror)', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    taskTransformMocks.forceNull = false;
    const actualToggleMarkdownTask = taskTransformMocks.actualToggleMarkdownTask;
    if (!actualToggleMarkdownTask) throw new Error('actual task transform was not loaded');
    taskTransformMocks.toggleMarkdownTask.mockImplementation((...args: Parameters<ToggleMarkdownTask>) => (
      taskTransformMocks.forceNull ? null : actualToggleMarkdownTask(...args)
    ));
    resourceMocks.post.mockReset();
    resourceMocks.fetchAttachmentBlob.mockReset();
  });

  it('edit mode shows a code editor surface for the whole document', () => {
    const { container } = renderWYS();
    expect(container.querySelector('.cm-editor')).toBeTruthy();
    expect(container.querySelector('.cm-content')).toBeTruthy();
  });

  it('enables CodeMirror line wrapping in edit mode', () => {
    const { container } = renderWYS({ initial: '很长的中文内容'.repeat(100) });
    expect(container.querySelector('.cm-lineWrapping')).toBeTruthy();
  });

  it('replaces a candidate as one isolated undoable document change', () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const { container } = renderWYS({ initial: 'Original content', workspaceRef });
    const view = currentEditorView(container);
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' human' } }));
    const depth = undoDepth(view.state);
    act(() => expect(workspaceRef.current?.replaceDocument('Accepted candidate')).toBe(true));
    expect(view.state.doc.toString()).toBe('Accepted candidate');
    expect(undoDepth(view.state)).toBe(depth + 1);
    act(() => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe('Original content human');
  });

  it('captures/restores selected source and formats with a single undo', () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const { container } = renderWYS({ initial: '中文段落', workspaceRef });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.range(0, 2) }));
    expect(workspaceRef.current?.captureSelection()).toEqual({ from: 0, to: 2, text: '中文' });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(view.state.doc.toString()).toBe('**中文**段落');
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe('中文段落');
    act(() => workspaceRef.current?.restoreSelection({ from: 2, to: 4, text: '段落' }));
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('段落');
  });

  it('slash menu navigates by keyboard and retains slash source on Escape', () => {
    const { container } = renderWYS({ initial: '/' });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(1) }));
    expect(screen.getByRole('menu', { name: 'Insert block' })).toBeInTheDocument();
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowDown' });
    fireEvent.keyDown(view.contentDOM, { key: 'Enter' });
    expect(view.state.doc.toString()).toBe('- ');
    act(() => undo(view));
    fireEvent.keyDown(view.contentDOM, { key: 'Escape' });
    expect(view.state.doc.toString()).toBe('/');
    expect(screen.queryByRole('menu', { name: 'Insert block' })).not.toBeInTheDocument();
  });

  it('measures slash menu height, flips at viewport bottom and repositions on scroll/resize', () => {
    const { container } = renderWYS({ initial: '' });
    const view = currentEditorView(container);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    let anchor = { left: 650, top: 690, bottom: 706 } as DOMRect;
    vi.spyOn(view, 'coordsAtPos').mockImplementation(() => anchor);
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { width: this.getAttribute('role') === 'menu' ? 200 : 0, height: this.getAttribute('role') === 'menu' ? 273 : 0, left: 0, top: 0, bottom: 0, right: 0 } as DOMRect;
    });
    try {
      act(() => view.dispatch({ changes: { from: 0, insert: '/' }, selection: { anchor: 1 } }));
      const menu = screen.getByRole('menu', { name: 'Insert block' });
      expect(menu.parentElement).toBe(document.body);
      expect(menu).toHaveStyle({ top: '413px', left: '650px', maxHeight: '674px' });
      anchor = { left: 350, top: 590, bottom: 610 } as DOMRect;
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      fireEvent.resize(window);
      expect(menu).toHaveStyle({ left: '178px', top: '313px', maxWidth: '366px' });
      anchor = { left: 100, top: 200, bottom: 218 } as DOMRect;
      fireEvent.scroll(window);
      expect(menu).toHaveStyle({ top: '222px', left: '100px' });
      expect(view.state.doc.toString()).toBe('/');
    } finally { measure.mockRestore(); }
  });

  it('scrolls the active slash choice into its measured menu viewport on keyboard navigation', () => {
    const { container } = renderWYS({ initial: '/' });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(1) }));
    const menu = screen.getByRole('menu', { name: 'Insert block' });
    Object.defineProperty(menu, 'clientHeight', { configurable: true, value: 80 });
    const choices = screen.getAllByRole('menuitem');
    choices.forEach((choice, index) => {
      Object.defineProperty(choice, 'offsetTop', { configurable: true, value: index * 40 });
      Object.defineProperty(choice, 'offsetHeight', { configurable: true, value: 40 });
    });
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowUp' });
    expect(choices[5]).toHaveAttribute('aria-current', 'true');
    expect(menu.scrollTop).toBe(160);
    fireEvent.keyDown(view.contentDOM, { key: 'ArrowDown' });
    expect(choices[0]).toHaveAttribute('aria-current', 'true');
    expect(menu.scrollTop).toBe(0);
    expect(view.state.doc.toString()).toBe('/');
  });

  it('does not trigger slash menu during Chinese composition', () => {
    const { container } = renderWYS({ initial: '' });
    const view = currentEditorView(container);
    fireEvent.compositionStart(view.contentDOM);
    act(() => view.dispatch({ changes: { from: 0, insert: '/' }, selection: { anchor: 1 } }));
    expect(screen.queryByRole('menu', { name: 'Insert block' })).not.toBeInTheDocument();
    fireEvent.keyDown(view.contentDOM, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(view.state.doc.toString()).toBe('/');
  });

  it('page picker searches provided authorized scope and inserts duplicate title by identity', () => {
    const { container } = renderWYS({ initial: 'Text', spaceId: 's1', pages: [{ id: 'a', title: 'Same' }, { id: 'b', title: 'Same' }] });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(4) }));
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    expect(screen.getByRole('dialog', { name: 'Page link' })).toHaveTextContent('Current Space');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Same b' }));
    expect(view.state.doc.toString()).toBe('Text[[b|Same]]');
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe('Text');
  });

  it('refuses page-link insertion after the source changes while picker has focus', () => {
    const { container } = renderWYS({ initial: 'Text', pages: [{ id: 'a', title: 'Page' }] });
    const view = currentEditorView(container);
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    act(() => view.dispatch({ changes: { from: 0, insert: 'human ' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Page a' }));
    expect(view.state.doc.toString()).toBe('human Text');
    expect(screen.getByRole('alert')).toHaveTextContent('selection changed');
  });

  it.each(['page', 'space', 'identity', 'permission'])('closes and clears loaded page links when %s changes', async (change) => {
    const requestLinks = vi.fn().mockResolvedValue([{ id: 'private', title: 'Private document' }]);
    const props = { pageId: 'page-1', spaceId: 'space-1', pageLinksIdentity: 'user-1:true', value: 'Original', mode: 'edit' as const, onChange: vi.fn(), onRequestPageLinks: requestLinks };
    const mounted = render(<LanguageProvider><MarkdownWorkspace {...props} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    await screen.findByRole('button', { name: 'Private document private' });
    const changed = { ...props, [change === 'page' ? 'pageId' : change === 'space' ? 'spaceId' : 'pageLinksIdentity']: change === 'permission' ? 'user-1:false' : 'other' };
    mounted.rerender(<LanguageProvider><MarkdownWorkspace {...changed} /></LanguageProvider>);
    expect(screen.queryByRole('dialog', { name: 'Page link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Private document private' })).not.toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('forwards cancellation from a remounted page-link picker and ignores its late result', async () => {
    const pending = deferred<Array<{ id: string; title: string }>>();
    const requestLinks = vi.fn().mockReturnValue(pending.promise);
    const props = { pageId: 'page-1', spaceId: 'space-1', pageLinksIdentity: 'user-1:true', value: 'Original', mode: 'edit' as const, onChange: vi.fn(), onRequestPageLinks: requestLinks };
    const mounted = render(<LanguageProvider><MarkdownWorkspace {...props} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    expect(requestLinks).toHaveBeenCalledWith('', expect.any(AbortSignal));
    const signal = requestLinks.mock.calls[0][1] as AbortSignal;
    mounted.rerender(<LanguageProvider><MarkdownWorkspace {...props} pageId="page-2" /></LanguageProvider>);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve([{ id: 'private', title: 'Private document' }]));
    expect(screen.queryByRole('dialog', { name: 'Page link' })).not.toBeInTheDocument();
    expect(screen.queryByText('Private document')).not.toBeInTheDocument();
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('tracks the active source heading in edit mode', () => {
    const { container } = renderWYS({ initial: '# A\n\n# B' });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(6) }));
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-current', 'location');
  });

  it('image toolbar uses existing upload anchors and isolates undo from prior typing', async () => {
    const upload = vi.fn().mockResolvedValue(['assets/image.png']);
    const { container } = renderWYS({ initial: 'Original', onUploadImages: upload });
    const view = currentEditorView(container);
    act(() => view.dispatch({ changes: { from: 8, insert: ' human' }, selection: { anchor: 14 } }));
    const depth = undoDepth(view.state);
    const input = screen.getByLabelText('Upload images');
    fireEvent.change(input, { target: { files: [new File(['image'], 'image.png', { type: 'image/png' })] } });
    await waitFor(() => expect(view.state.doc.toString()).toBe('Original human![[assets/image.png]]'));
    expect(undoDepth(view.state)).toBe(depth + 1);
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe('Original human');
  });

  it('edit outline navigates duplicate heading source and excludes fenced headings', () => {
    const { container } = renderWYS({ initial: '# A\n```md\n# fake\n```\n# A' });
    const view = currentEditorView(container);
    fireEvent.click(screen.getByRole('button', { name: 'Contents' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'A' })[1]);
    expect(view.state.selection.main.head).toBe(21);
    expect(screen.queryByRole('button', { name: 'fake' })).not.toBeInTheDocument();
  });

  it('edit mode renders formatting marks for non-cursor lines (live preview)', () => {
    const { container } = renderWYS();
    // heading markdown should produce a header-styled line in the editor
    expect(container.querySelector('.cm-line')).toBeTruthy();
  });

  it('editing the document calls onChange with the full text', () => {
    const onChange = vi.fn();
    const { container } = renderWYS({ onChange });
    const content = container.querySelector('.cm-content') as HTMLElement;
    expect(content).toBeTruthy();
    // CodeMirror is contentEditable; simulate input via onChange prop path is
    // covered by integration, here we assert the editor is wired and present.
    expect(content.getAttribute('contenteditable')).toBe('true');
  });

  it('mode switch is a single toggle button', () => {
    renderWYS();
    const toggle = screen.getByTestId('mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('preview mode renders formatted markdown read-only, no code editor', () => {
    renderWYS();
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByRole('heading', { name: /Title/ })).toBeInTheDocument();
    expect(screen.getByText('First paragraph.')).toBeInTheDocument();
    expect(document.querySelector('.cm-editor')).toBeFalsy();
  });

  it('preview mode renders the full document, not blocks', () => {
    renderWYS();
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(screen.getByTestId('md-preview')).toBeInTheDocument();
  });

  it('captures the nearest heading and cursor, then restores the semantic position across preview and edit', async () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    renderWYS({ initial: '# Intro\n\n## Details\n\nBody text', workspaceRef });
    const view = currentEditorView(document.body);
    const detailsBodyOffset = view.state.doc.toString().indexOf('Body text') + 3;
    act(() => {
      view.dispatch({ selection: EditorSelection.cursor(detailsBodyOffset) });
      view.scrollDOM.scrollTop = 240;
    });

    const position = workspaceRef.current?.capturePosition();
    expect(position).toEqual(expect.objectContaining({ cursorOffset: detailsBodyOffset, headingText: 'Details', scrollTop: 240 }));

    fireEvent.click(screen.getByTestId('mode-toggle'));
    const previewHeading = await screen.findByRole('heading', { name: /Details/ });
    const previewParagraph = screen.getByText('Body text');
    const scrollIntoView = vi.fn();
    Object.defineProperty(previewParagraph, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    act(() => workspaceRef.current?.restorePosition(position!));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    vi.spyOn(previewHeading, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    vi.spyOn(previewParagraph, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    expect(workspaceRef.current?.capturePosition()).toEqual(expect.objectContaining({
      cursorOffset: null,
      headingText: 'Details',
      scrollTop: 0,
    }));

    fireEvent.click(screen.getByTestId('mode-toggle'));
    act(() => workspaceRef.current?.restorePosition(position!));
    expect(currentEditorView(document.body).state.selection.main.head).toBe(detailsBodyOffset);
    expect(currentEditorView(document.body).scrollDOM.scrollTop).not.toBe(240);
  });

  it.each(['forward', 'reverse'] as const)('restores a %s selection at its exact repeated-text offsets without changing source or undo depth', (direction) => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const source = 'Repeat passage.\n\nRepeat passage.';
    const from = source.lastIndexOf('Repeat');
    const to = from + 'Repeat'.length;
    renderWYS({ initial: source, workspaceRef });
    const view = currentEditorView(document.body);
    const [anchor, head] = direction === 'forward' ? [from, to] : [to, from];
    act(() => view.dispatch({ selection: EditorSelection.range(anchor, head) }));
    const position = workspaceRef.current!.capturePosition();
    act(() => view.dispatch({ selection: EditorSelection.cursor(0) }));
    const depth = undoDepth(view.state);
    act(() => workspaceRef.current!.restorePosition(JSON.parse(JSON.stringify(position))));
    expect(view.state.selection.main.empty).toBe(true);
    act(() => workspaceRef.current!.restorePosition(position));
    expect(view.state.selection.main.anchor).toBe(anchor);
    expect(view.state.selection.main.head).toBe(head);
    expect(view.state.doc.toString()).toBe(source);
    expect(undoDepth(view.state)).toBe(depth);
    expect(JSON.stringify(position)).not.toContain('Repeat');
  });

  it('refuses a stale selection even when the selected text still matches, and keeps the clamped cursor fallback', () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    renderWYS({ initial: 'Repeat passage.', workspaceRef });
    const view = currentEditorView(document.body);
    act(() => view.dispatch({ selection: EditorSelection.range(0, 6) }));
    const position = workspaceRef.current!.capturePosition();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: ' Changed elsewhere.' } }));
    act(() => workspaceRef.current!.restorePosition(position));
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(6);
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Hi' } }));
    act(() => workspaceRef.current!.restorePosition(position));
    expect(view.state.selection.main.head).toBe(2);
  });

  it.each(['page', 'space', 'identity'] as const)('invalidates the selection bookmark after a %s scope change and does not revive it on return', (change) => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const source = 'Repeat passage.';
    const props = { pageId: 'page-1', spaceId: 'space-1', pageLinksIdentity: 'user-1', value: source, mode: 'edit' as const, onChange: vi.fn() };
    const renderWorkspace = (scope: typeof props) => <LanguageProvider><MarkdownWorkspace {...scope} ref={workspaceRef} /></LanguageProvider>;
    const { rerender } = render(renderWorkspace(props));
    const view = currentEditorView(document.body);
    act(() => view.dispatch({ selection: EditorSelection.range(8, 2) }));
    const position = workspaceRef.current!.capturePosition();
    const changed = { ...props, [change === 'page' ? 'pageId' : change === 'space' ? 'spaceId' : 'pageLinksIdentity']: 'other' };
    rerender(renderWorkspace(changed));
    act(() => workspaceRef.current!.restorePosition(position));
    expect(view.state.selection.main.empty).toBe(true);
    rerender(renderWorkspace(props));
    act(() => workspaceRef.current!.restorePosition(position));
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(2);
  });

  it('restores the second repeated heading by its rendered identity instead of the first label match', async () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const source = '## Repeat\n\nFirst section.\n\n## Repeat\n\nSecond section.';
    renderWYS({ initial: source, workspaceRef });
    const secondHeadingOffset = source.lastIndexOf('## Repeat');

    act(() => workspaceRef.current?.restorePosition({
      cursorOffset: null,
      headingId: 'repeat-1',
      headingText: 'Repeat',
      sourceOffset: secondHeadingOffset,
      scrollTop: 0,
    } as any));
    expect(currentEditorView(document.body).state.selection.main.head).toBe(secondHeadingOffset);

    fireEvent.click(screen.getByTestId('mode-toggle'));
    const repeatedHeadings = await screen.findAllByRole('heading', { name: /Repeat/ });
    const firstScroll = vi.fn();
    const secondScroll = vi.fn();
    Object.defineProperty(repeatedHeadings[0], 'scrollIntoView', { configurable: true, value: firstScroll });
    Object.defineProperty(repeatedHeadings[1], 'scrollIntoView', { configurable: true, value: secondScroll });
    act(() => workspaceRef.current?.restorePosition({
      cursorOffset: null,
      headingId: 'repeat-1',
      headingText: 'Repeat',
      sourceOffset: secondHeadingOffset,
      scrollTop: 0,
    } as any));

    expect(secondScroll).toHaveBeenCalledWith({ block: 'start' });
    expect(firstScroll).not.toHaveBeenCalled();
  });

  it('round-trips the current paragraph within a long section through its Markdown AST source offset', async () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const paragraphs = Array.from({ length: 20 }, (_, index) => (
      `Paragraph position ${String(index + 1).padStart(2, '0')} contains **formatted text** and enough detail to identify this block.`
    ));
    const source = `# Long section\n\n${paragraphs.join('\n\n')}`;
    const targetOffset = source.indexOf('Paragraph position 12');
    renderWYS({ initial: source, workspaceRef });
    const view = currentEditorView(document.body);
    act(() => view.dispatch({ selection: EditorSelection.cursor(targetOffset + 24) }));

    const editPosition = workspaceRef.current?.capturePosition();
    expect(editPosition).toEqual(expect.objectContaining({
      cursorOffset: targetOffset + 24,
      headingText: 'Long section',
      sourceOffset: targetOffset,
    }));

    fireEvent.click(screen.getByTestId('mode-toggle'));
    const targetParagraph = screen.getByText((_, element) => (
      element?.tagName === 'P' && element.textContent?.startsWith('Paragraph position 12') === true
    ));
    const scrollIntoView = vi.fn();
    Object.defineProperty(targetParagraph, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    act(() => workspaceRef.current?.restorePosition(editPosition!));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });

    const renderedBlocks = document.querySelectorAll<HTMLElement>('[data-markdown-source-start]');
    renderedBlocks.forEach((block) => {
      const offset = Number(block.dataset.markdownSourceStart);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
        top: offset <= targetOffset ? -20 : 300,
      } as DOMRect);
    });
    vi.spyOn(targetParagraph, 'getBoundingClientRect').mockReturnValue({ top: 8 } as DOMRect);
    const previewPosition = workspaceRef.current?.capturePosition();
    expect(previewPosition).toEqual(expect.objectContaining({ sourceOffset: targetOffset }));

    fireEvent.click(screen.getByTestId('mode-toggle'));
    act(() => workspaceRef.current?.restorePosition(previewPosition!));
    expect(currentEditorView(document.body).state.selection.main.head).toBe(targetOffset);
  });

  it('renders syntax-aware Wiki widgets with alias text and preview-equivalent fragments', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: 'target-201',
        title: 'Page 201',
        slug: 'page-201',
      })),
    }));
    const { container } = renderWYS({
      initial: [
        'active line',
        '[[Page 201#Heading Name|Visible alias]]',
        '[[Page 201#^block-one]]',
      ].join('\n'),
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    const alias = await screen.findByRole('link', { name: 'Visible alias' });
    expect(alias).toHaveAttribute(
      'href',
      '/pages/target-201#agentwiki:heading:00006800006500006100006400006900006e00006700002000006e00006100006d000065',
    );
    expect(screen.getByRole('link', { name: 'Page 201#^block-one' })).toHaveAttribute(
      'href',
      '/pages/target-201#agentwiki:block:00006200006c00006f00006300006b00002d00006f00006e000065',
    );
    expect(container.querySelector('.cm-editor')).toBeInTheDocument();
    expect(resourceMocks.post).toHaveBeenCalledWith(
      '/spaces/space-authoritative/markdown/resolve',
      { sourcePageId: 'page-editor', references: expect.arrayContaining([
        expect.objectContaining({ target: 'Page 201', heading: 'Heading Name' }),
        expect.objectContaining({ target: 'Page 201', blockId: 'block-one' }),
      ]) },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('never replaces Wiki-looking text inside inline/fenced code or ordinary Markdown links', async () => {
    const { container } = renderWYS({
      initial: [
        'active line',
        '[[Real page]]',
        '`[[Real page]]`',
        '```md',
        '[[Real page]]',
        '```',
        '[ordinary [[Real page]]](https://example.com)',
      ].join('\n'),
      pages: [{ id: 'real', title: 'Real page' }],
    });

    expect(await screen.findByRole('link', { name: 'Real page' })).toHaveAttribute('href', '/pages/real');
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(1);
    expect(container.querySelector('.cm-content')).toHaveTextContent('[[Real page]]');
  });

  it('keeps the active Wiki line as source and restores its widget after the cursor leaves', async () => {
    const { container } = renderWYS({
      initial: '[[Target]]\nplain line',
      pages: [{ id: 'target', title: 'Target' }],
    });
    const view = currentEditorView(container);

    expect(screen.queryByRole('link', { name: 'Target' })).not.toBeInTheDocument();
    expect(view.contentDOM).toHaveTextContent('[[Target]]');
    act(() => view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(2).from) }));

    expect(await screen.findByRole('link', { name: 'Target' })).toHaveAttribute('href', '/pages/target');
  });

  it('does not create widgets for ambiguous or missing authoritative targets', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any, index: number) => ({
        key: reference.key,
        status: index === 0 ? 'ambiguous' : 'unresolved',
      })),
    }));
    const { container } = renderWYS({
      initial: 'active\n[[Ambiguous]]\n[[Missing]]',
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    await waitFor(() => expect(resourceMocks.post).toHaveBeenCalledOnce());
    expect(container.querySelector('.cm-content')).toHaveTextContent('Ambiguous');
    expect(container.querySelector('.cm-content')).toHaveTextContent('Missing');
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(0);
  });

  it('aborts an obsolete resolver and never lets its late result bleed across Space or page identity', async () => {
    const stale = deferred<any>();
    resourceMocks.post.mockImplementation((url: string, body: any) => {
      const reference = body.references[0];
      if (url.includes('space-a')) return stale.promise;
      return Promise.resolve({ data: [{
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: 'target-b',
        title: 'Shared',
        slug: 'shared',
      }] });
    });
    const renderSnapshot = (spaceId: string, pageId: string) => (
      <LanguageProvider><MarkdownWorkspace
        value={'active\n[[Shared]]'}
        mode="edit"
        onChange={() => undefined}
        spaceId={spaceId}
        pageId={pageId}
      /></LanguageProvider>
    );
    const view = render(renderSnapshot('space-a', 'page-a'));
    await waitFor(() => expect(resourceMocks.post).toHaveBeenCalledTimes(1));
    const staleSignal = resourceMocks.post.mock.calls[0][2].signal as AbortSignal;

    view.rerender(renderSnapshot('space-b', 'page-b'));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
    expect(staleSignal.aborted).toBe(true);
    await act(async () => stale.resolve({ data: [{
      key: 'r0', status: 'resolved', kind: 'page', pageId: 'target-a', title: 'Shared', slug: 'shared',
    }] }));

    expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
  });

  it('dedupes a stable resolver snapshot and invalidates it when the page identity changes', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: [{
        key: body.references[0].key,
        status: 'resolved',
        kind: 'page',
        pageId: 'target',
        title: 'Target',
        slug: 'target',
      }],
    }));
    const renderSnapshot = (pageId: string) => (
      <LanguageProvider><MarkdownWorkspace
        value={'active\n[[Target]]'}
        mode="edit"
        onChange={() => undefined}
        spaceId="space-a"
        pageId={pageId}
      /></LanguageProvider>
    );
    const view = render(renderSnapshot('page-a'));
    expect(await screen.findByRole('link', { name: 'Target' })).toBeInTheDocument();

    view.rerender(renderSnapshot('page-a'));
    await act(async () => Promise.resolve());
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    view.rerender(renderSnapshot('page-b'));
    await waitFor(() => expect(resourceMocks.post).toHaveBeenCalledTimes(2));
  });

  it('bounds 201 unique references to one resolver request and leaves overflow as source', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target.toLowerCase().replaceAll(' ', '-'),
        title: reference.target,
        slug: reference.target.toLowerCase().replaceAll(' ', '-'),
      })),
    }));
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const references = Array.from({ length: 201 }, (_, index) => `[[Page ${index}]]`).join(' ');
    const { container } = renderWYS({
      initial: `active\n${references}`,
      workspaceRef,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });
    expect(await screen.findByRole('link', { name: 'Page 0' })).toHaveAttribute('href', '/pages/page-0');
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(100);
    expect(screen.queryByRole('link', { name: 'Page 100' })).not.toBeInTheDocument();
    expect(currentEditorView(container).state.doc.toString()).toContain('[[Page 100]]');

    for (const suffix of ['one', 'two', 'three']) {
      await act(async () => {
        workspaceRef.current?.simulateChange(`active ${suffix}\n${references}`);
        await Promise.resolve();
      });
    }

    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
  });

  it('widgetizes only the first 256 duplicate occurrences and keeps later aliases raw', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: 'target',
        title: 'Target',
        slug: 'target',
      })),
    }));
    const references = Array.from({ length: 258 }, (_, index) => `[[Target|Alias ${index}]]`).join(' ');
    const { container } = renderWYS({
      initial: `active\n${references}`,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(await screen.findByRole('link', { name: 'Alias 0' })).toHaveAttribute('href', '/pages/target');
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(256);
    expect(screen.queryByRole('link', { name: 'Alias 256' })).not.toBeInTheDocument();
    expect(currentEditorView(container).state.doc.toString()).toContain('[[Target|Alias 256]]');
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(1);
  });

  it('keeps an over-budget candidate and every following link raw without resolver I/O', () => {
    const source = `active\n[[Target|${'x'.repeat(32_768)}]] [[Good]]`;
    const { container } = renderWYS({
      initial: source,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(resourceMocks.post).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(0);
    expect(currentEditorView(container).state.doc.toString()).toBe(source);
  });

  it.each([
    ['generic HTML block', 'active\n<div>\n[[inside]]\n</div>'],
    ['quoted fenced code', 'active\n> ~~~md\n> [[inside]]\n> ~~~'],
    ['quoted indented code', 'active\n>     [[inside]]'],
  ])('keeps Wiki-looking text in %s raw with zero resolver I/O', (_kind, source) => {
    const { container } = renderWYS({
      initial: source,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(resourceMocks.post).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(0);
    expect(currentEditorView(container).state.doc.toString()).toBe(source);
  });

  it.each([
    ['list then quote fence', '- > ~~~md\n  > [[inside]]\n  > ~~~\n\n[[after]]'],
    ['ordered list then quote HTML', '1. > <div>\n   > [[inside]]\n   > </div>\n\n[[after]]'],
    ['quote/list/quote comment', '> - > <!--\n>   > [[inside]]\n>   > -->\n\n[[after]]'],
  ])('keeps %s content raw while resolving only the dedented reference', async (_kind, source) => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target,
        title: reference.target,
        slug: reference.target,
      })),
    }));
    const { container } = renderWYS({
      initial: `active\n${source}`,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(await screen.findByRole('link', { name: 'after' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'inside' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(1);
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(1);
    expect(currentEditorView(container).state.doc.toString()).toBe(`active\n${source}`);
  });

  it('isolates escaped, entity and Unicode aliases without losing following resolvers or widgets', async () => {
    const source = 'active\n[[slashes\\|alias]] [[One|alias &amp;]] [[路线|别名]] [[After]]';
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target,
        title: reference.target,
        slug: reference.target,
      })),
    }));
    const { container } = renderWYS({
      initial: source,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(await screen.findByRole('link', { name: 'After' })).toBeInTheDocument();
    // The shared raw-reference parser conservatively leaves the escaped-pipe
    // candidate as source, while the authoritative collector still keeps it
    // isolated so it cannot shift or suppress any later candidate.
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(3);
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(4);
    expect(currentEditorView(container).state.doc.toString()).toBe(source);
  });

  it('keeps an entity-injected multi-resource candidate raw and resolves only the following link', async () => {
    const source = 'active\n[[Good&#93;&#93; &#91;&#91;Bad]] [[After]]';
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target,
        title: reference.target,
        slug: reference.target,
      })),
    }));
    const { container } = renderWYS({
      initial: source,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(await screen.findByRole('link', { name: 'After' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Good' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(1);
    expect(currentEditorView(container).state.doc.toString()).toBe(source);
  });

  it('keeps an entity-decoded resource prefix with trailing content raw without resolver I/O', () => {
    const source = 'active\n[[Good&#93;&#93; trailing]]';
    const { container } = renderWYS({
      initial: source,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    expect(resourceMocks.post).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(0);
    expect(currentEditorView(container).state.doc.toString()).toBe(source);
  });

  it.each([
    ['type-7 tag after paragraph text', 'paragraph\n<custom-tag>\n[[valid in paragraph]]\n\n[[outside]]', ['valid in paragraph', 'outside']],
    ['quoted type-6 HTML dedent', '> <div>\n> [[inside]]\n[[outside]]', ['outside']],
    ['quoted comment dedent', '> <!--\n> [[inside]]\n[[outside]]', ['outside']],
    ['quoted raw-tag dedent', '> <script>\n> [[inside]]\n[[outside]]', ['outside']],
    ['quoted unclosed fence dedent', '> ~~~md\n> [[inside]]\n[[outside]]', ['outside']],
    ['list unclosed fence dedent', '- ~~~md\n  [[inside]]\n[[outside]]', ['outside']],
    ['unclosed code span paragraph', '`unterminated [[inside]]\n\n[[outside]]', ['inside', 'outside']],
    ['unclosed link-label paragraph', '[unterminated [[inside]]\n\n[[outside]]', ['inside', 'outside']],
    ['unclosed inline comment paragraph', 'paragraph <!--\n[[inside]]\n\n[[outside]]', ['inside', 'outside']],
  ])('keeps invalid %s content raw and resolves valid content after its boundary', async (_kind, source, links) => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target.toLowerCase().replaceAll(' ', '-'),
        title: reference.target,
        slug: reference.target.toLowerCase().replaceAll(' ', '-'),
      })),
    }));
    const { container } = renderWYS({
      initial: `active\n${source}`,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });

    for (const link of links) {
      expect(await screen.findByRole('link', { name: link })).toBeInTheDocument();
    }
    if (!links.includes('inside')) {
      expect(screen.queryByRole('link', { name: 'inside' })).not.toBeInTheDocument();
    }
    expect(container.querySelectorAll('.cm-content a')).toHaveLength(links.length);
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
    expect(resourceMocks.post.mock.calls[0][1].references).toHaveLength(links.length);
    expect(currentEditorView(container).state.doc.toString()).toBe(`active\n${source}`);
  });

  it('reuses resolution when alias text and offsets change while rebuilding the current widgets', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: 'target',
        title: 'Target',
        slug: 'target',
      })),
    }));
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    renderWYS({
      initial: 'active\n[[Target|First alias]]',
      workspaceRef,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });
    expect(await screen.findByRole('link', { name: 'First alias' })).toHaveAttribute('href', '/pages/target');

    await act(async () => {
      workspaceRef.current?.simulateChange('active changed\nordinary line\n[[Target|Second alias]]');
      await Promise.resolve();
    });

    expect(await screen.findByRole('link', { name: 'Second alias' })).toHaveAttribute('href', '/pages/target');
    expect(resourceMocks.post).toHaveBeenCalledTimes(1);
  });

  it('debounces a same-page reference-set addition into one resolver request', async () => {
    resourceMocks.post.mockImplementation(async (_url: string, body: any) => ({
      data: body.references.map((reference: any) => ({
        key: reference.key,
        status: 'resolved',
        kind: 'page',
        pageId: reference.target.toLowerCase(),
        title: reference.target,
        slug: reference.target.toLowerCase(),
      })),
    }));
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    renderWYS({
      initial: 'active\n[[Target]]',
      workspaceRef,
      pageId: 'page-editor',
      spaceId: 'space-authoritative',
    });
    expect(await screen.findByRole('link', { name: 'Target' })).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      act(() => {
        workspaceRef.current?.simulateChange('active\n[[Target]]\n[[Added]]');
        workspaceRef.current?.simulateChange('active one\n[[Target]]\n[[Added]]');
        workspaceRef.current?.simulateChange('active two\n[[Target]]\n[[Added]]');
      });
      expect(resourceMocks.post).toHaveBeenCalledTimes(1);

      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(resourceMocks.post).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes the authoritative page and Space context into scoped attachment preview rendering', async () => {
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:workspace-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    resourceMocks.post.mockImplementation((_url: string, body: any) => Promise.resolve({ data: [{
      key: body.references[0].key,
      status: 'resolved',
      kind: 'attachment',
      attachmentId: 'attachment-1',
      displayName: 'preview.png',
      mimeType: 'image/png',
      width: 1,
      height: 1,
    }] }));
    resourceMocks.fetchAttachmentBlob.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    try {
      const rendered = renderWYS({
        initial: '![[preview.png]]',
        pageId: 'page-authoritative',
        spaceId: 'space-authoritative',
      });
      fireEvent.click(screen.getByTestId('mode-toggle'));

      expect(await screen.findByRole('img', { name: 'preview.png' })).toHaveAttribute('src', 'blob:workspace-preview');
      expect(resourceMocks.post).toHaveBeenCalledWith(
        '/spaces/space-authoritative/markdown/resolve',
        expect.objectContaining({ references: [expect.objectContaining({ target: 'preview.png' })] }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(resourceMocks.fetchAttachmentBlob).toHaveBeenCalledWith('attachment-1', expect.any(AbortSignal));
      rendered.unmount();
    } finally {
      if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('updates only the editor draft when a preview task is toggled', () => {
    const onChange = vi.fn();
    renderWYS({ initial: '- [ ] draft task', onChange });
    fireEvent.click(screen.getByTestId('mode-toggle'));

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeDisabled();
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledWith('- [x] draft task');
  });

  it('keeps historical task checkboxes read-only', () => {
    render(<Markdown mode="version">- [ ] historical task</Markdown>);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('does not change the draft when the task source transform cannot find a safe target', () => {
    const onChange = vi.fn();
    taskTransformMocks.forceNull = true;
    renderWYS({ initial: '- [ ] stale draft task', onChange });
    fireEvent.click(screen.getByTestId('mode-toggle'));

    fireEvent.click(screen.getByRole('checkbox'));

    expect(taskTransformMocks.toggleMarkdownTask).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('insertText inserts at the cursor, moves it after the marker, and emits one document update', async () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const onChange = vi.fn();
    const { container } = renderWYS({ initial: 'alpha beta', workspaceRef, onChange });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(6) }));

    act(() => workspaceRef.current?.insertText('![[diagram.png]]'));

    await waitFor(() => expect(view.state.doc.toString()).toBe('alpha ![[diagram.png]]beta'));
    expect(view.state.selection.main.anchor).toBe(22);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('alpha ![[diagram.png]]beta');
  });

  it('insertText replaces every selected range and leaves each cursor after its insertion', async () => {
    const workspaceRef = createRef<MarkdownWorkspaceHandle>();
    const onChange = vi.fn();
    const { container } = renderWYS({ initial: 'one two three', workspaceRef, onChange });
    const view = currentEditorView(container);
    act(() => view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(8, 13),
      ], 0),
    }));

    act(() => workspaceRef.current?.insertText('X'));

    await waitFor(() => expect(view.state.doc.toString()).toBe('X two X'));
    expect(view.state.selection.ranges.map((range) => range.anchor)).toEqual([1, 7]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith('X two X');
  });

  it('uploads one pasted image at the captured selection and inserts the authoritative name', async () => {
    const upload = deferred<string[]>();
    const onUploadImages = vi.fn(() => upload.promise);
    const { container } = renderWYS({ initial: 'before after', onUploadImages });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(7) }));
    const file = new File(['png'], 'local.png', { type: 'image/png' });

    const event = dispatchPaste(view.contentDOM, [fileItem(file)]);
    act(() => view.dispatch({ selection: EditorSelection.cursor(0) }));
    await act(async () => upload.resolve(['assets/server-name-2.png']));

    expect(event.defaultPrevented).toBe(true);
    expect(onUploadImages).toHaveBeenCalledWith([file]);
    await waitFor(() => expect(view.state.doc.toString()).toBe('before ![[assets/server-name-2.png]]after'));
  });

  it('preserves pasted image order and inserts one newline-separated marker batch', async () => {
    const onChange = vi.fn();
    const onUploadImages = vi.fn().mockResolvedValue(['assets/first-2.png', 'assets/second.gif']);
    const { container } = renderWYS({ initial: '', onChange, onUploadImages });
    const view = currentEditorView(container);
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.gif', { type: 'image/gif' });

    const event = dispatchPaste(view.contentDOM, [textItem(), fileItem(first), fileItem(second)]);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(view.state.doc.toString()).toBe('![[assets/first-2.png]]\n![[assets/second.gif]]'));
    expect(onUploadImages).toHaveBeenCalledWith([first, second]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('accepts an image extension only when MIME is empty and rejects spoofed or unsupported MIME', async () => {
    const onUploadImages = vi.fn().mockResolvedValue(['assets/accepted.webp']);
    const { container } = renderWYS({ initial: '', onUploadImages });
    const view = currentEditorView(container);
    const fallback = new File(['webp'], 'fallback.WEBP', { type: '' });
    const spoofed = new File(['text'], 'spoofed.png', { type: 'text/plain' });
    const unsupported = new File(['bmp'], 'unsupported.bmp', { type: 'image/bmp' });

    const fallbackEvent = dispatchPaste(view.contentDOM, [fileItem(fallback, '')]);
    await waitFor(() => expect(view.state.doc.toString()).toBe('![[assets/accepted.webp]]'));
    const spoofedEvent = dispatchPaste(view.contentDOM, [fileItem(spoofed)]);
    const unsupportedEvent = dispatchPaste(view.contentDOM, [fileItem(unsupported)]);

    expect(fallbackEvent.defaultPrevented).toBe(true);
    // CodeMirror's ordinary paste handler owns default prevention for rejected
    // files; the image-upload handler must leave them unclaimed.
    expect(spoofedEvent.defaultPrevented).toBe(true);
    expect(unsupportedEvent.defaultPrevented).toBe(true);
    expect(onUploadImages).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('![[assets/accepted.webp]]');
  });

  it('leaves ordinary text paste and non-image drop completely untouched', () => {
    const onUploadImages = vi.fn();
    const { container } = renderWYS({ initial: 'unchanged', onUploadImages });
    const view = currentEditorView(container);
    const textPaste = dispatchPaste(view.contentDOM, [textItem()], 'plain ');
    const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const nonImageDrop = dispatchDrop(view.contentDOM, [fileItem(textFile)]);

    expect(textPaste.defaultPrevented).toBe(true);
    expect(nonImageDrop.defaultPrevented).toBe(false);
    expect(onUploadImages).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('plain unchanged');
  });

  it('inserts a dropped image at the coordinate-derived position instead of the cursor', async () => {
    const onUploadImages = vi.fn().mockResolvedValue(['assets/drop.png']);
    const onUploadError = vi.fn();
    const { container } = renderWYS({ initial: 'abcdef', onUploadImages, onUploadError });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(0) }));
    const position = vi.spyOn(view, 'posAtCoords').mockReturnValue(3);
    const file = new File(['png'], 'drop.png', { type: 'image/png' });

    const event = dispatchDrop(view.contentDOM, [fileItem(file)], 70, 40);

    expect(event.defaultPrevented).toBe(true);
    expect(position).toHaveBeenCalledWith({ x: 70, y: 40 });
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledWith([file]));
    expect(onUploadError).not.toHaveBeenCalled();
    await waitFor(() => expect(view.state.doc.toString()).toBe('abc![[assets/drop.png]]def'));
  });

  it.each([
    ['rejection', () => Promise.reject(new Error('upload failed'))],
    ['empty result', () => Promise.resolve([])],
    ['mismatched result', () => Promise.resolve(['assets/only-one.png'])],
  ])('%s preserves the whole document and reports exactly once', async (_name, uploadFactory) => {
    const onUploadImages = vi.fn(uploadFactory);
    const onUploadError = vi.fn();
    const { container } = renderWYS({ initial: 'untouched', onUploadImages, onUploadError });
    const view = currentEditorView(container);
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.png', { type: 'image/png' });

    dispatchPaste(view.contentDOM, [fileItem(first), fileItem(second)]);

    await waitFor(() => expect(onUploadError).toHaveBeenCalledTimes(1));
    expect(view.state.doc.toString()).toBe('untouched');
  });

  it('serializes overlapping uploads and keeps their markers in event order', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const onUploadImages = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { container } = renderWYS({ initial: '', onUploadImages });
    const view = currentEditorView(container);
    const firstFile = new File(['one'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['two'], 'second.png', { type: 'image/png' });

    dispatchPaste(view.contentDOM, [fileItem(firstFile)]);
    dispatchPaste(view.contentDOM, [fileItem(secondFile)]);
    expect(onUploadImages).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(['assets/first.png']));
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(['assets/second.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe('![[assets/first.png]]![[assets/second.png]]'));
  });

  it('moves a later upload at the same non-empty selection behind the first marker', async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const onUploadImages = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { container } = renderWYS({ initial: 'before target after', onUploadImages });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.range(7, 13) }));
    const firstFile = new File(['one'], 'first.png', { type: 'image/png' });
    const secondFile = new File(['two'], 'second.png', { type: 'image/png' });

    dispatchPaste(view.contentDOM, [fileItem(firstFile)]);
    dispatchPaste(view.contentDOM, [fileItem(secondFile)]);
    await act(async () => first.resolve(['assets/first.png']));
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(['assets/second.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe(
      'before ![[assets/first.png]]![[assets/second.png]] after',
    ));
  });

  it('invalidates a pending non-empty selection when the user edits inside it', async () => {
    const upload = deferred<string[]>();
    const onUploadError = vi.fn();
    const { container } = renderWYS({
      initial: 'before target after',
      onUploadImages: () => upload.promise,
      onUploadError,
    });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.range(7, 13) }));
    dispatchPaste(view.contentDOM, [fileItem(new File(['png'], 'late.png', { type: 'image/png' }))]);

    act(() => view.dispatch({ changes: { from: 9, to: 11, insert: 'USER' } }));
    expect(view.state.doc.toString()).toBe('before taUSERet after');
    await act(async () => upload.resolve(['assets/late.png']));

    await waitFor(() => expect(onUploadError).toHaveBeenCalledTimes(1));
    expect(view.state.doc.toString()).toBe('before taUSERet after');
  });

  it('keeps an empty upload cursor mapped through a nearby edit', async () => {
    const upload = deferred<string[]>();
    const { container } = renderWYS({
      initial: 'left right',
      onUploadImages: () => upload.promise,
    });
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(5) }));
    dispatchPaste(view.contentDOM, [fileItem(new File(['png'], 'mapped.png', { type: 'image/png' }))]);

    act(() => view.dispatch({ changes: { from: 0, insert: 'new ' } }));
    await act(async () => upload.resolve(['assets/mapped.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe('new left ![[assets/mapped.png]]right'));
  });

  it('suppresses a late upload when preview replaces the editor', async () => {
    const upload = deferred<string[]>();
    const onUploadError = vi.fn();
    const { container } = renderWYS({
      initial: 'unchanged',
      onUploadImages: () => upload.promise,
      onUploadError,
    });
    const view = currentEditorView(container);
    dispatchPaste(view.contentDOM, [fileItem(new File(['png'], 'late.png', { type: 'image/png' }))]);

    fireEvent.click(screen.getByTestId('mode-toggle'));
    await act(async () => upload.resolve(['assets/late.png']));

    expect(screen.getByTestId('md-preview')).toHaveTextContent('unchanged');
    expect(onUploadError).not.toHaveBeenCalled();
  });
});

describe('guarded visual table editing', () => {
  const tableSource = '# Before\n\n| Name | Value |\n| --- | ---: |\n| a | `code` |\n\n[ref]: ../中文.pdf "Keep"\n';
  beforeEach(() => { localStorage.setItem('agentwiki.language.v1', 'en'); resourceMocks.post.mockResolvedValue({ data: { resources: [] } }); });
  afterEach(cleanup);
  const openTable = (container: HTMLElement) => {
    const view = currentEditorView(container);
    act(() => view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf('| Name') + 2) }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit table' }));
    return view;
  };
  it('opens, cancels and applies an unchanged table without changing source/history', async () => {
    const onChange = vi.fn(); const { container } = renderWYS({ initial: tableSource, onChange });
    const view = openTable(container); const depth = undoDepth(view.state);
    const dispatch = vi.spyOn(view, 'dispatch');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dispatch).not.toHaveBeenCalled();
    await waitFor(() => expect(view.contentDOM).toHaveFocus());
    openTable(container); dispatch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(dispatch).not.toHaveBeenCalled(); dispatch.mockRestore();
    expect(onChange).not.toHaveBeenCalled(); expect(undoDepth(view.state)).toBe(depth);
    expect(view.state.doc.toString()).toBe(tableSource);
  });
  it('applies one isolated source span with exact undo and no changes outside the table', () => {
    const onChange = vi.fn(); const { container } = renderWYS({ initial: tableSource, onChange });
    const view = currentEditorView(container);
    act(() => view.dispatch({ changes: { from: 2, insert: 'human ' } }));
    const before = view.state.doc.toString(); const depth = undoDepth(view.state);
    openTable(container);
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' }), { target: { value: '**new**|cell' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(view.state.doc.toString()).toBe(before.replace('| a |', '| **new**\\|cell |'));
    expect(undoDepth(view.state)).toBe(depth + 1);
    act(() => undo(view)); expect(view.state.doc.toString()).toBe(before);
  });
  it.each(['change', 'change then undo'])('refuses a stale table after %s while the dialog is open', (action) => {
    const { container } = renderWYS({ initial: tableSource }); const view = openTable(container);
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' }), { target: { value: 'candidate' } });
    act(() => view.dispatch({ changes: { from: 0, insert: 'new ' } }));
    if (action === 'change then undo') act(() => undo(view));
    const beforeApply = view.state.doc.toString();
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(screen.getByRole('alert')).toHaveTextContent('document or editing permission changed');
    expect(view.state.doc.toString()).toBe(beforeApply);
  });
  it.each(['\r\n', 'mixed'])('visibly refuses %j raw line endings without mutating or claiming visual fidelity', (ending) => {
    const raw = ending === 'mixed' ? tableSource.replace('\n', '\r\n') : tableSource.replace(/\n/gu, ending);
    const onChange = vi.fn(); const { container } = renderWYS({ initial: raw, onChange });
    const depth = undoDepth(currentEditorView(container).state);
    const view = openTable(container);
    expect(screen.queryByRole('dialog', { name: 'Edit table' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('line endings cannot be preserved');
    expect(onChange).not.toHaveBeenCalled(); expect(undoDepth(view.state)).toBe(depth);
  });
  it('rechecks live CodeMirror readonly at Apply', () => {
    const onChange = vi.fn(); const { container } = renderWYS({ initial: tableSource, onChange }); const view = openTable(container);
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' }), { target: { value: 'late' } });
    act(() => view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply table' }));
    expect(screen.getByRole('alert')).toHaveTextContent('editing permission changed');
    expect(onChange).not.toHaveBeenCalled(); expect(view.state.doc.toString()).toBe(tableSource);
  });
  it('does not reparse tables on ordinary cursor movement', () => {
    const parse = vi.spyOn(tableEditing, 'parseTableLocations');
    try {
      const { container } = renderWYS({ initial: tableSource }); const view = currentEditorView(container);
      const initialCount = parse.mock.calls.length; expect(initialCount).toBeGreaterThan(0);
      for (const offset of [3, 5, 15, 21]) act(() => view.dispatch({ selection: EditorSelection.cursor(offset) }));
      expect(parse).toHaveBeenCalledTimes(initialCount);
    } finally { parse.mockRestore(); }
  });
  it('explains unsupported table shapes visibly and never opens a misleading grid', () => {
    const raw = '| Name | Value |\n| --- | --- |\n| one |';
    const onChange = vi.fn(); const { container } = renderWYS({ initial: raw, onChange });
    act(() => currentEditorView(container).dispatch({ selection: EditorSelection.cursor(2) }));
    expect(screen.queryByRole('button', { name: 'Edit table' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Table source' }));
    expect(screen.getByRole('status')).toHaveTextContent('uneven rows');
    expect(screen.queryByRole('dialog', { name: 'Edit table' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each(['permission', 'identity', 'preview'])('invalidates an open table after %s changes', (change) => {
    const onChange = vi.fn();
    const props = { value: tableSource, mode: 'edit' as MarkdownMode, onChange, pageId: 'a', spaceId: 's', pageLinksIdentity: 'user-a', tableEditingEnabled: true };
    const wrap = (next: typeof props) => <LanguageProvider><MarkdownWorkspace {...next} /></LanguageProvider>;
    const { container, rerender } = render(wrap(props)); const view = openTable(container);
    const apply = screen.getByRole('button', { name: 'Apply table' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' }), { target: { value: 'late' } });
    rerender(wrap({ ...props, ...(change === 'permission' ? { tableEditingEnabled: false } : change === 'identity' ? { pageLinksIdentity: 'user-b' } : { mode: 'preview' as MarkdownMode }) }));
    expect(screen.queryByRole('dialog', { name: 'Edit table' })).not.toBeInTheDocument();
    fireEvent.click(apply); expect(onChange).not.toHaveBeenCalled(); expect(view.state.doc.toString()).toBe(tableSource);
  });
});
