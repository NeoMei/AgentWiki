import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api/client';
import { AuthProvider, useAuth } from './AuthContext';

const sessionKey = 'agentwiki.auth.session';
const adapter = api.defaults.adapter;
const nativeUser = { id: 'native-user' };
const hubUser = { id: 'hub-user', authSource: 'unihub' };

function Probe() {
  const { token, user, logout, logoutFailed } = useAuth();
  return <>
    <output>{user?.id ?? 'signed-out'}:{token ?? 'none'}</output>
    <button onClick={() => { void logout(); }}>Sign out</button>
    {logoutFailed && <span>Server sign-out unconfirmed</span>}
  </>;
}

function storeOtherTabLogin() {
  localStorage.setItem('token', 'hub-token');
  localStorage.setItem('user', JSON.stringify(hubUser));
  localStorage.setItem(sessionKey, JSON.stringify({ token: 'hub-token', user: hubUser }));
}

function notifyOtherTab(key = sessionKey) {
  window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
}

function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('Unauthorized', undefined, config, undefined, {
    status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config,
  });
}

describe('AuthProvider shared browser session', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'native-token');
    localStorage.setItem('user', JSON.stringify(nativeUser));
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    api.defaults.adapter = adapter;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('adopts the other tab’s principal and token together, then observes its sign-out', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('native-user:native-token')).toBeVisible();

    await act(async () => {
      storeOtherTabLogin();
      localStorage.setItem('user', JSON.stringify(nativeUser));
      notifyOtherTab();
    });
    expect(screen.getByText('hub-user:hub-token')).toBeVisible();

    await act(async () => { localStorage.clear(); notifyOtherTab(); });
    expect(screen.getByText('signed-out:none')).toBeVisible();
  });

  it('cancels a request from the old view while another tab’s login is waiting to be applied', async () => {
    const send = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      status: 200, statusText: 'OK', data: {}, headers: {}, config,
    }));
    api.defaults.adapter = send;
    render(<AuthProvider><Probe /></AuthProvider>);
    storeOtherTabLogin();

    await expect(api.post('/spaces', { name: 'Old view action' })).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(send).not.toHaveBeenCalled();

    await act(async () => { notifyOtherTab(); });
    await api.get('/spaces');
    expect(send.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer hub-token');
  });

  it.each([true, false])('ignores a late 401 after the other tab takes over (initially authenticated: %s)', async (authenticated) => {
    if (!authenticated) localStorage.clear();
    let rejectResponse!: () => void;
    const send = vi.fn((config: InternalAxiosRequestConfig) => new Promise<never>((_resolve, reject) => {
      rejectResponse = () => reject(unauthorized(config));
    }));
    api.defaults.adapter = send;
    render(<AuthProvider><Probe /></AuthProvider>);

    const result = api.get('/spaces').catch((error: unknown) => error);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await act(async () => { storeOtherTabLogin(); notifyOtherTab(); });
    rejectResponse();

    expect(await result).toMatchObject({ response: { status: 401 } });
    expect(localStorage.getItem('token')).toBe('hub-token');
    expect(screen.getByText('hub-user:hub-token')).toBeVisible();
  });

  it('still clears the active session for its own rejected bearer', async () => {
    storeOtherTabLogin();
    api.defaults.adapter = async (config) => { throw unauthorized(config); };
    render(<AuthProvider><Probe /></AuthProvider>);
    await act(async () => {
      await expect(api.get('/spaces')).rejects.toMatchObject({ response: { status: 401 } });
    });
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem(sessionKey)).toBeNull();
    expect(screen.getByText('signed-out:none')).toBeVisible();
  });

  it('rejects a late success before the old operation can run a follow-up', async () => {
    const followUp = vi.fn();
    let finish!: () => void;
    const send = vi.fn((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve) => {
      finish = () => resolve({ status: 200, statusText: 'OK', data: {}, headers: {}, config });
    }));
    api.defaults.adapter = send;
    render(<AuthProvider><Probe /></AuthProvider>);
    const result = api.post('/spaces', {}).then(followUp).catch((error: unknown) => error);
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    await act(async () => { storeOtherTabLogin(); notifyOtherTab(); finish(); });

    expect(await result).toMatchObject({ code: 'ERR_CANCELED' });
    expect(followUp).not.toHaveBeenCalled();
    expect(screen.getByText('hub-user:hub-token')).toBeVisible();
  });

  it('waits for the bounded local revocation response before clearing a native session', async () => {
    let finish!: () => void;
    const send = vi.fn((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve) => {
      finish = () => resolve({ status: 204, statusText: 'No Content', data: {}, headers: {}, config });
    }));
    api.defaults.adapter = send;
    render(<AuthProvider><Probe /></AuthProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());

    const request = send.mock.calls[0][0];
    expect(request).toMatchObject({ baseURL: '/api', url: '/auth/unihub/logout', method: 'post', timeout: 5000 });
    expect(request.headers.get('Authorization')).toBe('Bearer native-token');
    expect(screen.getByText('native-user:native-token')).toBeVisible();
    expect(localStorage.getItem('token')).toBe('native-token');

    await act(async () => { finish(); });
    expect(screen.getByText('signed-out:none')).toBeVisible();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('clears a native session locally and records an unconfirmed server logout if the API fails', async () => {
    api.defaults.adapter = async () => { throw new Error('Network offline'); };
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByText('Server sign-out unconfirmed')).toBeVisible();
    expect(screen.getByText('signed-out:none')).toBeVisible();
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('leaves a replacement tab session intact when the outgoing SSO logout completes', async () => {
    storeOtherTabLogin();
    let finishLogout!: () => void;
    const send = vi.fn((config: InternalAxiosRequestConfig) => new Promise<AxiosResponse>((resolve) => {
      finishLogout = () => resolve({ status: 204, statusText: 'OK', data: {}, headers: {}, config });
    }));
    api.defaults.adapter = send;
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());

    await act(async () => {
      localStorage.setItem('token', 'native-replacement');
      localStorage.setItem('user', JSON.stringify(nativeUser));
      localStorage.setItem(sessionKey, JSON.stringify({ token: 'native-replacement', user: nativeUser }));
      notifyOtherTab();
      finishLogout();
    });

    expect(localStorage.getItem('token')).toBe('native-replacement');
    expect(screen.getByText('native-user:native-replacement')).toBeVisible();
  });
});
