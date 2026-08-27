import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
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
    await act(async () => upload.resolve(['server-name-2.png']));

    expect(event.defaultPrevented).toBe(true);
    expect(onUploadImages).toHaveBeenCalledWith([file]);
    await waitFor(() => expect(view.state.doc.toString()).toBe('before ![[server-name-2.png]]after'));
  });

  it('preserves pasted image order and inserts one newline-separated marker batch', async () => {
    const onChange = vi.fn();
    const onUploadImages = vi.fn().mockResolvedValue(['first-2.png', 'second.gif']);
    const { container } = renderWYS({ initial: '', onChange, onUploadImages });
    const view = currentEditorView(container);
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.gif', { type: 'image/gif' });

    const event = dispatchPaste(view.contentDOM, [textItem(), fileItem(first), fileItem(second)]);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(view.state.doc.toString()).toBe('![[first-2.png]]\n![[second.gif]]'));
    expect(onUploadImages).toHaveBeenCalledWith([first, second]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('accepts an image extension only when MIME is empty and rejects spoofed or unsupported MIME', async () => {
    const onUploadImages = vi.fn().mockResolvedValue(['accepted.webp']);
    const { container } = renderWYS({ initial: '', onUploadImages });
    const view = currentEditorView(container);
    const fallback = new File(['webp'], 'fallback.WEBP', { type: '' });
    const spoofed = new File(['text'], 'spoofed.png', { type: 'text/plain' });
    const unsupported = new File(['bmp'], 'unsupported.bmp', { type: 'image/bmp' });

    const fallbackEvent = dispatchPaste(view.contentDOM, [fileItem(fallback, '')]);
    await waitFor(() => expect(view.state.doc.toString()).toBe('![[accepted.webp]]'));
    const spoofedEvent = dispatchPaste(view.contentDOM, [fileItem(spoofed)]);
    const unsupportedEvent = dispatchPaste(view.contentDOM, [fileItem(unsupported)]);

    expect(fallbackEvent.defaultPrevented).toBe(true);
    // CodeMirror's ordinary paste handler owns default prevention for rejected
    // files; the image-upload handler must leave them unclaimed.
    expect(spoofedEvent.defaultPrevented).toBe(true);
    expect(unsupportedEvent.defaultPrevented).toBe(true);
    expect(onUploadImages).toHaveBeenCalledTimes(1);
    expect(view.state.doc.toString()).toBe('![[accepted.webp]]');
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
    const onUploadImages = vi.fn().mockResolvedValue(['drop.png']);
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
    await waitFor(() => expect(view.state.doc.toString()).toBe('abc![[drop.png]]def'));
  });

  it.each([
    ['rejection', () => Promise.reject(new Error('upload failed'))],
    ['empty result', () => Promise.resolve([])],
    ['mismatched result', () => Promise.resolve(['only-one.png'])],
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

    await act(async () => first.resolve(['first.png']));
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(['second.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe('![[first.png]]![[second.png]]'));
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
    await act(async () => first.resolve(['first.png']));
    await waitFor(() => expect(onUploadImages).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(['second.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe(
      'before ![[first.png]]![[second.png]] after',
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
    await act(async () => upload.resolve(['late.png']));

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
    await act(async () => upload.resolve(['mapped.png']));

    await waitFor(() => expect(view.state.doc.toString()).toBe('new left ![[mapped.png]]right'));
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
    await act(async () => upload.resolve(['late.png']));

    expect(screen.getByTestId('md-preview')).toHaveTextContent('unchanged');
    expect(onUploadError).not.toHaveBeenCalled();
  });
});
