import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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

const attachmentMocks = vi.hoisted(() => ({
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  archiveAttachment: vi.fn(),
  restoreAttachment: vi.fn(),
}));

const contentTreeMocks = vi.hoisted(() => ({
  getContentTreeRevision: vi.fn(),
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

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'Editor', email: 'editor@example.com' } }),
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socketMock.socket) }));
vi.mock('../page-templates/pageTemplateApi', () => ({
  listPageTemplates: templateMocks.listPageTemplates,
  createPageTemplate: templateMocks.createPageTemplate,
}));
vi.mock('../attachments/attachmentApi', () => ({
  listAttachments: attachmentMocks.listAttachments,
  uploadAttachment: attachmentMocks.uploadAttachment,
  archiveAttachment: attachmentMocks.archiveAttachment,
  restoreAttachment: attachmentMocks.restoreAttachment,
}));
vi.mock('../../api/content-tree', () => ({ getContentTreeRevision: contentTreeMocks.getContentTreeRevision }));

// Per-test queue of page-detail responses.
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

const attachment = (displayName: string, overrides: Record<string, unknown> = {}) => ({
  id: `attachment-${displayName}`,
  spaceId: 'space-1',
  displayName,
  mimeType: 'image/png',
  sizeBytes: 3n,
  width: 10,
  height: 10,
  status: 'active' as const,
  uploadedByUserId: 'user-1',
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
  archivedAt: null,
  ...overrides,
});

const currentEditorView = () => {
  const editor = document.querySelector('.cm-editor') as HTMLElement | null;
  if (!editor) throw new Error('CodeMirror editor not found');
  const view = EditorView.findFromDOM(editor);
  if (!view) throw new Error('CodeMirror view not found');
  return view;
};

const pasteImages = (files: File[]) => {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      files: [],
      getData: () => '',
    },
  });
  fireEvent(currentEditorView().contentDOM, event);
  return event;
};

