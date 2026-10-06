import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo, undoDepth } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import type { PageLinkTarget } from '../markdownLinks';
import { DocumentTools } from './DocumentTools';

const deferred = () => {
  let resolve!: (value: PageLinkTarget[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<PageLinkTarget[]>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
};
const page = (id: string, title = id) => ({ id, title });
const request = () => vi.fn<(query?: string, signal?: AbortSignal) => Promise<PageLinkTarget[]>>().mockResolvedValue([]);
let editor: EditorView;
let editorHost: HTMLDivElement;
const renderTools = (provider = request(), pages: PageLinkTarget[] = []) => render(
  <LanguageProvider><DocumentTools view={() => editor} selection={{ from: 0, to: 0, text: '' }} pages={pages} spaceId="s" onRequestPageLinks={provider} /></LanguageProvider>,
);
const open = async () => { await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Page link' }))); };
const search = (query: string) => fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
const tick = async (ms = 300) => { await act(async () => vi.advanceTimersByTime(ms)); };

describe('Space page-link picker', () => {
  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    vi.useFakeTimers();
    editorHost = document.createElement('div'); document.body.append(editorHost);
    editor = new EditorView({ parent: editorHost, state: EditorState.create({ doc: 'Original text', extensions: [history()] }) });
  });
  afterEach(() => { cleanup(); editor.destroy(); editorHost.remove(); vi.useRealTimers(); });

  it('debounces Space search and retains body-only matches absent from recent pages', async () => {
    const provider = request().mockResolvedValueOnce([page('recent')]).mockResolvedValueOnce([page('old-101', 'Unrelated title')]);
    renderTools(provider); await open();
    expect(provider).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(screen.getByText(/100 recent/)).toBeInTheDocument();
    search('body term');
    expect(screen.queryByRole('button', { name: 'recent recent' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    await tick(299); expect(provider).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(provider).toHaveBeenLastCalledWith('body term', expect.any(AbortSignal));
    expect(screen.getByRole('button', { name: 'Unrelated title old-101' })).toBeInTheDocument();
    expect(screen.getByText(/50 authorized/)).toBeInTheDocument();
  });

  it('cancels old queries immediately and ignores late results during the next debounce', async () => {
    const first = deferred(); const second = deferred();
    const provider = request().mockResolvedValueOnce([]).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderTools(provider); await open(); search('first'); await tick();
    const oldSignal = provider.mock.calls[1][1]!;
    search('second'); expect(oldSignal.aborted).toBe(true);
    await act(async () => first.resolve([page('stale')]));
    expect(screen.queryByRole('button', { name: 'stale stale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await tick(); await act(async () => second.resolve([page('current')]));
    expect(screen.getByRole('button', { name: 'current current' })).toBeInTheDocument();
  });

  it.each(['close', 'unmount'])('cancels requests on %s and never reports cancellation as failure', async (action) => {
    const response = deferred(); const provider = request().mockReturnValue(response.promise);
    const mounted = renderTools(provider); await open();
    const signal = provider.mock.calls[0][1]!;
    if (action === 'close') fireEvent.click(screen.getByRole('button', { name: 'Close' })); else mounted.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => response.reject(new DOMException('Cancelled', 'AbortError')));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes during debounce without sending the query, and reopens independently of an old completion', async () => {
    const old = deferred(); const provider = request().mockReturnValueOnce(old.promise).mockResolvedValueOnce([page('new')]);
    renderTools(provider); await open(); search('never sent');
    fireEvent.keyDown(document, { key: 'Escape' }); await tick();
    expect(provider).toHaveBeenCalledTimes(1);
    await open(); await act(async () => old.resolve([page('private old')]));
    expect(screen.getByRole('button', { name: 'new new' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'private old private old' })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('retries the same query with the original selection and makes one isolated undo step', async () => {
    act(() => editor.dispatch({ changes: { from: 13, insert: ' human' }, selection: EditorSelection.range(0, 8) }));
    const depth = undoDepth(editor.state);
    const provider = request().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([page('target', 'Document')]);
    renderTools(provider); await open(); search('phrase'); await tick();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not');
    act(() => editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await tick();
    expect(screen.getByRole('searchbox')).toHaveValue('phrase');
    expect(provider.mock.calls.map(([query]) => query)).toEqual(['', 'phrase', 'phrase']);
    fireEvent.click(screen.getByRole('button', { name: 'Document target' }));
    expect(editor.state.doc.toString()).toBe('[[target|Document]] text human');
    expect(undoDepth(editor.state)).toBe(depth + 1);
    act(() => undo(editor)); expect(editor.state.doc.toString()).toBe('Original text human');
  });

  it('keeps the original source proof after retry and refuses changed source', async () => {
    const provider = request().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([page('target')]);
    renderTools(provider); await open(); search('phrase'); await tick();
    act(() => editor.dispatch({ changes: { from: 0, insert: 'changed ' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await tick();
    fireEvent.click(screen.getByRole('button', { name: 'target target' }));
    expect(editor.state.doc.toString()).toBe('changed Original text');
    expect(screen.getByRole('alert')).toHaveTextContent('selection changed');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('distinguishes query failure and empty search from loading', async () => {
    const provider = request().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    renderTools(provider); await open(); search('failed'); await tick();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No matching authorized pages')).not.toBeInTheDocument();
    search('empty'); expect(screen.queryByRole('alert')).not.toBeInTheDocument(); await tick();
    expect(screen.getByText('No matching authorized pages')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps local filtering for provided pages without a request callback', async () => {
    render(<LanguageProvider><DocumentTools view={() => editor} selection={{ from: 0, to: 0, text: '' }} spaceId="s" pages={[page('a', 'First'), page('b', 'Second')]} /></LanguageProvider>);
    await open(); search('second');
    expect(screen.getByRole('button', { name: 'Second b' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First a' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
