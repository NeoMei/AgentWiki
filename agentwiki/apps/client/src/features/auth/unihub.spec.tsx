import { StrictMode } from 'react';
import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App, { createAppMemoryRouter } from '../../App';
import api, { authSessionKey, writeAuthSession } from '../../api/client';
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

function updateFromOtherTab(token: string | null, user: unknown = null) {
  const oldValue = localStorage.getItem(authSessionKey);
  writeAuthSession(token, user);
  window.dispatchEvent(new StorageEvent('storage', {
    key: authSessionKey,
    storageArea: localStorage,
    oldValue,
    newValue: localStorage.getItem(authSessionKey),
  }));
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
  sessionStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  localStorage.setItem('agentwiki.language.v1', 'en');
  window.history.replaceState({}, '', '/');
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

describe('UniHub browser flows', () => {
  it('uses UniHub as the primary sign-in entry when the default rollout is enabled', async () => {
    mockApi(() => ({ enabled: true, defaultLogin: true }));
    openRoute('/pages/old-page?tab=notes#selection');

    expect(await screen.findByRole('link', { name: 'Sign in with UniHub' })).toHaveAttribute('href',
      '/api/auth/unihub/start?returnTo=%2Fpages%2Fold-page%3Ftab%3Dnotes%23selection&mode=workspace');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in with AgentWiki' })).toHaveAttribute('href', expect.stringContaining('intent=unihub'));
  });

  it('offers central sign-in and original account migration after the passive login returns', async () => {
    mockApi(() => ({ enabled: true, defaultLogin: true }));
    openRoute('/unihub?error=workspace&returnTo=%2Fpages%2Fold-page');

    expect(await screen.findByRole('link', { name: 'Sign in with UniHub' })).toHaveAttribute('href',
      '/api/auth/unihub/start?returnTo=%2Fpages%2Fold-page&mode=workspace&prompt=login');
    expect(screen.getByRole('link', { name: 'Sign in with AgentWiki' })).toHaveAttribute('href', expect.stringContaining('intent=unihub'));
  });

  it('keeps workspace sign-in on a retry after the authorization preview cannot load', async () => {
    mockApi(({ url }) => url === '/auth/unihub/status' ? { enabled: true, defaultLogin: true } : {});
    openRoute(callbackRoute + '&mode=workspace&returnTo=%2Fprofile%2F');

    expect(await screen.findByRole('link', { name: 'Start a new UniHub sign-in' })).toHaveAttribute('href',
      '/api/auth/unihub/start?returnTo=%2Fprofile%2F&mode=workspace');
  });

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

  it('automatically continues the Hub entry once after the original AgentWiki login', async () => {
    const adapter = mockApi((request) => {
      if (request.url === '/auth/login') return { access_token: 'original-token', user: localUser };
      if (request.url === '/auth/unihub/native') throw new AxiosError('Unavailable', undefined, request, undefined, {
        data: {}, status: 503, statusText: 'Unavailable', headers: {}, config: request,
      });
      return { enabled: true, bound: false };
    });
    const router = openRoute('/unihub?entry=hub');

    await screen.findByText('Sign in to AgentWiki to connect your UniHub account.');
    expect(screen.queryByRole('link', { name: 'Sign in with UniHub' })).not.toBeInTheDocument();
    submitNativeLogin();

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Link an existing UniHub account' })).toBeVisible();
    expect(screen.queryByLabelText('AgentWiki password')).not.toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('original-token');
    const attempts = adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/native');
    expect(attempts).toHaveLength(1);
    expect(JSON.parse(attempts[0][0].data)).toEqual({ mode: 'auto' });
    expect(attempts[0][0].headers.get('Authorization')).toBe('Bearer original-token');
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
    openRoute('/unihub');

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
    expect(request?.timeout).toBeGreaterThan(0);
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
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/native')?.[0];
    expect(request?.data).toBe('{"mode":"open"}');
    expect(request?.timeout).toBeGreaterThan(0);
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

  it.each([false, true])('explicitly confirms signed-in SSO after an unknown match (same account: %s)', async (sameAccount) => {
    seedSession();
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId, returnTo: '/guide/obsidian#connect' };
      if (url === '/auth/unihub/finish') return sameAccount ? {} : { access_token: 'sso-token', user: centerUser };
      return { enabled: true };
    });
    const router = openRoute(callbackRoute + '&returnTo=%2Fdashboard');

    const next = await screen.findByRole('button', { name: 'Switch AgentWiki account' });
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/guide/obsidian#connect');
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
    fireEvent.click(next);
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/guide/obsidian', hash: '#connect' }));
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/finish')?.[0];
    expect(JSON.parse(request?.data ?? '{}')).toEqual({ mode: 'sso', confirmationId, confirmAccountSwitch: true });
    expect(request?.headers.get('Authorization')).toBe('Bearer original-token');
    expect(request?.timeout).toBeGreaterThan(0);
    expect(localStorage.getItem('token')).toBe(sameAccount ? 'original-token' : 'sso-token');
  });

  it.each([
    { change: 'sign-out', token: null, user: null },
    { change: 'account replacement', token: 'replacement-token', user: centerUser },
    { change: 'a new session for the same account', token: 'replacement-token', user: localUser },
  ])('requires a new SSO flow after cross-tab $change', async ({ token, user }) => {
    writeAuthSession('original-token', localUser);
    const adapter = mockApi((request) => {
      if (request.url === '/auth/unihub/pending') {
        return {
          mode: 'sso', confirmationId, returnTo: '/guide/obsidian#connect',
          sameUser: request.headers.get('Authorization') === 'Bearer replacement-token',
        };
      }
      if (request.url === '/auth/unihub/finish') return { access_token: 'unexpected-token', user: centerUser, returnTo: '/' };
      return { enabled: request.headers.get('Authorization') !== 'Bearer replacement-token' };
    });
    openRoute(callbackRoute + '&returnTo=%2Fguide%2Fobsidian%23connect');
    await screen.findByRole('button', { name: 'Switch AgentWiki account' });
    expect(Object.values(sessionStorage).join('')).not.toContain('original-token');

    await act(async () => { updateFromOtherTab(token, user); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Your AgentWiki session changed.');
    expect(screen.getByRole('link', { name: 'Start a new UniHub sign-in' }))
      .toHaveAttribute('href', '/api/auth/unihub/start?returnTo=%2Fguide%2Fobsidian%23connect');
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/guide/obsidian#connect');
    expect(adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/pending')).toHaveLength(1);
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
    expect(localStorage.getItem('token')).toBe(token);
  });

  it('retains the flow owner across a provider remount and permits a fresh flow in the same tab', async () => {
    seedSession();
    const newFlow = 'b'.repeat(64);
    const adapter = mockApi(({ url, params }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId: params.flow };
      if (url === '/auth/unihub/finish') return { access_token: 'fresh-token', user: centerUser, returnTo: '/' };
      return { enabled: true };
    });
    const original = createAppMemoryRouter(callbackRoute);
    const view = render(<App router={original} />);
    await screen.findByRole('button', { name: 'Switch AgentWiki account' });
    view.unmount();
    updateFromOtherTab(null);

    const reopened = createAppMemoryRouter(callbackRoute);
    const remounted = render(<App router={reopened} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your AgentWiki session changed.');
    expect(adapter.mock.calls.some(([request]) => request.url === '/auth/unihub/finish')).toBe(false);
    remounted.unmount();

    const fresh = openRoute('/unihub?continue=1&flow=' + newFlow);
    await waitFor(() => expect(fresh.state.location.pathname).toBe('/'));
    const finishes = adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/finish');
    expect(finishes).toHaveLength(1);
    expect(JSON.parse(finishes[0][0].data)).toEqual({ mode: 'sso', confirmationId: newFlow });
    expect(localStorage.getItem('token')).toBe('fresh-token');
  });

  it('aborts an in-flight same-account finish on cross-tab logout', async () => {
    seedSession();
    let resolveFinish!: (data: unknown) => void;
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId, sameUser: true };
      if (url === '/auth/unihub/finish') return new Promise((resolve) => { resolveFinish = resolve; });
      return { enabled: true };
    });
    openRoute(callbackRoute);
    await waitFor(() => expect(resolveFinish).toBeDefined());
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/finish')?.[0];

    await act(async () => { updateFromOtherTab(null); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Your AgentWiki session changed.');
    expect(request?.signal?.aborted).toBe(true);
    await act(async () => { resolveFinish({ access_token: 'late-token', user: centerUser, returnTo: '/' }); });
    expect(localStorage.getItem('token')).toBeNull();
    expect(adapter.mock.calls.filter(([entry]) => entry.url === '/auth/unihub/finish')).toHaveLength(1);
  });

  it('offers a new sign-in and Cancel when an automatic SSO finish may have consumed the flow', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId, sameUser: true, returnTo: '/guide/obsidian#connect' };
      if (url === '/auth/unihub/finish') throw new AxiosError('Timed out', 'ECONNABORTED');
      return { enabled: true };
    });
    const router = openRoute(callbackRoute + '&returnTo=%2Fdashboard');

    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Start a new UniHub sign-in' }))
      .toHaveAttribute('href', '/api/auth/unihub/start?returnTo=%2Fguide%2Fobsidian%23connect');
    expect(screen.queryByRole('button', { name: /^(Continue|Switch AgentWiki account)$/ })).not.toBeInTheDocument();
    const finishes = adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/finish');
    expect(finishes).toHaveLength(1);
    expect(JSON.parse(finishes[0][0].data)).toEqual({ mode: 'sso', confirmationId, requireSameUser: true });
    expect(finishes[0][0].timeout).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location).toMatchObject({ pathname: '/guide/obsidian', hash: '#connect' }));
    expect(localStorage.getItem('token')).toBe('original-token');
  });

  it.each([callbackRoute, '/unihub?error=login'])('uses the validated destination to restart a failed callback at %s', async (route) => {
    seedSession();
    mockApi((request) => {
      if (request.url === '/auth/unihub/pending') rejectUnauthorized(request);
      return { enabled: true };
    });
    openRoute(route + '&returnTo=%2Fguide%2Fobsidian%23connect');

    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Start a new UniHub sign-in' }))
      .toHaveAttribute('href', '/api/auth/unihub/start?returnTo=%2Fguide%2Fobsidian%23connect');
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/guide/obsidian#connect');
  });

  it('restarts a failed link from connection management without resubmitting the consumed flow', async () => {
    seedSession();
    const adapter = mockApi((request) => {
      if (request.url === '/auth/unihub/pending') return preview;
      if (request.url === '/auth/unihub/finish') rejectUnauthorized(request);
      return { enabled: true };
    });
    const router = openRoute(callbackRoute + '&returnTo=%2Fguide%2Fobsidian');
    fireEvent.click(await screen.findByRole('button', { name: 'Complete UniHub connection' }));

    fireEvent.click(await screen.findByRole('link', { name: 'Restart UniHub connection' }));
    expect(await screen.findByRole('button', { name: 'Link an existing UniHub account' })).toBeVisible();
    expect(router.state.location).toMatchObject({ pathname: '/unihub', search: '?returnTo=%2Fguide%2Fobsidian' });
    expect(adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/finish')).toHaveLength(1);
  });

  it('keeps Cancel available during SSO completion and ignores a late session response', async () => {
    seedSession();
    let resolveFinish!: (data: unknown) => void;
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId, sameUser: true, returnTo: '/guide/obsidian' };
      if (url === '/auth/unihub/finish') return new Promise((resolve) => { resolveFinish = resolve; });
      return { enabled: true };
    });
    const router = openRoute(callbackRoute);
    await waitFor(() => expect(resolveFinish).toBeDefined());

    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/guide/obsidian'));
    const request = adapter.mock.calls.find(([entry]) => entry.url === '/auth/unihub/finish')?.[0];
    expect(request?.signal?.aborted).toBe(true);
    await act(async () => { resolveFinish({ access_token: 'late-token', user: centerUser, returnTo: '/dashboard' }); });
    expect(router.state.location.pathname).toBe('/guide/obsidian');
    expect(localStorage.getItem('token')).toBe('original-token');
  });

  it('returns a matching SSO callback to the workspace without switching the original local session', async () => {
    seedSession();
    const adapter = mockApi(({ url }) => {
      if (url === '/auth/unihub/pending') return { mode: 'sso', confirmationId, sameUser: true };
      if (url === '/auth/unihub/finish') return { returnTo: '/dashboard' };
      return { enabled: true };
    });
    const router = openRoute(callbackRoute);
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    const requests = adapter.mock.calls.filter(([request]) => request.url === '/auth/unihub/finish');
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0][0].data)).toEqual({ mode: 'sso', confirmationId, requireSameUser: true });
    expect(localStorage.getItem('token')).toBe('original-token');
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

  it('keeps the original UniHub intent attached to a required password change', async () => {
    seedSession();
    localStorage.setItem('user', JSON.stringify({ ...localUser, mustChangePassword: true }));
    mockApi(() => ({ enabled: true }));
    const router = openRoute('/unihub?entry=hub');
    await waitFor(() => expect(router.state.location).toMatchObject({
      pathname: '/change-password',
      state: { passwordUserId: localUser.id, uniHubReturnTo: '/unihub?entry=hub' },
    }));
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
  it.each(['unihub', undefined])('sends the captured bearer before clearing local auth on logout (source: %s)', async (authSource) => {
    seedSession({ ...localUser, authSource });
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
});
