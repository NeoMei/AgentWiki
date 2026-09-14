/** Public diagnostics must never retain Git stderr, credentials or local paths. */
export class GitSourceError extends Error {
  readonly stage = 'fetching';
  constructor(readonly code: string, message: string, readonly repository: string) {
    super(message);
    this.name = 'GitSourceError';
  }
}

export function gitSourceError(error: unknown, phase: 'clone' | 'checkout', repository: string): GitSourceError {
  const details = error as { code?: unknown; killed?: unknown; stderr?: unknown } | null;
  let code = phase === 'clone' ? 'GIT_FETCH_FAILED' : 'GIT_CHECKOUT_FAILED';
  let message = phase === 'clone' ? 'Git repository could not be fetched' : 'Git repository contents could not be read';
  if (details?.code === 'ENOENT') {
    code = 'GIT_UNAVAILABLE';
    message = 'Git is not available on the source worker';
  } else if (details?.killed === true || details?.code === 'ETIMEDOUT') {
    code = 'GIT_TIMEOUT';
    message = 'Git repository fetch exceeded the time limit';
  } else if (typeof details?.stderr === 'string' && /authentication failed|repository[^\n]*not found|could not read username|access denied|requested URL returned error:\s*(?:401|403)\b/iu.test(details.stderr)) {
    code = 'GIT_ACCESS_FAILED';
    message = 'Git repository is unavailable or requires authentication';
  }
  let safeRepository = '[invalid-url]';
  try {
    const url = new URL(repository);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    safeRepository = url.toString();
  } catch { /* Only sanitized repository identifiers enter public diagnostics. */ }
  return new GitSourceError(code, message, safeRepository);
}
