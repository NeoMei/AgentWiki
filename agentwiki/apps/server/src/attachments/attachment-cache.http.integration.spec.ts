import { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { get as httpGet } from 'node:http';
import { Readable } from 'node:stream';
import { AuthService } from '../core/auth/auth.service';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { AuthorizationService } from '../core/authorization/authorization.service';
import { AllExceptionsFilter } from '../core/filters/all-exceptions.filter';
import { AuditService } from '../core/security/audit.service';
import { AttachmentContentController } from './attachment.controller';
import { AttachmentService } from './attachment.service';

// Exercise the real HTTP route, authentication guard, authorization and content
// service. Only database/storage/account lookups use isolated in-memory fixtures.
describe('protected attachment HTTP revalidation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let memberActive = true;
  let attachmentExists = true;
  let version = 'a';
  const streams: Readable[] = [];
  const jwt = new JwtService({ secret: 'attachment-cache-isolated-test-secret' });
  const ownerToken = jwt.sign({ sub: 'owner', authVersion: 1 });
  const otherToken = jwt.sign({ sub: 'other', authVersion: 1 });
  const prisma = {
    space: { findUnique: async () => ({ id: 'space-1', deletedAt: null }) },
    spaceMember: { findUnique: async ({ where }: any) => memberActive && where.userId_spaceId.userId === 'owner'
      ? { role: 'viewer', space: { deletedAt: null } } : null },
    spaceAttachment: { findUnique: async () => attachmentExists ? {
      id: 'attachment-1', spaceId: 'space-1', contentHash: version.repeat(64),
      storageKey: 'private-storage', mimeType: 'image/png', displayName: 'image.png', sizeBytes: 7n,
    } : null },
  } as any;
  const authorization = new AuthorizationService(prisma);
  const storage = { open: async () => {
    const stream = Readable.from([Buffer.from(`image-${version}`)]);
    streams.push(stream);
    return stream;
  } } as any;
  const service = new AttachmentService(prisma, authorization, undefined as any, storage,
    undefined as any, undefined as any, undefined as any, undefined as any);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AttachmentContentController],
      providers: [CombinedAuthGuard,
        { provide: AttachmentService, useValue: service },
        { provide: JwtService, useValue: jwt },
        { provide: AuthService, useValue: {
          validateJwtUser: async (sub: string) => ['owner', 'other'].includes(sub)
            ? { userId: sub, type: 'human', authVersion: 1 } : null,
          validateApiKey: async () => null,
        } },
        { provide: AuditService, useValue: { record: async () => undefined } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use((_req: unknown, response: any, next: () => void) => { response.vary('Origin'); next(); });
    app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => { memberActive = true; attachmentExists = true; version = 'a'; streams.length = 0; });
  const get = (headers: Record<string, string> = {}, token: string | null = ownerToken) => new Promise<{
    status: number; headers: Headers; text: () => Promise<string>;
  }>((resolve, reject) => {
    // fetch adds force-refresh directives to manual conditional requests; use
    // an HTTP client that sends exactly the browser revalidation headers here.
    const request = httpGet(`${baseUrl}/attachments/attachment-1/content`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({
        status: response.statusCode!,
        headers: new Headers(Object.fromEntries(Object.entries(response.headers)
          .filter((entry) => entry[1] !== undefined)
          .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)]))),
        text: async () => Buffer.concat(chunks).toString(),
      }));
    });
    request.on('error', reject);
  });

  it('allows private storage but requires validation and isolates both credential transports', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-a');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('vary')?.toLowerCase().split(/,\s*/)).toEqual(
      expect.arrayContaining(['origin', 'authorization', 'x-api-key']),
    );
    expect(response.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`);
  });

  it.each([
    `"${'a'.repeat(64)}"`,
    `W/"${'a'.repeat(64)}"`,
    `"another-version", W/"${'a'.repeat(64)}"`,
    '*',
  ])('returns no image body for a current validator %s and closes the unused stream', async (validator) => {
    const response = await get({ 'If-None-Match': validator });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`);
    expect(streams).toHaveLength(1);
    expect(streams[0].destroyed).toBe(true);
  });

  it('downloads the new body when the content hash changes', async () => {
    version = 'b';
    const response = await get({ 'If-None-Match': `"${'a'.repeat(64)}"` });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-b');
    expect(response.headers.get('etag')).toBe(`"${'b'.repeat(64)}"`);
  });

  it('honors a forced refresh even when the validator matches', async () => {
    const response = await get({ 'If-None-Match': `"${'a'.repeat(64)}"`, 'Cache-Control': 'no-cache' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('image-a');
  });

  it.each(['revoked membership', 'deleted attachment', 'different account', 'signed out'])(
    'never returns 304 or cached image bytes after %s', async (scenario) => {
      const initial = await get();
      expect(initial.status).toBe(200);
      await initial.text();
      if (scenario === 'revoked membership') memberActive = false;
      if (scenario === 'deleted attachment') attachmentExists = false;
      const token = scenario === 'different account' ? otherToken : scenario === 'signed out' ? null : ownerToken;
      const response = await get({ 'If-None-Match': initial.headers.get('etag')! }, token);
      expect(response.status).toBe(scenario === 'signed out' ? 401 : 404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const body = await response.text();
      expect(body).not.toContain('image-a');
      expect(streams).toHaveLength(1);
    },
  );
});
