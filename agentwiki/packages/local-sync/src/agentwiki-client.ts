import type { LocalSyncConnection } from './config.js';

export interface ExchangeResult {
  apiKey: string;
  agentId: string;
  credentialId: string;
  serverUrl: string;
  pluginVersion: string;
  scopes: string[];
}

export interface AccessResult {
  access: Array<{
    id: string;
    name: string;
    status: string;
    grants: Array<{ role: string; space: { id: string; name: string } }>;
    credentials: Array<{ id: string; scopes: string[]; active: boolean }>;
  }>;
}

export interface KnowledgeSyncState {
  exists: boolean;
  sourceId: string | null;
  sourceVersionId: string | null;
  syncedAt: string | null;
  documents: Array<{ path: string; contentHash: string }>;
}

export interface KnowledgeSyncResult {
  status: 'queued' | 'noop';
  sourceId: string;
  sourceVersionId: string;
  runId: string | null;
}

export class AgentWikiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    message: string,
    status: number,
    code: string,
  ) {
    super(redactSecrets(message));
    this.name = 'AgentWikiClientError';
    this.status = status;
    this.code = redactSecrets(code);
  }
}

export function redactSecrets(text: string): string {
  return text.replace(/\b(?:agk|awk)_[A-Za-z0-9_-]+\b/g, '[REDACTED]');
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

function endpoint(serverUrl: string, path: string): string {
  return `${normalizeServerUrl(serverUrl)}${path}`;
}

function authorization(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

async function responseBody(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) return undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function errorDetails(body: unknown, status: number): { code: string; message: string } {
  if (typeof body === 'object' && body !== null) {
    const error = body as Record<string, unknown>;
    const code = typeof error.code === 'string' ? error.code : `HTTP_${status}`;
    const message = typeof error.message === 'string' ? error.message : `Request failed with status ${status}`;
    return { code, message };
  }

  return {
    code: `HTTP_${status}`,
    message: typeof body === 'string' ? body : `Request failed with status ${status}`,
  };
}

export class AgentWikiClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async exchange(serverUrl: string, code: string): Promise<ExchangeResult> {
    return this.send<ExchangeResult>(endpoint(serverUrl, '/integrations/local-sync/exchange'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }

  async access(connection: LocalSyncConnection, apiKey: string): Promise<AccessResult> {
    return this.send<AccessResult>(endpoint(connection.serverUrl, '/integrations/mcp'), {
      method: 'GET',
      headers: authorization(apiKey),
    });
  }

  async getSyncState(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    sourceKey: string,
  ): Promise<KnowledgeSyncState> {
    return this.send<KnowledgeSyncState>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-syncs/${encodeURIComponent(sourceKey)}`),
      { method: 'GET', headers: authorization(apiKey) },
    );
  }

  async upload(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    bytes: Uint8Array,
    idempotencyKey: string,
  ): Promise<KnowledgeSyncResult> {
    const form = new FormData();
    const contents = new Uint8Array(bytes.byteLength);
    contents.set(bytes);
    form.append('file', new Blob([contents]), 'knowledge-bundle.okf.json');

    return this.send<KnowledgeSyncResult>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-syncs`),
      {
        method: 'POST',
        headers: {
          ...authorization(apiKey),
          'Idempotency-Key': idempotencyKey,
          'X-AgentWiki-User-Confirmed': 'true',
        },
        body: form,
      },
    );
  }

  private async send<T>(url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.request(url, init);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentWikiClientError(message, 0, 'NETWORK_ERROR');
    }

    const body = await responseBody(response);
    if (!response.ok) {
      const { code, message } = errorDetails(body, response.status);
      throw new AgentWikiClientError(message, response.status, code);
    }

    return body as T;
  }
}
