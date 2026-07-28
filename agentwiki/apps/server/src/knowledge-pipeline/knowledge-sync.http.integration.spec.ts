import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { HttpAdapterHost } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { AuthService } from '../core/auth/auth.service';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { BusinessException } from '../core/filters/business-error';
import { AuditService } from '../core/security/audit.service';
import { PrismaService } from '../database/prisma.service';
import { IngestQueue } from './ingest.queue';
import { KnowledgeSyncController } from './knowledge-sync.controller';
import { KnowledgeSyncService } from './knowledge-sync.service';

describe('KnowledgeSyncController HTTP authorization', () => {
  let app: INestApplication;
  let baseUrl: string;
  const queue = { enqueue: jest.fn() };
  const syncs = {
    createSync: jest.fn(async (_spaceId: string, _principal: unknown, _file: Buffer, idempotencyKey: string, confirmed: boolean) => {
      if (!confirmed) throw new BusinessException('SYNC_CONFIRMATION_REQUIRED');
      return { status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: idempotencyKey === 'stable-key' ? 'run-original' : 'run-1' };
    }),
    getState: jest.fn().mockResolvedValue({
      exists: true,
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      syncedAt: '2026-07-29T00:00:00.000Z',
      documents: [{
        path: 'docs/guide.md',
        contentHash: 'hash-1',
        content: 'sensitive document content',
        body: 'sensitive document body',
      }],
    }),
  };
  const principals: Record<string, any> = {
    agk_missing_sources: { userId: 'owner-1', agentId: 'agent-missing-sources', credentialId: 'credential-1', scopes: ['runs:write'] },
    agk_grant_no_runs: { userId: 'owner-1', agentId: 'agent-grant-no-runs', credentialId: 'credential-2', scopes: ['sources:write', 'runs:write'] },
    agk_viewer: { userId: 'owner-1', agentId: 'agent-viewer', credentialId: 'credential-3', scopes: ['sources:write', 'runs:write', 'sources:read'] },
    agk_editor: { userId: 'owner-1', agentId: 'agent-editor', credentialId: 'credential-4', scopes: ['sources:write', 'runs:write', 'sources:read'] },
  };
  const grants: Record<string, any> = {
    'agent-missing-sources': { role: 'editor', scopes: ['sources:write', 'runs:write'], agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } },
    'agent-grant-no-runs': { role: 'editor', scopes: ['sources:write'], agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } },
    'agent-viewer': { role: 'viewer', scopes: ['sources:write', 'runs:write', 'sources:read'], agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } },
    'agent-editor': { role: 'editor', scopes: ['sources:write', 'runs:write', 'sources:read'], agent: { status: 'active', revokedAt: null }, space: { deletedAt: null } },
  };
  const prisma = {
    space: { findUnique: jest.fn().mockResolvedValue({ id: 'space-1', deletedAt: null }) },
    agentGrant: { findUnique: jest.fn(({ where }: any) => grants[where.agentId_spaceId.agentId]) },
  } as any;
  const auth = {
    validateJwtUser: jest.fn(),
    validateApiKey: jest.fn(async (key: string) => principals[key] || null),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeSyncController],
      providers: [
        AuthorizationService,
        CombinedAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { verify: jest.fn(() => { throw new Error('not a JWT'); }) } },
        { provide: AuthService, useValue: auth },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: KnowledgeSyncService, useValue: syncs },
        { provide: IngestQueue, useValue: queue },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  async function upload(apiKey: string, headers: Record<string, string> = {}, contents: BlobPart = '{"okfVersion":"0.1"}') {
    const form = new FormData();
    form.set('file', new Blob([contents], { type: 'application/json' }), 'workspace.okf.json');
    return fetch(`${baseUrl}/spaces/space-1/knowledge-syncs`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, ...headers },
      body: form,
    });
  }

  it('returns AUTH_SCOPE_REQUIRED when the credential lacks sources:write', async () => {
    const response = await upload('agk_missing_sources', {
      'idempotency-key': 'missing-sources', 'x-agentwiki-user-confirmed': 'true',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_SCOPE_REQUIRED' });
  });

  it('returns SPACE_ACCESS_DENIED when the grant lacks runs:write', async () => {
    const response = await upload('agk_grant_no_runs', {
      'idempotency-key': 'missing-runs', 'x-agentwiki-user-confirmed': 'true',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'SPACE_ACCESS_DENIED' });
  });

  it('rejects a non-editor with 403', async () => {
    const response = await upload('agk_viewer', {
      'idempotency-key': 'viewer', 'x-agentwiki-user-confirmed': 'true',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'SPACE_ACCESS_DENIED' });
  });

  it('requires explicit confirmation before creating a sync', async () => {
    const response = await upload('agk_editor', { 'idempotency-key': 'unconfirmed' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'SYNC_CONFIRMATION_REQUIRED' });
  });

  it('returns 413 rather than 500 for a file over 10 MiB', async () => {
    const response = await upload('agk_editor', {
      'idempotency-key': 'too-large', 'x-agentwiki-user-confirmed': 'true',
    }, Buffer.alloc(10 * 1024 * 1024 + 1));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
  });

  it('queues a valid upload exactly once', async () => {
    const response = await upload('agk_editor', {
      'idempotency-key': 'valid-upload', 'x-agentwiki-user-confirmed': 'true',
    });

    expect(response.status).toBe(201);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(syncs.createSync).toHaveBeenCalledWith('space-1', principals.agk_editor, expect.any(Buffer), 'valid-upload', true);
  });

  it('does not enqueue a repeated idempotency key more than once', async () => {
    const headers = { 'idempotency-key': 'stable-key', 'x-agentwiki-user-confirmed': 'true' };
    syncs.createSync
      .mockResolvedValueOnce({ status: 'queued', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-original' })
      .mockResolvedValueOnce({ status: 'noop', sourceId: 'source-1', sourceVersionId: 'version-1', runId: 'run-original' });
    const first = await upload('agk_editor', headers);
    const second = await upload('agk_editor', headers);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({ runId: 'run-original' });
    await expect(second.json()).resolves.toMatchObject({ runId: 'run-original' });
    expect(syncs.createSync).toHaveBeenCalledTimes(2);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it('returns sync paths and hashes without document content', async () => {
    const response = await fetch(`${baseUrl}/spaces/space-1/knowledge-syncs/workspace-docs`, {
      headers: { 'x-api-key': 'agk_editor' },
    });
    const state = await response.json() as any;

    expect(response.status).toBe(200);
    expect(state).toMatchObject({ documents: [{ path: 'docs/guide.md', contentHash: 'hash-1' }] });
    expect(state.documents).toEqual([{ path: 'docs/guide.md', contentHash: 'hash-1' }]);
    expect(JSON.stringify(state)).not.toContain('sensitive document content');
    expect(JSON.stringify(state)).not.toContain('sensitive document body');
  });
});
