import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { ProtectedRoute, createAppMemoryRouter } from './App';

const authState = vi.hoisted(() => ({ token: null as string | null, user: null as { mustChangePassword?: boolean } | null }));

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ token: authState.token, user: authState.user }),
}));

vi.mock('./components/Layout', () => ({ Layout: () => <Outlet /> }));

vi.mock('./features/collaboration/TemplateEditor', () => ({
  TemplateEditor: ({ mode }: { mode: string }) => <h1>Template editor mode: {mode}</h1>,
}));

vi.mock('./features/page-templates/PageTemplateManager', () => ({
  PageTemplateManager: () => <h1>Space 页面模板</h1>,
}));

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
    authState.token = null;
    authState.user = null;
    window.history.replaceState({}, '', '/');
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

  it('redirects the legacy integrations URL to the Obsidian guide', async () => {
    installDataRouterRequestShim();
    const router = createAppMemoryRouter('/settings/integrations');
    render(<App router={router} />);

    await waitFor(() => expect(router.state.location.pathname).toBe('/guide/obsidian'));
  });
});
