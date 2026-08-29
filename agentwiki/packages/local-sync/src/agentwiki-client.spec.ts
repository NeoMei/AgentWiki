import { describe, expect, it, vi } from 'vitest';

import type { LocalSyncConnection } from './config.js';
import { AgentWikiClient, redactSecrets } from './agentwiki-client.js';
import { canonicalBytes, contentHash, treeRevisionContentHashV2, type TreePushChangeV2, type TreeRevisionContentManifestV2 } from '@neomei/agentwiki-sync-protocol';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const connection: LocalSyncConnection = {
  id: 'local',
  serverUrl: 'https://wiki.test/api/',
  agentId: 'agent-1',
  credentialId: 'cred-1',
  pluginVersion: '0.1.0',
  client: 'codex',
  mcpName: 'agentwiki',
};

describe('AgentWikiClient', () => {
  const v2Capabilities = {
    maxPageBytes: 1_048_576, maxBatchBytes: 4_194_304, maxBatchItems: 100,
    maxChangeCount: 100, maxConfirmationBytes: 4_194_304, maxClientSpacePages: 5_000,
    maxClientSpaceFolders: 10_000, maxSnapshotObjects: 15_000,
    maxClientManifestBytes: 4_194_304, maxClientTotalBodyBytes: 2_097_152,
    maxResponseBytes: 4_194_304, maxPageItems: 100, pushSessionTtlSeconds: 900,
  };

  it('negotiates strict v2 capabilities using only the device credential', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64),
    }));

    const result = await new AgentWikiClient(request as typeof fetch)
      .getTreeCapabilitiesV2(connection, 'device-secret');

    expect(result.capabilities.maxChangeCount).toBe(100);
    expect(request).toHaveBeenCalledWith('https://wiki.test/api/sync/v2/capabilities', expect.objectContaining({
      headers: { Authorization: 'Bearer device-secret' },
    }));
    expect(JSON.stringify(request.mock.calls)).not.toContain('agk_secret');
  });

  it('rejects malformed or oversized v2 responses before using their data', async () => {
    const malformed = vi.fn().mockResolvedValue(jsonResponse({
      protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64), unexpected: true,
    }));
    await expect(new AgentWikiClient(malformed as typeof fetch).getTreeCapabilitiesV2(connection, 'device-secret'))
      .rejects.toMatchObject({ code: 'RESPONSE_INVALID' });

    const oversized = vi.fn().mockResolvedValue(jsonResponse({ payload: 'x'.repeat(1024) }));
    await expect(new AgentWikiClient(oversized as typeof fetch).getTreeCapabilitiesV2(connection, 'device-secret', 64))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });

  it('cancels a no-content-length response stream as soon as UTF-8 bytes exceed the hard discovery ceiling', async () => {
    const cancel = vi.fn();
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('汉'.repeat(12_000)));
      },
      pull(controller) {
        controller.enqueue(encoder.encode('汉'.repeat(12_000)));
      },
      cancel,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const request = vi.fn().mockResolvedValue(response);

    await expect(new AgentWikiClient(request as typeof fetch).getTreeCapabilitiesV2(connection, 'device-secret'))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a streamed response when strict UTF-8 decoding fails', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff]));
      },
      cancel,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    const request = vi.fn().mockResolvedValue(response);

    await expect(new AgentWikiClient(request as typeof fetch).getTreeCapabilitiesV2(connection, 'device-secret'))
      .rejects.toMatchObject({ code: 'RESPONSE_BODY_ERROR' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('re-fetches capabilities once and pushes one atomic v2 session', async () => {
    let capabilityReads = 0;
    let createAttempts = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      requests.push({ url, init });
      if (url.endsWith('/sync/v2/capabilities')) {
        capabilityReads += 1;
        return jsonResponse({
          protocolVersion: '2', capabilities: v2Capabilities,
          capabilitiesHash: (capabilityReads === 1 ? 'a' : 'b').repeat(64),
        });
      }
      if (url.endsWith('/push-sessions')) {
        createAttempts += 1;
        if (createAttempts === 1) return jsonResponse({ protocolVersion: '2', error: { code: 'CAPABILITIES_CHANGED', message: 'changed', retryable: true } }, 409);
        return jsonResponse({
          protocolVersion: '2', sessionId: '11111111-1111-4111-8111-111111111111',
          status: 'uploading', expiresAt: '2026-08-29T01:00:00.000Z', result: null,
        }, 201);
      }
      if (url.includes('/batches/0')) return jsonResponse({
        protocolVersion: '2', sessionId: '11111111-1111-4111-8111-111111111111',
        batchIndex: 0, batchHash: JSON.parse(String(init?.body)).batchHash,
        receipt: 'receipt', receivedBatchCount: 1,
      });
      if (url.endsWith('/finalize')) return jsonResponse({
        protocolVersion: '2', status: 'published', revision: 'rev-2', sequence: 2,
        publishedAt: '2026-08-29T00:00:00.000Z', revisionContentHash: 'c'.repeat(64),
        folderCount: '1', pageCount: '0', revisionManifestByteLength: '1', revisionBodyBytes: '0', changeSetId: null,
      });
      return jsonResponse({});
    });
    const changes: TreePushChangeV2[] = [{
      operation: 'upsert_folder',
      folder: {
        folderId: 'folder-1', parentFolderId: null, name: 'Project', path: 'pages/Project',
        sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z',
      },
    }];

    const result = await new AgentWikiClient(request as typeof fetch).pushTreeChangesV2(
      connection, 'device-secret', 'space-1', 'rev-1', changes,
    );

    expect(result.revision).toBe('rev-2');
    expect(capabilityReads).toBe(2);
    expect(createAttempts).toBe(2);
    expect(requests.filter(({ url }) => url.includes('/batches/'))).toHaveLength(1);
    expect(requests.filter(({ url }) => url.endsWith('/finalize'))).toHaveLength(1);
    expect(requests.every(({ init }) => (init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer device-secret')).toBe(true);
  });

  it('derives a stable idempotency UUID from the confirmation and capabilities binding', async () => {
    const idempotencyKeys: string[] = [];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/sync/v2/capabilities')) {
        return jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64) });
      }
      if (url.endsWith('/push-sessions')) {
        idempotencyKeys.push((JSON.parse(String(init?.body)) as { idempotencyKey: string }).idempotencyKey);
        return jsonResponse({
          protocolVersion: '2', sessionId: '11111111-1111-4111-8111-111111111111',
          status: 'uploading', expiresAt: '2026-08-29T01:00:00.000Z', result: null,
        }, 201);
      }
      if (url.includes('/batches/0')) return jsonResponse({
        protocolVersion: '2', sessionId: '11111111-1111-4111-8111-111111111111',
        batchIndex: 0, batchHash: JSON.parse(String(init?.body)).batchHash,
        receipt: 'receipt', receivedBatchCount: 1,
      });
      return jsonResponse({
        protocolVersion: '2', status: 'published', revision: 'rev-2', sequence: 2,
        publishedAt: '2026-08-29T00:00:00.000Z', revisionContentHash: 'c'.repeat(64),
        folderCount: '1', pageCount: '0', revisionManifestByteLength: '1', revisionBodyBytes: '0', changeSetId: null,
      });
    });
    const changes: TreePushChangeV2[] = [{
      operation: 'upsert_folder',
      folder: { folderId: 'folder-1', parentFolderId: null, name: 'Project', path: 'pages/Project', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' },
    }];
    const client = new AgentWikiClient(request as typeof fetch);

    await client.pushTreeChangesV2(connection, 'device-secret', 'space-1', 'rev-1', changes);
    await client.pushTreeChangesV2(connection, 'device-secret', 'space-1', 'rev-1', structuredClone(changes));

    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  it.each(['upload', 'finalize'] as const)(
    'rebuilds the complete push exactly once when capabilities drift during %s',
    async (driftPhase) => {
      let capabilityReads = 0;
      let createAttempts = 0;
      let uploadAttempts = 0;
      let finalizeAttempts = 0;
      const createBodies: Array<{ idempotencyKey: string; capabilitiesHash: string }> = [];
      const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url.endsWith('/sync/v2/capabilities')) {
          capabilityReads += 1;
          return jsonResponse({
            protocolVersion: '2', capabilities: v2Capabilities,
            capabilitiesHash: (capabilityReads === 1 ? 'a' : 'b').repeat(64),
          });
        }
        if (url.endsWith('/push-sessions')) {
          createAttempts += 1;
          createBodies.push(JSON.parse(String(init?.body)) as { idempotencyKey: string; capabilitiesHash: string });
          return jsonResponse({
            protocolVersion: '2',
            sessionId: createAttempts === 1
              ? '11111111-1111-4111-8111-111111111111'
              : '22222222-2222-4222-8222-222222222222',
            status: 'uploading', expiresAt: '2026-08-29T01:00:00.000Z', result: null,
          }, 201);
        }
        if (url.includes('/batches/0')) {
          uploadAttempts += 1;
          if (driftPhase === 'upload' && createAttempts === 1) {
            return jsonResponse({ protocolVersion: '2', error: { code: 'CAPABILITIES_CHANGED', message: 'changed', retryable: true } }, 409);
          }
          return jsonResponse({
            protocolVersion: '2',
            sessionId: createAttempts === 1
              ? '11111111-1111-4111-8111-111111111111'
              : '22222222-2222-4222-8222-222222222222',
            batchIndex: 0, batchHash: JSON.parse(String(init?.body)).batchHash,
            receipt: 'receipt', receivedBatchCount: 1,
          });
        }
        finalizeAttempts += 1;
        if (driftPhase === 'finalize' && createAttempts === 1) {
          return jsonResponse({ protocolVersion: '2', error: { code: 'CAPABILITIES_CHANGED', message: 'changed', retryable: true } }, 409);
        }
        return jsonResponse({
          protocolVersion: '2', status: 'published', revision: 'rev-2', sequence: 2,
          publishedAt: '2026-08-29T00:00:00.000Z', revisionContentHash: 'c'.repeat(64),
          folderCount: '1', pageCount: '0', revisionManifestByteLength: '1', revisionBodyBytes: '0', changeSetId: null,
        });
      });
      const changes: TreePushChangeV2[] = [{
        operation: 'upsert_folder',
        folder: { folderId: 'folder-1', parentFolderId: null, name: 'Project', path: 'pages/Project', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' },
      }];

      await expect(new AgentWikiClient(request as typeof fetch).pushTreeChangesV2(
        connection, 'device-secret', 'space-1', 'rev-1', changes,
      )).resolves.toMatchObject({ revision: 'rev-2' });

      expect({ capabilityReads, createAttempts, uploadAttempts, finalizeAttempts }).toEqual({
        capabilityReads: 2,
        createAttempts: 2,
        uploadAttempts: 2,
        finalizeAttempts: driftPhase === 'finalize' ? 2 : 1,
      });
      expect(createBodies.map((body) => body.capabilitiesHash)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
      expect(createBodies[1]!.idempotencyKey).not.toBe(createBodies[0]!.idempotencyKey);
    },
  );

  it('fails after a second capability drift without entering an unbounded rebuild loop', async () => {
    let capabilityReads = 0;
    let createAttempts = 0;
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/sync/v2/capabilities')) {
        capabilityReads += 1;
        return jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: `${capabilityReads}`.repeat(64) });
      }
      createAttempts += 1;
      return jsonResponse({ protocolVersion: '2', error: { code: 'CAPABILITIES_CHANGED', message: 'changed again', retryable: true } }, 409);
    });

    await expect(new AgentWikiClient(request as typeof fetch).pushTreeChangesV2(
      connection, 'device-secret', 'space-1', 'rev-1', [],
    )).rejects.toMatchObject({ code: 'CAPABILITIES_CHANGED' });
    expect({ capabilityReads, createAttempts }).toEqual({ capabilityReads: 2, createAttempts: 2 });
  });

  it('strictly assembles a paginated v2 snapshot and sends only the device credential', async () => {
    const folder = { folderId: 'f1', parentFolderId: null, name: 'Dir', path: 'pages/Dir', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' };
    const page = { pageId: 'p1', folderId: 'f1', path: 'pages/Dir/Page.md', title: 'Page', body: 'body', contentHash: await contentHash('body'), updatedAt: '2026-08-29T00:00:00.000Z' };
    const manifest: TreeRevisionContentManifestV2 = { protocolVersion: '2', spaceId: 'space-1', folders: [folder], pages: [page] };
    let snapshotPage = 0;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer device-secret');
      if (url.endsWith('/capabilities')) return jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64) });
      snapshotPage += 1;
      const common = {
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
        revisionContentHash: await treeRevisionContentHashV2(manifest), folderCount: '1', pageCount: '1',
        revisionManifestByteLength: String(canonicalBytes(manifest).byteLength), revisionBodyBytes: '4',
      };
      return snapshotPage === 1
        ? jsonResponse({ ...common, folders: [folder], pages: [], nextCursor: 'cursor-1' })
        : jsonResponse({ ...common, folders: [], pages: [page], nextCursor: null });
    });

    const snapshot = await new AgentWikiClient(request as typeof fetch)
      .getTreeSnapshotV2(connection, 'device-secret', 'space-1', 'rev-1');

    expect(snapshot.manifest.folders.map((folder) => folder.folderId)).toEqual(['f1']);
    expect(snapshot.manifest.pages.map((page) => page.pageId)).toEqual(['p1']);
    expect(request.mock.calls[2]?.[0].toString()).toContain('cursor=cursor-1');
  });

  it('accepts a Folder-rich snapshot within separate Folder/Page/total negotiated limits', async () => {
    const capabilities = { ...v2Capabilities, maxClientSpacePages: 1, maxClientSpaceFolders: 2, maxSnapshotObjects: 3 };
    const folders = [
      { folderId: 'f1', parentFolderId: null, name: 'One', path: 'pages/One', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' },
      { folderId: 'f2', parentFolderId: null, name: 'Two', path: 'pages/Two', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' },
    ];
    const manifest: TreeRevisionContentManifestV2 = { protocolVersion: '2', spaceId: 'space-1', folders, pages: [] };
    const request = vi.fn(async (input: RequestInfo | URL) => input.toString().endsWith('/capabilities')
      ? jsonResponse({ protocolVersion: '2', capabilities, capabilitiesHash: 'a'.repeat(64) })
      : jsonResponse({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
        revisionContentHash: await treeRevisionContentHashV2(manifest), folderCount: '2', pageCount: '0',
        revisionManifestByteLength: String(canonicalBytes(manifest).byteLength), revisionBodyBytes: '0',
        folders, pages: [], nextCursor: null,
      }));

    await expect(new AgentWikiClient(request as typeof fetch).getTreeSnapshotV2(connection, 'device-secret', 'space-1'))
      .resolves.toMatchObject({ manifest: { folders: expect.arrayContaining([expect.objectContaining({ folderId: 'f2' })]) } });
  });

  it('enforces Folder, Page, and aggregate snapshot counts as three distinct negotiated ceilings', async () => {
    const folderOne = { folderId: 'f1', parentFolderId: null, name: 'One', path: 'pages/One', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' };
    const folderTwo = { folderId: 'f2', parentFolderId: null, name: 'Two', path: 'pages/Two', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' };
    const pageOne = { pageId: 'p1', folderId: null, path: 'pages/One.md', title: 'One', body: 'one', contentHash: await contentHash('one'), updatedAt: '2026-08-29T00:00:00.000Z' };
    const pageTwo = { pageId: 'p2', folderId: null, path: 'pages/Two.md', title: 'Two', body: 'two', contentHash: await contentHash('two'), updatedAt: '2026-08-29T00:00:00.000Z' };
    const cases = [
      { capabilities: { ...v2Capabilities, maxClientSpaceFolders: 1 }, folders: [folderOne, folderTwo], pages: [] },
      { capabilities: { ...v2Capabilities, maxClientSpacePages: 1 }, folders: [], pages: [pageOne, pageTwo] },
      { capabilities: { ...v2Capabilities, maxSnapshotObjects: 1 }, folders: [folderOne], pages: [pageOne] },
    ];

    for (const testCase of cases) {
      const request = vi.fn(async (input: RequestInfo | URL) => input.toString().endsWith('/capabilities')
        ? jsonResponse({ protocolVersion: '2', capabilities: testCase.capabilities, capabilitiesHash: 'a'.repeat(64) })
        : jsonResponse({
          protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
          revisionContentHash: 'b'.repeat(64), folderCount: String(testCase.folders.length), pageCount: String(testCase.pages.length),
          revisionManifestByteLength: '1', revisionBodyBytes: '0',
          folders: testCase.folders, pages: testCase.pages, nextCursor: null,
        }));
      await expect(new AgentWikiClient(request as typeof fetch).getTreeSnapshotV2(connection, 'device-secret', 'space-1'))
        .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    }
  });

  it('rejects cursor replay and duplicate identities in v2 reads', async () => {
    const folder = { folderId: 'f1', parentFolderId: null, name: 'Dir', path: 'pages/Dir', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' };
    let read = 0;
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/capabilities')) return jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64) });
      read += 1;
      return jsonResponse({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
        revisionContentHash: 'b'.repeat(64), folderCount: '2', pageCount: '0',
        revisionManifestByteLength: '1', revisionBodyBytes: '0', folders: [folder], pages: [],
        nextCursor: read === 1 ? 'replayed' : 'replayed',
      });
    });
    await expect(new AgentWikiClient(request as typeof fetch).getTreeSnapshotV2(connection, 'device-secret', 'space-1'))
      .rejects.toMatchObject({ code: 'CURSOR_REPLAY' });

    const duplicate = vi.fn(async (input: RequestInfo | URL) => input.toString().endsWith('/capabilities')
      ? jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64) })
      : jsonResponse({
        protocolVersion: '2', spaceId: 'space-1', revision: 'rev-1', sequence: 1,
        revisionContentHash: 'b'.repeat(64), folderCount: '2', pageCount: '0',
        revisionManifestByteLength: '1', revisionBodyBytes: '0', folders: [folder, folder], pages: [], nextCursor: null,
      }));
    await expect(new AgentWikiClient(duplicate as typeof fetch).getTreeSnapshotV2(connection, 'device-secret', 'space-1'))
      .rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
  });

  it('strictly assembles a paginated v2 delta without replaying entity mutations', async () => {
    let page = 0;
    const request = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString().endsWith('/capabilities')) return jsonResponse({ protocolVersion: '2', capabilities: v2Capabilities, capabilitiesHash: 'a'.repeat(64) });
      page += 1;
      const common = {
        protocolVersion: '2', spaceId: 'space-1', fromRevision: 'rev-1', toRevision: 'rev-2', toSequence: 2,
        toRevisionContentHash: 'b'.repeat(64), toFolderCount: '1', toPageCount: '0',
        toRevisionManifestByteLength: '1', toRevisionBodyBytes: '0',
      };
      return jsonResponse({ ...common, items: [{ operation: 'upsert_folder', folder: { folderId: 'f1', parentFolderId: null, name: 'Dir', path: 'pages/Dir', sortOrder: 0, updatedAt: '2026-08-29T00:00:00.000Z' } }], nextCursor: page === 1 ? 'next' : null });
    });

    await expect(new AgentWikiClient(request as typeof fetch).getTreeDeltaV2(connection, 'device-secret', 'space-1', 'rev-1'))
      .rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
  });

  it('rejects a delta whose aggregate change count exceeds maxChangeCount', async () => {
    const capabilities = { ...v2Capabilities, maxChangeCount: 1 };
    const request = vi.fn(async (input: RequestInfo | URL) => input.toString().endsWith('/capabilities')
      ? jsonResponse({ protocolVersion: '2', capabilities, capabilitiesHash: 'a'.repeat(64) })
      : jsonResponse({
        protocolVersion: '2', spaceId: 'space-1', fromRevision: 'rev-1', toRevision: 'rev-2', toSequence: 2,
        toRevisionContentHash: 'b'.repeat(64), toFolderCount: '0', toPageCount: '0',
        toRevisionManifestByteLength: '0', toRevisionBodyBytes: '0',
        items: [
          { operation: 'archive_page', pageId: 'p1', previousPath: 'pages/One.md' },
          { operation: 'archive_page', pageId: 'p2', previousPath: 'pages/Two.md' },
        ], nextCursor: null,
      }));

    await expect(new AgentWikiClient(request as typeof fetch).getTreeDeltaV2(connection, 'device-secret', 'space-1', 'rev-1'))
      .rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
  });
  it('redacts API keys and one-time installation codes', () => {
    expect(redactSecrets('agk_secret AW-ABCDEFGHIJKLMNOPQRSTUVWX AW-ABCD-EFGH awk_other')).toBe(
      '[REDACTED] [REDACTED] [REDACTED] [REDACTED]',
    );
  });

  it('exchanges the short-lived code without logging the returned key', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      apiKey: 'agk_secret', agentId: 'agent-1', credentialId: 'cred-1',
      serverUrl: 'https://wiki.test/api', pluginVersion: '0.1.0', scopes: ['sources:read'],
    }));
    const client = new AgentWikiClient(request as typeof fetch);

    await expect(client.exchange('https://wiki.test/api/', 'AW-CODE'))
      .resolves.toMatchObject({ apiKey: 'agk_secret' });
    expect(request).toHaveBeenCalledWith('https://wiki.test/api/integrations/local-sync/exchange', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ code: 'AW-CODE' }),
    }));
  });

  it('uses the stored key only in the Authorization header', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      exists: false, sourceId: null, sourceVersionId: null, syncedAt: null, documents: [],
    }));

    await new AgentWikiClient(request as typeof fetch).getSyncState(connection, 'agk_secret', 'space 1', 'source/1');

    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://wiki.test/api/spaces/space%201/knowledge-syncs/source%2F1');
    expect(url).not.toContain('agk_secret');
    expect(JSON.stringify(init.body ?? '')).not.toContain('agk_secret');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer agk_secret');
  });

  it('gets integration access with the key in only the Authorization header', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({ access: [] }));

    await expect(new AgentWikiClient(request as typeof fetch).access(connection, 'agk_secret'))
      .resolves.toEqual({ access: [] });

    expect(request).toHaveBeenCalledWith('https://wiki.test/api/integrations/mcp', expect.objectContaining({
      method: 'GET',
      headers: { Authorization: 'Bearer agk_secret' },
    }));
  });

  it('uploads multipart with confirmation and idempotency headers', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-1',
    }));
    const client = new AgentWikiClient(request as typeof fetch);

    await client.upload(connection, 'agk_secret', 'space-1', new Uint8Array([1, 2, 3]), 'preview-1');

    expect(request).toHaveBeenCalledWith('https://wiki.test/api/spaces/space-1/knowledge-syncs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer agk_secret',
        'Idempotency-Key': 'preview-1',
        'X-AgentWiki-User-Confirmed': 'true',
      }),
      body: expect.any(FormData),
    }));
    const [, init] = request.mock.calls[0] as [string, RequestInit];
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob);
  });

  it('reports business errors with code and status while redacting API keys', async () => {
    const request = vi.fn().mockResolvedValue(jsonResponse({
      code: 'FORBIDDEN',
      message: 'Credential agk_server_secret cannot access this space',
    }, 403));

    await expect(new AgentWikiClient(request as typeof fetch).access(connection, 'agk_client_secret'))
      .rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
        message: expect.not.stringContaining('agk_'),
      });
  });

  it('redacts API keys when reading a response body throws', async () => {
    const response = {
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new Error('response stream failed for agk_response_secret')),
    } as unknown as Response;
    const request = vi.fn().mockResolvedValue(response);

    await expect(new AgentWikiClient(request as typeof fetch).access(connection, 'agk_client_secret'))
      .rejects.toMatchObject({
        code: 'RESPONSE_BODY_ERROR',
        status: 200,
        message: expect.not.stringContaining('agk_'),
      });
  });
});
