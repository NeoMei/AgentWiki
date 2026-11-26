import type { Request, Response } from 'express';
import { TreeSyncCapabilitiesV3Schema } from '@neomei/agentwiki-sync-protocol';
import { SyncCapabilitiesService } from './sync-capabilities.service';
import { syncDocumentLimitsMiddleware } from './sync-document-limits';

describe('SyncCapabilitiesService v3 compatibility gates', () => {
  it('returns capabilities accepted by the public strict v3 schema', async () => {
    const service = new SyncCapabilitiesService({} as any);

    expect(TreeSyncCapabilitiesV3Schema.parse(service.capabilitiesV3()))
      .toEqual(service.capabilitiesV3());
    await expect(service.hashV3()).resolves.toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps old clients on their existing V2 and V3 limits while opt-in requests negotiate 10 MiB', async () => {
    const service = new SyncCapabilitiesService({} as any);
    const discover = (header?: string) => {
      const request = { path: '/api/sync/v3/capabilities', get: () => header } as unknown as Request;
      return new Promise((resolve) => syncDocumentLimitsMiddleware(request, {} as Response, async () => {
        const [hashV2, hashV3] = await Promise.all([service.hashV2(), service.hashV3()]);
        resolve({ v2: service.capabilitiesV2(), v3: service.capabilitiesV3(), hashV2, hashV3 });
      }));
    };
    const [legacy, large] = await Promise.all([discover(), discover('10485760')]);
    const legacyLimits = {
      maxPageBytes: 1_048_576, maxBatchBytes: 4_194_304, maxResponseBytes: 4_194_304,
      maxClientTotalBodyBytes: 2_097_152, maxClientManifestBytes: 4_194_304,
    };
    const largeLimits = {
      maxPageBytes: 10_485_760, maxBatchBytes: 67_108_864, maxResponseBytes: 67_108_864,
      maxClientTotalBodyBytes: 10_485_760, maxClientManifestBytes: 67_108_864,
    };
    expect(legacy).toMatchObject({ v2: legacyLimits, v3: legacyLimits });
    expect(large).toMatchObject({ v2: largeLimits, v3: largeLimits });
    expect(legacy).not.toMatchObject({
      hashV2: (large as { hashV2: string }).hashV2, hashV3: (large as { hashV3: string }).hashV3,
    });
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
