import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { createAppMemoryRouter } from '../../App';
import api from '../../api/client';
import { AuthProvider, useAuth } from '../../context/AuthContext';

const localUser = { id: 'local-user', name: 'Local User', email: 'local@example.test' };
const centerUser = { id: 'center-user', name: 'Center User', authSource: 'unihub' };
const confirmationId = 'a'.repeat(64);
const callbackRoute = '/unihub?continue=1&flow=' + confirmationId;
const preview = {
  mode: 'link',
  confirmationId,
  localEmail: 'Exact.Local@example.test',
  centralUserId: 'central-preview-42',
  displayName: 'Selected UniHub Account',
  maskedEmail: 's***@example.test',
};

function seedSession(user: typeof localUser & { authSource?: string } = localUser) {
  localStorage.setItem('token', 'original-token');
  localStorage.setItem('user', JSON.stringify(user));
}

function mockApi(respond: (request: InternalAxiosRequestConfig) => unknown = () => ({})) {
  const adapter = vi.fn(async (request: InternalAxiosRequestConfig): Promise<AxiosResponse> => ({
    data: await respond(request), status: 200, statusText: 'OK', headers: {}, config: request,
  }));
  api.defaults.adapter = adapter;
  return adapter;
}

function rejectUnauthorized(request: InternalAxiosRequestConfig): never {
  throw new AxiosError('Unauthorized', undefined, request, undefined, {
    data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config: request,
  });
}

function openRoute(path: string) {
  const router = createAppMemoryRouter(path);
  render(<StrictMode><App router={router} /></StrictMode>);
  return router;
}

function submitNativeLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: localUser.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'local-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('agentwiki.language.v1', 'en');
  window.history.replaceState({}, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('UniHub browser flows', () => {
  it('preserves the original protected destination in the UniHub sign-in URL', async () => {
    const adapter = mockApi(() => ({ enabled: true }));
    openRoute('/pages/old-page?tab=notes#selection');

    const signIn = await screen.findByRole('link', { name: 'Sign in with UniHub' });
    expect(signIn).toHaveAttribute('href', '/api/auth/unihub/start?returnTo=%2Fpages%2Fold-page%3Ftab%3Dnotes%23selection');
    expect(adapter.mock.calls[0][0]).toMatchObject({ method: 'get', baseURL: '/api', url: '/auth/unihub/status' });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it.each([false, 'true', null])('keeps UniHub hidden when enabled is %s', async (enabled) => {
    const adapter = mockApi(() => ({ enabled }));
    openRoute('/');

    await waitFor(() => expect(adapter).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: 'Sign in with UniHub' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  it('does not render or finish a callback when status is disabled', async () => {
    const adapter = mockApi(() => ({ enabled: false }));
    const router = openRoute(callbackRoute);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(adapter.mock.calls.every(([request]) => request.method === 'get')).toBe(true);
    expect(screen.queryByRole('heading', { name: 'UniHub' })).not.toBeInTheDocument();
  });

  it.each(['//outside.test', '/unihub?continue=1', '/api/auth/unihub/start', '/onboard/device?unexpected=1'])('rejects the unsafe sign-in destination %s', async (returnTo) => {
    mockApi(() => ({ enabled: true }));
    openRoute('/unihub?returnTo=' + encodeURIComponent(returnTo));

    expect(await screen.findByRole('link', { name: 'Sign in with UniHub' }))
      .toHaveAttribute('href', '/api/auth/unihub/start?returnTo=%2F');
  });

  it('resumes the Hub entry after the original AgentWiki login without offering SSO there', async () => {
    const adapter = mockApi(({ url }) => url === '/auth/login'
      ? { access_token: 'original-token', user: localUser }
      : { enabled: true, bound: false });
    const router = openRoute('/unihub?entry=hub');

    await screen.findByText('Sign in to AgentWiki to connect your UniHub account.');
    expect(screen.queryByRole('link', { name: 'Sign in with UniHub' })).not.toBeInTheDocument();
    submitNativeLogin();

    expect(await screen.findByRole('button', { name: 'Link an existing UniHub account' })).toBeVisible();
    expect(router.state.location).toMatchObject({ pathname: '/unihub', search: '?entry=hub' });
    expect(adapter.mock.calls.find(([request]) => request.url === '/auth/unihub/status' && request.headers.get('Authorization'))
      ?.[0].headers.get('Authorization')).toBe('Bearer original-token');
  });

  it.each([
    ['Link an existing UniHub account', ' reauth ', { mode: 'link', password: ' reauth ' }],
    ['Create a UniHub account', '', { mode: 'enroll' }],
  ])('sends the locally confirmed %s choice with optional reauthentication', async (label, password, body) => {
    seedSession();
    const adapter = mockApi((request) => {
      if (request.url === '/auth/unihub/native') rejectUnauthorized(request);
      return { enabled: true };
    });
    openRoute('/unihub?entry=hub');

    fireEvent.click(await screen.findByRole('button', { name: label }));
    expect(adapter.mock.calls.some(([request]) => request.method === 'post')).toBe(false);
    const field = screen.getByLabelText('AgentWiki password');
    expect(field).toHaveAttribute('type', 'password');
    if (password) fireEvent.change(field, { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('alert')).toBeVisible();
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/native')?.[0];
    expect(JSON.parse(request?.data ?? '{}')).toEqual(body);
    expect(request?.headers.get('Authorization')).toBe('Bearer original-token');
    expect(localStorage.getItem('token')).toBe('original-token');
  });

  it('opens a known binding without submitting a password', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => url === '/auth/unihub/native'
      ? { redirectUrl: 'javascript:void(0)' }
      : { enabled: true, bound: true });
    openRoute('/unihub');

    fireEvent.click(await screen.findByRole('button', { name: 'Open UniHub' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.queryByLabelText('AgentWiki password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link an existing UniHub account' })).not.toBeInTheDocument();
    expect(adapter.mock.calls.find(([request]) => request.url === '/auth/unihub/native')?.[0].data).toBe('{"mode":"open"}');
  });

  it('shows the exact accounts and sends the selected central ID only after confirmation', async () => {
    seedSession();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return preview;
      if (url === '/auth/unihub/finish') return { returnTo: '/guide/obsidian#connect' };
      return { enabled: true };
    });
    const router = openRoute(callbackRoute);

    const finish = await screen.findByRole('button', { name: 'Complete UniHub connection' });
    expect(screen.getByText(preview.localEmail)).toBeVisible();
    expect(screen.getByText(preview.displayName)).toBeVisible();
    expect(screen.getByText(preview.maskedEmail)).toBeVisible();
    expect(screen.queryByText(preview.centralUserId)).not.toBeInTheDocument();
    const pending = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/pending')?.[0];
    expect(pending).toMatchObject({ method: 'get', baseURL: '/api', params: { flow: confirmationId } });
    expect(pending?.headers.get('Authorization')).toBe('Bearer original-token');
    expect(adapter.mock.calls.some(([request]) => request.method === 'post')).toBe(false);
    await act(async () => { await router.navigate('/'); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/unihub');
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);

    fireEvent.click(finish);
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/guide/obsidian', hash: '#connect' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/finish')?.[0];
    expect(JSON.parse(request?.data ?? '{}')).toEqual({ mode: 'link', confirmationId, centralUserId: preview.centralUserId });
    expect(request?.headers.get('Authorization')).toBe('Bearer original-token');
    expect(localStorage.getItem('token')).toBe('original-token');
  });

  it('leaves the preview on Cancel without posting finish', async () => {
    seedSession();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const adapter = mockApi(({ url }) => url === '/auth/unihub/pending' ? preview : { enabled: true });
    const router = openRoute(callbackRoute + '&returnTo=%2Fguide%2Fobsidian');

    await screen.findByText(preview.localEmail);
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/guide/obsidian'));
    expect(confirm).not.toHaveBeenCalled();
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
  });

  it.each([false, true])('blocks finish when the preview request fails (signed in: %s)', async (signedIn) => {
    if (signedIn) seedSession();
    const adapter = mockApi((request) => {
      if (request.url === '/auth/unihub/pending') rejectUnauthorized(request);
      return { enabled: true };
    });
    openRoute(callbackRoute);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to verify the pending UniHub request.');
    expect(screen.getByRole('link', { name: 'Cancel' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Complete UniHub connection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
    expect(localStorage.getItem('token')).toBe(signedIn ? 'original-token' : null);
  });

  it('blocks a preview returned for a different browser flow', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => url === '/auth/unihub/pending'
      ? { ...preview, confirmationId: 'b'.repeat(64) }
      : { enabled: true });
    openRoute(callbackRoute);

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to verify the pending UniHub request.');
    expect(screen.queryByRole('button', { name: 'Complete UniHub connection' })).not.toBeInTheDocument();
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
  });

  it('blocks a link if the active bearer changes after preview', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => url === '/auth/unihub/pending' ? preview : { enabled: true });
    openRoute(callbackRoute);

    const finish = await screen.findByRole('button', { name: 'Complete UniHub connection' });
    localStorage.setItem('token', 'different-token');
    fireEvent.click(finish);
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
  });

  it('keeps signed-in SSO explicit and submits no link identity', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId };
      if (url === '/auth/unihub/finish') return { returnTo: '/guide/obsidian' };
      return { enabled: true };
    });
    const router = openRoute(callbackRoute);

    const next = await screen.findByRole('button', { name: 'Continue' });
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
    fireEvent.click(next);
    await waitFor(() => expect(router.state.location.pathname).toBe('/guide/obsidian'));
    expect(adapter.mock.calls.find(([request]) => request.url === '/auth/unihub/finish')?.[0].data).toBe(JSON.stringify({ mode: 'sso', confirmationId }));
  });

  it('finishes signed-out SSO once and stores the AgentWiki session through AuthProvider', async () => {
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId };
      if (url === '/auth/unihub/finish') return { access_token: 'sso-token', user: centerUser, returnTo: '/guide/obsidian#connect' };
      return { enabled: true };
    });
    const router = openRoute(callbackRoute);

    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/guide/obsidian', hash: '#connect' }));
    const callbackRequests = adapter.mock.calls.map(([request]) => request.url).filter(url => url?.endsWith('/pending') || url?.endsWith('/finish'));
    expect(callbackRequests).toEqual(['/auth/unihub/pending', '/auth/unihub/finish']);
    const finishRequests = adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/finish');
    expect(finishRequests).toHaveLength(1);
    expect(finishRequests[0][0].data).toBe(JSON.stringify({ mode: 'sso', confirmationId }));
    expect(finishRequests[0][0].headers.get('Authorization')).toBeUndefined();
    expect(localStorage.getItem('token')).toBe('sso-token');
    expect(JSON.parse(localStorage.getItem('user') ?? '{}')).toEqual(centerUser);
  });

  it('offers connection management from the authenticated profile', async () => {
    seedSession();
    mockApi(({ url }) => url === '/auth/unihub/status' ? { enabled: true } : {});
    openRoute('/profile');

    expect(await screen.findByRole('link', { name: 'Manage UniHub connection' })).toHaveAttribute('href', '/unihub');
  });
});

function LogoutButton() {
  const { logout } = useAuth();
  return <button onClick={() => { void logout(); }}>Log out</button>;
}

describe('UniHub logout', () => {
  it('sends the captured SSO bearer before clearing local auth even when remote logout fails', async () => {
    seedSession({ ...localUser, authSource: centerUser.authSource });
    let rejectLogout!: () => void;
    const adapter = mockApi((request) => new Promise((_, reject) => {
      rejectLogout = () => {
        try { rejectUnauthorized(request); } catch (error) { reject(error); }
      };
    }));
    render(<AuthProvider><LogoutButton /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(adapter).toHaveBeenCalledOnce());
    const request = adapter.mock.calls[0][0];
    expect(request.url).toBe('/auth/unihub/logout');
    expect(request.headers.get('Authorization')).toBe('Bearer original-token');
    expect(localStorage.getItem('token')).toBe('original-token');

    await act(async () => { rejectLogout(); });
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears a native session without calling UniHub logout', () => {
    seedSession();
    const adapter = mockApi();
    render(<AuthProvider><LogoutButton /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(localStorage.getItem('token')).toBeNull();
    expect(adapter).not.toHaveBeenCalled();
  });
});
