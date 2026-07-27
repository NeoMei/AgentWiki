import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LanguageProvider } from '../../context/LanguageContext';
import { PageEditor } from './PageEditor';

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket: any = {
    id: 'local-socket',
    connected: true,
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  socket.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
    handlers.set(event, handler);
    return socket;
  });
  return { handlers, socket };
});

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Editor', email: 'editor@example.com' } }),
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socketMock.socket) }));

// Per-test queue of page-detail responses. The wiki-link space index fetch is
// answered separately so it never consumes this queue.
let pageQueue: any[] = [];
const queuePages = (...responses: any[]) => { pageQueue = responses; };

// Drive editor content through the workspace handle (CodeMirror does not
// expose a simple per-line editable DOM in jsdom).
let workspaceRef: { current: import('../../components/MarkdownWorkspace').MarkdownWorkspaceHandle | null };

const editContent = (next: string) => {
  act(() => workspaceRef.current?.simulateChange(next));
};

const contentEditorValue = () => {
  return workspaceRef.current?.currentValue() ?? '';
};

const page = (overrides: Record<string, unknown> = {}) => ({
  id: 'page-1',
  title: 'Original title',
  content: 'Original content',
  format: 'markdown',
  spaceId: 'space-1',
  updatedAt: '2026-07-27T08:00:00.000Z',
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderEditor = (withLanguageSwitcher = false) => render(
  <LanguageProvider>
    {withLanguageSwitcher ? <LanguageSwitcher /> : null}
    <MemoryRouter initialEntries={['/pages/page-1/edit']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes><Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} /></Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

const NavigationHarness = () => {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate('/pages/page-2/edit')}>Navigate to second page</button>
    <Routes><Route path="/pages/:id/edit" element={<PageEditor />} /></Routes>
  </>;
};

describe('PageEditor remote update safety', () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    workspaceRef = { current: null };
    socketMock.handlers.clear();
    socketMock.socket.emit.mockClear();
    socketMock.socket.disconnect.mockClear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.patch).mockReset();
    pageQueue = [];
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('spaceId=')) {
        return Promise.resolve({ data: { data: [] } } as any);
      }
      const next = pageQueue.shift();
      if (!next) return Promise.reject(new Error('unexpected get ' + url));
      return Promise.resolve(next);
    });
  });

  it('preserves a dirty draft across repeated remote refreshes and accepts only the latest remote version explicitly', async () => {
    queuePages({ data: page() }, { data: page({ title: 'Remote v2', content: 'Remote content v2', updatedAt: '2026-07-27T08:01:00.000Z' }) }, { data: page({ title: 'Remote v3', content: 'Remote content v3', updatedAt: '2026-07-27T08:02:00.000Z' }) });

    renderEditor();
    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'My local title' } });
    editContent('My local content');

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer remote version is available');
    expect(title).toHaveValue('My local title');
    expect(contentEditorValue()).toBe('My local content');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(
      vi.mocked(api.get).mock.calls.filter(([url]) => typeof url === 'string' && !url.includes('spaceId=')),
    ).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: 'Accept remote version' }));

    expect(title).toHaveValue('Remote v3');
    expect(contentEditorValue()).toBe('Remote content v3');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the local draft and its original version token so a save is protected by the server', async () => {
    queuePages({ data: page() }, { data: page({ title: 'Remote title', content: 'Remote content', updatedAt: '2026-07-27T08:05:00.000Z' }) });
    vi.mocked(api.patch).mockResolvedValue({
      data: page({ title: 'My local title', content: 'My local content', updatedAt: '2026-07-27T08:06:00.000Z' }),
    } as any);

    renderEditor();
    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'My local title' } });
    editContent('My local content');

    await act(async () => window.dispatchEvent(new Event('focus')));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep local draft' }));
    expect(title).toHaveValue('My local title');
    expect(contentEditorValue()).toBe('My local content');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
      title: 'My local title',
      content: 'My local content',
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z',
    }));
  });

  it('refreshes a pristine form safely and uses the refreshed version for the next save', async () => {
    queuePages({ data: page() }, { data: page({ title: 'Remote title', content: 'Remote content', updatedAt: '2026-07-27T08:05:00.000Z' }) });
    vi.mocked(api.patch).mockResolvedValue({ data: page({ updatedAt: '2026-07-27T08:06:00.000Z' }) } as any);

    renderEditor();
    await screen.findByDisplayValue('Original title', undefined, { timeout: 3000 });
    await act(async () => window.dispatchEvent(new Event('focus')));

    const title = await screen.findByDisplayValue('Remote title');
    expect(contentEditorValue()).toBe('Remote content');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.change(title, { target: { value: 'Local after refresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
      title: 'Local after refresh',
      content: 'Remote content',
      expectedUpdatedAt: '2026-07-27T08:05:00.000Z',
    }));
  });

  it('ignores a duplicate accepted collaboration version but surfaces the next version', async () => {
    queuePages({ data: page() });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Local content');

    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote live content',
      userId: 'remote-socket',
      version: 10,
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept remote version' }));
    editContent('Local after accept');

    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote live content',
      userId: 'remote-socket',
      version: 10,
    }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Newer remote live content',
      userId: 'remote-socket',
      version: 11,
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer remote version is available');
    expect(contentEditorValue()).toBe('Local after accept');
  });

  it('does not treat a language change as navigation or overwrite a dirty draft', async () => {
    queuePages({ data: page() }, { data: page({ title: 'Remote title', content: 'Remote content', updatedAt: '2026-07-27T08:05:00.000Z' }) });
    renderEditor(true);
    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'Local title' } });
    editContent('Local content');

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));

    await waitFor(() => expect(title).toHaveValue('Local title'));
    expect(contentEditorValue()).toBe('Local content');
    expect(screen.getByText(/未保存/)).toBeInTheDocument();
  });

  it('keeps edits dirty after a failed save and offers the latest remote state after a 409', async () => {
    queuePages({ data: page() }, { data: page({ title: 'Latest remote', content: 'Latest remote content', updatedAt: '2026-07-27T08:09:00.000Z' }) });
    vi.mocked(api.patch).mockRejectedValueOnce({
      response: { status: 409, data: { message: 'Page changed after this editor loaded it' } },
    });
    renderEditor();
    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'Local title' } });
    editContent('Local content');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Page changed after this editor loaded it/)).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(title).toHaveValue('Local title');
    expect(contentEditorValue()).toBe('Local content');
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
  });

  it('does not mark edits made during a save as clean and advances the version token after success', async () => {
    const firstSave = deferred<any>();
    queuePages({ data: page() });
    vi.mocked(api.patch)
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce({ data: page({ content: 'Second edit', updatedAt: '2026-07-27T08:02:00.000Z' }) } as any);
    renderEditor();
    await screen.findByDisplayValue('Original title');
    editContent('First edit');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    editContent('Second edit');

    await act(async () => firstSave.resolve({
      data: page({ content: 'First edit', updatedAt: '2026-07-27T08:01:00.000Z' }),
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(contentEditorValue()).toBe('Second edit');
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/pages/page-1', {
      title: 'Original title',
      content: 'Second edit',
      expectedUpdatedAt: '2026-07-27T08:01:00.000Z',
    }));
  });

  it('ignores a late page response after navigation and aborts the obsolete request', async () => {
    const oldPage = deferred<any>();
    let oldSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === '/pages/page-1') {
        oldSignal = config?.signal as AbortSignal;
        return oldPage.promise;
      }
      return Promise.resolve({ data: page({ id: 'page-2', title: 'Second page', content: 'Second content' }) } as any);
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();
    expect(oldSignal?.aborted).toBe(true);

    await act(async () => oldPage.resolve({ data: page({ title: 'Late old page' }) } as any));
    expect(screen.queryByDisplayValue('Late old page')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Second page')).toBeInTheDocument();
  });
});