const pasteImage = (file: File) => pasteImages([file]);

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
    vi.mocked(api.post).mockReset();
    contentTreeMocks.getContentTreeRevision.mockReset();
    contentTreeMocks.getContentTreeRevision.mockResolvedValue('31');
    templateMocks.listPageTemplates.mockReset();
    templateMocks.createPageTemplate.mockReset();
    templateMocks.listPageTemplates.mockResolvedValue(catalog(false));
    attachmentMocks.listAttachments.mockReset();
    attachmentMocks.uploadAttachment.mockReset();
    attachmentMocks.archiveAttachment.mockReset();
    attachmentMocks.restoreAttachment.mockReset();
    attachmentMocks.listAttachments.mockResolvedValue({ items: [], total: 0, skip: 0, take: 20 });
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
          capabilities: { canEdit: true, canManageAttachments: true },
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

  it('clears the A Space resolver before B resolves its preview wiki-link target', async () => {
    const resolverB = deferred<any>();
    vi.mocked(api.post).mockImplementation((url: string, body: any) => {
      const response = { data: [{
        key: body.references[0].key,
        status: 'resolved',
        kind: 'page',
        pageId: url.includes('space-a') ? 'target-a' : 'target-b',
        title: 'Shared',
        slug: 'shared',
      }] } as any;
      return url.includes('space-b') ? resolverB.promise.then(() => response) : Promise.resolve(response);
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ content: '[[Shared]]', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: '[[Shared]]', spaceId: 'space-b',
      }) } as any);
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
    await act(async () => resolverB.resolve({}));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
  });

  it('previews resources with the current authoritative page and Space context', async () => {
    queuePages({ data: page({
      title: 'Self preview',
      content: '![[Self preview]]',
      capabilities: { canEdit: true, canManageAttachments: true },
    }) });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') {
        const next = pageQueue.shift();
        if (!next) return Promise.reject(new Error(`unexpected get ${url}`));
        return Promise.resolve(next);
      }
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    vi.mocked(api.post).mockImplementation((_url: string, body: any) => Promise.resolve({ data: [{
      key: body.references[0].key,
      status: 'resolved',
      kind: 'page',
      pageId: 'page-1',
      title: 'Self preview',
      slug: 'self-preview',
    }] } as any));

    renderEditor();
    await screen.findByDisplayValue('Self preview');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText('A circular embed was stopped.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith(
      '/spaces/space-1/markdown/resolve',
      expect.anything(),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).startsWith('/pages?'))).toBe(false);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-1')).toHaveLength(1);
  });

  it('ignores a deferred A Space resolver after B preview links have resolved', async () => {
    const oldResolverA = deferred<any>();
    vi.mocked(api.post).mockImplementation((url: string, body: any) => {
      const response = { data: [{
        key: body.references[0].key,
        status: 'resolved',
        kind: 'page',
        pageId: url.includes('space-a') ? 'stale-target-a' : 'target-b',
        title: 'Shared',
        slug: 'shared',
      }] } as any;
      return url.includes('space-a') ? oldResolverA.promise.then(() => response) : Promise.resolve(response);
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ content: '[[Shared]]', spaceId: 'space-a' }) } as any);
      if (url === '/pages/page-2') return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: '[[Shared]]', spaceId: 'space-b',
      }) } as any);
      return Promise.reject(new Error(`unexpected get ${url}`));
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}>
      <NavigationHarness />
    </MemoryRouter></LanguageProvider>);

    await waitFor(() => expect(
      vi.mocked(api.post).mock.calls.some(([url]) => url === '/spaces/space-a/markdown/resolve'),
    ).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');

    await act(async () => oldResolverA.resolve({}));

    expect(screen.getByRole('link', { name: 'Shared' })).toHaveAttribute('href', '/pages/target-b');
    expect(vi.mocked(api.get).mock.calls.some(([url]) => String(url).startsWith('/pages?'))).toBe(false);
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
      expectedTreeRevision: '31',
    }));
    expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledWith('space-1');
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
      expectedTreeRevision: '31',
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
      content: 'Second edit',
      expectedUpdatedAt: '2026-07-27T08:01:00.000Z',
    }));
    expect(contentTreeMocks.getContentTreeRevision).not.toHaveBeenCalled();
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
      expectedTreeRevision: '31',
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

  it('shows the attachment picker only for an authorized Markdown editor in edit mode', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    const first = renderEditor();
    const trigger = await screen.findByRole('button', { name: 'Image attachments' });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    first.unmount();

    queuePages({ data: page() });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    cleanup();

    queuePages({ data: page({ format: 'html', capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
  });

  it('inserts an existing attachment at the live selection, closes, restores focus, and marks dirty', async () => {
    attachmentMocks.listAttachments.mockResolvedValue({
      items: [attachment('diagram.png')], total: 1, skip: 0, take: 20,
    });
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    const trigger = await screen.findByRole('button', { name: 'Image attachments' });
    const view = currentEditorView();
    act(() => view.dispatch({ selection: EditorSelection.range(9, 16) }));

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: 'Insert diagram.png' }));

    await waitFor(() => expect(contentEditorValue()).toBe('Original ![[diagram.png]]'));
    expect(screen.queryByRole('dialog', { name: 'Image attachments' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('keeps page editing available while hiding and blocking attachments without the dedicated capability', async () => {
    queuePages({ data: page({
      capabilities: { canEdit: true, canManageAttachments: false },
    }) });
    renderEditor();

    await screen.findByRole('button', { name: 'Save' });
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    editContent('Admin page edit');
    const paste = pasteImage(new File(['png'], 'blocked.png', { type: 'image/png' }));

    expect(paste.defaultPrevented).toBe(true);
    expect(attachmentMocks.uploadAttachment).not.toHaveBeenCalled();
    expect(contentEditorValue()).toBe('Admin page edit');
  });

  it('enables attachment picker and paste for the dedicated owner/editor capability', async () => {
    attachmentMocks.uploadAttachment.mockResolvedValue(attachment('allowed.png'));
    queuePages({ data: page({
      capabilities: { canEdit: true, canManageAttachments: true },
    }) });
    renderEditor();

    expect(await screen.findByRole('button', { name: 'Image attachments' })).toBeEnabled();
    pasteImage(new File(['png'], 'allowed.png', { type: 'image/png' }));

    await waitFor(() => expect(attachmentMocks.uploadAttachment).toHaveBeenCalledTimes(1));
  });

  it('picker upload inserts the final suffixed server name and enables save', async () => {
    attachmentMocks.uploadAttachment.mockResolvedValue(attachment('diagram-2.png'));
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Image attachments' }));
    const localFile = new File(['png'], 'diagram.png', { type: 'image/png' });

    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [localFile] } });

    await waitFor(() => expect(contentEditorValue()).toBe('![[diagram-2.png]]Original content'));
    expect(attachmentMocks.uploadAttachment).toHaveBeenCalledWith('space-1', localFile, expect.any(Object));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('paste upload uses the page Space, inserts final names in order, and marks the draft dirty', async () => {
    attachmentMocks.uploadAttachment
      .mockResolvedValueOnce(attachment('first-2.png'))
      .mockResolvedValueOnce(attachment('second.gif', { mimeType: 'image/gif' }));
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    const first = new File(['one'], 'first.png', { type: 'image/png' });
    const second = new File(['two'], 'second.gif', { type: 'image/gif' });

    const event = pasteImages([first, second]);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(contentEditorValue()).toBe('![[first-2.png]]\n![[second.gif]]Original content'));
    expect(attachmentMocks.uploadAttachment.mock.calls.map(([spaceId, file]) => [spaceId, file])).toEqual([
      ['space-1', first],
      ['space-1', second],
    ]);
    expect(screen.getByText(/Unsaved/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('a partial paste batch failure preserves the whole draft and reports once', async () => {
    attachmentMocks.uploadAttachment
      .mockResolvedValueOnce(attachment('first.png'))
      .mockRejectedValueOnce(new Error('second upload failed'));
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });

    pasteImages([
      new File(['one'], 'first.png', { type: 'image/png' }),
      new File(['two'], 'second.png', { type: 'image/png' }),
    ]);

    expect(await screen.findByRole('alert')).toHaveTextContent('The image could not be uploaded.');
    expect(screen.getAllByText('The image could not be uploaded.')).toHaveLength(1);
    expect(contentEditorValue()).toBe('Original content');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('remote conflict removes attachment entry points and refuses a new paste upload', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    editContent('Local draft');
    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote draft', userId: 'remote-socket', version: 15,
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A newer remote version is available');
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    const event = pasteImage(new File(['png'], 'blocked.png', { type: 'image/png' }));

    expect(event.defaultPrevented).toBe(true);
    expect(attachmentMocks.uploadAttachment).not.toHaveBeenCalled();
    expect(contentEditorValue()).toBe('Local draft');
  });

  it('mode change aborts an in-flight paste upload and suppresses its late result', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png')));

    expect(screen.getByTestId('md-preview')).toHaveTextContent('Original content');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('save start suppresses an in-flight paste upload even if its request resolves late', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    const save = deferred<{ data: ReturnType<typeof page> }>();
    attachmentMocks.uploadAttachment.mockImplementation(() => upload.promise);
    vi.mocked(api.patch).mockImplementation(() => save.promise as any);
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    editContent('Local draft');
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await act(async () => upload.resolve(attachment('late.png')));

    expect(contentEditorValue()).toBe('Local draft');
    expect(screen.queryByText('![[late.png]]')).not.toBeInTheDocument();
    await act(async () => save.resolve({ data: page({ content: 'Local draft', updatedAt: '2026-08-28T10:00:00.000Z' }) }));
  });

  it('remote conflict suppresses an already in-flight paste upload', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    attachmentMocks.uploadAttachment.mockImplementation(() => upload.promise);
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    editContent('Local draft');
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    await act(async () => socketMock.handlers.get('contentUpdated')?.({
      content: 'Remote draft', userId: 'remote-socket', version: 16,
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer remote version is available');
    await act(async () => upload.resolve(attachment('late.png')));

    expect(contentEditorValue()).toBe('Local draft');
    expect(screen.queryByText('![[late.png]]')).not.toBeInTheDocument();
  });

  it('route A to B aborts an in-flight upload and never inserts into B', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('spaceId=')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) } as any);
      return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: 'Second content', spaceId: 'space-2', capabilities: { canEdit: true, canManageAttachments: true },
      }) } as any);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><NavigationHarness /></MemoryRouter></LanguageProvider>);
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png')));

    expect(currentEditorView().state.doc.toString()).toBe('Second content');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Space change aborts an in-flight upload and preserves the newly adopted page', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    queuePages(
      { data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) },
      { data: page({ title: 'Moved page', content: 'Moved content', spaceId: 'space-2', capabilities: { canEdit: true, canManageAttachments: true }, updatedAt: '2026-08-28T09:00:00.000Z' }) },
    );
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Moved page')).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png', { spaceId: 'space-1' })));

    expect(contentEditorValue()).toBe('Moved content');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('same-page remote revision replacement aborts a pending selected upload', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    queuePages(
      { data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) },
      { data: page({
        title: 'Refreshed title',
        content: 'Completely replaced remote content',
        capabilities: { canEdit: true, canManageAttachments: true },
        updatedAt: '2026-08-28T09:30:00.000Z',
      }) },
    );
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    act(() => currentEditorView().dispatch({ selection: EditorSelection.range(0, 8) }));
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Refreshed title')).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png')));

    expect(contentEditorValue()).toBe('Completely replaced remote content');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears an attachment failure when navigating from page A to page B', async () => {
    attachmentMocks.uploadAttachment.mockRejectedValueOnce(new Error('upload failed'));
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('spaceId=')) return Promise.resolve({ data: { data: [] } } as any);
      if (url === '/pages/page-1') return Promise.resolve({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) } as any);
      return Promise.resolve({ data: page({
        id: 'page-2', title: 'Second page', content: 'Second content', spaceId: 'space-2', capabilities: { canEdit: true, canManageAttachments: true },
      }) } as any);
    });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><NavigationHarness /></MemoryRouter></LanguageProvider>);
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'failed.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The image could not be uploaded.');

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();

    expect(screen.queryByText('The image could not be uploaded.')).not.toBeInTheDocument();
  });

  it('clears an attachment failure when the same page moves to another Space', async () => {
    attachmentMocks.uploadAttachment.mockRejectedValueOnce(new Error('upload failed'));
    queuePages(
      { data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) },
      { data: page({
        title: 'Moved page',
        content: 'Moved content',
        spaceId: 'space-2',
        capabilities: { canEdit: true, canManageAttachments: true },
        updatedAt: '2026-08-28T09:00:00.000Z',
      }) },
    );
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'failed.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The image could not be uploaded.');

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Moved page')).toBeInTheDocument();

    expect(screen.queryByText('The image could not be uploaded.')).not.toBeInTheDocument();
  });

  it('does not clear a normal save success when the same page changes Space', async () => {
    queuePages(
      { data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) },
      { data: page({
        title: 'Moved page',
        content: 'Local draft',
        spaceId: 'space-2',
        capabilities: { canEdit: true, canManageAttachments: true },
        updatedAt: '2026-08-28T10:30:00.000Z',
      }) },
    );
    vi.mocked(api.patch).mockResolvedValue({
      data: page({ content: 'Local draft', capabilities: { canEdit: true, canManageAttachments: true }, updatedAt: '2026-08-28T10:00:00.000Z' }),
    } as any);
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    editContent('Local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Moved page')).toBeInTheDocument();

    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('keeps the live workspace usable for a new upload after a Space change', async () => {
    attachmentMocks.uploadAttachment.mockResolvedValue(attachment('new-space.png', { spaceId: 'space-2' }));
    queuePages(
      { data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) },
      { data: page({ title: 'Moved page', content: 'Moved content', spaceId: 'space-2', capabilities: { canEdit: true, canManageAttachments: true }, updatedAt: '2026-08-28T09:00:00.000Z' }) },
    );
    renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByDisplayValue('Moved page')).toBeInTheDocument();
    const file = new File(['png'], 'new-space.png', { type: 'image/png' });
    pasteImage(file);

    await waitFor(() => expect(attachmentMocks.uploadAttachment).toHaveBeenCalledWith(
      'space-2', file, expect.any(Object),
    ));
    await waitFor(() => expect(contentEditorValue()).toBe('![[new-space.png]]Moved content'));
  });

  it('unmount aborts task-owned uploads and ignores late completion', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    const rendered = renderEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));

    rendered.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png')));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
