import { createHash } from 'node:crypto';
import {
  CreateTreePushSessionResponseV2Schema,
  TreeCapabilitiesResponseV2Schema,
  TreeDeltaPageV2Schema,
  TreeFinalizePushResponseV2Schema,
  TreePushBatchReceiptV2Schema,
  TreeRevisionHeadResponseV2Schema,
  TreeSnapshotPageV2Schema,
  TREE_SYNC_V2_LIMITS,
  canonicalTreeRevisionManifestV2,
  canonicalBytes,
  contentHash as treePageContentHash,
  partitionTreePushChangesV2,
  treeConfirmationHashV2,
  treeRevisionContentHashV2,
  type AgentAccessRole,
  type TreeDeltaItemV2,
  type TreeCapabilitiesResponseV2,
  type TreePushChangeV2,
  type TreeRevisionContentManifestV2,
} from '@neomei/agentwiki-sync-protocol';
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
  pluginVersion: '0.7.0';
  scopes: string[];
}

export interface AccessResult {
  access: Array<{
    id: string;
    name: string;
    status: string;
    grants: Array<{ role: AgentAccessRole; space: { id: string; name: string } }>;
    credentials: Array<{
      id: string;
      authorization: {
        id: string;
        role: AgentAccessRole;
        scopes: string[];
        space: { id: string; name: string };
      };
      active: boolean;
    }>;
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

export interface TreeSnapshotV2 {
  revision: string;
  sequence: number;
  revisionContentHash: string;
  manifest: TreeRevisionContentManifestV2;
}

export interface TreeDeltaV2 {
  fromRevision: string;
  toRevision: string;
  toSequence: number;
  toRevisionContentHash: string;
  toFolderCount: string;
  toPageCount: string;
  toRevisionManifestByteLength: string;
  toRevisionBodyBytes: string;
  items: TreeDeltaItemV2[];
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

function negotiatedV2ResponseBytes(maxResponseBytes: number): number {
  return Math.min(maxResponseBytes, TREE_SYNC_V2_LIMITS.maxResponseBytes);
}

async function responseBody(response: Response, maximumBytes?: number): Promise<unknown> {
  if (maximumBytes !== undefined) {
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > maximumBytes) {
      await response.body?.cancel('declared response byte limit exceeded').catch(() => undefined);
      throw new AgentWikiClientError('Response exceeded the negotiated byte limit', response.status, 'RESPONSE_TOO_LARGE');
    }
  }
  let body = '';
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let receivedBytes = 0;
    let cancelled = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        receivedBytes += next.value.byteLength;
        if (maximumBytes !== undefined && receivedBytes > maximumBytes) {
          cancelled = true;
          await reader.cancel('response byte limit exceeded');
          throw new AgentWikiClientError('Response exceeded the negotiated byte limit', response.status, 'RESPONSE_TOO_LARGE');
        }
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
    } catch (error) {
      if (!cancelled) {
        await reader.cancel('response stream rejected').catch(() => undefined);
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else if (response.status !== 204) {
    body = await response.text();
    if (maximumBytes !== undefined && new TextEncoder().encode(body).byteLength > maximumBytes) {
      throw new AgentWikiClientError('Response exceeded the negotiated byte limit', response.status, 'RESPONSE_TOO_LARGE');
    }
  }
  if (!body) return undefined;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function capabilityBoundIdempotencyKey(
  spaceId: string,
  baseRevision: string,
  confirmationHash: string,
  capabilitiesHash: string,
): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify({ protocolVersion: '2', spaceId, baseRevision, confirmationHash, capabilitiesHash }))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function errorDetails(body: unknown, status: number): { code: string; message: string } {
  if (typeof body === 'object' && body !== null) {
    const error = body as Record<string, unknown>;
    const nested = error.error;
    if (typeof nested === 'object' && nested !== null) {
      const details = nested as Record<string, unknown>;
      return {
        code: typeof details.code === 'string' ? details.code : `HTTP_${status}`,
        message: typeof details.message === 'string' ? details.message : `Request failed with status ${status}`,
      };
    }
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

  async getTreeCapabilitiesV2(
    connection: LocalSyncConnection,
    syncDeviceCredential: string,
    maximumResponseBytes = TREE_SYNC_V2_LIMITS.capabilitiesDiscoveryBytes,
  ): Promise<TreeCapabilitiesResponseV2> {
    const body = await this.send<unknown>(endpoint(connection.serverUrl, '/sync/v2/capabilities'), {
      method: 'GET',
      headers: authorization(syncDeviceCredential),
    }, Math.min(maximumResponseBytes, TREE_SYNC_V2_LIMITS.capabilitiesDiscoveryBytes));
    return this.parseV2(TreeCapabilitiesResponseV2Schema, body);
  }

  async getTreeRevisionHeadV2(
    connection: LocalSyncConnection,
    syncDeviceCredential: string,
    spaceId: string,
  ): Promise<ReturnType<typeof TreeRevisionHeadResponseV2Schema.parse>> {
    const negotiated = await this.getTreeCapabilitiesV2(connection, syncDeviceCredential);
    return this.parseV2(TreeRevisionHeadResponseV2Schema, await this.send<unknown>(
      endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/head`),
      { method: 'GET', headers: authorization(syncDeviceCredential) },
      negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
    ));
  }

  async getTreeSnapshotV2(
    connection: LocalSyncConnection,
    syncDeviceCredential: string,
    spaceId: string,
    revision = 'current',
  ): Promise<TreeSnapshotV2> {
    const negotiated = await this.getTreeCapabilitiesV2(connection, syncDeviceCredential);
    const folders: TreeRevisionContentManifestV2['folders'] = [];
    const pages: TreeRevisionContentManifestV2['pages'] = [];
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let metadata: Omit<TreeSnapshotV2, 'manifest'> | null = null;
    let counts: { folderCount: string; pageCount: string; revisionManifestByteLength: string; revisionBodyBytes: string } | null = null;
    do {
      const query = new URLSearchParams({ revision, limit: String(negotiated.capabilities.maxPageItems) });
      if (cursor !== null) query.set('cursor', cursor);
      const page = this.parseV2(TreeSnapshotPageV2Schema, await this.send<unknown>(
        endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/snapshot?${query.toString()}`),
        { method: 'GET', headers: authorization(syncDeviceCredential) },
        negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
      ));
      const nextMetadata = { revision: page.revision, sequence: page.sequence, revisionContentHash: page.revisionContentHash };
      const nextCounts = {
        folderCount: page.folderCount, pageCount: page.pageCount,
        revisionManifestByteLength: page.revisionManifestByteLength, revisionBodyBytes: page.revisionBodyBytes,
      };
      if (page.spaceId !== spaceId || (metadata && JSON.stringify(metadata) !== JSON.stringify(nextMetadata))
        || (counts && JSON.stringify(counts) !== JSON.stringify(nextCounts))) {
        throw new AgentWikiClientError('Snapshot pagination metadata changed', 502, 'RESPONSE_INVALID');
      }
      metadata = nextMetadata;
      counts = nextCounts;
      folders.push(...page.folders);
      pages.push(...page.pages);
      if (folders.length > negotiated.capabilities.maxClientSpaceFolders
        || pages.length > negotiated.capabilities.maxClientSpacePages
        || folders.length + pages.length > negotiated.capabilities.maxSnapshotObjects) {
        throw new AgentWikiClientError('Snapshot exceeded the negotiated object limit', 502, 'RESPONSE_TOO_LARGE');
      }
      if (page.nextCursor !== null && cursors.has(page.nextCursor)) {
        throw new AgentWikiClientError('Snapshot cursor was replayed', 502, 'CURSOR_REPLAY');
      }
      if (page.nextCursor !== null) cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor !== null);
    if (!metadata || !counts) throw new AgentWikiClientError('Snapshot response was empty', 502, 'RESPONSE_INVALID');
    const folderIds = new Set(folders.map((folder) => folder.folderId));
    const pageIds = new Set(pages.map((page) => page.pageId));
    if (folderIds.size !== folders.length || pageIds.size !== pages.length) {
      throw new AgentWikiClientError('Snapshot repeated an object identity', 502, 'RESPONSE_INVALID');
    }
    let manifest: TreeRevisionContentManifestV2;
    try { manifest = canonicalTreeRevisionManifestV2({ protocolVersion: '2', spaceId, folders, pages }); }
    catch { throw new AgentWikiClientError('Snapshot tree was invalid', 502, 'RESPONSE_INVALID'); }
    const bodyBytes = manifest.pages.reduce((total, page) => total + new TextEncoder().encode(page.body).byteLength, 0);
    const manifestBytes = manifest.folders.length === 0 && manifest.pages.length === 0 ? 0 : canonicalBytes(manifest).byteLength;
    for (const page of manifest.pages) {
      if (await treePageContentHash(page.body) !== page.contentHash) {
        throw new AgentWikiClientError('Snapshot Page content hash was invalid', 502, 'RESPONSE_INVALID');
      }
    }
    if (counts.folderCount !== String(manifest.folders.length) || counts.pageCount !== String(manifest.pages.length)
      || counts.revisionBodyBytes !== String(bodyBytes) || counts.revisionManifestByteLength !== String(manifestBytes)
      || metadata.revisionContentHash !== await treeRevisionContentHashV2(manifest)
      || bodyBytes > negotiated.capabilities.maxClientTotalBodyBytes
      || manifestBytes > negotiated.capabilities.maxClientManifestBytes) {
      throw new AgentWikiClientError('Snapshot totals or revision hash were invalid', 502, 'RESPONSE_INVALID');
    }
    return { ...metadata, manifest };
  }

  async getTreeDeltaV2(
    connection: LocalSyncConnection,
    syncDeviceCredential: string,
    spaceId: string,
    fromRevision: string,
  ): Promise<TreeDeltaV2> {
    const negotiated = await this.getTreeCapabilitiesV2(connection, syncDeviceCredential);
    const items: TreeDeltaItemV2[] = [];
    const identities = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | null = null;
    let metadata: Omit<TreeDeltaV2, 'items'> | null = null;
    do {
      const query = new URLSearchParams({ from: fromRevision, limit: String(negotiated.capabilities.maxPageItems) });
      if (cursor !== null) query.set('cursor', cursor);
      const page = this.parseV2(TreeDeltaPageV2Schema, await this.send<unknown>(
        endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/delta?${query.toString()}`),
        { method: 'GET', headers: authorization(syncDeviceCredential) },
        negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
      ));
      const nextMetadata = {
        fromRevision: page.fromRevision, toRevision: page.toRevision, toSequence: page.toSequence,
        toRevisionContentHash: page.toRevisionContentHash, toFolderCount: page.toFolderCount,
        toPageCount: page.toPageCount, toRevisionManifestByteLength: page.toRevisionManifestByteLength,
        toRevisionBodyBytes: page.toRevisionBodyBytes,
      };
      if (page.spaceId !== spaceId || page.fromRevision !== fromRevision
        || (metadata && JSON.stringify(metadata) !== JSON.stringify(nextMetadata))) {
        throw new AgentWikiClientError('Delta pagination metadata changed', 502, 'RESPONSE_INVALID');
      }
      metadata = nextMetadata;
      for (const item of page.items) {
        let entityId: string;
        if (item.operation === 'upsert_folder') entityId = `folder:${item.folder.folderId}`;
        else if (item.operation === 'archive_folder') entityId = `folder:${item.folderId}`;
        else if (item.operation === 'upsert_page') entityId = `page:${item.page.pageId}`;
        else entityId = `page:${item.pageId}`;
        if (identities.has(entityId)) throw new AgentWikiClientError('Delta repeated an object identity', 502, 'RESPONSE_INVALID');
        identities.add(entityId);
        items.push(item);
      }
      if (items.length > negotiated.capabilities.maxDeltaItems) {
        throw new AgentWikiClientError('Delta exceeded the negotiated object limit', 502, 'RESPONSE_TOO_LARGE');
      }
      if (page.nextCursor !== null && cursors.has(page.nextCursor)) {
        throw new AgentWikiClientError('Delta cursor was replayed', 502, 'CURSOR_REPLAY');
      }
      if (page.nextCursor !== null) cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor !== null);
    if (!metadata) throw new AgentWikiClientError('Delta response was empty', 502, 'RESPONSE_INVALID');
    return { ...metadata, items };
  }

  async pushTreeChangesV2(
    connection: LocalSyncConnection,
    syncDeviceCredential: string,
    spaceId: string,
    baseRevision: string,
    changes: TreePushChangeV2[],
  ): Promise<ReturnType<typeof TreeFinalizePushResponseV2Schema.parse>> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const negotiated = await this.getTreeCapabilitiesV2(connection, syncDeviceCredential);
      try {
        const batches = await partitionTreePushChangesV2(changes, negotiated.capabilities);
        const manifest = {
          protocolVersion: '2' as const,
          spaceId,
          baseRevision,
          changes: changes.map((change) => change.operation === 'upsert_page'
            ? {
                operation: change.operation,
                page: {
                  pageId: change.page.pageId, folderId: change.page.folderId, path: change.page.path,
                  title: change.page.title, contentHash: change.page.contentHash, updatedAt: change.page.updatedAt,
                },
              }
            : change),
        };
        const confirmationHash = await treeConfirmationHashV2(manifest);
        const confirmationByteLength = canonicalBytes(manifest).byteLength;
        const totalBodyBytes = changes.reduce((total, change) => total + (
          change.operation === 'upsert_page'
            ? new TextEncoder().encode(change.page.body.replace(/\r\n?/g, '\n')).byteLength
            : 0
        ), 0);
        const createBody = {
          protocolVersion: '2' as const,
          baseRevision,
          idempotencyKey: capabilityBoundIdempotencyKey(
            spaceId,
            baseRevision,
            confirmationHash,
            negotiated.capabilitiesHash,
          ),
          capabilitiesHash: negotiated.capabilitiesHash,
          confirmationHash,
          confirmationByteLength,
          changeCount: changes.length,
          totalBodyBytes,
        };
        const session = this.parseV2(CreateTreePushSessionResponseV2Schema, await this.send<unknown>(
          endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/push-sessions`),
          {
            method: 'POST',
            headers: { ...authorization(syncDeviceCredential), 'Content-Type': 'application/json' },
            body: JSON.stringify(createBody),
          },
          negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
        ));
        if (session.result) return session.result;
        for (const batch of batches) {
          const receipt = this.parseV2(TreePushBatchReceiptV2Schema, await this.send<unknown>(
            endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/push-sessions/${encodeURIComponent(session.sessionId)}/batches/${batch.batchIndex}`),
            {
              method: 'PUT',
              headers: { ...authorization(syncDeviceCredential), 'Content-Type': 'application/json' },
              body: JSON.stringify(batch),
            },
            negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
          ));
          if (receipt.batchHash !== batch.batchHash) {
            throw new AgentWikiClientError('Push batch receipt did not match the uploaded batch', 502, 'RESPONSE_INVALID');
          }
        }
        return this.parseV2(TreeFinalizePushResponseV2Schema, await this.send<unknown>(
          endpoint(connection.serverUrl, `/sync/v2/spaces/${encodeURIComponent(spaceId)}/push-sessions/${encodeURIComponent(session.sessionId)}/finalize`),
          {
            method: 'POST',
            headers: { ...authorization(syncDeviceCredential), 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocolVersion: '2', confirmationHash, userConfirmed: true }),
          },
          negotiatedV2ResponseBytes(negotiated.capabilities.maxResponseBytes),
        ));
      } catch (error) {
        if (attempt === 0 && error instanceof AgentWikiClientError && error.code === 'CAPABILITIES_CHANGED') continue;
        throw error;
      }
    }
    throw new AgentWikiClientError('Server capabilities changed repeatedly', 409, 'CAPABILITIES_CHANGED');
  }

  private parseV2<T>(schema: { parse(value: unknown): T }, value: unknown): T {
    try {
      return schema.parse(value);
    } catch {
      throw new AgentWikiClientError('Server returned an invalid Sync Protocol v2 response', 502, 'RESPONSE_INVALID');
    }
  }

  private async send<T>(url: string, init: RequestInit, maximumResponseBytes?: number): Promise<T> {
    let response: Response;
    try {
      response = await this.request(url, init);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AgentWikiClientError(message, 0, 'NETWORK_ERROR');
    }

    let body: unknown;
    try {
      body = await responseBody(response, maximumResponseBytes);
    } catch (error: unknown) {
      if (error instanceof AgentWikiClientError) throw error;
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
