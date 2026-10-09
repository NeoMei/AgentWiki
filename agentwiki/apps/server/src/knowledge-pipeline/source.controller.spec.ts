import { AuthorizationService } from '../core/authorization/authorization.service';
import { ForbiddenException } from '@nestjs/common';
import { SourceController } from './source.controller';

describe('SourceController source result boundary', () => {
  const sources = { get: jest.fn(), createRun: jest.fn(), getRun: jest.fn() };
  const authorization = { assertPersonalSourceRead: jest.fn(), assertSourceAccess: jest.fn(), assertIngestRunAccess: jest.fn() };
  const queue = { enqueue: jest.fn() };
  const controller = new SourceController(sources as any, queue as any, authorization as any);
  const req = { user: { userId: 'viewer-1' } } as any;
  beforeEach(() => { jest.resetAllMocks(); });
  it('authorizes the selected source before reading any of its own run results', async () => {
    authorization.assertSourceAccess.mockRejectedValue(new ForbiddenException());
    await expect(controller.get('private-source', req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sources.get).not.toHaveBeenCalled();
    authorization.assertSourceAccess.mockResolvedValue(undefined);
    const ownResults = { id: 'source-1', runs: [{ id: 'own-run', sourceId: 'source-1' }] };
    sources.get.mockResolvedValue(ownResults);
    await expect(controller.get('source-1', req)).resolves.toBe(ownResults);
    expect(authorization.assertSourceAccess).toHaveBeenLastCalledWith(req.user, 'source-1');
    expect(sources.getRun).not.toHaveBeenCalled();
  });
  it('does not create or enqueue a run when source write authorization fails', async () => {
    authorization.assertSourceAccess.mockRejectedValue(new ForbiddenException());
    await expect(controller.createRun('source-1', req)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sources.createRun).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});

describe('SourceController personal source scopes', () => {
  it.each([{ scopes: ['pages:read'] }, { scopes: [] }])('rejects restricted personal scopes %j before list/detail read', async ({ scopes }) => {
    const prisma = { apiKeyCredential: { findFirst: jest.fn().mockResolvedValue({ scopes }) } } as any;
    const authorization = new AuthorizationService(prisma);
    const sources = { list: jest.fn(), get: jest.fn(), listRuns: jest.fn(), getRun: jest.fn() };
    const controller = new SourceController(sources as any, {} as any, authorization);
    const req = { user: { userId: 'u', credentialId: 'pat' } } as any;
    await expect(controller.list('s', req)).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    await expect(controller.get('src', req)).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    await expect(controller.listRuns('s', req)).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    await expect(controller.getRun('r', req)).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    expect(sources.list).not.toHaveBeenCalled(); expect(sources.get).not.toHaveBeenCalled();
    expect(sources.listRuns).not.toHaveBeenCalled(); expect(sources.getRun).not.toHaveBeenCalled();
  });
  it.each([{ scopes: undefined }, { scopes: ['*'] }, { scopes: ['sources:read'] }])('preserves JWT or permitted PAT %j', async ({ scopes }) => {
    const prisma = { apiKeyCredential: { findFirst: jest.fn().mockResolvedValue({ scopes }) } } as any;
    const authorization = new AuthorizationService(prisma);
    jest.spyOn(authorization, 'assertSpaceAccess').mockResolvedValue({} as any);
    jest.spyOn(authorization, 'assertSourceAccess').mockResolvedValue({} as any);
    jest.spyOn(authorization, 'assertIngestRunAccess').mockResolvedValue({} as any);
    const sources = { list: jest.fn().mockResolvedValue([]), get: jest.fn().mockResolvedValue({ id: 'src' }), listRuns: jest.fn().mockResolvedValue([]), getRun: jest.fn().mockResolvedValue({ id: 'r' }) };
    const controller = new SourceController(sources as any, {} as any, authorization);
    const req = { user: { userId: 'u', ...(scopes ? { credentialId: 'pat' } : {}) } } as any;
    await expect(controller.list('s', req)).resolves.toEqual([]);
    await expect(controller.get('src', req)).resolves.toEqual({ id: 'src' });
    await expect(controller.listRuns('s', req)).resolves.toEqual([]);
    await expect(controller.getRun('r', req)).resolves.toEqual({ id: 'r' });
    if (!scopes) expect(prisma.apiKeyCredential.findFirst).not.toHaveBeenCalled();
  });
});
