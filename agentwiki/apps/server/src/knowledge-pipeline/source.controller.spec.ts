import { ForbiddenException } from '@nestjs/common';
import { SourceController } from './source.controller';

describe('SourceController source result boundary', () => {
  const sources = { get: jest.fn(), createRun: jest.fn(), getRun: jest.fn() };
  const authorization = { assertSourceAccess: jest.fn(), assertIngestRunAccess: jest.fn() };
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
