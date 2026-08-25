import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App, { ProtectedRoute } from './App';

const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock('./context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ token: authState.token }),
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

describe('ProtectedRoute', () => {
  beforeEach(() => {
    authState.token = null;
    window.history.replaceState({}, '', '/');
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
    window.history.replaceState({}, '', '/spaces/space-1/collaboration/templates/new');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Template editor mode: create' })).toBeVisible();
  });

  it('routes the settings page to PageTemplateManager', async () => {
    authState.token = 'signed-in';
    window.history.replaceState({}, '', '/spaces/space-1/settings/page-templates');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Space 页面模板' })).toBeInTheDocument();
  });

  it('redirects the legacy integrations URL to the Obsidian guide', async () => {
    window.history.replaceState({}, '', '/settings/integrations');

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/guide/obsidian'));
  });
});
