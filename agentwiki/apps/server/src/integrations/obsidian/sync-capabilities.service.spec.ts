import { TreeSyncCapabilitiesV3Schema } from '@neomei/agentwiki-sync-protocol';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { SyncCapabilitiesService } from './sync-capabilities.service';

describe('SyncCapabilitiesService v3 compatibility gates', () => {
  it('fails Nest construction when the mandatory v3 compatibility verifier provider is missing', async () => {
    await expect(Test.createTestingModule({
      providers: [
        SyncCapabilitiesService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile()).rejects.toThrow(/SyncV3RevisionWriterService|dependencies/u);
  });

  it('returns capabilities accepted by the public strict v3 schema', async () => {
    const service = new SyncCapabilitiesService(
      { $transaction: jest.fn(async (callback: any) => callback({})) } as any,
      { inspectCurrentLocked: jest.fn().mockResolvedValue({ mode: 'legacy_v2' }) } as any,
    );

    expect(TreeSyncCapabilitiesV3Schema.parse(service.capabilitiesV3()))
      .toEqual(service.capabilitiesV3());
    await expect(service.hashV3()).resolves.toMatch(/^[a-f0-9]{64}$/u);
  });

  it('blocks every v1 current entry before legacy folder checks when bootstrap is required', async () => {
    const tx = {};
    const prisma = {
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(tx)),
      folder: { count: jest.fn() },
      page: { count: jest.fn() },
    };
    const writer = {
      inspectCurrentLocked: jest.fn().mockResolvedValue({ mode: 'bootstrap_required' }),
    };
    const service = new SyncCapabilitiesService(prisma as any, writer as any);

    await expect(service.assertV1Compatible('space-1')).rejects.toMatchObject({
      syncCode: 'SYNC_PROTOCOL_UPGRADE_REQUIRED',
      response: expect.objectContaining({ protocolVersion: '1' }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(writer.inspectCurrentLocked).toHaveBeenCalledWith(tx, 'space-1');
    expect(prisma.folder.count).not.toHaveBeenCalled();
    expect(prisma.page.count).not.toHaveBeenCalled();
  });
});
