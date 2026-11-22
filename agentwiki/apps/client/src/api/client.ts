import axios from 'axios';
import { unauthorizedRedirect } from '../features/auth/unauthorizedRedirect';

declare module 'axios' {
  interface AxiosRequestConfig {
    authSessionToken?: string | null;
  }
}

export const authSessionKey = 'agentwiki.auth.session';
let renderedToken: string | null | undefined;

export function readAuthSession(): { token: string | null; user: any } {
  const stored = localStorage.getItem(authSessionKey);
  const token = stored === null ? localStorage.getItem('token') : null;
  try {
    if (stored === null) return { token, user: JSON.parse(localStorage.getItem('user') ?? 'null') };
    const session = JSON.parse(stored);
    if (typeof session?.token === 'string') return session;
  } catch {
    // Malformed storage must not break the app shell or revive a legacy bearer.
  }
  return { token, user: null };
}

export function writeAuthSession(token: string | null, user: any) {
  if (token) {
    // Existing socket clients and handoff checks still read these keys.
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem(authSessionKey, JSON.stringify({ token, user }));
  } else {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem(authSessionKey);
  }
}

export function setRenderedAuthToken(token?: string | null) {
  renderedToken = token;
}

export function pinAuthSession() {
  return { authSessionToken: renderedToken === undefined ? readAuthSession().token : renderedToken };
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const { token } = readAuthSession();
  // A storage write in another tab can arrive before React receives its event.
  const pinned = config.authSessionToken;
  if ((renderedToken !== undefined && renderedToken !== token) ||
      (pinned !== undefined && pinned !== token)) throw new axios.CanceledError();
  const authorization = config.headers.get('Authorization');
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ') &&
      authorization !== 'Bearer ' + token) throw new axios.CanceledError();
  config.authSessionToken = token;
  if (token && !config.headers.has('Authorization')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.config.authSessionToken !== readAuthSession().token) throw new axios.CanceledError();
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      const { token } = readAuthSession();
      if (!token || error.config?.headers?.get('Authorization') !== 'Bearer ' + token) return Promise.reject(error);
      // Auth flows handle their own 401 responses. Other 401s invalidate
      // the stored human session. Device Auth preserves its validated return target.
      const redirect = unauthorizedRedirect(
        error.config?.url,
        window.location.pathname,
        window.location.search,
      );
      if (redirect) {
        writeAuthSession(null, null);
        window.dispatchEvent(new StorageEvent('storage', { key: authSessionKey, storageArea: localStorage }));
        window.location.href = redirect;
      }
    }
    return Promise.reject(error);
  }
);

export default api;
