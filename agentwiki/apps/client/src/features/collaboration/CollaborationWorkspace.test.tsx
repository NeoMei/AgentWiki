import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { collaborationApi } from './api';
import { CollaborationWorkspace } from './CollaborationWorkspace';

vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('./api', () => ({
  collaborationApi: {
    listTemplates: vi.fn(), copyTemplate: vi.fn(), archiveTemplate: vi.fn(),
    listRuns: vi.fn(), listMembers: vi.fn(),
  },
}));

const systemCodingTemplate = {
  id: 'system-coding', spaceId: null, slug: 'coding', name: '编码协作 / Coding collaboration',
  description: '从需求分析到发布 / From requirements to release', system: true, version: 1,
};
const spaceTemplate = {
  id: 'space-template', spaceId: 'space-1', slug: 'backend-release', name: 'Backend release',
  description: 'Release workflow', system: false, version: 2,
};
const spaceBTemplate = {
  id: 'space-b-template', spaceId: 'space-2', slug: 'space-b', name: 'Space B template',
  description: 'Space B workflow', system: false, version: 1,
};

let navigateWorkspace!: ReturnType<typeof useNavigate>;

const NavigationCapture = () => {
  navigateWorkspace = useNavigate();
  return null;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderWorkspace(language: 'en' | 'zh-CN' = 'en') {
  localStorage.setItem('agentwiki.language.v1', language);
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/spaces/space-1/collaboration']}>
        <NavigationCapture />
        <Routes>
          <Route path="/spaces/:id/collaboration" element={<CollaborationWorkspace />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('CollaborationWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'owner-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listTemplates).mockResolvedValue([systemCodingTemplate, spaceTemplate]);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'owner-1', role: 'owner' },
    ]);
    vi.mocked(collaborationApi.listRuns).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('shows system and Space templates and copies a system template', async () => {
    vi.mocked(collaborationApi.copyTemplate).mockResolvedValue({ ...spaceTemplate, id: 'copy-1' });
    renderWorkspace();

    expect(await screen.findByText('Coding collaboration')).toBeVisible();
    expect(screen.getByText('Backend release')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Copy as my template' }));
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Backend release copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(collaborationApi.copyTemplate).toHaveBeenCalledWith(
      'space-1', 'system-coding', 'Backend release copy',
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Template copied');
  });

  it('keeps ingest Runs distinct and places Collaboration between Runs and Members', async () => {
    renderWorkspace();
    await screen.findByText('Coding collaboration');
    const links = screen.getAllByRole('link');
    const labels = links.map((link) => link.textContent?.trim());
    expect(labels.indexOf('Runs')).toBeLessThan(labels.indexOf('Collaboration'));
    expect(labels.indexOf('Collaboration')).toBeLessThan(labels.indexOf('Members'));
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/spaces/space-1/runs');
    expect(screen.getByRole('link', { name: 'Collaboration' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows active and history runs on separate tabs', async () => {
    vi.mocked(collaborationApi.listRuns)
      .mockResolvedValueOnce({ items: [{ id: 'active-1', name: 'Active release', status: 'running', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'done-1', name: 'Finished release', status: 'completed', createdAt: '2026-08-23T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z' }], nextCursor: null });
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    expect(await screen.findByText('Active release')).toBeVisible();
    expect(collaborationApi.listRuns).toHaveBeenCalledWith('space-1', 'active');
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Finished release')).toBeVisible();
    expect(collaborationApi.listRuns).toHaveBeenCalledWith('space-1', 'history');
  });

  it('loads the next server-filtered Run page without truncating after the first 100', async () => {
    vi.mocked(collaborationApi.listRuns)
      .mockResolvedValueOnce({
        items: [{ id: 'active-100', name: 'Active 100', status: 'running', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' }],
        nextCursor: 'active-page-2',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'active-101', name: 'Active 101', status: 'ready', createdAt: '2026-08-23T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z' }],
        nextCursor: null,
      });
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    expect(await screen.findByText('Active 100')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Active 101')).toBeVisible();
    expect(screen.getByText('Active 100')).toBeVisible();
    expect(collaborationApi.listRuns).toHaveBeenLastCalledWith('space-1', 'active', 'active-page-2');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('does not let an older Active first-page response overwrite the current History tab', async () => {
    const active = deferred<Awaited<ReturnType<typeof collaborationApi.listRuns>>>();
    vi.mocked(collaborationApi.listRuns).mockImplementation(async (_spaceId, kind) => {
      if (kind === 'active') return active.promise;
      return {
        items: [{ id: 'history-current', name: 'Current history', status: 'completed', createdAt: '2026-08-23T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z' }],
        nextCursor: null,
      };
    });
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Current history')).toBeVisible();
    await act(async () => active.resolve({
      items: [{ id: 'active-stale', name: 'Stale active', status: 'running', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' }],
      nextCursor: 'stale-active-cursor',
    }));

    await waitFor(() => expect(screen.getByText('Current history')).toBeVisible());
    expect(screen.queryByText('Stale active')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('does not append an older Active load-more response or cursor after switching to History', async () => {
    const activeMore = deferred<Awaited<ReturnType<typeof collaborationApi.listRuns>>>();
    vi.mocked(collaborationApi.listRuns).mockImplementation(async (_spaceId, kind, cursor) => {
      if (kind === 'active' && cursor) return activeMore.promise;
      if (kind === 'active') return {
        items: [{ id: 'active-current', name: 'Current active', status: 'running', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' }],
        nextCursor: 'active-page-2',
      };
      return {
        items: [{ id: 'history-current', name: 'Current history', status: 'completed', createdAt: '2026-08-23T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z' }],
        nextCursor: null,
      };
    });
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    expect(await screen.findByText('Current active')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Current history')).toBeVisible();
    await act(async () => activeMore.resolve({
      items: [{ id: 'active-stale-more', name: 'Stale active page', status: 'ready', createdAt: '2026-08-22T00:00:00Z', updatedAt: '2026-08-22T00:00:00Z' }],
      nextCursor: 'stale-page-3',
    }));

    await waitFor(() => expect(screen.getByText('Current history')).toBeVisible());
    expect(screen.queryByText('Stale active page')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('does not let an obsolete Active error replace the ready History state', async () => {
    const active = deferred<Awaited<ReturnType<typeof collaborationApi.listRuns>>>();
    vi.mocked(collaborationApi.listRuns).mockImplementation(async (_spaceId, kind) => kind === 'active'
      ? active.promise
      : {
        items: [{ id: 'history-current', name: 'Current history', status: 'completed', createdAt: '2026-08-23T00:00:00Z', updatedAt: '2026-08-23T00:00:00Z' }],
        nextCursor: null,
      });
    renderWorkspace();
    await screen.findByText('Coding collaboration');

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Current history')).toBeVisible();
    await act(async () => active.reject(new Error('obsolete active failure')));

    await waitFor(() => expect(screen.getByText('Current history')).toBeVisible());
    expect(screen.queryByTestId('collaboration-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not let an older Space A Templates success replace Space B data or permissions', async () => {
    const spaceA = deferred<Awaited<ReturnType<typeof collaborationApi.listTemplates>>>();
    vi.mocked(collaborationApi.listTemplates).mockImplementation(async (spaceId) => spaceId === 'space-1'
      ? spaceA.promise
      : [spaceBTemplate]);
    vi.mocked(collaborationApi.listMembers).mockImplementation(async (spaceId) => spaceId === 'space-1'
      ? [{ type: 'human', userId: 'owner-1', role: 'owner' }]
      : [{ type: 'human', userId: 'owner-1', role: 'viewer' }]);
    renderWorkspace();
    await waitFor(() => expect(collaborationApi.listTemplates).toHaveBeenCalledWith('space-1'));

    await act(async () => navigateWorkspace('/spaces/space-2/collaboration'));
    expect(await screen.findByText('Space B template')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Create template' })).not.toBeInTheDocument();
    await act(async () => spaceA.resolve([spaceTemplate]));

    await waitFor(() => expect(screen.getByText('Space B template')).toBeVisible());
    expect(screen.queryByText('Backend release')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create template' })).not.toBeInTheDocument();
  });

  it('does not let an older Space A Templates error replace ready Space B', async () => {
    const spaceA = deferred<Awaited<ReturnType<typeof collaborationApi.listTemplates>>>();
    vi.mocked(collaborationApi.listTemplates).mockImplementation(async (spaceId) => spaceId === 'space-1'
      ? spaceA.promise
      : [spaceBTemplate]);
    renderWorkspace();
    await waitFor(() => expect(collaborationApi.listTemplates).toHaveBeenCalledWith('space-1'));

    await act(async () => navigateWorkspace('/spaces/space-2/collaboration'));
    expect(await screen.findByText('Space B template')).toBeVisible();
    await act(async () => spaceA.reject(new Error('obsolete Space A failure')));

    await waitFor(() => expect(screen.getByText('Space B template')).toBeVisible());
    expect(screen.queryByTestId('collaboration-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not let an obsolete Templates error replace an Active Runs tab', async () => {
    const templates = deferred<Awaited<ReturnType<typeof collaborationApi.listTemplates>>>();
    vi.mocked(collaborationApi.listTemplates).mockReturnValue(templates.promise);
    vi.mocked(collaborationApi.listRuns).mockResolvedValue({
      items: [{ id: 'active-current', name: 'Current active', status: 'running', createdAt: '2026-08-24T00:00:00Z', updatedAt: '2026-08-24T00:00:00Z' }],
      nextCursor: null,
    });
    renderWorkspace();
    await waitFor(() => expect(collaborationApi.listTemplates).toHaveBeenCalledWith('space-1'));

    fireEvent.click(screen.getByRole('tab', { name: 'Active runs' }));
    expect(await screen.findByText('Current active')).toBeVisible();
    await act(async () => templates.reject(new Error('obsolete Templates failure')));

    await waitFor(() => expect(screen.getByText('Current active')).toBeVisible());
    expect(screen.queryByTestId('collaboration-error')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not inspect or publish a Templates failure after unmount', async () => {
    const templates = deferred<Awaited<ReturnType<typeof collaborationApi.listTemplates>>>();
    vi.mocked(collaborationApi.listTemplates).mockReturnValue(templates.promise);
    let inspected = false;
    const obsoleteError = Object.defineProperty({}, 'response', {
      get: () => {
        inspected = true;
        return undefined;
      },
    });
    const view = renderWorkspace();
    await waitFor(() => expect(collaborationApi.listTemplates).toHaveBeenCalledWith('space-1'));

    view.unmount();
    await act(async () => templates.reject(obsoleteError));

    expect(inspected).toBe(false);
  });

  it('renders loading, empty, error, permissions, and Chinese copy', async () => {
    let release!: (value: typeof systemCodingTemplate[]) => void;
    vi.mocked(collaborationApi.listTemplates).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const view = renderWorkspace('zh-CN');
    expect(screen.getByTestId('collaboration-loading')).toBeVisible();
    release([]);
    expect(await screen.findByTestId('collaboration-empty')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Agent 协作' })).toBeVisible();
    view.unmount();

    vi.mocked(useAuth).mockReturnValue({ user: { id: 'viewer-1' } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: 'viewer-1', role: 'viewer' },
    ]);
    vi.mocked(collaborationApi.listTemplates).mockResolvedValue([systemCodingTemplate, spaceTemplate]);
    renderWorkspace();
    await screen.findByText('Coding collaboration');
    expect(screen.queryByRole('button', { name: 'Copy as my template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start run' })).not.toBeInTheDocument();
  });

  it('renders a recoverable error state', async () => {
    vi.mocked(collaborationApi.listTemplates).mockRejectedValue(new Error('offline'));
    renderWorkspace();
    expect(await screen.findByTestId('collaboration-error')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it.each(['owner', 'admin', 'editor'] as const)('shows Start run to a human %s', async (role) => {
    vi.mocked(useAuth).mockReturnValue({ user: { id: `${role}-1` } } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([
      { type: 'human', userId: `${role}-1`, role },
    ]);
    renderWorkspace();

    const startLinks = await screen.findAllByRole('link', { name: 'Start run' });
    expect(startLinks).toHaveLength(2);
    startLinks.forEach((link) => expect(link).toBeVisible());
  });

  it('treats a platform super admin without Space membership as Owner', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'platform-admin', platformRole: 'super_admin' },
    } as ReturnType<typeof useAuth>);
    vi.mocked(collaborationApi.listMembers).mockResolvedValue([]);

    renderWorkspace();

    expect(await screen.findByRole('link', { name: 'Create template' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Start run' })).toHaveLength(2);
  });
});
