import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LanguageProvider } from '../../context/LanguageContext';
import type { PageTemplateListResponse } from '../page-templates/pageTemplateTypes';
import { PageEditor } from './PageEditor';

const templateMocks = vi.hoisted(() => ({
  listPageTemplates: vi.fn(),
  createPageTemplate: vi.fn(),
}));

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
vi.mock('../page-templates/pageTemplateApi', () => ({
  listPageTemplates: templateMocks.listPageTemplates,
  createPageTemplate: templateMocks.createPageTemplate,
}));

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

const catalog = (canManage = true): PageTemplateListResponse => ({
  system: [], space: [], totalSpace: 0, skip: 0, take: 1,
  capabilities: { canManage },
});

const createdTemplate = {
  id: 'template-1', scope: 'space' as const, stableKey: 'original-title', category: 'other' as const,
  name: 'Original title', description: '', defaultTitle: 'Original title', sourceLocale: 'en' as const,
  currentVersion: 1, archivedAt: null, updatedAt: '2026-08-25T10:01:00.000Z',
  content: 'Original content', contentLocale: 'en' as const, sourcePageId: 'page-1',
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

const renderEditor = (withLanguageSwitcher = false) => render(
  <LanguageProvider>
    {withLanguageSwitcher ? <LanguageSwitcher /> : null}
    <MemoryRouter initialEntries={['/pages/page-1/edit']}>
      <Routes>
        <Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} />
        <Route path="/pages/:id" element={<DirectEditRedirectTarget />} />
      </Routes>
    </MemoryRouter>
  </LanguageProvider>,
);

const DirectEditRedirectTarget = () => {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <p>{`${location.pathname}:${navigationType}`}</p>;
};

const expectNoWritableWorkspace = (container: HTMLElement) => {
  expect(container.querySelector('.cm-editor')).not.toBeInTheDocument();
  expect(screen.queryByTestId('md-editor-surface')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('assist-toggle')).not.toBeInTheDocument();
};

const NavigationHarness = () => {
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => navigate('/pages/page-2/edit')}>Navigate to second page</button>
    <Routes>
      <Route path="/pages/:id/edit" element={<PageEditor />} />
      <Route path="/pages/:id" element={<DirectEditRedirectTarget />} />
    </Routes>
  </>;
};

