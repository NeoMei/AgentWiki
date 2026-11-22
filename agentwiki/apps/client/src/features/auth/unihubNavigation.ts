import { safeReturnTo } from './safeReturnTo';

const targetOrigin = 'https://agentwiki.invalid';
const entry = '/unihub?entry=hub';

// Match the destinations the UniHub start endpoint accepts across the round trip.
export function safeUniHubReturnTo(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\u0000-\u0020\u007f]|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return null;
  const url = new URL(value, targetOrigin);
  if (url.origin !== targetOrigin) return null;
  if (/^\/(?:$|dashboard$|(?:spaces|pages|space)(?:\/[a-zA-Z0-9_-]+)*\/?$)/.test(url.pathname)) {
    return url.pathname + url.search + url.hash;
  }
  return safeReturnTo(value);
}

export function uniHubStartHref(returnTo: string | null): string {
  return '/api/auth/unihub/start?returnTo=' + encodeURIComponent(returnTo ?? '/');
}

export function uniHubEntryHref(returnTo: string | null): string {
  return returnTo ? entry + '&returnTo=' + encodeURIComponent(returnTo) : entry;
}

// The original login accepts this single UniHub intent as a local destination.
export function safeUniHubEntryHref(value: unknown): string | null {
  if (value === entry) return entry;
  if (typeof value !== 'string' || !value.startsWith(entry + '&returnTo=')) return null;
  return uniHubEntryHref(safeUniHubReturnTo(new URLSearchParams(value.slice(entry.length + 1)).get('returnTo')));
}

export function uniHubRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:'
      && (url.origin === window.location.origin || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return url.href;
  } catch {
    return null;
  }
  return null;
}
