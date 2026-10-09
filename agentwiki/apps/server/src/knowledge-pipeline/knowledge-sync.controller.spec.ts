import { KnowledgeSyncController } from './knowledge-sync.controller';
import { AuthorizationService } from '../core/authorization/authorization.service';

describe('KnowledgeSyncController source read boundary', () => {
  it('rejects a pages-only personal credential before returning source identity or paths', async () => {
    const db = { apiKeyCredential: { findFirst: jest.fn().mockResolvedValue({ scopes: ['pages:read'] }) } } as any;
    const authorization = new AuthorizationService(db);
    const syncs = { getState: jest.fn() };
    const controller = new KnowledgeSyncController(syncs as any, authorization, {} as any);
    await expect(controller.state('s', 'key', { user: { userId: 'u', credentialId: 'pat' } } as any)).rejects.toMatchObject({ businessCode: 'AUTH_SCOPE_REQUIRED' });
    expect(syncs.getState).not.toHaveBeenCalled();
  });
});
