import type { AgentAccessRole } from '@neomei/agentwiki-sync-protocol';
import type { LocalSyncConnection } from './config.js';
import type { KnowledgeBundle } from './protocol/bundle.js';
import type { Delta } from './protocol/sync.js';

export interface ExchangeResult {
  apiKey: string;
  agentId: string;
  credentialId: string;
  spaceId: string;
  role: AgentAccessRole;
  serverUrl: string;
  pluginVersion: '0.5.0';
  scopes: string[];
}

export interface AccessResult {
  access: Array<{
    id: string;
    name: string;
    status: string;
    grants: Array<{ role: AgentAccessRole; space: { id: string; name: string } }>;
    credentials: Array<{ id: string; role: AgentAccessRole; scopes: string[]; active: boolean }>;
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

export interface RevisionHead {
  revisionId: string;
  sequence: number;
  contentHash: string;
}

export interface RevisionSnapshot extends RevisionHead {
  schemaVersion: string;
  recipeVersion: string;
  bundle: KnowledgeBundle;
}

export interface RevisionDelta {
  fromRevision: string;
  toRevision: string;
  revisions: Array<{
    revisionId: string;
    sequence: number;
    contentHash: string;
    delta: Delta;
  }>;
}

export interface KnowledgeSubmissionResult {
  status: 'pending_review' | 'published' | 'noop' | 'existing';
  submissionId: string;
  changeSetId: string | null;
  currentRevision: string;
}

export interface StaleBaseError {
  code: 'STALE_BASE_REVISION';
  currentRevision: string;
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
  return text
    .replace(/\b(?:agk|awk)_[A-Za-z0-9_-]+\b/g, '[REDACTED]')
    .replace(/\bAW-[A-Z0-9-]{4,64}\b/gi, '[REDACTED]');
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

function endpoint(serverUrl: string, path: string): string {
  const base = normalizeServerUrl(serverUrl);
  const baseWithApi = base.endsWith('/api') ? base : `${base}/api`;
  return path.startsWith('/api') ? `${baseWithApi}${path.slice(4)}` : `${baseWithApi}${path}`;
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

  async revokeCurrentCredential(connection: LocalSyncConnection, apiKey: string): Promise<void> {
    await this.send(endpoint(connection.serverUrl, '/integrations/local-sync/credentials/current'), {
      method: 'DELETE',
      headers: authorization(apiKey),
    });
  }

  async getSyncState(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    sourceKey: string,
  ): Promise<KnowledgeSyncState> {
    try {
      return await this.send<KnowledgeSyncState>(
        endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-syncs/${encodeURIComponent(sourceKey)}`),
        { method: 'GET', headers: authorization(apiKey) },
      );
    } catch (error) {
      if (error instanceof AgentWikiClientError && error.status === 404) {
        return { exists: false, sourceId: null, sourceVersionId: null, syncedAt: null, documents: [] };
      }
      throw error;
    }
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


  async getRevisionHead(connection: LocalSyncConnection, apiKey: string, spaceId: string): Promise<RevisionHead> {
    return this.send<RevisionHead>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-revisions/current`),
      { method: 'GET', headers: authorization(apiKey) },
    );
  }

  async getSnapshot(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    revisionId?: string,
  ): Promise<RevisionSnapshot> {
    const rev = revisionId ?? 'current';
    const path = `/spaces/${encodeURIComponent(spaceId)}/knowledge-revisions/${encodeURIComponent(rev)}/snapshot`;
    return this.send<RevisionSnapshot>(endpoint(connection.serverUrl, path), { method: 'GET', headers: authorization(apiKey) });
  }

  async getDelta(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    fromRevisionId: string,
  ): Promise<RevisionDelta> {
    return this.send<RevisionDelta>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-revisions/delta?from=${encodeURIComponent(fromRevisionId)}`),
      { method: 'GET', headers: authorization(apiKey) },
    );
  }

  async submitKnowledge(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    bundle: KnowledgeBundle,
    idempotencyKey: string,
    confirmationHash: string,
  ): Promise<KnowledgeSubmissionResult> {
    const body = Buffer.from(JSON.stringify(bundle)).toString('base64');
    return this.send<KnowledgeSubmissionResult>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-submissions`),
      {
        method: 'POST',
        headers: {
          ...authorization(apiKey),
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-AgentWiki-Confirmation-Hash': confirmationHash,
          'X-AgentWiki-User-Confirmed': 'true',
        },
        body: JSON.stringify({ body, idempotencyKey }),
      },
    );
  }

  async getSubmission(
    connection: LocalSyncConnection,
    apiKey: string,
    spaceId: string,
    submissionId: string,
  ): Promise<KnowledgeSubmissionResult> {
    return this.send<KnowledgeSubmissionResult>(
      endpoint(connection.serverUrl, `/spaces/${encodeURIComponent(spaceId)}/knowledge-submissions/${encodeURIComponent(submissionId)}`),
      { method: 'GET', headers: authorization(apiKey) },
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

    let body: unknown;
    try {
      body = await responseBody(response);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentWikiClientError(message, response.status, 'RESPONSE_BODY_ERROR');
    }
    if (!response.ok) {
      const { code, message } = errorDetails(body, response.status);
      throw new AgentWikiClientError(message, response.status, code);
    }

    return body as T;
  }
}
