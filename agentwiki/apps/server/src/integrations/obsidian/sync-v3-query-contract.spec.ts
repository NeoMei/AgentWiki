import { Readable } from 'node:stream';
import { SyncV3Controller } from './sync-v3.controller';
import { SyncApiException } from './sync-error';

describe('SyncV3Controller strict query contract', () => {
  const hash = 'a'.repeat(64);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const principal = {
    userId: 'user-1', credentialId: 'credential-1', credentialFamilyId: 'family-1',
    platformRole: 'user', deviceId: 'device-1', vaultId: 'vault-1',
  } as any;
  const request = { user: principal };
  const snapshotEnvelope = {
    protocolVersion: '3', spaceId: 'space-1', revision: 'rev-2', sequence: 2,
    revisionContentHash: hash, folderCount: '0', pageCount: '0', attachmentCount: '0',
    revisionManifestByteLength: '2', revisionBodyBytes: '0', revisionAttachmentBytes: '0',
    folders: [], pages: [], attachments: [], nextCursor: null,
  };
  const deltaEnvelope = {
    protocolVersion: '3', spaceId: 'space-1', fromRevision: '0', toRevision: 'rev-2',
    toSequence: 2, toRevisionContentHash: hash, toFolderCount: '0', toPageCount: '0',
    toAttachmentCount: '0', toRevisionManifestByteLength: '2', toRevisionBodyBytes: '0',
    toRevisionAttachmentBytes: '0', items: [], nextCursor: null,
  };

  let revisions: Record<string, jest.Mock>;
  let capabilities: Record<string, jest.Mock>;
  let bootstrap: Record<string, jest.Mock>;
  let blobs: Record<string, jest.Mock>;
  let pushSessions: Record<string, jest.Mock>;
  let controller: SyncV3Controller;

  beforeEach(() => {
    revisions = {
      listSpaces: jest.fn(), head: jest.fn(),
      snapshot: jest.fn().mockResolvedValue(snapshotEnvelope),
      delta: jest.fn().mockResolvedValue(deltaEnvelope),
      assertReadable: jest.fn(),
    };
    capabilities = { capabilitiesV3: jest.fn(), hashV3: jest.fn() };
    bootstrap = { previewBootstrap: jest.fn(), bootstrapConfirmed: jest.fn() };
    blobs = { putChunk: jest.fn(), complete: jest.fn(), openRevisionAttachment: jest.fn() };
    pushSessions = {
      create: jest.fn(), uploadBatch: jest.fn(), finalize: jest.fn(),
      get: jest.fn(), abort: jest.fn(),
    };
    controller = new SyncV3Controller(
      revisions as any,
      capabilities as any,
      bootstrap as any,
      blobs as any,
      pushSessions as any,
    );
  });

  const bootstrapBody = {
    protocolVersion: '3', baseRevision: 'rev-1', confirmationHash: hash, userConfirmed: true,
  };
  const createBody = {
    protocolVersion: '3', baseRevision: 'rev-1',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    capabilitiesHash: hash, confirmationHash: hash, confirmationByteLength: 1,
    changeCount: 0, totalBodyBytes: 0, attachmentCount: 0,
    transferBlobBytes: 0, blobRequirements: [],
  };

  const emptyQueryRoutes: Array<[string, (controller: any, query: unknown) => Promise<unknown>]> = [
    ['capabilities', (subject, query) => subject.negotiatedCapabilities(query)],
    ['spaces', (subject, query) => subject.listSpaces(query, request)],
    ['head', (subject, query) => subject.head('space-1', query, request)],
    ['create Push', (subject, query) => subject.createPushSession('space-1', query, createBody, request)],
    ['upload Push batch', (subject, query) => subject.uploadPushBatch('space-1', sessionId, '0', query, {}, request)],
    ['finalize Push', (subject, query) => subject.finalizePushSession('space-1', sessionId, query, {}, request)],
    ['Push status', (subject, query) => subject.getPushSession('space-1', sessionId, query, request)],
    ['abort Push', (subject, query) => subject.abortPushSession('space-1', sessionId, query, request)],
    ['bootstrap preview', (subject, query) => subject.bootstrapPreview('space-1', query, request)],
    ['bootstrap', (subject, query) => subject.bootstrapConfirmed('space-1', query, bootstrapBody, request)],
    ['Blob chunk', (subject, query) => subject.putBlobChunk(
      'space-1', sessionId, hash, '0', query, 'application/octet-stream', '0',
      Object.assign(Readable.from([]), request),
    )],
    ['Blob complete', (subject, query) => subject.completeBlob('space-1', sessionId, hash, query, {}, request)],
    ['fixed Blob download', (subject, query) => subject.revisionAttachmentContent(
      'space-1', 'rev-1', 'attachment-1', query, request, { setHeader: jest.fn() },
    )],
  ];

  it.each(emptyQueryRoutes)('%s rejects unknown and repeated query values before service access', async (_name, invoke) => {
    for (const query of [{ unexpected: '1' }, { unexpected: ['1', '2'] }]) {
      jest.clearAllMocks();
      const emptyQuery = jest.spyOn(controller as any, 'assertEmptyQuery');
      let failure: unknown;
      try {
        await invoke(controller as any, query);
      } catch (error) {
        failure = error;
      }
      expect(emptyQuery).toHaveBeenCalledWith(query);
      expect(failure).toBeInstanceOf(SyncApiException);
      expect((failure as SyncApiException).getStatus()).toBe(400);
      expect((failure as SyncApiException).getResponse()).toEqual({
        protocolVersion: '3', error: { code: 'PAYLOAD_INVALID', retryable: false },
      });
      for (const service of [revisions, capabilities, bootstrap, blobs, pushSessions]) {
        for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
      }
      emptyQuery.mockRestore();
    }
  });

  it.each([
    ['snapshot', (query: unknown) => (controller as any).snapshot('space-1', query, request), 'snapshot'],
    ['delta', (query: unknown) => (controller as any).delta('space-1', query, request), 'delta'],
  ])('%s rejects unknown and repeated/array query values before the read service', async (name, invoke, method) => {
    const invalidQueries = name === 'snapshot'
      ? [
        { revision: 'current', unexpected: '1' },
        { revision: ['current', 'rev-2'] },
        { revision: 'current', cursor: ['a', 'b'] },
        { revision: 'current', limit: ['1', '2'] },
      ]
      : [
        { from: '0', unexpected: '1' },
        { from: ['0', 'rev-1'] },
        { from: '0', cursor: ['a', 'b'] },
        { from: '0', limit: ['1', '2'] },
      ];
    for (const query of invalidQueries) {
      jest.clearAllMocks();
      await expect(invoke(query)).rejects.toMatchObject({ syncCode: 'PAYLOAD_INVALID' });
      expect(revisions[method]).not.toHaveBeenCalled();
    }
  });

  it('accepts only the documented snapshot and delta query fields and forwards canonical values', async () => {
    await (controller as any).snapshot('space-1', { revision: 'current' }, request);
    await (controller as any).snapshot(
      'space-1', { revision: 'rev-2', cursor: 'cursor-1', limit: '2' }, request,
    );
    await (controller as any).delta('space-1', { from: '0' }, request);
    await (controller as any).delta(
      'space-1', { from: 'rev-1', cursor: 'cursor-2', limit: '3' }, request,
    );
    expect(revisions.snapshot).toHaveBeenNthCalledWith(1, principal, 'space-1', 'current', undefined, 100);
    expect(revisions.snapshot).toHaveBeenNthCalledWith(2, principal, 'space-1', 'rev-2', 'cursor-1', 2);
    expect(revisions.delta).toHaveBeenNthCalledWith(1, principal, 'space-1', '0', undefined, 100);
    expect(revisions.delta).toHaveBeenNthCalledWith(2, principal, 'space-1', 'rev-1', 'cursor-2', 3);
  });
});
