import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App, { createAppMemoryRouter } from '../../App';
import api from '../../api/client';

vi.mock('../../components/Layout', () => ({ Layout: () => <Outlet /> }));
vi.mock('../page/PagePreview', () => ({ PagePreview: () => <h1>Original page</h1> }));
vi.mock('../agent/AgentList', () => ({ AgentList: () => <h1>Agents list</h1> }));

const user = { id: 'user-1', email: 'native@example.test', mustChangePassword: true };
const otherUser = { ...user, id: 'user-2', email: 'other@example.test' };
const adapter = api.defaults.adapter;
const devicePath = '/onboard/device?user_code=ABCD-EFGH';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('agentwiki.language.v1', 'en');
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  api.defaults.adapter = adapter;
  localStorage.clear();
});

function open(path: string) {
  const router = createAppMemoryRouter(path);
  const requested: string[] = [];
  api.defaults.adapter = async (config) => {
    const url = config.url ?? '';
    requested.push(url);
    const activeUser = config.headers.get('Authorization') === 'Bearer other-token' ? otherUser : user;
    const data = url === '/auth/login' ? { access_token: 'temporary-token', user }
      : url === '/auth/change-required-password' ? { access_token: 'new-token', user: { ...activeUser, mustChangePassword: false } }
      : url === '/auth/unihub/status' ? { enabled: true }
      : url === '/onboard/device/session' ? {
        clientType: 'codex', purpose: 'full-onboarding', packageVersion: '0.13.6',
        status: 'pending', expiresAt: '2099-01-01T00:00:00Z',
      } : {};
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  render(<App router={router} />);
  return { router, requested };
}

function signIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temporary-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

async function changePassword() {
  const save = await screen.findByRole('button', { name: 'Save' });
  const fields = Array.from(save.closest('form')!.querySelectorAll('input'));
  for (const field of fields) fireEvent.change(field, { target: { value: 'New-password-123' } });
  fireEvent.click(save);
}

it.each([
  ['/pages/original?tab=notes#selection', '/pages/original', '?tab=notes', '#selection'],
  ['/agents?filter=owned#list', '/agents', '?filter=owned', '#list'],
])('returns to the protected destination %s after native login and mandatory password change', async (url, pathname, search, hash) => {
  const { router } = open(url);
  await screen.findByRole('button', { name: 'Sign in' });
  signIn();
  await changePassword();
  await waitFor(() => expect(router.state.location).toMatchObject({ pathname, search, hash }));
  expect(localStorage.getItem('token')).toBe('new-token');
});

function signInFromOtherTab(mustChangePassword: boolean) {
  const key = 'agentwiki.auth.session';
  const nextUser = { ...otherUser, mustChangePassword };
  localStorage.setItem('token', 'other-token');
  localStorage.setItem('user', JSON.stringify(nextUser));
  localStorage.setItem(key, JSON.stringify({ token: 'other-token', user: nextUser }));
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}

it.each([true, false])('drops an earlier account’s device return after a tab switch (requires change: %s)', async (mustChangePassword) => {
  localStorage.setItem('token', 'temporary-token');
  localStorage.setItem('user', JSON.stringify(user));
  const { router, requested } = open(devicePath);
  await screen.findByRole('button', { name: 'Save' });

  await act(async () => { signInFromOtherTab(mustChangePassword); });
  if (mustChangePassword) await changePassword();

  await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  expect(requested).not.toContain('/onboard/device/session');
});

it('does not assign the open device page to a different account that needs a password change', async () => {
  localStorage.setItem('token', 'native-token');
  localStorage.setItem('user', JSON.stringify({ ...user, mustChangePassword: false }));
  const { router, requested } = open(devicePath);
  await screen.findByRole('button', { name: 'Authorize connection' });

  await act(async () => { signInFromOtherTab(true); });
  await changePassword();

  await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
  expect(requested.filter((url) => url === '/onboard/device/session')).toHaveLength(1);
});

it('does not continue a signed-out Hub entry from another tab’s login', async () => {
  const href = '/?intent=unihub&returnTo=' + encodeURIComponent('/unihub?entry=hub') + '#login';
  const { router, requested } = open(href);
  await screen.findByText('Sign in to AgentWiki to connect your UniHub account.');

  await act(async () => { signInFromOtherTab(false); });

  expect(await screen.findByRole('link', { name: 'Open Dashboard' })).toBeVisible();
  expect(router.state.location.pathname).toBe('/');
  expect(requested).not.toContain('/auth/unihub/native');
});

it('shows on the landing page when server sign-out could not be confirmed', async () => {
  localStorage.setItem('token', 'temporary-token');
  localStorage.setItem('user', JSON.stringify(user));
  open('/change-password');
  const logOut = await screen.findByRole('button', { name: 'Log out' });
  api.defaults.adapter = async () => { throw new Error('Network offline'); };

  fireEvent.click(logOut);

  expect(await screen.findByRole('alert')).toHaveTextContent('Server sign-out could not be confirmed.');
  expect(localStorage.getItem('token')).toBeNull();
});

it('routes an existing temporary session through password change before loading the device decision', async () => {
  localStorage.setItem('token', 'temporary-token');
  localStorage.setItem('user', JSON.stringify(user));
  const { router, requested } = open(devicePath);

  await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
  expect(requested).not.toContain('/onboard/device/session');
  await changePassword();
  expect(await screen.findByRole('button', { name: 'Authorize connection' })).toBeVisible();
  expect(router.state.location).toMatchObject({ pathname: '/onboard/device', search: '?user_code=ABCD-EFGH' });
});

it('keeps a device code through native login and mandatory password change', async () => {
  const { router, requested } = open(devicePath);
  fireEvent.click(await screen.findByRole('link', { name: 'Sign in or register to authorize' }));
  signIn();

  await waitFor(() => expect(router.state.location.pathname).toBe('/change-password'));
  expect(requested.filter((url) => url === '/onboard/device/session')).toHaveLength(1);
  await changePassword();
  expect(await screen.findByRole('button', { name: 'Authorize connection' })).toBeVisible();
  expect(router.state.location.search).toBe('?user_code=ABCD-EFGH');
});
