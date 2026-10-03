import { PushSessionService } from './push-session.service';
import { SyncV3PushSessionService } from './sync-v3-push-session.service';
import { SyncV1Controller } from './sync-v1.controller';
import { SyncV2Controller } from './sync-v2.controller';

const principal = { userId: 'admin-1', platformRole: 'super_admin' } as any;
function db(role: string | null = null) {
  return {
    space: {
      findUnique: jest.fn().mockResolvedValue({ deletedAt: null }),
      findMany: jest.fn().mockResolvedValue([{ id: 'space-1', name: 'Space' }]),
    },
    spaceMember: {
      findUnique: jest.fn().mockResolvedValue(role ? { role } : null),
      findMany: jest.fn().mockResolvedValue(role ? [{ spaceId: 'space-1', role, space: { id: 'space-1', name: 'Space' } }] : []),
    },
  } as any;
}

describe('device sync platform-admin Space authority', () => {
  it.each(['assertPublishable', 'assertPublishableV2', 'assertPublishableInTx', 'assertPublishableV2InTx'])(
    'requires real membership in legacy %s', async (method) => {
      const prisma = db();
      const service = new (PushSessionService as any)(prisma, {}, {}, {});
      const check = () => method.endsWith('InTx')
        ? service[method](prisma, principal, 'space-1')
        : service[method](principal, 'space-1');
      await expect(check()).rejects.toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });
      prisma.spaceMember.findUnique.mockResolvedValue({ role: 'viewer' });
      await expect(check()).rejects.toMatchObject({ syncCode: 'SPACE_READ_ONLY' });
      prisma.spaceMember.findUnique.mockResolvedValue({ role: 'editor' });
      await expect(check()).resolves.toBeUndefined();
    },
  );

  it('requires real live membership in v3 publish checks', async () => {
    const prisma = db();
    const service = new (SyncV3PushSessionService as any)({}, {}, {}, {}, {}, {});
    await expect(service.assertPublishable(prisma, { id: 'admin-1', platformRole: 'super_admin' }, 'space-1'))
      .rejects.toMatchObject({ syncCode: 'SPACE_FORBIDDEN' });
  });

  it.each([1, 2])('exposes read-only v%s sync capabilities for a nonmember platform admin', async (version) => {
    const prisma = db();
    const revisions = { head: jest.fn().mockResolvedValue({ revision: '0', pageCount: 0n, folderCount: '0', revisionManifestByteLength: 0n, revisionBodyBytes: 0n }) } as any;
    const capabilities = { assertV1Compatible: jest.fn() } as any;
    const controller = version === 1
      ? new SyncV1Controller(prisma, revisions, {} as any, capabilities, {} as any)
      : new (SyncV2Controller as any)(prisma, revisions, {}, capabilities, {});
    const result = await controller.listSpaces({ user: principal });
    expect(result.spaces[0]).toMatchObject({ role: 'viewer', canRead: true, canPublish: false });
  });
});
