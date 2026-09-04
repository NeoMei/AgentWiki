export type SyncRequestProtocolVersion = '1' | '2' | '3';

export function syncProtocolFromRequestPath(request: {
  originalUrl?: unknown;
  url?: unknown;
}): SyncRequestProtocolVersion | null {
  const rawUrl = String(request.originalUrl ?? request.url ?? '');
  let pathname: string;
  try {
    pathname = new URL(rawUrl, 'http://agentwiki.invalid').pathname;
  } catch {
    return null;
  }
  const match = /(?:^|\/)sync\/v([123])(?:\/|$)/u.exec(pathname);
  return match?.[1] as SyncRequestProtocolVersion | undefined ?? null;
}
