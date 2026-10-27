/** Read-only 429 recovery. Mutations are sent once, even when their outcome is uncertain. */
const MINUTE = 60_000;
const MAX_RETRY_DELAY = 61_000;
export function retryAfterMilliseconds(value, now = Date.now()) {
  const fallback = MINUTE - (now % MINUTE) + 1_000;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const header = value.trim();
  const parsed = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - now;
  return Number.isFinite(parsed) ? Math.min(MAX_RETRY_DELAY, Math.max(0, parsed)) : fallback;
}
export function createFixtureRequester({ fetchImpl = fetch, waitImpl = delay => new Promise(resolve => setTimeout(resolve, delay)), now = Date.now, onRetry = () => {} } = {}) {
  let previousRequestAt = Number.NEGATIVE_INFINITY;
  async function wait(milliseconds, signal) {
    let remaining = milliseconds;
    while (remaining > 0) {
      signal?.throwIfAborted();
      const part = Math.min(MINUTE, remaining);
      await waitImpl(part, signal);
      signal?.throwIfAborted();
      remaining -= part;
    }
  }
  return async function request(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const { timeoutMs, ...fetchOptions } = options;
    const safeToRetry = method === 'GET' || method === 'HEAD';
    for (let attempt = 0; ; attempt++) {
      await wait(Math.max(0, 200 - (now() - previousRequestAt)), options.signal);
      options.signal?.throwIfAborted();
      previousRequestAt = now();
      const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
      const signal = timeout ? (options.signal ? AbortSignal.any([options.signal, timeout]) : timeout) : options.signal;
      const response = await fetchImpl(url, { ...fetchOptions, ...(signal ? { signal } : {}) });
      if (response.status !== 429 || !safeToRetry || attempt >= 2) return response;
      const delay = retryAfterMilliseconds(response.headers.get('retry-after'), now());
      // Consume the rejected response before waiting, releasing the connection.
      await response.arrayBuffer();
      onRetry({ method, attempt: attempt + 1, delayMs: delay });
      await wait(delay, options.signal);
    }
  };
}
