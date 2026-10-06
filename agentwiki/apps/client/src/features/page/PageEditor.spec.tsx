import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { undo, undoDepth } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Link, MemoryRouter, Outlet, Route, RouterProvider, Routes, createMemoryRouter, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LanguageProvider } from '../../context/LanguageContext';
import type { PageTemplateListResponse } from '../page-templates/pageTemplateTypes';
import { PageEditor } from './PageEditor';
import { loadDraft, saveDraft } from './localDrafts';
import { SpaceWorkspace } from '../space-workspace/SpaceWorkspace';
import { SpaceWorkspaceProvider, SpaceWorkspaceScope, useSpaceWorkspace } from '../space-workspace/SpaceWorkspaceContext';
import { NavigationGuardProvider, resetWorkspacePositions } from '../space-workspace/workspaceNavigation';

const templateMocks = vi.hoisted(() => ({
  listPageTemplates: vi.fn(),
  createPageTemplate: vi.fn(),
  listCompositeTemplates: vi.fn(),
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
const authMock = vi.hoisted(() => ({ user: { id: 'user-1', name: 'Editor', email: 'editor@example.com' } }));

vi.mock('../page-templates/PageAgentBindingDialog', () => ({
  PageAgentBindingDialog: ({ scope, onClose }: { scope: { title: string }; onClose: () => void }) => (
    <div role="dialog">Binding page: {scope.title}<button type="button" onClick={onClose}>Close binding</button></div>
  ),
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

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authMock.user }),
}));
vi.mock('socket.io-client', () => ({ io: vi.fn(() => socketMock.socket) }));
vi.mock('../page-templates/pageTemplateApi', () => ({
  listPageTemplates: templateMocks.listPageTemplates,
  createPageTemplate: templateMocks.createPageTemplate,
}));
vi.mock('../page-templates/compositeTemplateApi', () => ({
  listCompositeTemplates: templateMocks.listCompositeTemplates,
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
  canonicalPath: `assets/${displayName}`,
  referenceable: true,
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
  return <>
    <p>{`${location.pathname}:${navigationType}`}</p>
    <output data-testid="returned-workspace-position">
      {JSON.stringify((location.state as { workspacePosition?: unknown } | null)?.workspacePosition ?? null)}
    </output>
  </>;
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
      <Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} />
      <Route path="/pages/:id" element={<DirectEditRedirectTarget />} />
    </Routes>
  </>;
};

const GuardedEditorHarness = () => {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <p data-testid="guarded-location">{`${location.pathname}${location.search}`}</p>
    <PageEditor workspaceRef={workspaceRef} />
    <Link to="/spaces/space-1?folder=parent-folder">Parent directory</Link>
    <button type="button" onClick={() => navigate('/spaces/space-1/graph')}>Space graph</button>
    <button type="button" onClick={() => navigate(-1)}>Browser back</button>
  </>;
};

const HistoryDestination = () => {
  const location = useLocation();
  return <output data-testid="history-source-state">{JSON.stringify(location.state)}</output>;
};

const renderGuardedEditor = () => {
  const router = createMemoryRouter([{
    element: <NavigationGuardProvider><Outlet /></NavigationGuardProvider>,
    children: [
      { path: '/pages/:id/edit', element: <GuardedEditorHarness /> },
      { path: '/pages/:id/versions', element: <HistoryDestination /> },
      { path: '*', element: <p>Destination</p> },
    ],
  }], { initialEntries: ['/pages/previous', '/pages/page-1/edit'], initialIndex: 1 });
  return render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
};

const EditorCrumbReporter = () => {
  const workspace = useSpaceWorkspace();
  return <button type="button" onClick={() => workspace.reportDirectoryCrumbs([
    { id: null, name: 'Product knowledge' },
    { id: 'folder-guides', name: 'Guides' },
  ])}>Report editor crumbs</button>;
};

const renderEditorWithCrumbs = () => render(
  <LanguageProvider>
    <MemoryRouter initialEntries={['/pages/page-1/edit']}>
      <SpaceWorkspaceProvider userId="user-1">
        <SpaceWorkspaceScope
          mode="edit"
          spaceId="space-1"
          activeSection="pages"
          selectedFolderId={null}
          selectedPageId="page-1"
          selectedPageFolderId="folder-guides"
          pageRefreshRequest={0}
          selectFolder={() => undefined}
          reportPageIdentity={() => undefined}
          requestPageRefresh={() => undefined}
        >
          <EditorCrumbReporter />
          <Routes><Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} /></Routes>
        </SpaceWorkspaceScope>
      </SpaceWorkspaceProvider>
    </MemoryRouter>
  </LanguageProvider>,
);

describe('PageEditor remote update safety', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
    authMock.user = { id: 'user-1', name: 'Editor', email: 'editor@example.com' };
    localStorage.setItem('agentwiki.language.v1', 'en');
    resetWorkspacePositions();
    workspaceRef = { current: null };
    socketMock.handlers.clear();
    socketMock.socket.emit.mockClear();
    socketMock.socket.disconnect.mockClear();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.post).mockReset();
    contentTreeMocks.getContentTreeRevision.mockReset();
    contentTreeMocks.getContentTreeRevision.mockResolvedValue('31');
    templateMocks.listPageTemplates.mockReset();
    templateMocks.createPageTemplate.mockReset();
    templateMocks.listCompositeTemplates.mockReset();
    templateMocks.listPageTemplates.mockResolvedValue(catalog(false));
    templateMocks.listCompositeTemplates.mockResolvedValue({
      data: [], total: 0, skip: 0, take: 1,
      capabilities: { canManage: false, canCreate: true },
    });
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

  const draftScope = { userId: 'user-1', spaceId: 'space-1', pageId: 'page-1' };
  const draftRemote = { ...draftScope, updatedAt: '2026-07-27T08:00:00.000Z', title: 'Original title', content: 'Original content', canEdit: true };
  const seedDraft = () => saveDraft(draftScope, { baseUpdatedAt: draftRemote.updatedAt, title: 'Recovered title', content: 'Recovered draft' }, draftRemote, 1234);

  it('offers a same-user local draft only after authorized load and restores explicitly with content undo', async () => {
    seedDraft();
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    expect(contentEditorValue()).toBe('Original content');
    fireEvent.click(screen.getByRole('button', { name: 'Recover local draft' }));
    expect(contentEditorValue()).toBe('Recovered draft');
    expect(screen.getByDisplayValue('Recovered title')).toBeInTheDocument();
    act(() => expect(undo(currentEditorView())).toBe(true));
    expect(contentEditorValue()).toBe('Original content');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('blocks stale direct restore and allows preview/export and exact discard', async () => {
    seedDraft();
    queuePages({ data: page({ updatedAt: '2026-07-28T08:00:00.000Z', capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview local draft' }));
    expect(screen.getByText('Recovered draft')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export local draft' })).toHaveAttribute('download');
    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }));
    expect(loadDraft(draftScope)).toBeNull();
    expect(contentEditorValue()).toBe('Original content');
  });

  it('debounces human edits, persists on pagehide and offers them after reload without an automatic replacement', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    const first = renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Unsaved human draft');
    expect(loadDraft(draftScope)).toBeNull();
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)?.content).toBe('Unsaved human draft');
    first.unmount();
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    expect(contentEditorValue()).toBe('Original content');
    expect(screen.getByRole('button', { name: 'Recover local draft' })).toBeInTheDocument();
  });

  it('preserves newer typing during server Save and rebases its recoverable record', async () => {
    const save = deferred<{ data: ReturnType<typeof page> }>();
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.mocked(api.patch).mockReturnValue(save.promise);
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Submitted snapshot');
    fireEvent.click(screen.getByTestId('save-button'));
    editContent('Newer typing');
    fireEvent.change(screen.getByRole('textbox', { name: 'Page title' }), { target: { value: 'Newer title' } });
    fireEvent(window, new Event('pagehide'));
    save.resolve({ data: page({ content: 'Submitted snapshot', updatedAt: '2026-07-27T09:00:00.000Z' }) });
    await waitFor(() => expect(loadDraft(draftScope)?.baseUpdatedAt).toBe('2026-07-27T09:00:00.000Z'));
    expect(loadDraft(draftScope)?.content).toBe('Newer typing');
    expect(loadDraft(draftScope)?.title).toBe('Newer title');
    expect(screen.getByDisplayValue('Newer title')).toBeInTheDocument();
    expect(contentEditorValue()).toBe('Newer typing');
    expect(screen.getByTestId('save-button')).toBeEnabled();
    expect(api.patch).toHaveBeenCalledWith('/pages/page-1', { content: 'Submitted snapshot', expectedUpdatedAt: '2026-07-27T08:00:00.000Z' });
  });

  it('cannot offer a draft from another user, Space or page after authorized load', async () => {
    for (const scope of [{ ...draftScope, userId: 'other' }, { ...draftScope, spaceId: 'other' }, { ...draftScope, pageId: 'other' }]) {
      saveDraft(scope, { baseUpdatedAt: draftRemote.updatedAt, title: 'Private', content: 'Private source' }, { ...draftRemote, ...scope }, 1234);
    }
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    expect(screen.queryByText('Private source')).not.toBeInTheDocument();
  });

  it('flushes a pending local edit before unmount', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    const view = renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Pending before leave');
    view.unmount();
    expect(loadDraft(draftScope)?.content).toBe('Pending before leave');
  });

  it('clears only saved content and does not call a local draft a server save', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.mocked(api.patch).mockResolvedValue({ data: page({ content: 'Human edit', updatedAt: '2026-07-27T09:00:00.000Z' }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Human edit');
    await waitFor(() => expect(loadDraft(draftScope)?.content).toBe('Human edit'));
    expect(screen.getByTestId('local-draft-status')).toHaveTextContent('Saved on this device');
    expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeDisabled());
    expect(loadDraft(draftScope)).toBeNull();
  });

  it('does not retain a false recoverable draft when newer typing returns to the submitted bytes during Save', async () => {
    const save = deferred<{ data: ReturnType<typeof page> }>();
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.mocked(api.patch).mockReturnValue(save.promise);
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Submitted'); fireEvent.click(screen.getByTestId('save-button'));
    editContent('Typing'); editContent('Submitted'); fireEvent(window, new Event('pagehide'));
    save.resolve({ data: page({ content: 'Submitted', updatedAt: '2026-07-27T09:00:00.000Z' }) });
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await waitFor(() => expect(loadDraft(draftScope)).toBeNull());
    expect(screen.queryByTestId('local-draft-status')).not.toBeInTheDocument();
  });

  it('keeps recovery blocked after a newer unsaved socket revision is dismissed', async () => {
    seedDraft(); queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Human buffer');
    act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote concurrent edit', userId: 'remote', version: 42 }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep local draft' }));
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    fireEvent.focus(window);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview local draft' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Export local draft' })).toBeInTheDocument();
  });

  it('keeps dismissed socket conflicts unresolved through a periodic baseline refresh', async () => {
    vi.useFakeTimers();
    try {
      seedDraft();
      queuePages({ data: page({ capabilities: { canEdit: true } }) }, { data: page({ capabilities: { canEdit: true } }) });
      await act(async () => { renderEditor(); });
      editContent('Human buffer');
      act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote concurrent edit', userId: 'remote', version: 42 }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep local draft' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Preview local draft' })).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it.each(['pagehide', 'failed-save'] as const)('preserves pending newer human input when discarding an older offer before %s', async (action) => {
    seedDraft(); queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Persisted A');
    await waitFor(() => expect(loadDraft(draftScope)?.content).toBe('Persisted A'));
    editContent('Pending B');
    fireEvent.click(screen.getByRole('button', { name: 'Discard local draft' }));
    expect(loadDraft(draftScope)?.content).toBe('Persisted A');
    if (action === 'pagehide') fireEvent(window, new Event('pagehide'));
    else {
      vi.mocked(api.patch).mockRejectedValue({ response: { status: 500 } });
      fireEvent.click(screen.getByTestId('save-button'));
      await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    }
    expect(loadDraft(draftScope)?.content).toBe('Pending B');
    expect(contentEditorValue()).toBe('Pending B');
  });

  it('reports quota failure without claiming that the draft was saved', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    editContent('Human edit'); fireEvent(window, new Event('pagehide'));
    expect(screen.getByTestId('local-draft-status')).toHaveTextContent('Device storage is full');
    expect(loadDraft(draftScope)).toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('clears recovery offers and pending local writes on permission loss', async () => {
    seedDraft(); queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    expect(screen.getByRole('button', { name: 'Recover local draft' })).toBeInTheDocument();
    editContent('Must not persist after revoke');
    vi.mocked(api.get).mockRejectedValue({ response: { status: 403 } });
    fireEvent.focus(window);
    await screen.findByTestId('editor-write-unavailable');
    fireEvent(window, new Event('pagehide'));
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    expect(loadDraft(draftScope)?.content).toBe('Recovered draft');
  });

  it('requires a fresh page load on account switch and does not expose or flush the prior user draft', async () => {
    seedDraft(); queuePages({ data: page({ capabilities: { canEdit: true } }) });
    const view = renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Prior user typing');
    const newLoad = deferred<{ data: ReturnType<typeof page> }>();
    vi.mocked(api.get).mockReturnValue(newLoad.promise);
    authMock.user = { ...authMock.user, id: 'user-2' };
    view.rerender(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><Routes><Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} /></Routes></MemoryRouter></LanguageProvider>);
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    newLoad.resolve({ data: page({ capabilities: { canEdit: true } }) });
    await screen.findByDisplayValue('Original title');
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)?.content).toBe('Recovered draft');
    expect(loadDraft({ ...draftScope, userId: 'user-2' })).toBeNull();
  });

  it('flushes human edits to their old page on navigation without writing them into the next page', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) }, { data: page({ id: 'page-2', title: 'Second', content: 'Second server', capabilities: { canEdit: true } }) });
    render(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><NavigationHarness /></MemoryRouter></LanguageProvider>);
    await screen.findByDisplayValue('Original title');
    editContent('First-page local edit');
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    await screen.findByDisplayValue('Second');
    expect(loadDraft(draftScope)?.content).toBe('First-page local edit');
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft({ ...draftScope, pageId: 'page-2' })).toBeNull();
    expect(contentEditorValue()).toBe('Second server');
  });

  it('keeps WebSocket remote drafts out of recoverable local storage', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote unsaved snapshot', userId: 'remote', version: 42 }));
    expect(contentEditorValue()).toBe('Remote unsaved snapshot');
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)).toBeNull();
  });

  it('does not persist a remote-only snapshot even when server Save fails', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 500 } });
    renderEditor(); await screen.findByDisplayValue('Original title');
    act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote-only snapshot', userId: 'remote', version: 42 }));
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    expect(loadDraft(draftScope)).toBeNull();
  });

  it('retains local recovery after a server Save failure and invalidates offers on Save authorization failure', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Unsent human edit');
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 500 } });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    expect(loadDraft(draftScope)?.content).toBe('Unsent human edit');
    vi.mocked(api.patch).mockRejectedValue({ response: { status: 403 } });
    fireEvent.click(screen.getByTestId('save-button'));
    await screen.findByTestId('editor-write-unavailable');
    editContent('After forbidden'); fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)?.content).toBe('Unsent human edit');
  });

  it('keeps recovery stale after a newer remote version prompt is dismissed', async () => {
    seedDraft(); queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Human buffer');
    queuePages({ data: page({ updatedAt: '2026-07-28T08:00:00.000Z', capabilities: { canEdit: true } }) });
    fireEvent.focus(window);
    await screen.findByText(/A newer remote version is available/);
    fireEvent.click(screen.getByRole('button', { name: 'Keep local draft' }));
    expect(screen.queryByRole('button', { name: 'Recover local draft' })).not.toBeInTheDocument();
    expect(contentEditorValue()).toBe('Human buffer');
  });

  it('loads page links only when opened and inserts authorized same-title identity without saving', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    expect(vi.mocked(api.get).mock.calls.some(([url]) => url === '/pages')).toBe(false);
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url === '/pages' ? { data: [
      { id: 'a', title: 'Same', spaceId: 'space-1' }, { id: 'b', title: 'Same', spaceId: 'space-1' },
      { id: 'private', title: 'Other Space', spaceId: 'other' },
    ] } : page({ capabilities: { canEdit: true } }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Same b' }));
    expect(contentEditorValue()).toContain('[[b|Same]]');
    expect(screen.queryByText('Other Space')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('shows page-link retrieval failure with retry and leaves the draft unchanged', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    vi.mocked(api.get).mockRejectedValue(new Error('private provider detail'));
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load pages');
    expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
    expect(contentEditorValue()).toBe('Original content');
  });

  it('restores scoped collaboration tab and width without submitting or editing', async () => {
    localStorage.setItem('agentwiki.workspace.v1:user-1:space-1', JSON.stringify({ schemaVersion: 1, collaborationOpen: true, collaborationTab: 'notes', collaborationWidth: 440 }));
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    const view = renderEditorWithCrumbs();
    await screen.findByDisplayValue('Original title');
    expect(screen.getByRole('button', { name: 'Notes queue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('separator', { name: 'Resize collaboration panel' })).toHaveAttribute('aria-valuenow', '440');
    expect(contentEditorValue()).toBe('Original content');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close collaboration panel' }));
    view.unmount();
    queuePages({ data: page({ capabilities: { canEdit: true } }) }); renderEditorWithCrumbs();
    await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Notes queue' })).not.toBeInTheDocument();
  });

  it('keeps mobile panel dismissal and viewport clamping out of desktop preferences', async () => {
    const viewport = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);
    const key = 'agentwiki.workspace.v1:user-1:space-1';
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, collaborationOpen: true, collaborationTab: 'notes', collaborationWidth: 520 }));
    queuePages({ data: page({ capabilities: { canEdit: true } }) }); renderEditorWithCrumbs();
    await screen.findByDisplayValue('Original title');
    expect(screen.queryByRole('button', { name: 'Notes queue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Personal notes' }));
    expect(document.querySelector('.document-assist-layer')).toHaveStyle({ width: '358px' });
    expect(screen.queryByRole('separator', { name: 'Resize collaboration panel' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close collaboration panel' }));
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ collaborationOpen: true, collaborationWidth: 520 });
    viewport.mockReturnValue(1280); fireEvent.resize(window);
    expect(screen.getByRole('button', { name: 'Notes queue' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('separator', { name: 'Resize collaboration panel' })).toHaveAttribute('aria-valuenow', '520');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize collaboration panel' }), { key: 'Home' });
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ collaborationWidth: 320 });
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
  });

  it('suppresses a remembered notes tab immediately when live editing permission is lost', async () => {
    const key = 'agentwiki.workspace.v1:user-1:space-1';
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, collaborationOpen: true, collaborationTab: 'notes' }));
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const router = createMemoryRouter([{ element: <NavigationGuardProvider><SpaceWorkspaceProvider userId="user-1"><Outlet /></SpaceWorkspaceProvider></NavigationGuardProvider>, children: [
      { path: '/pages/:id/edit', element: <SpaceWorkspace mode="edit" pageId="page-1"><PageEditor workspaceRef={workspaceRef} /></SpaceWorkspace> },
      { path: '/pages/:id', element: <DirectEditRedirectTarget /> },
    ] }], { initialEntries: ['/pages/page-1/edit'] });
    render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>); await screen.findByDisplayValue('Original title');
    expect(screen.getByRole('button', { name: 'Notes queue' })).toBeVisible();
    editContent('Retained private draft');
    queuePages({ data: page({ capabilities: { canEdit: false } }) });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByRole('button', { name: 'Notes queue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Personal notes' })).toBeDisabled();
    expect(screen.getByTestId('assist-toggle')).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ collaborationOpen: true, collaborationTab: 'notes' });
    expect(contentEditorValue()).toBe('Retained private draft'); expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps the opened candidate panel mounted through tabs/close but clears its page identity', async () => {
    const key = 'agentwiki.workspace.v1:user-1:space-1';
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, collaborationOpen: true, collaborationTab: 'assist' }));
    vi.mocked(api.get).mockImplementation(async (url: string) => ({ data: url === '/assist/tasks' || url === '/review' ? [] : page({ id: url.includes('page-2') ? 'page-2' : 'page-1', capabilities: { canEdit: true } }) }));
    const ScopedEditor = () => {
      const { id } = useParams(); const navigate = useNavigate();
      return <><button onClick={() => navigate('/pages/page-2/edit')}>Next scoped document</button><SpaceWorkspace mode="edit" pageId={id}><PageEditor workspaceRef={workspaceRef} /></SpaceWorkspace></>;
    };
    render(<LanguageProvider><SpaceWorkspaceProvider userId="user-1"><MemoryRouter initialEntries={['/pages/page-1/edit']}><Routes><Route path="/pages/:id/edit" element={<ScopedEditor />} /></Routes></MemoryRouter></SpaceWorkspaceProvider></LanguageProvider>);
    const intent = await screen.findByTestId('assist-intent');
    fireEvent.change(intent, { target: { value: 'Unsubmitted request' } });
    fireEvent.click(screen.getByRole('button', { name: 'Notes queue' }));
    expect(intent).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close collaboration panel' }));
    fireEvent.click(screen.getByTestId('assist-toggle'));
    expect(screen.getByTestId('assist-intent')).toBe(intent); expect(intent).toHaveValue('Unsubmitted request');
    fireEvent.click(screen.getByRole('button', { name: 'Next scoped document' }));
    await waitFor(() => expect(screen.getByTestId('assist-intent')).not.toBe(intent));
    expect(screen.getByTestId('assist-intent')).toHaveValue('');
    expect(api.post).not.toHaveBeenCalled(); expect(api.patch).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).not.toContain('Unsubmitted request');
  });

  it('suppresses the article outline for notes-only collaboration then restores its stored choice', async () => {
    localStorage.setItem('agentwiki.workspace.v1:user-1:space-1', JSON.stringify({ schemaVersion: 1, outlineOpen: true, collaborationOpen: true, collaborationTab: 'notes' }));
    queuePages({ data: page({ content: '# Outline entry', capabilities: { canEdit: true } }) });
    renderEditorWithCrumbs(); await screen.findByDisplayValue('Original title');
    expect(screen.getByRole('button', { name: 'Contents' })).toBeDisabled();
    expect(screen.queryByRole('navigation', { name: 'Contents' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close collaboration panel' }));
    expect(await screen.findByRole('navigation', { name: 'Contents' })).toBeVisible();
    fireEvent.click(screen.getByTestId('mode-toggle'));
    expect(await screen.findByRole('navigation', { name: 'Contents' })).toBeVisible();
    expect(JSON.parse(localStorage.getItem('agentwiki.workspace.v1:user-1:space-1')!)).toMatchObject({ outlineOpen: true, collaborationOpen: false });
    expect(contentEditorValue()).toBe('# Outline entry'); expect(api.patch).not.toHaveBeenCalled();
  });

  it('keeps enough exposed document width without replacing the saved collaboration width', async () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    let canvasLeft = 580;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
      return this.classList.contains('document-canvas') ? { ...originalBounds.call(this), left: canvasLeft } as DOMRect : originalBounds.call(this);
    });
    const key = 'agentwiki.workspace.v1:user-1:space-1';
    localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, collaborationOpen: true, collaborationTab: 'notes', collaborationWidth: 520 }));
    queuePages({ data: page({ capabilities: { canEdit: true } }) }); renderEditorWithCrumbs();
    await screen.findByDisplayValue('Original title');
    expect(document.querySelector('.document-assist-layer')).toHaveStyle({ width: '320px' });
    expect(screen.getByRole('separator', { name: 'Resize collaboration panel' })).toHaveAttribute('aria-valuemax', '320');
    canvasLeft = 400; fireEvent.resize(window);
    expect(document.querySelector('.document-assist-layer')).toHaveStyle({ width: '500px' });
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ collaborationWidth: 520 });
  });

  it('keeps Assist streams out of the draft and accepts completion as a single undoable edit', async () => {
    let tasks: any[] = [];
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url === '/assist/tasks' ? tasks : url === '/review' ? [] : page({ capabilities: { canEdit: true } }) }));
    vi.mocked(api.post).mockImplementation(async (url: string) => {
      if (url === '/assist/tasks') { tasks = [{ id: 'assist-1', intent: 'Rewrite', status: 'running' }]; return { data: tasks[0] }; }
      return { data: {} };
    });
    renderEditor();
    fireEvent.click(await screen.findByTestId('assist-toggle'));
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(() => expect(screen.getByTestId('assist-submit')).toHaveTextContent('Run task'));
    act(() => socketMock.handlers.get('assistStream')?.({ taskId: 'assist-1', chunk: '📝 生成: {"changes":"Partial"}' }));
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)).toBeNull();
    expect(contentEditorValue()).toBe('Original content');
    expect(screen.getByTestId('save-button')).toBeDisabled();
    tasks = [{ id: 'assist-1', intent: 'Rewrite', status: 'done', result: { changes: 'Accepted candidate' } }];
    act(() => socketMock.handlers.get('assistComplete')?.({ taskId: 'assist-1' }));
    const accept = await screen.findByRole('button', { name: 'Accept to draft' });
    expect(contentEditorValue()).toBe('Original content');
    fireEvent.click(accept);
    expect(contentEditorValue()).toBe('Accepted candidate');
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)?.content).toBe('Accepted candidate');
    expect(api.patch).not.toHaveBeenCalled();
    act(() => expect(undo(currentEditorView())).toBe(true));
    expect(contentEditorValue()).toBe('Original content');
    fireEvent(window, new Event('pagehide'));
    expect(loadDraft(draftScope)).toBeNull();
    expect(screen.queryByTestId('local-draft-status')).not.toBeInTheDocument();
    act(() => socketMock.handlers.get('assistComplete')?.({ taskId: 'assist-1' }));
    await screen.findByText('Accepted to draft');
    expect(contentEditorValue()).toBe('Original content');
  });

  it.each(['human', 'remote-kept', 'preview'] as const)('keeps the live draft safe when candidate acceptance meets %s state', async (scenario) => {
    let tasks: any[] = [];
    vi.mocked(api.get).mockImplementation((url: string) => Promise.resolve({ data: url === '/assist/tasks' ? tasks : url === '/review' ? [] : page({ capabilities: { canEdit: true } }) }));
    vi.mocked(api.post).mockImplementation(async () => { tasks = [{ id: 'assist-1', intent: 'Rewrite', status: 'done', result: { changes: 'Candidate' } }]; return { data: { id: 'assist-1' } }; });
    renderEditor();
    fireEvent.click(await screen.findByTestId('assist-toggle'));
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    const accept = await screen.findByRole('button', { name: 'Accept to draft' });
    if (scenario === 'preview') {
      fireEvent.click(screen.getByTestId('mode-toggle'));
      expect(accept).toBeDisabled();
      expect(screen.getByText('Return to edit to accept this candidate.')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('mode-toggle'));
      expect(contentEditorValue()).toBe('Original content');
      return;
    }
    if (scenario === 'human') editContent('Human draft');
    else {
      // A title-only human change makes the local draft dirty while preserving source.
      fireEvent.change(screen.getByDisplayValue('Original title'), { target: { value: 'Renamed' } });
      act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote content', userId: 'other', version: 9 }));
      fireEvent.click(await screen.findByRole('button', { name: 'Keep local draft' }));
      fireEvent.change(screen.getByDisplayValue('Renamed'), { target: { value: 'Original title' } });
    }
    fireEvent.click(accept);
    expect(contentEditorValue()).toBe(scenario === 'human' ? 'Human draft' : 'Original content');
    expect(await screen.findByText(/Page, permissions, version or draft changed/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('labels the title field and refuses whitespace without sending an update', async () => {
    queuePages({ data: page() }); renderEditor();
    const title = await screen.findByDisplayValue('Original title');
    expect(title).toHaveAccessibleName('Page title');
    expect(title).toHaveAttribute('placeholder', 'Enter a page title');
    fireEvent.change(title, { target: { value: '  　 ' } });
    fireEvent.click(screen.getByTestId('save-button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a non-blank page title.');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('registers its successful page load with the workspace shell without another page request', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <SpaceWorkspaceProvider userId="user-1">
            <Routes><Route path="/pages/:id/edit" element={
              <SpaceWorkspace mode="edit" pageId="page-1"><PageEditor /></SpaceWorkspace>
            } /></Routes>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByDisplayValue('Original title')).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-1')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-1');
  });

  it.each([
    'Parent directory',
    'Space graph',
    'Versions',
    'Return to reading',
    'Browser back',
  ])('keeps the dirty editor and route intact when %s navigation is cancelled', async (actionName) => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderGuardedEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Unsaved guarded content');

    fireEvent.click(screen.getByRole(actionName === 'Parent directory' ? 'link' : 'button', { name: actionName }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave anyway?'));
    expect(screen.getByTestId('guarded-location')).toHaveTextContent('/pages/page-1/edit');
    expect(contentEditorValue()).toBe('Unsaved guarded content');
  });

  it.each(['readonly', 401, 403, 404])('retains the dirty draft but locks writes after background capability loss: %s', async (loss) => {
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderGuardedEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Draft must survive permission loss');
    expect(screen.getByTestId('save-button')).toBeEnabled();
    if (loss === 'readonly') queuePages({ data: page({ capabilities: { canEdit: false, canManageAttachments: true } }) });
    else vi.mocked(api.get).mockRejectedValueOnce({ response: { status: loss } });
    await act(async () => window.dispatchEvent(new Event('focus')));
    if (loss === 'readonly') expect(confirm).toHaveBeenCalled();
    expect(screen.getByTestId('guarded-location')).toHaveTextContent('/pages/page-1/edit');
    expect(contentEditorValue()).toBe('Draft must survive permission loss');
    expect(screen.getByTestId('save-button')).toBeDisabled();
    expect(screen.getByTestId('assist-toggle')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    expect(screen.getByTestId('editor-write-unavailable')).toBeVisible();
    fireEvent.click(screen.getByTestId('save-button'));
    fireEvent.click(screen.getByTestId('assist-toggle'));
    expect(api.patch).not.toHaveBeenCalled();
    expect(attachmentMocks.uploadAttachment).not.toHaveBeenCalled();
  });

  it('immediately locks a dirty mounted editor after its sidebar page deletion without reloading away the draft', async () => {
    let deleted = false;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/pages/page-1') return { data: page({ folderId: null, capabilities: { canEdit: true, canManageAttachments: true } }) };
      if (url === '/spaces/space-1') return { data: { id: 'space-1', name: 'Wiki', members: [{ userId: 'user-1', role: 'owner' }] } };
      if (url === '/spaces/space-1/content-tree') return { data: { spaceId: 'space-1', treeRevision: deleted ? '32' : '31', parentFolderId: null, nextCursor: null, data: deleted ? [] : [{ ...page(), kind: 'page', folderId: null, path: '/Original title', sortOrder: 0, createdAt: 'now' }] } };
      if (url.includes('spaceId=')) return { data: { data: [] } };
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(api.delete).mockImplementation(async () => { deleted = true; return { data: {} }; });
    const router = createMemoryRouter([{
      element: <NavigationGuardProvider><SpaceWorkspaceProvider userId="user-1"><Outlet /></SpaceWorkspaceProvider></NavigationGuardProvider>,
      children: [{ path: '/pages/:id/edit', element: <SpaceWorkspace mode="edit" pageId="page-1" showDirectory><PageEditor workspaceRef={workspaceRef} /></SpaceWorkspace> }],
    }], { initialEntries: ['/pages/page-1/edit'] });
    render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
    await screen.findByDisplayValue('Original title');
    editContent('Deleted server page, retained local draft');
    fireEvent.click(await screen.findByTestId('content-deletepage-page-1'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeDisabled());
    expect(contentEditorValue()).toBe('Deleted server page, retained local draft');
    expect(screen.getByTestId('assist-toggle')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/pages/page-1')).toHaveLength(1);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each(['restored', 401, 403, 'late'])('rechecks authoritative capabilities after ancestor restore while retaining the draft: %s', async (outcome) => {
    if (outcome === 'late') {
      class RouterTestRequest {
        readonly url: string;
        readonly signal: AbortSignal | null;
        readonly method: string;
        constructor(input: string | URL | Request, init?: RequestInit) {
          this.url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
          this.signal = init?.signal ?? null;
          this.method = init?.method ?? 'GET';
        }
      }
      vi.stubGlobal('Request', RouterTestRequest as unknown as typeof Request);
    }
    let deleted = false;
    let restored = false;
    let reads = 0;
    const staleRead = deferred<{ data: ReturnType<typeof page> }>();
    const restoredRead = deferred<{ data: ReturnType<typeof page> }>();
    const restoreResult = deferred<{ data: { treeRevision: string } }>();
    const original = page({ folderId: 'child', capabilities: { canEdit: true, canManageAttachments: true } });
    const parent = { id: 'parent', parentId: null, name: 'Parent', path: '/Parent', updatedAt: 'now', createdAt: 'now' };
    const child = { ...parent, id: 'child', parentId: 'parent', name: 'Child', path: '/Parent/Child' };
    const revision = () => restored ? '33' : deleted ? '32' : '31';
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.get).mockImplementation(async (url: string, config?: { params?: { parentFolderId?: string } }) => {
      if (url === '/pages/page-1') {
        reads += 1;
        if (restored) return restoredRead.promise;
        if (reads > 1) return staleRead.promise;
        return { data: original };
      }
      if (url === '/pages/page-2') return { data: page({ id: 'page-2', title: 'Unrelated page', content: 'Unrelated content', folderId: null, capabilities: { canEdit: true } }) };
      if (url === '/spaces/space-1') return { data: { id: 'space-1', name: 'Wiki', members: [{ userId: 'user-1', role: 'owner' }] } };
      if (url === '/spaces/space-1/folders') return { data: { treeRevision: revision(), data: deleted && !restored ? [] : [parent, child], nextCursor: null } };
      if (url === '/spaces/space-1/content-tree') {
        const parentId = config?.params?.parentFolderId ?? null;
        return { data: { treeRevision: revision(), parentFolderId: parentId, nextCursor: null,
          data: deleted && !restored ? [] : parentId === null ? [{ ...parent, kind: 'folder', sortOrder: 0, hasChildren: true }]
            : parentId === 'parent' ? [{ ...child, kind: 'folder', sortOrder: 0, hasChildren: true }]
              : [{ ...original, kind: 'page', sortOrder: 0, path: '/Parent/Child/Original title', createdAt: 'now' }],
        } };
      }
      if (url.endsWith('/delete-impact')) return { data: { treeRevision: '31', rootUpdatedAt: 'now', folderCount: 2, pageCount: 1, impactHash: 'impact' } };
      if (url.includes('spaceId=')) return { data: { data: [] } };
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(api.delete).mockImplementation(async () => { deleted = true; return { data: { treeRevision: '32', batch: { id: 'batch' } } }; });
    vi.mocked(api.post).mockImplementation(async () => { const result = await restoreResult.promise; restored = true; return result; });
    const RestorableEditor = () => {
      const { id } = useParams();
      return <SpaceWorkspace mode="edit" pageId={id} showDirectory><PageEditor workspaceRef={workspaceRef} /></SpaceWorkspace>;
    };
    const router = createMemoryRouter([{
      element: <NavigationGuardProvider><SpaceWorkspaceProvider userId="user-1"><Outlet /></SpaceWorkspaceProvider></NavigationGuardProvider>,
      children: [{ path: '/pages/:id/edit', element: <RestorableEditor /> }],
    }], { initialEntries: ['/pages/page-1/edit'] });
    render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
    await screen.findByDisplayValue('Original title');
    editContent('Draft surviving delete and restore');
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(reads).toBe(2);
    fireEvent.click(await screen.findByTestId('content-deletefolder-parent'));
    fireEvent.click(await screen.findByTestId('folder-delete-confirm'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeDisabled());
    await waitFor(() => expect(screen.queryByTestId('folder-delete-dialog')).not.toBeInTheDocument());
    await act(async () => staleRead.resolve({ data: original }));
    expect(screen.getByTestId('save-button')).toBeDisabled();
    expect(contentEditorValue()).toBe('Draft surviving delete and restore');
    fireEvent.click(screen.getByTestId('folder-restore-button'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    if (outcome === 'late') {
      await act(async () => router.navigate('/pages/page-2/edit'));
      await screen.findByDisplayValue('Unrelated page');
      await act(async () => restoreResult.resolve({ data: { treeRevision: '33' } }));
      expect(contentEditorValue()).toBe('Unrelated content');
      expect(reads).toBe(2);
      expect(screen.queryByTestId('editor-write-unavailable')).not.toBeInTheDocument();
      return;
    }
    await act(async () => restoreResult.resolve({ data: { treeRevision: '33' } }));
    await waitFor(() => expect(reads).toBe(3));
    expect(screen.getByTestId('save-button')).toBeDisabled();
    expect(screen.getByTestId('assist-toggle')).toBeDisabled();
    if (typeof outcome === 'number') {
      await act(async () => restoredRead.reject({ response: { status: outcome } }));
      expect(screen.getByTestId('save-button')).toBeDisabled();
      expect(screen.getByTestId('assist-toggle')).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Image attachments' })).not.toBeInTheDocument();
    } else {
      await act(async () => restoredRead.resolve({ data: page({ folderId: 'child', content: 'Restored server content', updatedAt: '2026-09-09T00:00:00.000Z', capabilities: { canEdit: true, canManageAttachments: true } }) }));
      expect(screen.queryByTestId('editor-write-unavailable')).not.toBeInTheDocument();
      expect(screen.getByTestId('assist-toggle')).toBeEnabled();
      expect(screen.getByTestId('save-button')).toBeDisabled(); // Existing remote revision decision remains required.
      fireEvent.click(screen.getByRole('button', { name: 'Keep local draft' }));
      expect(screen.getByTestId('save-button')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Image attachments' })).toBeEnabled();
    }
    expect(contentEditorValue()).toBe('Draft surviving delete and restore');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.each(['permission loss', 'remote conflict'])('closes the table editor and refuses late Apply after %s', async (reason) => {
    const tableSource = '| Name | Value |\n| --- | --- |\n| a | b |';
    queuePages({ data: page({ content: tableSource, capabilities: { canEdit: true } }) });
    renderEditor(); await screen.findByDisplayValue('Original title');
    editContent('Human draft\n\n' + tableSource);
    const view = currentEditorView(); const before = contentEditorValue();
    act(() => view.dispatch({ selection: EditorSelection.cursor(before.indexOf('| Name') + 2) }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit table' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Row 1, column 1 (Markdown)' }), { target: { value: 'must not apply' } });
    const apply = screen.getByRole('button', { name: 'Apply table' });
    if (reason === 'permission loss') {
      vi.mocked(api.get).mockRejectedValue({ response: { status: 403 } });
      fireEvent.focus(window); await screen.findByTestId('editor-write-unavailable');
    } else {
      act(() => socketMock.handlers.get('contentUpdated')?.({ content: 'Remote concurrent edit', userId: 'remote', version: 42 }));
    }
    expect(screen.queryByRole('dialog', { name: 'Edit table' })).not.toBeInTheDocument();
    fireEvent.click(apply);
    expect(contentEditorValue()).toBe(before); expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit table' })).toBeDisabled();
  });

  it.each(['loaded', 'pending'])('closes %s page-link results immediately after edit permission is revoked', async (status) => {
    const pending = deferred<any>();
    const defaultGet = vi.mocked(api.get).getMockImplementation()!;
    let pageLinksSignal: AbortSignal | undefined;
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === '/pages') {
        pageLinksSignal = config?.signal as AbortSignal | undefined;
        return status === 'pending' ? pending.promise : Promise.resolve({ data: { data: [{ id: 'private-link', title: 'Private linked page', spaceId: 'space-1' }] } });
      }
      return defaultGet(url, config);
    });
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderGuardedEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Retained draft');
    fireEvent.click(screen.getByRole('button', { name: 'Page link' }));
    if (status === 'loaded') await screen.findByRole('button', { name: 'Private linked page private-link' });
    else await waitFor(() => expect(pageLinksSignal).toBeDefined());
    queuePages({ data: page({ capabilities: { canEdit: false } }) });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.queryByRole('dialog', { name: 'Page link' })).not.toBeInTheDocument();
    if (status === 'pending') {
      expect(pageLinksSignal?.aborted).toBe(true);
      await act(async () => pending.resolve({ data: { data: [{ id: 'late-link', title: 'Late private page', spaceId: 'space-1' }] } }));
    }
    expect(screen.queryByText('Private linked page')).not.toBeInTheDocument();
    expect(screen.queryByText('Late private page')).not.toBeInTheDocument();
    expect(contentEditorValue()).toBe('Retained draft');
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('aborts a pending image upload on capability loss and ignores its late success after dirty cancel', async () => {
    const upload = deferred<ReturnType<typeof attachment>>();
    let signal: AbortSignal | undefined;
    attachmentMocks.uploadAttachment.mockImplementation((_spaceId, _file, options) => {
      signal = options?.signal;
      return upload.promise;
    });
    queuePages({ data: page({ capabilities: { canEdit: true, canManageAttachments: true } }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    renderGuardedEditor();
    await screen.findByRole('button', { name: 'Image attachments' });
    editContent('Retained draft');
    pasteImage(new File(['png'], 'late.png', { type: 'image/png' }));
    await waitFor(() => expect(signal).toBeDefined());
    queuePages({ data: page({ capabilities: { canEdit: false, canManageAttachments: false } }) });
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(signal?.aborted).toBe(true);
    await act(async () => upload.resolve(attachment('late.png')));
    pasteImage(new File(['png'], 'blocked.png', { type: 'image/png' }));
    expect(attachmentMocks.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(contentEditorValue()).toBe('Retained draft');
    expect(screen.getByTestId('save-button')).toBeDisabled();
  });

  it('records the edit source only after the dirty navigation is confirmed', async () => {
    class RouterTestRequest {
      readonly url: string;
      readonly signal: AbortSignal | null;
      readonly method: string;

      constructor(input: string | URL | Request, init?: RequestInit) {
        this.url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
        this.signal = init?.signal ?? null;
        this.method = init?.method ?? 'GET';
      }
    }
    vi.stubGlobal('Request', RouterTestRequest as unknown as typeof Request);
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderGuardedEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Confirmed history draft');

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));

    const state = JSON.parse(await screen.findByTestId('history-source-state').then((element) => element.textContent ?? 'null'));
    expect(state.pageHistorySource).toMatchObject({ pageId: 'page-1', mode: 'edit' });
    expect(state.pageHistorySource.workspacePosition.pageId).toBe('page-1');
  });

  it('keeps preview and return-to-reading separate, with visible actions and no preview write', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Unsaved preview body');

    expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Save');
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveTextContent('Preview');
    expect(screen.getByRole('button', { name: 'Return to reading' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByTestId('md-preview')).toHaveTextContent('Unsaved preview body');
    expect(screen.getByRole('button', { name: 'Return to edit' })).toBeVisible();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('keeps real directory crumbs and primary editor actions in the sticky workspace toolbar', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    renderEditorWithCrumbs();
    await screen.findByDisplayValue('Original title');
    fireEvent.click(screen.getByRole('button', { name: 'Report editor crumbs' }));

    const toolbar = await screen.findByTestId('editor-toolbar');
    expect(toolbar).toHaveClass('sticky');
    expect(toolbar).toContainElement(screen.getByRole('link', { name: 'Product knowledge' }));
    expect(toolbar).toContainElement(screen.getByRole('link', { name: 'Guides' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Return to reading' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Save' }));
    expect(toolbar).toContainElement(screen.getByRole('button', { name: 'Preview' }));
    expect(toolbar).not.toContainElement(screen.getByDisplayValue('Original title'));
  });

  it('applies a semantic reading position after the CodeMirror view finishes mounting', async () => {
    const body = '# Intro\n\n## Details\n\nBody text';
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={[{
          pathname: '/pages/page-1/edit',
          state: { workspacePosition: {
            pageId: 'page-1', cursorOffset: null, headingId: 'details', headingText: 'Details', scrollTop: 2380,
          } },
        }]}>
          <Routes><Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} /></Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    await screen.findByDisplayValue('Original title');
    const expectedHeadingOffset = body.indexOf('## Details') + '## Details'.length;
    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(expectedHeadingOffset));
    expect(currentEditorView().scrollDOM.scrollTop).not.toBe(2380);
  });

  it('preserves a non-top cursor when Ctrl/Cmd+E toggles preview in both directions', async () => {
    const body = '# Intro\n\nOpening.\n\n## Details\n\nDeep body text';
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    const deepCursor = body.indexOf('Deep body') + 5;
    act(() => currentEditorView().dispatch({ selection: EditorSelection.cursor(deepCursor) }));

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true });
    await screen.findByRole('heading', { name: /Details/ });
    const deepParagraph = screen.getByText('Deep body text');
    for (const block of document.querySelectorAll<HTMLElement>('[data-markdown-source-start]')) {
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
        top: block === deepParagraph ? 178 : -300,
      } as DOMRect);
    }
    fireEvent.keyDown(window, { key: 'e', metaKey: true });

    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(deepCursor));
  });

  it.each(['forward', 'reverse'] as const)('restores the complete %s selection after clamped preview layout without user navigation', async (direction) => {
    const body = '# Intro\n\nRepeated passage.\n\nRepeated passage.';
    const from = body.lastIndexOf('Repeated');
    const to = from + 'Repeated'.length;
    const [anchor, head] = direction === 'forward' ? [from, to] : [to, from];
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    act(() => currentEditorView().dispatch({ selection: EditorSelection.range(anchor, head) }));
    const depth = undoDepth(currentEditorView().state);
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('md-preview');
    // Short/clamped preview leaves the first heading nearest, without navigation.
    fireEvent.scroll(document);
    fireEvent.resize(window);
    fireEvent.click(screen.getByRole('button', { name: 'Return to edit' }));
    await waitFor(() => expect(currentEditorView().state.selection.main.anchor).toBe(anchor));
    expect(currentEditorView().state.selection.main.head).toBe(head);
    expect(undoDepth(currentEditorView().state)).toBe(depth);
    expect(currentEditorView().state.doc.toString()).toBe(body);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('returns to an explicitly chosen outline target even when preview scroll is clamped', async () => {
    const body = '# A\n\nSelected text.\n\n# B';
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    act(() => currentEditorView().dispatch({ selection: EditorSelection.range(6, 14) }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Contents' }));
    screen.getByRole('heading', { name: /B/ }).scrollIntoView = vi.fn();
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to edit' }));
    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(body.indexOf('# B')));
    expect(currentEditorView().state.selection.main.empty).toBe(true);
  });

  it.each(['page', 'identity'] as const)('does not carry the preview origin across a %s change', async (change) => {
    const body = '# Intro\n\nRepeated passage.';
    const from = body.indexOf('Repeated');
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    const tree = <LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><NavigationHarness /></MemoryRouter></LanguageProvider>;
    const view = render(tree);
    await screen.findByDisplayValue('Original title');
    act(() => currentEditorView().dispatch({ selection: EditorSelection.range(from + 8, from + 2) }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTestId('md-preview');
    queuePages({ data: page({ id: change === 'page' ? 'page-2' : 'page-1', title: 'Reloaded page', content: body, capabilities: { canEdit: true } }) });
    if (change === 'page') {
      fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    } else {
      authMock.user = { ...authMock.user, id: 'user-2' };
      view.rerender(<LanguageProvider><MemoryRouter initialEntries={['/pages/page-1/edit']}><NavigationHarness /></MemoryRouter></LanguageProvider>);
    }
    await screen.findByDisplayValue('Reloaded page');
    for (const block of document.querySelectorAll<HTMLElement>('[data-markdown-source-start]')) {
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
        top: Number(block.dataset.markdownSourceStart) === from ? 12 : -300,
      } as DOMRect);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Return to edit' }));
    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(from));
    expect(currentEditorView().state.selection.main.empty).toBe(true);
  });

  it('returns to the preview block selected after moving away from the original editor cursor', async () => {
    const body = '# Long section\n\nParagraph A.\n\nParagraph B.\n\nParagraph C.';
    const paragraphAOffset = body.indexOf('Paragraph A');
    const paragraphBOffset = body.indexOf('Paragraph B');
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    renderEditor();
    await screen.findByDisplayValue('Original title');
    act(() => currentEditorView().dispatch({ selection: EditorSelection.range(paragraphAOffset + 10, paragraphAOffset + 4) }));

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Paragraph B.');
    for (const block of document.querySelectorAll<HTMLElement>('[data-markdown-source-start]')) {
      const sourceOffset = Number(block.dataset.markdownSourceStart);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({
        top: sourceOffset === paragraphBOffset ? 178 : sourceOffset < paragraphBOffset ? -300 : 500,
      } as DOMRect);
    }

    fireEvent.wheel(screen.getByTestId('md-preview'), { deltaY: 200 });
    const surface = screen.getByTestId('md-editor-surface');
    surface.scrollTop = 200;
    fireEvent.scroll(surface);

    fireEvent.click(screen.getByRole('button', { name: 'Return to edit' }));

    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(paragraphBOffset));
    expect(currentEditorView().state.selection.main.empty).toBe(true);
  });

  it('keeps the second repeated heading identity through reading, edit, preview, and reading', async () => {
    const body = '## Repeat\n\nFirst section.\n\n## Repeat\n\nSecond section.';
    const secondHeadingOffset = body.lastIndexOf('## Repeat');
    queuePages({ data: page({ content: body, capabilities: { canEdit: true } }) });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={[{
          pathname: '/pages/page-1/edit',
          state: { workspacePosition: {
            pageId: 'page-1', cursorOffset: null, headingId: 'repeat-1', headingText: 'Repeat',
            sourceOffset: secondHeadingOffset, scrollTop: 2400,
          } },
        }]}>
          <Routes>
            <Route path="/pages/:id/edit" element={<PageEditor workspaceRef={workspaceRef} />} />
            <Route path="/pages/:id" element={<DirectEditRedirectTarget />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );

    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(secondHeadingOffset));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const repeatedHeadings = await screen.findAllByRole('heading', { name: /Repeat/ });
    vi.spyOn(repeatedHeadings[0], 'getBoundingClientRect').mockReturnValue({ top: -400 } as DOMRect);
    vi.spyOn(repeatedHeadings[1], 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    for (const paragraph of document.querySelectorAll<HTMLElement>('p[data-markdown-source-start]')) {
      const sourceOffset = Number(paragraph.dataset.markdownSourceStart);
      vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({
        top: sourceOffset < secondHeadingOffset ? -200 : 400,
      } as DOMRect);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Return to reading' }));
    const returned = JSON.parse(screen.getByTestId('returned-workspace-position').textContent ?? 'null');
    expect(returned).toEqual(expect.objectContaining({
      pageId: 'page-1',
      headingId: 'repeat-1',
      headingText: 'Repeat',
      sourceOffset: secondHeadingOffset,
    }));
  });

  it('keeps the accepted workspace identity when an ordinary background refresh fails', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <SpaceWorkspaceProvider userId="user-1">
            <Routes><Route path="/pages/:id/edit" element={
              <SpaceWorkspace mode="edit" pageId="page-1"><PageEditor /></SpaceWorkspace>
            } /></Routes>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('navigation', { name: 'Space navigation' })).toBeInTheDocument();
    vi.mocked(api.get).mockRejectedValue(new Error('transient offline'));
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('navigation', { name: 'Space navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-1');
    expect(screen.getByDisplayValue('Original title')).toBeInTheDocument();

    vi.mocked(api.get).mockRejectedValue({ response: { status: 403 } });
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Space navigation' })).not.toBeInTheDocument());
  });

  it('keeps a dirty editor in its accepted Space until a different-Space remote page is adopted', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <SpaceWorkspaceProvider userId="user-1">
            <Routes><Route path="/pages/:id/edit" element={
              <SpaceWorkspace mode="edit" pageId="page-1"><PageEditor workspaceRef={workspaceRef} /></SpaceWorkspace>
            } /></Routes>
          </SpaceWorkspaceProvider>
        </MemoryRouter>
      </LanguageProvider>,
    );

    expect(await screen.findByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-1');
    editContent('Dirty local draft');
    vi.mocked(api.get).mockResolvedValue({ data: page({
      content: 'Remote moved content',
      spaceId: 'space-2',
      updatedAt: '2026-09-08T09:00:00.000Z',
      capabilities: { canEdit: true },
    }) } as any);

    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer remote version is available');
    expect(contentEditorValue()).toBe('Dirty local draft');
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-1');

    fireEvent.click(screen.getByRole('button', { name: 'Accept remote version' }));
    expect(contentEditorValue()).toBe('Remote moved content');
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/spaces/space-2');
  });

  it('opens late-binding settings from the Page editor without requiring template-management permission', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    templateMocks.listPageTemplates.mockResolvedValue(catalog(false));
    templateMocks.listCompositeTemplates.mockResolvedValue({
      data: [], total: 0, skip: 0, take: 1,
      capabilities: { canManage: false, canCreate: true },
    });
    renderEditor();

    fireEvent.click(await screen.findByRole('button', { name: 'Agent / collaboration settings' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Binding page: Original title');
  });

  it('hides late-binding settings when authoritative composite rollout is off', async () => {
    queuePages({ data: page({ capabilities: { canEdit: true } }) });
    templateMocks.listCompositeTemplates.mockResolvedValue({
      data: [], total: 0, skip: 0, take: 1,
      capabilities: { canManage: true, canCreate: false },
    });
    renderEditor();

    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(templateMocks.listCompositeTemplates).toHaveBeenCalledWith('space-1', {
      locale: 'en', take: 1,
    }));
    expect(screen.queryByRole('button', { name: 'Agent / collaboration settings' })).not.toBeInTheDocument();
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
    expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledWith('space-1', expect.any(AbortSignal));
  });

  it('does not PATCH after navigating away while the structural tree head is pending', async () => {
    const head = deferred<string>();
    contentTreeMocks.getContentTreeRevision.mockReturnValue(head.promise);
    queuePages(
      { data: page() },
      { data: page({ id: 'page-2', title: 'Second page', spaceId: 'space-2' }) },
    );
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const title = await screen.findByDisplayValue('Original title');
    fireEvent.change(title, { target: { value: 'Late title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    expect(await screen.findByDisplayValue('Second page')).toBeInTheDocument();

    await act(async () => head.resolve('31'));

    expect(api.patch).not.toHaveBeenCalled();
  });

  it('resets the saving state for a new Page route without letting the obsolete save finally alter it', async () => {
    const oldHead = deferred<string>();
    const newSave = deferred<any>();
    contentTreeMocks.getContentTreeRevision
      .mockImplementationOnce(() => oldHead.promise)
      .mockResolvedValueOnce('32');
    queuePages(
      { data: page() },
      { data: page({
        id: 'page-2',
        title: 'Second page',
        content: 'Second content',
        spaceId: 'space-2',
        updatedAt: '2026-07-27T09:00:00.000Z',
      }) },
    );
    vi.mocked(api.patch).mockImplementation(() => newSave.promise);
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <NavigationHarness />
        </MemoryRouter>
      </LanguageProvider>,
    );

    fireEvent.change(await screen.findByDisplayValue('Original title'), { target: { value: 'Late old title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(contentTreeMocks.getContentTreeRevision).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Navigate to second page' }));
    const newTitle = await screen.findByDisplayValue('Second page');
    fireEvent.change(newTitle, { target: { value: 'Saved second page' } });
    const newSaveButton = screen.getByTestId('save-button');
    expect(newSaveButton).toHaveAccessibleName('Save');
    expect(newSaveButton).toBeEnabled();
    fireEvent.click(newSaveButton);

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pages/page-2', {
      title: 'Saved second page',
      content: 'Second content',
      expectedUpdatedAt: '2026-07-27T09:00:00.000Z',
      expectedTreeRevision: '32',
    }));
    expect(newSaveButton).toBeDisabled();

    await act(async () => oldHead.resolve('31'));
    expect(newSaveButton).toBeDisabled();

    await act(async () => newSave.resolve({ data: page({
      id: 'page-2',
      title: 'Saved second page',
      content: 'Second content',
      spaceId: 'space-2',
      updatedAt: '2026-07-27T09:01:00.000Z',
    }) }));
    await waitFor(() => expect(newSaveButton).toHaveAccessibleName('Save'));
    expect(newSaveButton).toBeDisabled();
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

  it('ignores a page read started before save when it resolves after the save', async () => {
    const staleRead = deferred<any>();
    queuePages({ data: page() }, staleRead.promise);
    vi.mocked(api.patch).mockResolvedValueOnce({
      data: page({ content: 'Saved content', updatedAt: '2026-07-27T08:01:00.000Z' }),
    } as any);
    renderEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Saved content');

    await act(async () => window.dispatchEvent(new Event('focus')));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Saved'));

    await act(async () => staleRead.resolve({ data: page() }));

    expect(contentEditorValue()).toBe('Saved content');
    expect(screen.getByDisplayValue('Original title')).toBeInTheDocument();
  });

  it('ignores a page read started during save when it resolves after the save', async () => {
    const save = deferred<any>();
    const staleRead = deferred<any>();
    queuePages({ data: page() }, staleRead.promise);
    vi.mocked(api.patch).mockImplementationOnce(() => save.promise);
    renderEditor();
    await screen.findByDisplayValue('Original title');
    editContent('Submitted content');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));

    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => save.resolve({
      data: page({ content: 'Submitted content', updatedAt: '2026-07-27T08:01:00.000Z' }),
    }));
    await act(async () => staleRead.resolve({ data: page() }));

    expect(contentEditorValue()).toBe('Submitted content');
  });

  it('restores the editor cursor after leaving the route and navigating back', async () => {
    queuePages({ data: page() }, { data: page() });
    const Away = () => {
      const navigate = useNavigate();
      return <button type="button" onClick={() => navigate(-1)}>Back now</button>;
    };
    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={['/pages/page-1/edit']}>
          <Routes>
            <Route path="/pages/:id/edit" element={<><PageEditor workspaceRef={workspaceRef} /><Link to="/away">Leave editor</Link></>} />
            <Route path="/away" element={<Away />} />
          </Routes>
        </MemoryRouter>
      </LanguageProvider>,
    );
    await screen.findByDisplayValue('Original title');
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    act(() => currentEditorView().dispatch({ selection: EditorSelection.cursor(9) }));

    fireEvent.click(screen.getByRole('link', { name: 'Leave editor' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back now' }));
    await screen.findByDisplayValue('Original title');

    await waitFor(() => expect(currentEditorView().state.selection.main.head).toBe(9));
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

    await waitFor(() => expect(contentEditorValue()).toBe('Original ![[assets/diagram.png]]'));
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

    await waitFor(() => expect(contentEditorValue()).toBe('![[assets/diagram-2.png]]Original content'));
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
    await waitFor(() => expect(contentEditorValue()).toBe('![[assets/first-2.png]]\n![[assets/second.gif]]Original content'));
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
    await waitFor(() => expect(contentEditorValue()).toBe('![[assets/new-space.png]]Moved content'));
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
  it('sends a real selected passage to Agent and preserves unrelated concurrent typing when accepted', async () => {
    const base='old'+'x'.repeat(300)+'quote'+'y'.repeat(300);let tasks:any[]=[];
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?tasks:url==='/review'?[]:page({content:base,capabilities:{canEdit:true}})}));
    vi.mocked(api.post).mockImplementation(async()=>{tasks=[{id:'scoped',intent:'Fix',status:'done',result:{changes:base.replace('quote','new')}}];return{data:{id:'scoped'}};});
    renderEditor();await screen.findByDisplayValue('Original title');
    act(()=>currentEditorView().dispatch({selection:EditorSelection.single(303,308)}));
    fireEvent.click(screen.getByRole('button',{name:'Ask Agent'}));
    expect(screen.getByRole('combobox',{name:'Edit scope'})).toHaveValue('selection');
    fireEvent.change(screen.getByTestId('assist-intent'),{target:{value:'Fix quote'}});fireEvent.click(screen.getByTestId('assist-submit'));
    await screen.findByRole('button',{name:'Accept to draft'});
    expect(api.post).toHaveBeenCalledWith('/assist/tasks',expect.objectContaining({snapshot:expect.objectContaining({assistTarget:expect.objectContaining({from:303,to:308,quote:'quote'})})}));
    editContent(base.replace('old','human'));fireEvent.click(screen.getByRole('button',{name:'Accept to draft'}));
    expect(contentEditorValue()).toBe('human'+'x'.repeat(300)+'new'+'y'.repeat(300));
    act(()=>expect(undo(currentEditorView())).toBe(true));expect(contentEditorValue()).toBe(base.replace('old','human'));
    expect(api.patch).not.toHaveBeenCalled();
  });
  it('sends checked private notes and accepts each linked hunk once with separate undo', async () => {
    const base='one\nkeep\ntwo\n';let tasks:any[]=[];
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?tasks:url==='/review'?[]:page({content:base,capabilities:{canEdit:true}})}));
    vi.mocked(api.post).mockImplementation(async()=>{tasks=[{id:'notes',intent:'Fix',status:'done',result:{changes:'ONE\nkeep\nTWO\n'}}];return{data:{id:'notes'}};});
    renderEditor();await screen.findByDisplayValue('Original title');fireEvent.click(screen.getByRole('button',{name:'Personal notes'}));
    for(const [from,to,body] of [[0,3,'Fix one'],[9,12,'Fix two']] as const){
      act(()=>currentEditorView().dispatch({selection:EditorSelection.single(from,to)}));
      fireEvent.change(screen.getByRole('textbox',{name:'Note'}),{target:{value:body}});fireEvent.click(screen.getByRole('button',{name:'Add note'}));
    }
    expect(screen.getByText(/Private notes, stored only/)).toBeInTheDocument();
    for(const body of ['Fix one','Fix two'])fireEvent.click(screen.getByRole('checkbox',{name:body}));
    fireEvent.click(screen.getByRole('button',{name:'Send selected to Agent'}));
    await screen.findByRole('button',{name:'Accept change 1'});fireEvent.click(screen.getByRole('button',{name:'Notes queue'}));expect(screen.getAllByText('Awaiting review')).toHaveLength(2);expect(contentEditorValue()).toBe(base);fireEvent.click(screen.getByRole('button',{name:'Candidate queue'}));
    fireEvent.click(screen.getByRole('button',{name:'Accept change 1'}));expect(contentEditorValue()).toBe('ONE\nkeep\ntwo\n');fireEvent.click(screen.getByRole('button',{name:'Notes queue'}));fireEvent.click(screen.getByRole('button',{name:'All (2)'}));expect(screen.getAllByText('Resolved')).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Candidate queue'}));
    fireEvent.click(screen.getByRole('button',{name:'Accept change 2'}));expect(contentEditorValue()).toBe('ONE\nkeep\nTWO\n');fireEvent.click(screen.getByRole('button',{name:'Notes queue'}));fireEvent.click(screen.getByRole('button',{name:'All (2)'}));expect(screen.getAllByText('Resolved')).toHaveLength(2);fireEvent.click(screen.getByRole('button',{name:'Candidate queue'}));
    fireEvent.click(screen.getByRole('button',{name:'Accept change 1'}));act(()=>expect(undo(currentEditorView())).toBe(true));expect(contentEditorValue()).toBe('ONE\nkeep\ntwo\n');
    act(()=>expect(undo(currentEditorView())).toBe(true));expect(contentEditorValue()).toBe(base);expect(api.patch).not.toHaveBeenCalled();
  });

  it('captures current heading section and sends default document snapshots explicitly', async () => {
    const base='# One\nintro\n## Child\nx\n# Two\ny';let tasks:any[]=[];
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?tasks:url==='/review'?[]:page({content:base,capabilities:{canEdit:true}})}));
    vi.mocked(api.post).mockImplementation(async()=>{tasks=[{id:'scope',intent:'Fix',status:'done',result:{changes:base.replace('intro','INTRO')}}];return{data:{id:'scope'}};});
    renderEditor();await screen.findByDisplayValue('Original title');act(()=>currentEditorView().dispatch({selection:EditorSelection.cursor(7)}));
    fireEvent.click(screen.getByTestId('assist-toggle'));expect(screen.getByRole('combobox',{name:'Edit scope'})).toHaveValue('document');
    fireEvent.change(screen.getByTestId('assist-intent'),{target:{value:'Fix'}});fireEvent.click(screen.getByTestId('assist-submit'));await screen.findByRole('button',{name:'Accept to draft'});
    expect(api.post).toHaveBeenLastCalledWith('/assist/tasks',expect.objectContaining({snapshot:expect.objectContaining({assistTarget:expect.objectContaining({kind:'document',from:0,to:base.length})})}));
    fireEvent.click(screen.getByRole('button',{name:'Discard'}));fireEvent.change(screen.getByRole('combobox',{name:'Edit scope'}),{target:{value:'section'}});
    fireEvent.change(screen.getByTestId('assist-intent'),{target:{value:'Fix section'}});fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(2));expect(api.post).toHaveBeenLastCalledWith('/assist/tasks',expect.objectContaining({snapshot:expect.objectContaining({assistTarget:expect.objectContaining({kind:'section',quote:'# One\nintro\n## Child\nx\n'})})}));expect(contentEditorValue()).toBe(base);
  });

  it.each(['generating','ready','partial'] as const)('preserves %s scoped candidate across closing and reopening the drawer',async(phase)=>{
    const base='one\nkeep\ntwo\n';let tasks:any[]=[];
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?tasks:url==='/review'?[]:page({content:base,capabilities:{canEdit:true}})}));
    vi.mocked(api.post).mockImplementation(async()=>{tasks=[{id:'continuity',intent:'Fix',status:phase==='generating'?'running':'done',result:{changes:'ONE\nkeep\nTWO\n'}}];return{data:{id:'continuity'}};});
    renderEditor();await screen.findByDisplayValue('Original title');fireEvent.click(screen.getByTestId('assist-toggle'));fireEvent.change(screen.getByTestId('assist-intent'),{target:{value:'Fix'}});fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(()=>expect(screen.getByTestId('assist-submit')).toHaveTextContent('Run task'));
    if(phase!=='generating')await screen.findByRole('button',{name:'Accept change 1'});
    if(phase==='partial')fireEvent.click(screen.getByRole('button',{name:'Accept change 1'}));
    fireEvent.click(screen.getByRole('button',{name:'Close collaboration panel'}));fireEvent.click(screen.getByTestId('assist-toggle'));
    tasks=[{id:'continuity',intent:'Fix',status:'done',result:{changes:'ONE\nkeep\nTWO\n'}}];act(()=>socketMock.handlers.get('assistComplete')?.({taskId:'continuity'}));
    await screen.findByRole('button',{name:'Accept change 2'});
    if(phase==='partial'){expect(screen.getByRole('button',{name:'Accept change 1'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Accept change 2'}));expect(contentEditorValue()).toBe('ONE\nkeep\nTWO\n');}
    else {expect(screen.getByRole('button',{name:'Accept change 1'})).toBeEnabled();expect(contentEditorValue()).toBe(base);}
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it.each(['failed','delayed'] as const)('auto-submits a notes request once across close/reopen after %s POST',async(scenario)=>{
    let tasks:any[]=[];const delayed=deferred<any>();
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?tasks:url==='/review'?[]:page({capabilities:{canEdit:true}})}));
    vi.mocked(api.post).mockImplementation(()=>scenario==='failed'?Promise.reject(new Error('failed')):delayed.promise);
    renderEditor();await screen.findByDisplayValue('Original title');fireEvent.click(screen.getByRole('button',{name:'Personal notes'}));
    act(()=>currentEditorView().dispatch({selection:EditorSelection.single(0,8)}));fireEvent.change(screen.getByRole('textbox',{name:'Note'}),{target:{value:'Fix'}});fireEvent.click(screen.getByRole('button',{name:'Add note'}));fireEvent.click(screen.getByRole('checkbox',{name:'Fix'}));fireEvent.click(screen.getByRole('button',{name:'Send selected to Agent'}));
    await waitFor(()=>expect(api.post).toHaveBeenCalledTimes(1));if(scenario==='failed')await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'Close collaboration panel'}));fireEvent.click(screen.getByTestId('assist-toggle'));
    if(scenario==='delayed'){tasks=[{id:'delayed',intent:'Fix',status:'done',result:{changes:'Changed content'}}];await act(async()=>delayed.resolve({data:{id:'delayed'}}));await screen.findByRole('button',{name:'Accept change 1'});}
    else expect(screen.getByRole('alert')).toHaveTextContent('Could not submit');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

});