describe('PageEditor remote update safety', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.setItem('agentwiki.language.v1', 'en');
    workspaceRef = { current: null };
    socketMock.handlers.clear();
    socketMock.socket.emit.mockClear();
    socketMock.socket.disconnect.mockClear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.patch).mockReset();
    templateMocks.listPageTemplates.mockReset();
    templateMocks.createPageTemplate.mockReset();
    templateMocks.listPageTemplates.mockResolvedValue(catalog(false));
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

  it('redirects a viewer from the direct-edit route without rendering a writable workspace', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const deniedPage = deferred<any>();
    queuePages(deniedPage.promise);

    const { container } = renderEditor();
    expectNoWritableWorkspace(container);

    await act(async () => deniedPage.resolve({ data: page({ capabilities: { canEdit: false } }) }));

    expect(await screen.findByText('/pages/page-1:REPLACE')).toBeInTheDocument();
    expect(alertSpy).toHaveBeenCalledWith('Access Denied');
    expectNoWritableWorkspace(container);
  });

  it('ignores a stale denied response after navigating to another edit route', async () => {
    const deniedFirstPage = deferred<any>();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') return deniedFirstPage.promise;
      if (url === '/pages/page-2') {
        return Promise.resolve({ data: page({
          id: 'page-2',
          title: 'Second page',
          content: 'Second content',
          capabilities: { canEdit: true },
        }) } as any);
      }
      if (url.includes('spaceId=')) return Promise.resolve({ data: { data: [] } } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();

    await act(async () => deniedFirstPage.resolve({
      data: page({ capabilities: { canEdit: false } }),
    }));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Second page')).toBeInTheDocument();
    expect(screen.queryByText('/pages/page-1:REPLACE')).not.toBeInTheDocument();
  });

  it('clears the A Space index before B resolves its preview wiki-link target', async () => {
    const indexB = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ content: '[[Shared]]', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: '[[Shared]]', spaceId: 'space-b',
      }) } as any);
      if (url === '/pages?spaceId=space-a&take=200') return Promise.resolve({ data: { data: [{ id: 'target-a', title: 'Shared' }] } } as any);
      if (url === '/pages?spaceId=space-b&take=200') return indexB.promise;
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    await screen.findByDisplayValue('Original title');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-a');
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Shared' })).not.toBeInTheDocument();
    await act(async () => indexB.resolve({ data: { data: [{ id: 'target-b', title: 'Shared' }] } }));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
  });

  it('ignores a deferred A Space index after B preview links have resolved', async () => {
    const oldIndexA = deferred<any>();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ content: '[[Shared]]', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: '[[Shared]]', spaceId: 'space-b',
      }) } as any);
      if (url === '/pages?spaceId=space-a&take=200') return oldIndexA.promise;
      if (url === '/pages?spaceId=space-b&take=200') return Promise.resolve({ data: { data: [{ id: 'target-b', title: 'Shared' }] } } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    await waitFor(() => expect(
      vi.mocked(api.get).mock.calls.some(([url]) => url === '/pages?spaceId=space-a&take=200'),
    ).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');

    await act(async () => oldIndexA.resolve({ data: { data: [{ id: 'stale-target-a', title: 'Shared' }] } }));

    expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
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

    const saveFailure = await screen.findByText(/Page changed after this editor loaded it/);
    expect(saveFailure.parentElement).toHaveAttribute('role', 'alert');
    expect(await screen.findByText(/newer remote version is available/i)).toBeInTheDocument();
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
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
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

  it('shows Save as Space template only with server management capability', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();

    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(templateMocks.listPageTemplates).toHaveBeenCalledWith('space-1', {
      locale: 'en', scope: 'space', take: 1,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));

    expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeEnabled();
  });

  it('requires saving dirty content before opening the template dialog', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();

    const title = await screen.findByDisplayValue('Original title');
    const trigger = await screen.findByRole('button', { name: 'More page actions' });
    fireEvent.change(title, { target: { value: 'Dirty' } });
    fireEvent.click(trigger);

    expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeDisabled();
    const reason = screen.getByText('Save the page before creating a template.');
    expect(reason).toHaveAttribute('id', 'save-page-template-blocked-reason');
    expect(trigger).toHaveAttribute('aria-describedby', 'save-page-template-blocked-reason');
    expect(screen.queryByRole('dialog', { name: 'Save as Space template' })).not.toBeInTheDocument();
  });

  it('persists pristine socket content before saving that page as a template', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    vi.mocked(api.patch).mockResolvedValue({
      data: page({
        content: 'Remote live content',
        updatedAt: '2026-07-27T08:05:00.000Z',
      }),
    } as any);
    templateMocks.createPageTemplate.mockResolvedValue({
      ...createdTemplate,
      content: 'Remote live content',
    });
    renderEditor();

    await screen.findByDisplayValue('Original title');
    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote live content',
      userId: 'remote-socket',
      version: 10,
    }));

    expect(contentEditorValue()).toBe('Remote live content');
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
    expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
      title: 'Original title',
      content: 'Remote live content',
      expectedUpdatedAt: '2026-07-27T08:00:00.000Z',
    }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as Space template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(templateMocks.createPageTemplate).toHaveBeenCalledWith(
      'space-1', expect.objectContaining({
        sourcePageId: 'page-1',
        expectedSourceUpdatedAt: '2026-07-27T08:05:00.000Z',
      }),
    ));
  });

  it('invalidates an open template snapshot when collaboration content becomes an unsaved draft', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    templateMocks.createPageTemplate.mockResolvedValue(createdTemplate);
    renderEditor();

    await screen.findByDisplayValue('Original title');
    fireEvent.click(await screen.findByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as Space template' }));
    const staleSubmit = screen.getByRole('button', { name: 'Save template' });

    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote live content',
      userId: 'remote-socket',
      version: 10,
    }));

    expect(contentEditorValue()).toBe('Remote live content');
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
    fireEvent.click(staleSubmit);
    expect(screen.queryByRole('dialog', { name: 'Save as Space template' })).not.toBeInTheDocument();
    expect(templateMocks.createPageTemplate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'More page actions' }));
    expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toBeDisabled();
  });

  it('does not request or show template actions for non-Markdown pages', async () => {
    queuePages({ data: page({ format: 'html' }) });
    renderEditor();

    await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'More page actions' })).not.toBeInTheDocument();
    expect(templateMocks.listPageTemplates).not.toHaveBeenCalled();
  });

  it('hides template actions when the server capability request fails', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockRejectedValue(new Error('offline'));
    renderEditor();

    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(templateMocks.listPageTemplates).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'More page actions' })).not.toBeInTheDocument();
  });

  it('closes the More menu on Escape and outside click and returns focus on Escape', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();
    const trigger = await screen.findByRole('button', { name: 'More page actions' });

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toHaveFocus());
  });

  it('gives the More menu an accessible name that matches its trigger', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();
    const trigger = await screen.findByRole('button', { name: 'More page actions' });

    fireEvent.click(trigger);

    expect(screen.getByRole('menu', { name: 'More page actions' })).toBeInTheDocument();
  });

  it.each([8, 358])('clamps the More menu inside a 390px viewport from trigger left %i', async (triggerLeft) => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();
    const trigger = await screen.findByRole('button', { name: 'More page actions' });
    const rect = (left: number, width: number, top = 8, height = 32): DOMRect => ({
      x: left, y: top, left, right: left + width, top, bottom: top + height, width, height,
      toJSON: () => ({}),
    });
    const viewport = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    const geometry = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === trigger) return rect(triggerLeft, 32);
      if (this.getAttribute('role') === 'menu') return rect(0, 256);
      return rect(0, 0, 0, 0);
    });

    try {
      fireEvent.click(trigger);
      const menu = await screen.findByRole('menu');
      await waitFor(() => expect(menu.style.left).not.toBe(''));
      const left = Number.parseFloat(menu.style.left);
      const width = Number.parseFloat(menu.style.width);

      expect(left).toBeGreaterThanOrEqual(16);
      expect(left + width).toBeLessThanOrEqual(374);
    } finally {
      geometry.mockRestore();
      viewport.mockRestore();
    }
  });

  it('closes an open More menu when viewport geometry changes', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    renderEditor();
    const trigger = await screen.findByRole('button', { name: 'More page actions' });

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toHaveFocus());
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Save as Space template' })).toHaveFocus());
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ignores stale capability responses after a page route switch', async () => {
    const staleCapability = deferred<PageTemplateListResponse>();
    templateMocks.listPageTemplates
      .mockImplementationOnce(() => staleCapability.promise)
      .mockResolvedValueOnce(catalog(false));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('spaceId=')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page() } as any);
      return Promise.resolve({ data: page({ id: 'page-2', title: 'Second page', spaceId: 'space-2' }) } as any);
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    await screen.findByDisplayValue('Original title');
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    await screen.findByDisplayValue('Second page');
    await act(async () => staleCapability.resolve(catalog(true)));

    expect(screen.queryByRole('button', { name: 'More page actions' })).not.toBeInTheDocument();
  });

  it('ignores a stale capability response after the language identity changes', async () => {
    const staleCapability = deferred<PageTemplateListResponse>();
    queuePages({ data: page() });
    templateMocks.listPageTemplates
      .mockImplementationOnce(() => staleCapability.promise)
      .mockResolvedValueOnce(catalog(false));
    renderEditor(true);

    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(templateMocks.listPageTemplates).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    await waitFor(() => expect(templateMocks.listPageTemplates).toHaveBeenCalledTimes(2));
    await act(async () => staleCapability.resolve(catalog(true)));

    expect(screen.queryByRole('button', { name: 'More page actions' })).not.toBeInTheDocument();
  });

  it('closes an old template dialog on route switch', async () => {
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('spaceId=')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page() } as any);
      return Promise.resolve({ data: page({ id: 'page-2', title: 'Second page', spaceId: 'space-2' }) } as any);
    });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    await screen.findByDisplayValue('Original title');
    fireEvent.click(await screen.findByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as Space template' }));
    expect(screen.getByRole('dialog', { name: 'Save as Space template' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Save as Space template' })).not.toBeInTheDocument();
  });

  it('reports template success without changing editor content, dirty state, or persisted timestamp', async () => {
    queuePages({ data: page() });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    templateMocks.createPageTemplate.mockResolvedValue(createdTemplate);
    vi.mocked(api.patch).mockResolvedValue({ data: page({ title: 'After template', updatedAt: '2026-08-25T10:02:00.000Z' }) } as any);
    renderEditor();

    const title = await screen.findByDisplayValue('Original title');
    fireEvent.click(await screen.findByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as Space template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    const templateCreated = await screen.findByText('Template created');
    expect(templateCreated.parentElement).toHaveAttribute('role', 'status');
    expect(templateCreated.parentElement).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(title).toHaveValue('Original title');
    expect(contentEditorValue()).toBe('Original content');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(title, { target: { value: 'After template' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-1', {
      title: 'After template', content: 'Original content', expectedUpdatedAt: '2026-07-27T08:00:00.000Z',
    }));
  });

  it('freezes the page identity, title, and stale-write token when the template dialog opens', async () => {
    queuePages(
      { data: page() },
      { data: page({ title: 'Remote B', updatedAt: '2026-07-27T08:05:00.000Z' }) },
    );
    templateMocks.listPageTemplates.mockResolvedValue(catalog(true));
    templateMocks.createPageTemplate.mockResolvedValue(createdTemplate);
    renderEditor();

    await screen.findByDisplayValue('Original title');
    fireEvent.click(await screen.findByRole('button', { name: 'More page actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save as Space template' }));
    expect(screen.getByLabelText('Template name')).toHaveValue('Original title');

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Remote B')).toBeInTheDocument();
    expect(screen.getByLabelText('Template name')).toHaveValue('Original title');
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() => expect(templateMocks.createPageTemplate).toHaveBeenCalledWith(
      'space-1', expect.objectContaining({
        sourcePageId: 'page-1',
        name: 'Original title',
        expectedSourceUpdatedAt: '2026-07-27T08:00:00.000Z',
      }),
    ));
  });

  it('keeps edited page titles within the server-valid 200 Unicode boundary', async () => {
    queuePages({ data: page() });
    renderEditor();
    const title = await screen.findByDisplayValue('Original title');

    fireEvent.change(title, { target: { value: '😀'.repeat(201) } });

    expect(title).toHaveValue('😀'.repeat(200));
  });
});
