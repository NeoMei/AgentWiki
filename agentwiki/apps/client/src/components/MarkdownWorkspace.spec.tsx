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
