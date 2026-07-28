import { describe, expect, it, vi } from 'vitest';

import type { LocalSyncConnection } from './config.js';
import { AgentWikiClient } from './agentwiki-client.js';

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
});
