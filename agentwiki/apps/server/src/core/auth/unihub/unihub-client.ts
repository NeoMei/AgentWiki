import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class UniHubRuntimeError extends Error {
  constructor(readonly status: number) {
    super('UniHub identity request failed');
  }
}

export interface UniHubIdentity {
  binding: { local_user_id: string; user_id: string };
  auth_version: number;
  access: { active: boolean; permissions: string[] };
}

export interface NativeProof {
  local_user_id: string;
  authentication_id: string;
  method: 'password' | 'session';
  authenticated_at: number;
  auth_version: number;
}

export function agentWikiReturnTo(input: unknown): string {
  if (typeof input !== 'string' || input.length > 1024 || !input.startsWith('/') || input.startsWith('//') ||
      /[\\\u0000-\u0020\u007f]|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(input)) return '/';
  let value: URL;
  try {
    value = new URL(input, 'https://agentwiki.invalid');
  } catch {
    return '/';
  }
  if (value.origin !== 'https://agentwiki.invalid') return '/';
  if (value.pathname === '/onboard/device') {
    const codes = value.searchParams.getAll('user_code');
    if (value.hash || [...value.searchParams.keys()].some(key => key !== 'user_code') ||
        codes.length > 1 || (codes.length === 1 && !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(codes[0]))) return '/';
  } else if (value.pathname === '/guide/obsidian') {
    if (value.search || (value.hash && value.hash !== '#connect')) return '/';
  } else if (!/^\/(?:$|dashboard$|(?:spaces|pages|space)(?:\/[a-zA-Z0-9_-]+)*\/?$)/.test(value.pathname)) {
    return '/';
  }
  return value.pathname + value.search + value.hash;
}

function endpoint(value: string, path: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Invalid UniHub identity URL configuration');
  }
  if (parsed.pathname !== path || parsed.username || parsed.password || parsed.search || parsed.hash ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) {
    throw new Error('Invalid UniHub identity URL configuration');
  }
  return parsed;
}

export function hasUniHubLifecycleRuntime(apiOrigin?: string, token?: string): boolean {
  return Boolean(apiOrigin?.trim() && token?.trim());
}

@Injectable()
export class UniHubClient {
  readonly enabled: boolean;
  readonly lifecycleEnabled: boolean;
  readonly clientId: string;
  readonly sessionGeneration: string;
  readonly callbackURL: string;
  private readonly api: string;
  private readonly publicOrigin: string;
  private readonly token: string;
  private readonly pilotUsers: ReadonlySet<string>;

  constructor(config: ConfigService) {
    this.enabled = config.get('UNIHUB_IDENTITY_ENABLED') === 'true';
    this.clientId = config.get<string>('UNIHUB_IDENTITY_CLIENT_ID') ?? '';
    this.sessionGeneration = config.get<string>('UNIHUB_IDENTITY_SESSION_GENERATION') ?? '1';
    if (this.enabled && (this.sessionGeneration === 'disabled' || !/^[a-zA-Z0-9._-]{1,64}$/.test(this.sessionGeneration))) {
      throw new Error('Invalid UniHub identity session generation');
    }
    this.token = config.get<string>('UNIHUB_IDENTITY_RUNTIME_TOKEN') ?? '';
    const apiOrigin = config.get<string>('UNIHUB_IDENTITY_API_ORIGIN');
    this.lifecycleEnabled = this.enabled || hasUniHubLifecycleRuntime(apiOrigin, this.token);
    this.api = this.lifecycleEnabled ? endpoint(apiOrigin ?? '', '/').origin : '';
    if (this.lifecycleEnabled && (this.token.length < 32 || /\s/.test(this.token))) {
      throw new Error('Invalid UniHub identity service token configuration');
    }
    this.publicOrigin = '';
    this.callbackURL = '';
    const pilot = config.get<string>('UNIHUB_IDENTITY_PILOT_USER_IDS') ?? '';
    this.pilotUsers = new Set(pilot.split(',').map(value => value.trim()).filter(Boolean));
    if (!this.enabled) return;
    if ([...this.pilotUsers].some(value => value !== '*' && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) ||
        (this.pilotUsers.has('*') && this.pilotUsers.size !== 1)) {
      throw new Error('Invalid UniHub identity pilot user IDs');
    }
    this.publicOrigin = endpoint(config.get<string>('UNIHUB_IDENTITY_PUBLIC_ORIGIN') ?? '', '/').origin;
    this.callbackURL = endpoint(config.get<string>('UNIHUB_IDENTITY_CALLBACK_URL') ?? '', '/api/auth/unihub/callback').href;
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(this.clientId)) {
      throw new Error('Invalid UniHub identity client configuration');
    }
  }

  allowsLocalUser(userId: string): boolean {
    return this.enabled && (this.pilotUsers.has('*') || this.pilotUsers.has(userId));
  }

  get hasPilotUsers(): boolean {
    return this.pilotUsers.size > 0;
  }

  browserURL(path: string, query: Record<string, string> = {}): string {
    if (!this.enabled) throw new UniHubRuntimeError(404);
    const url = new URL(path, this.publicOrigin);
    if (url.origin !== this.publicOrigin) throw new UniHubRuntimeError(502);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.href;
  }

  checkBrowserURL(value: unknown, path: string): string {
    if (typeof value !== 'string') throw new UniHubRuntimeError(502);
    const url = new URL(value);
    if (url.origin !== this.publicOrigin || url.pathname !== path || url.username || url.password || url.hash) {
      throw new UniHubRuntimeError(502);
    }
    return url.href;
  }

  async request<T>(path: string, body: unknown, actor?: string): Promise<T> {
    const lifecyclePath = path === '/source-lifecycle' || path === '/source-lifecycle/status' || path === '/source-session/revoke';
    if (!this.enabled && !(this.lifecycleEnabled && lifecyclePath)) throw new UniHubRuntimeError(404);
    if (!/^\/(?:[a-z-]+\/)*[a-z-]+$/.test(path)) throw new UniHubRuntimeError(502);
    const headers: Record<string, string> = {
      authorization: 'Bearer ' + this.token,
      'content-type': 'application/json',
    };
    if (actor) headers['X-UniHub-Actor-Authorization'] = 'Bearer ' + actor;
    let response: Response;
    try {
      response = await fetch(this.api + '/internal/v1/product-runtime/identity' + path, {
        method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(3000),
      });
    } catch {
      throw new UniHubRuntimeError(503);
    }
    if (!response.ok) throw new UniHubRuntimeError(response.status);
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch {
      throw new UniHubRuntimeError(502);
    }
  }
}
