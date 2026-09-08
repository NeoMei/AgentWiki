import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { ProtectedRoute, createAppMemoryRouter } from './App';

const authState = vi.hoisted(() => ({ token: null as string | null, user: null as { id?: string; mustChangePassword?: boolean } | null }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('./api/client', () => ({ default: api }));

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ token: authState.token, user: authState.user }),
}));

vi.mock('./components/Layout', () => ({ Layout: () => <Outlet /> }));

vi.mock('./features/collaboration/TemplateEditor', () => ({
  TemplateEditor: ({ mode }: { mode: string }) => <h1>Template editor mode: {mode}</h1>,
}));

vi.mock('./features/page-templates/PageTemplateManager', () => ({
  PageTemplateManager: () => <h2>Space 页面模板</h2>,
}));

vi.mock('./features/knowledge/KnowledgeGraph', () => ({ KnowledgeGraph: () => <h2>Graph body</h2> }));
vi.mock('./features/source/SourcesPage', () => ({ SourcesPage: () => <h2>Sources body</h2> }));
vi.mock('./features/source/RunsPage', () => ({ RunsPage: () => <h2>Runs body</h2> }));
vi.mock('./features/space/SpaceMembers', () => ({ SpaceMembers: () => <h2>Members body</h2> }));
vi.mock('./features/space/SpaceSettings', () => ({ SpaceSettings: () => <h2>Settings body</h2> }));
vi.mock('./features/collaboration/CollaborationWorkspace', () => ({ CollaborationWorkspace: () => <h2>Collaboration body</h2> }));
vi.mock('./features/collaboration/RunStartWizard', () => ({ RunStartWizard: () => <h2>Run wizard body</h2> }));
vi.mock('./features/collaboration/RunDashboard', () => ({ RunDashboard: () => <h2>Run dashboard body</h2> }));

const LocationProbe = () => {
  const location = useLocation();
  return <p>{location.pathname + location.search + location.hash}</p>;
};

const installDataRouterRequestShim = () => {
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
};

describe('ProtectedRoute', () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    authState.token = null;
    authState.user = null;
    window.history.replaceState({}, '', '/');
    localStorage.setItem('agentwiki.language.v1', 'en');
  });

  it('keeps a signed-in user on required password change until it is completed', () => {
    authState.token = 'signed-in';
    authState.user = { mustChangePassword: true };

    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><p>private</p></ProtectedRoute>} />
          <Route path="/change-password" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('/change-password')).toBeInTheDocument();
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('redirects signed-out protected routes to the workspace login intent', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<ProtectedRoute><p>private</p></ProtectedRoute>} />
          <Route path="/" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('/?intent=workspace#login')).toBeInTheDocument();
  });

  it('routes the static new-template URL to explicit create mode', async () => {
    authState.token = 'signed-in';
    render(<App router={createAppMemoryRouter('/spaces/space-1/collaboration/templates/new')} />);

    expect(await screen.findByRole('heading', { name: 'Template editor mode: create' })).toBeVisible();
  });

  it('routes the settings page to PageTemplateManager', async () => {
    authState.token = 'signed-in';
    render(<App router={createAppMemoryRouter('/spaces/space-1/settings/page-templates')} />);

    expect(await screen.findByRole('heading', { name: 'Space 页面模板' })).toBeInTheDocument();
  });

  it.each([
    ['/spaces/graph-space/graph', 'graph-space', 'Graph'],
    ['/spaces/member-space/members', 'member-space', 'Members'],
    ['/spaces/settings-space/settings', 'settings-space', 'Settings'],
    ['/spaces/template-settings-space/settings/page-templates', 'template-settings-space', 'Settings'],
    ['/spaces/docs-space/docs', 'docs-space', 'Sources'],
    ['/spaces/source-space/sources', 'source-space', 'Sources'],
    ['/spaces/ingest-space/runs', 'ingest-space', 'Runs'],
    ['/spaces/collaboration-space/collaboration', 'collaboration-space', 'Collaboration'],
    ['/spaces/create-space/collaboration/templates/new', 'create-space', 'Collaboration'],
    ['/spaces/edit-space/collaboration/templates/template-17', 'edit-space', 'Collaboration'],
    ['/spaces/start-space/collaboration/templates/template-18/start', 'start-space', 'Collaboration'],
    ['/spaces/run-space/collaboration/runs/run-22', 'run-space', 'Collaboration'],
  ])('wraps section route %s with its real Space identity and one navigation', async (path, expectedSpaceId, activeLabel) => {
    installDataRouterRequestShim();
    authState.token = 'signed-in';
    authState.user = { id: 'user-1' };
    api.get.mockImplementation(async (url: string) => {
      const match = url.match(/^\/spaces\/([^/]+)$/u);
      if (!match) throw new Error(`unexpected get ${url}`);
      return { data: { id: match[1], name: `Space ${match[1]}`, description: '', members: [] } };
    });

    render(<App router={createAppMemoryRouter(path)} />);

    expect(await screen.findByRole('heading', { name: `Space ${expectedSpaceId}` })).toBeVisible();
    expect(screen.getAllByRole('navigation', { name: 'Space navigation' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: activeLabel })).toHaveAttribute('aria-current', 'page');
    expect(document.querySelector('aside')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/spaces/${expectedSpaceId}`);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain(`/spaces/template-17`);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain(`/spaces/template-18`);
    expect(api.get.mock.calls.map(([url]) => url)).not.toContain(`/spaces/run-22`);
    expect(api.get.mock.calls.every(([url]) => !String(url).includes('/folders') && !String(url).includes('/content-tree'))).toBe(true);
  });

  it('redirects the legacy integrations URL to the Obsidian guide', async () => {
    installDataRouterRequestShim();
    const router = createAppMemoryRouter('/settings/integrations');
    render(<App router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide/obsidian'));
  });

  it('keeps section content and a retry path visible when Space metadata fails', async () => {
    authState.token = 'signed-in';
    authState.user = { id: 'user-1' };
    api.get
      .mockRejectedValueOnce({ response: { status: 503, data: { message: 'Space temporarily unavailable' } } })
      .mockResolvedValueOnce({ data: { id: 'space-error', name: 'Recovered Space', description: '', members: [] } });

    render(<App router={createAppMemoryRouter('/spaces/space-error/sources')} />);

    expect(await screen.findByText('Space temporarily unavailable')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Sources body' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Space navigation' })).not.toBeInTheDocument();
    expect(document.querySelector('aside')).not.toBeInTheDocument();
    const errorLayout = screen.getByText('Space temporarily unavailable').parentElement?.parentElement;
    expect(errorLayout).toHaveClass('flex-col');
    expect(errorLayout).not.toHaveClass('lg:flex-row');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Recovered Space' })).toBeVisible();
    expect(screen.queryByText('Space temporarily unavailable')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Space navigation' })).toBeVisible();
  });
});
